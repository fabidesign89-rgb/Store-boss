'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb, seed, SETTING_KEYS } = require('./db');
const { sqliteAdapter, tursoAdapter } = require('./dbadapter');
const U = require('./util');
const { HttpError, hashPassword, verifyPassword, sha256, slugify, clean, EMAIL_RE } = U;
const { checkFile, safeName, MAX_FILE, ALLOWED } = require('./files');

const STATUSES = {
  recue: 'Reçue', en_etude: 'En étude', devis_envoye: 'Devis envoyé', en_attente_validation: 'En attente de validation',
  acceptee: 'Acceptée', en_production: 'En production', en_attente_retour_client: 'En attente de retour client',
  terminee: 'Terminée', annulee: 'Annulée',
};
const CLIENT_CAN = { acceptee: ['devis_envoye', 'en_attente_validation'], annulee: ['recue', 'en_etude', 'devis_envoye', 'en_attente_validation', 'acceptee'] };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json' };

function createApp(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const production = (opts.production ?? process.env.NODE_ENV === 'production');
  const trustProxy = process.env.TRUST_PROXY === '1';
  const publicDir = path.join(__dirname, '..', 'public');
  const tursoUrl = opts.tursoUrl || process.env.TURSO_DATABASE_URL;
  let db;
  if (tursoUrl) db = tursoAdapter(tursoUrl, opts.tursoToken || process.env.TURSO_AUTH_TOKEN, opts.fetch);
  else { fs.mkdirSync(dataDir, { recursive: true }); db = sqliteAdapter(dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'digifaso.db')); }
  const loginLimit = U.makeLimiter(opts.loginMax || 10, 15 * 60 * 1000);
  const registerLimit = U.makeLimiter(opts.registerMax || 10, 60 * 60 * 1000);
  const contactLimit = U.makeLimiter(opts.contactMax || 5, 60 * 60 * 1000);
  const mkq = (ex) => (sql) => ({ get: (...a) => ex.get(sql, a), all: (...a) => ex.all(sql, a), run: (...a) => ex.run(sql, a) });
  const q = mkq(db);
  const tx = (fn) => db.tx((ex) => fn(mkq(ex))); // fn reçoit un « q » lié à la transaction
  const audit = async (actor, action, target = '', detail = '') => { await q('INSERT INTO audit_log(actor_id,action,target,detail) VALUES(?,?,?,?)').run(actor?.id ?? null, action, String(target), String(detail).slice(0, 500)); };

  // ---- Initialisation (schéma, contenu initial, compte administrateur) : une seule fois par instance
  let bootstrapInfo = null;
  const ready = (async () => {
    await openDb(db);
    await seed(db);
    if (!(await q("SELECT 1 FROM users WHERE role='admin'").get())) {
      const email = (opts.adminEmail || process.env.ADMIN_EMAIL || 'admin@exemple.com').toLowerCase();
      let pw = opts.adminPassword || process.env.ADMIN_PASSWORD;
      let generated = false;
      if (!pw) {
        if (db.kind === 'turso') { console.error('ADMIN_PASSWORD est obligatoire avec une base distante : aucun administrateur créé.'); return; }
        pw = crypto.randomBytes(9).toString('base64url'); generated = true;
      }
      try {
        await q('INSERT INTO users(email,name,password_hash,role) VALUES(?,?,?,?)').run(email, 'Administrateur', hashPassword(pw), 'admin');
        bootstrapInfo = { email, password: generated ? pw : null, generated };
      } catch (e) { /* créé en parallèle par une autre instance */ }
    }
  })();
  ready.catch((e) => console.error('Initialisation impossible :', e.message));

  // ---- Helpers
  const ipOf = (req) => (trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '?';
  const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Requête trop volumineuse.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const o = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(o && typeof o === 'object' ? o : {}); }
        catch { reject(new HttpError(400, 'JSON invalide.')); }
      });
      req.on('error', reject);
    });
  }
  const json = (res, status, obj, headers = {}) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };
  const userView = (u) => u && ({ id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, active: !!u.active, created_at: u.created_at });
  async function currentUser(req) {
    const tok = parseCookies(req).df_sid;
    if (!tok) return null;
    const s = (await q('SELECT user_id, expires_at FROM sessions WHERE token_hash=?').get(sha256(tok)));
    if (!s) return null;
    if (s.expires_at < Date.now()) { (await q('DELETE FROM sessions WHERE token_hash=?').run(sha256(tok))); return null; }
    const u = (await q('SELECT * FROM users WHERE id=?').get(s.user_id));
    return u && u.active ? u : null;
  }
  const setCookie = (tok, maxAge) => `df_sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
  async function startSession(res, user, status, extra) {
    const tok = crypto.randomBytes(32).toString('base64url');
    (await q('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha256(tok), user.id, Date.now() + 7 * 864e5));
    json(res, status, { user: userView(user), ...extra }, { 'Set-Cookie': setCookie(tok, 7 * 86400) });
  }
  const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Connexion requise.'); return ctx.user; };
  const requireRole = (ctx, ...roles) => { const u = requireUser(ctx); if (!roles.includes(u.role)) throw new HttpError(403, 'Accès refusé.'); return u; };
  const isStaff = (u) => u.role === 'admin' || u.role === 'advisor';
  const nid = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Introuvable.'); return n; };
  const needFields = (errs) => { if (Object.keys(errs).length) throw new HttpError(422, 'Veuillez corriger les champs indiqués.', errs); };

  function validatePassword(pw, errs) {
    if (typeof pw !== 'string' || pw.length < 8) errs.password = 'Le mot de passe doit contenir au moins 8 caractères.';
    else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errs.password = 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    else if (pw.length > 200) errs.password = 'Mot de passe trop long.';
  }
  const getSettings = async () => Object.fromEntries((await q('SELECT key,value FROM settings').all()).map((r) => [r.key, r.value]));

  // ---- Services (vue publique et admin)
  const svcView = (s) => ({ ...s, deliverables: JSON.parse(s.deliverables || '[]'), options: JSON.parse(s.options || '[]'),
    published: !!s.published, deleted: !!s.deleted, price: s.price_text || 'Sur devis', delay: s.delay_text || 'À définir avec votre conseiller' });

  // ---- Commandes
  function canSeeOrder(u, o) { return u.role === 'admin' || (u.role === 'client' && o.user_id === u.id) || (u.role === 'advisor' && o.advisor_id === u.id); }
  async function loadOrder(u, id) {
    const o = (await q(`SELECT o.*, c.name client_name, c.email client_email, c.phone client_phone, a.name advisor_name
      FROM orders o JOIN users c ON c.id=o.user_id LEFT JOIN users a ON a.id=o.advisor_id WHERE o.id=?`).get(id));
    if (!o || !canSeeOrder(u, o)) throw new HttpError(404, 'Demande introuvable.');
    return o;
  }
  const orderView = (o, u) => {
    const v = { ...o, selected_options: JSON.parse(o.selected_options || '[]'), status_label: STATUSES[o.status] };
    if (u.role === 'client') { delete v.client_email; delete v.client_phone; }
    return v;
  };
  async function setStatus(o, status, actor, note = '') {
    (await q("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?").run(status, o.id));
    (await q('INSERT INTO status_history(order_id,status,actor_id,note) VALUES(?,?,?,?)').run(o.id, status, actor.id, note));
  }

  // ---- Conversations
  async function loadConv(u, id) {
    const c = (await q(`SELECT c.*, cl.name client_name, a.name advisor_name, o.ref order_ref, o.advisor_id order_advisor_id
      FROM conversations c JOIN users cl ON cl.id=c.user_id LEFT JOIN users a ON a.id=c.advisor_id LEFT JOIN orders o ON o.id=c.order_id WHERE c.id=?`).get(id));
    if (!c) throw new HttpError(404, 'Conversation introuvable.');
    const ok = u.role === 'admin' || (u.role === 'client' && c.user_id === u.id) ||
      (u.role === 'advisor' && (c.advisor_id === u.id || c.order_advisor_id === u.id));
    if (!ok) throw new HttpError(404, 'Conversation introuvable.');
    return c;
  }
  async function convSummary(c, u) {
    const last = (await q('SELECT m.id, m.body, m.created_at, m.sender_id, s.role sender_role FROM messages m JOIN users s ON s.id=m.sender_id WHERE conversation_id=? ORDER BY m.id DESC LIMIT 1').get(c.id));
    const read = (await q('SELECT last_read_id FROM conversation_reads WHERE conversation_id=? AND user_id=?').get(c.id, u.id))?.last_read_id || 0;
    const unread = (await q('SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND id>? AND sender_id<>?').get(c.id, read, u.id)).n;
    // « En attente de réponse » = dernier message du client sans réponse d'un conseiller. Aucune disponibilité n'est simulée.
    return { id: c.id, subject: c.subject, order_id: c.order_id, order_ref: c.order_ref, client_name: c.client_name,
      advisor_name: c.advisor_name || null, created_at: c.created_at, updated_at: c.updated_at, unread,
      last_message: last ? { body: last.body.slice(0, 140), created_at: last.created_at } : null,
      awaiting_reply: !!last && last.sender_role === 'client' };
  }

  // ====================== ROUTES ======================
  const routes = [];
  const route = (method, pattern, handler, opt = {}) => {
    const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, opt });
  };

  route('GET', '/api/health', async (ctx) => ({ ok: true, time: new Date().toISOString() }));
  route('GET', '/api/config', async () => {
    const s = await getSettings();
    return { settings: s, statuses: STATUSES, allowed_files: ALLOWED, max_file_mb: MAX_FILE / 1048576 };
  });
  route('GET', '/api/categories', async () => {
    const cats = (await q('SELECT * FROM categories WHERE published=1 AND deleted=0 ORDER BY position,id').all());
    const svcs = (await q('SELECT * FROM services WHERE published=1 AND deleted=0 ORDER BY position,id').all()).map(svcView);
    return { categories: cats.map((c) => ({ ...c, published: !!c.published, services: svcs.filter((s) => s.category_id === c.id) })) };
  });
  route('GET', '/api/services', async (ctx) => {
    const { category, q: term } = ctx.query;
    let rows = (await q(`SELECT s.*, c.slug category_slug, c.name category_name FROM services s JOIN categories c ON c.id=s.category_id
      WHERE s.published=1 AND s.deleted=0 AND c.published=1 AND c.deleted=0 ORDER BY s.position,s.id`).all());
    if (category) rows = rows.filter((r) => r.category_slug === category);
    if (term) { const t = term.toLowerCase(); rows = rows.filter((r) => `${r.name} ${r.summary} ${r.description}`.toLowerCase().includes(t)); }
    return { services: rows.map(svcView) };
  });
  route('GET', '/api/services/:slug', async (ctx) => {
    const s = (await q(`SELECT s.*, c.slug category_slug, c.name category_name FROM services s JOIN categories c ON c.id=s.category_id
      WHERE s.slug=? AND s.published=1 AND s.deleted=0 AND c.published=1 AND c.deleted=0`).get(ctx.params.slug));
    if (!s) throw new HttpError(404, 'Service introuvable.');
    return { service: svcView(s) };
  });
  route('POST', '/api/contact', async (ctx) => {
    if (!contactLimit(ipOf(ctx.req))) throw new HttpError(429, 'Trop de messages envoyés. Réessayez plus tard.');
    const b = ctx.body, errs = {};
    const name = clean(b.name, 100), email = clean(b.email, 200), phone = clean(b.phone, 40), message = clean(b.message, 3000);
    if (name.length < 2) errs.name = 'Indiquez votre nom.';
    if (!EMAIL_RE.test(email)) errs.email = 'Adresse e-mail invalide.';
    if (message.length < 10) errs.message = 'Votre message doit contenir au moins 10 caractères.';
    needFields(errs);
    (await q('INSERT INTO contact_messages(name,email,phone,message) VALUES(?,?,?,?)').run(name, email, phone, message));
    return { ok: true, message: 'Message enregistré. Notre équipe le traitera depuis l\'espace d\'administration.' };
  }, { status: 201 });

  // ---- Auth
  route('POST', '/api/auth/register', async (ctx) => {
    if (!registerLimit(ipOf(ctx.req))) throw new HttpError(429, 'Trop de tentatives. Réessayez plus tard.');
    const b = ctx.body, errs = {};
    const name = clean(b.name, 100), email = clean(b.email, 200).toLowerCase(), phone = clean(b.phone, 40);
    if (name.length < 2) errs.name = 'Indiquez votre nom.';
    if (!EMAIL_RE.test(email)) errs.email = 'Adresse e-mail invalide.';
    validatePassword(b.password, errs);
    needFields(errs);
    if ((await q('SELECT 1 FROM users WHERE email=?').get(email))) throw new HttpError(409, 'Un compte existe déjà avec cet e-mail.', { email: 'Un compte existe déjà avec cet e-mail.' });
    const r = (await q('INSERT INTO users(email,name,phone,password_hash,role) VALUES(?,?,?,?,?)').run(email, name, phone, hashPassword(b.password), 'client'));
    const u = (await q('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid));
    return { __session: u, __status: 201 };
  });
  route('POST', '/api/auth/login', async (ctx) => {
    const email = clean(ctx.body.email, 200).toLowerCase();
    if (!loginLimit(ipOf(ctx.req) + '|' + email)) throw new HttpError(429, 'Trop de tentatives de connexion. Réessayez dans quelques minutes.');
    const u = (await q('SELECT * FROM users WHERE email=?').get(email));
    const ok = verifyPassword(String(ctx.body.password || ''), u ? u.password_hash : 'scrypt$00$00');
    if (!u || !ok || !u.active) throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
    return { __session: u, __status: 200 };
  });
  route('POST', '/api/auth/logout', async (ctx) => {
    const tok = parseCookies(ctx.req).df_sid;
    if (tok) (await q('DELETE FROM sessions WHERE token_hash=?').run(sha256(tok)));
    return { __clear: true };
  });
  route('GET', '/api/auth/me', async (ctx) => ({ user: userView(ctx.user) || null }));
  route('PUT', '/api/me', async (ctx) => {
    const u = requireUser(ctx), errs = {};
    const name = clean(ctx.body.name, 100), phone = clean(ctx.body.phone, 40);
    if (name.length < 2) errs.name = 'Indiquez votre nom.';
    needFields(errs);
    (await q('UPDATE users SET name=?, phone=? WHERE id=?').run(name, phone, u.id));
    return { user: userView((await q('SELECT * FROM users WHERE id=?').get(u.id))) };
  });
  route('PUT', '/api/me/password', async (ctx) => {
    const u = requireUser(ctx), errs = {};
    if (!verifyPassword(String(ctx.body.current || ''), u.password_hash)) errs.current = 'Mot de passe actuel incorrect.';
    validatePassword(ctx.body.password, errs);
    needFields(errs);
    (await q('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(ctx.body.password), u.id));
    const tok = sha256(parseCookies(ctx.req).df_sid || '');
    (await q('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(u.id, tok));
    return { ok: true };
  });

  // ---- Commandes / devis
  route('POST', '/api/orders', async (ctx) => {
    const u = requireRole(ctx, 'client'); const b = ctx.body, errs = {};
    const svc = (await q('SELECT * FROM services WHERE id=? AND published=1 AND deleted=0').get(Number(b.service_id)));
    if (!svc) errs.service_id = 'Choisissez un service valide.';
    if (!['devis', 'commande'].includes(b.kind)) errs.kind = 'Type de demande invalide.';
    const details = clean(b.details, 5000);
    if (details.length < 20) errs.details = 'Décrivez votre besoin en au moins 20 caractères.';
    const budget = clean(b.budget, 100), deadline = clean(b.deadline, 100);
    const contact_pref = ['messagerie', 'telephone', 'whatsapp', 'email'].includes(b.contact_pref) ? b.contact_pref : 'messagerie';
    let opts2 = Array.isArray(b.selected_options) ? b.selected_options.map((x) => clean(x, 120)).filter(Boolean).slice(0, 20) : [];
    needFields(errs);
    const ref = 'DF-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const result = await tx(async (q) => {
      const r = await q('INSERT INTO orders(ref,user_id,service_id,service_name,kind,details,selected_options,budget,deadline,contact_pref) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(ref, u.id, svc.id, svc.name, b.kind, details, JSON.stringify(opts2), budget, deadline, contact_pref);
      const id = Number(r.lastInsertRowid);
      (await q('INSERT INTO status_history(order_id,status,actor_id) VALUES(?,?,?)').run(id, 'recue', u.id));
      const cr = (await q('INSERT INTO conversations(user_id,order_id,subject) VALUES(?,?,?)').run(u.id, id, `${svc.name} — ${ref}`));
      return { id, conversation_id: Number(cr.lastInsertRowid) };
    });
    return { order: { id: result.id, ref, status: 'recue', conversation_id: result.conversation_id }, message: 'Votre demande a bien été enregistrée.', __status: 201 };
  });
  route('GET', '/api/orders', async (ctx) => {
    const u = requireUser(ctx);
    let sql = 'SELECT o.id,o.ref,o.service_name,o.kind,o.status,o.created_at,o.updated_at,o.user_id,o.advisor_id,c.name client_name,a.name advisor_name FROM orders o JOIN users c ON c.id=o.user_id LEFT JOIN users a ON a.id=o.advisor_id';
    const where = [], args = [];
    if (u.role === 'client') { where.push('o.user_id=?'); args.push(u.id); }
    if (u.role === 'advisor') { where.push('o.advisor_id=?'); args.push(u.id); }
    if (ctx.query.status && STATUSES[ctx.query.status]) { where.push('o.status=?'); args.push(ctx.query.status); }
    if (u.role === 'admin' && ctx.query.unassigned === '1') where.push('o.advisor_id IS NULL');
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY o.id DESC LIMIT 300';
    return { orders: (await q(sql).all(...args)).map((o) => ({ ...o, status_label: STATUSES[o.status] })) };
  });
  route('GET', '/api/orders/:id', async (ctx) => {
    const u = requireUser(ctx); const o = await loadOrder(u, nid(ctx.params.id));
    const files = (await q('SELECT id,original_name,mime,size,created_at,uploader_id FROM order_files WHERE order_id=? ORDER BY id').all(o.id));
    const history = (await q('SELECT h.status,h.note,h.created_at,u.name actor FROM status_history h LEFT JOIN users u ON u.id=h.actor_id WHERE order_id=? ORDER BY h.id').all(o.id))
      .map((h) => ({ ...h, status_label: STATUSES[h.status] }));
    const conv = (await q('SELECT id FROM conversations WHERE order_id=? ORDER BY id LIMIT 1').get(o.id));
    return { order: orderView(o, u), files, history, conversation_id: conv?.id || null,
      client_actions: u.role === 'client' ? Object.entries(CLIENT_CAN).filter(([, from]) => from.includes(o.status)).map(([s]) => s) : [] };
  });
  route('POST', '/api/orders/:id/files', async (ctx) => {
    const u = requireUser(ctx); const o = await loadOrder(u, nid(ctx.params.id));
    if (o.status === 'annulee' || o.status === 'terminee') throw new HttpError(409, 'Cette demande est clôturée.');
    const list = Array.isArray(ctx.body.files) ? ctx.body.files : [];
    if (!list.length || list.length > 5) throw new HttpError(422, 'Envoyez entre 1 et 5 fichiers à la fois.');
    if ((await q('SELECT COUNT(*) n FROM order_files WHERE order_id=?').get(o.id)).n + list.length > 15) throw new HttpError(422, 'Maximum 15 fichiers par demande.');
    const prepared = list.map((f) => {
      const name = safeName(f.name || 'fichier');
      const buf = Buffer.from(String(f.data || ''), 'base64');
      const chk = checkFile(name, buf);
      if (chk.error) throw new HttpError(422, `${name} : ${chk.error}`);
      return { name, buf, mime: chk.mime, ext: chk.ext };
    });
    const saved = [];
    for (const f of prepared) {
      const r = await q('INSERT INTO order_files(order_id,uploader_id,original_name,mime,size,data) VALUES(?,?,?,?,?,?)').run(o.id, u.id, f.name, f.mime, f.buf.length, f.buf);
      saved.push({ id: r.lastInsertRowid, original_name: f.name, size: f.buf.length });
    }
    return { files: saved, __status: 201 };
  }, { limit: 4.4 * 1024 * 1024 });
  route('GET', '/api/files/:id', async (ctx) => {
    const u = requireUser(ctx);
    const f = await q('SELECT * FROM order_files WHERE id=?').get(nid(ctx.params.id));
    if (!f) throw new HttpError(404, 'Fichier introuvable.');
    await loadOrder(u, f.order_id); // vérifie la permission (404 sinon)
    return { __buffer: Buffer.from(f.data), name: f.original_name, mime: f.mime };
  });
  route('PUT', '/api/orders/:id/status', async (ctx) => {
    const u = requireUser(ctx); const o = await loadOrder(u, nid(ctx.params.id));
    const status = ctx.body.status, note = clean(ctx.body.note, 500);
    if (!STATUSES[status]) throw new HttpError(422, 'Statut invalide.');
    if (u.role === 'client') {
      if (!(CLIENT_CAN[status] || []).includes(o.status)) throw new HttpError(403, 'Ce changement de statut n\'est pas autorisé.');
    }
    if (status === o.status) throw new HttpError(409, 'La demande a déjà ce statut.');
    await setStatus(o, status, u, note);
    if (isStaff(u)) await audit(u, 'order.status', o.ref, `${o.status} → ${status}`);
    return { ok: true, status, status_label: STATUSES[status] };
  });
  route('PUT', '/api/orders/:id/quote', async (ctx) => {
    const u = requireRole(ctx, 'admin', 'advisor'); const o = await loadOrder(u, nid(ctx.params.id));
    const quote = clean(ctx.body.quote_text, 3000);
    if (!quote) throw new HttpError(422, 'Saisissez le contenu du devis.', { quote_text: 'Saisissez le contenu du devis.' });
    (await q("UPDATE orders SET quote_text=?, updated_at=datetime('now') WHERE id=?").run(quote, o.id));
    if (['recue', 'en_etude'].includes(o.status)) await setStatus(o, 'devis_envoye', u, 'Devis envoyé');
    await audit(u, 'order.quote', o.ref);
    return { ok: true };
  });
  route('PUT', '/api/orders/:id/assign', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const o = await loadOrder(u, nid(ctx.params.id));
    let aid = ctx.body.advisor_id === null || ctx.body.advisor_id === '' ? null : Number(ctx.body.advisor_id);
    if (aid !== null) {
      const a = (await q("SELECT id FROM users WHERE id=? AND role='advisor' AND active=1").get(aid));
      if (!a) throw new HttpError(422, 'Conseiller invalide.');
    }
    await tx(async (q) => {
      (await q("UPDATE orders SET advisor_id=?, updated_at=datetime('now') WHERE id=?").run(aid, o.id));
      (await q('UPDATE conversations SET advisor_id=? WHERE order_id=?').run(aid, o.id));
    });
    await audit(u, 'order.assign', o.ref, `conseiller ${aid}`);
    return { ok: true };
  });

  // ---- Messagerie
  route('GET', '/api/conversations', async (ctx) => {
    const u = requireUser(ctx);
    let rows;
    if (u.role === 'client') rows = (await q('SELECT c.*, cl.name client_name, a.name advisor_name, o.ref order_ref FROM conversations c JOIN users cl ON cl.id=c.user_id LEFT JOIN users a ON a.id=c.advisor_id LEFT JOIN orders o ON o.id=c.order_id WHERE c.user_id=? ORDER BY c.updated_at DESC, c.id DESC').all(u.id));
    else if (u.role === 'advisor') rows = (await q('SELECT c.*, cl.name client_name, a.name advisor_name, o.ref order_ref FROM conversations c JOIN users cl ON cl.id=c.user_id LEFT JOIN users a ON a.id=c.advisor_id LEFT JOIN orders o ON o.id=c.order_id WHERE c.advisor_id=? OR o.advisor_id=? ORDER BY c.updated_at DESC, c.id DESC').all(u.id, u.id));
    else rows = (await q('SELECT c.*, cl.name client_name, a.name advisor_name, o.ref order_ref FROM conversations c JOIN users cl ON cl.id=c.user_id LEFT JOIN users a ON a.id=c.advisor_id LEFT JOIN orders o ON o.id=c.order_id ORDER BY c.updated_at DESC, c.id DESC LIMIT 300').all());
    return { conversations: await Promise.all(rows.map((c) => convSummary(c, u))) };
  });
  route('POST', '/api/conversations', async (ctx) => {
    const u = requireRole(ctx, 'client'); const b = ctx.body, errs = {};
    const subject = clean(b.subject, 150), body = clean(b.body, 4000);
    let order = null;
    if (b.order_id) { order = (await q('SELECT * FROM orders WHERE id=? AND user_id=?').get(Number(b.order_id), u.id)); if (!order) throw new HttpError(404, 'Demande introuvable.'); }
    if (!order && subject.length < 3) errs.subject = 'Indiquez un sujet.';
    if (body.length < 1) errs.body = 'Écrivez votre message.';
    needFields(errs);
    const id = await tx(async (q) => {
      const r = (await q('INSERT INTO conversations(user_id,order_id,advisor_id,subject) VALUES(?,?,?,?)').run(u.id, order?.id ?? null, order?.advisor_id ?? null, subject || `${order.service_name} — ${order.ref}`));
      (await q('INSERT INTO messages(conversation_id,sender_id,body) VALUES(?,?,?)').run(r.lastInsertRowid, u.id, body));
      return Number(r.lastInsertRowid);
    });
    return { conversation: { id }, __status: 201 };
  });
  route('GET', '/api/conversations/:id', async (ctx) => {
    const u = requireUser(ctx); const c = await loadConv(u, nid(ctx.params.id));
    const after = Number(ctx.query.after) || 0;
    const msgs = (await q('SELECT m.id,m.body,m.created_at,m.sender_id,s.name sender_name,s.role sender_role FROM messages m JOIN users s ON s.id=m.sender_id WHERE conversation_id=? AND m.id>? ORDER BY m.id').all(c.id, after));
    if (msgs.length) (await q(`INSERT INTO conversation_reads(conversation_id,user_id,last_read_id) VALUES(?,?,?)
      ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_id=MAX(last_read_id, excluded.last_read_id)`).run(c.id, u.id, msgs[msgs.length - 1].id));
    return { conversation: await convSummary(c, u), messages: msgs.map((m) => ({ ...m, mine: m.sender_id === u.id })) };
  });
  route('POST', '/api/conversations/:id/messages', async (ctx) => {
    const u = requireUser(ctx); const c = await loadConv(u, nid(ctx.params.id));
    const body = clean(ctx.body.body, 4000);
    if (!body) throw new HttpError(422, 'Écrivez votre message.', { body: 'Écrivez votre message.' });
    const r = (await q('INSERT INTO messages(conversation_id,sender_id,body) VALUES(?,?,?)').run(c.id, u.id, body));
    (await q("UPDATE conversations SET updated_at=datetime('now') WHERE id=?").run(c.id));
    (await q(`INSERT INTO conversation_reads(conversation_id,user_id,last_read_id) VALUES(?,?,?)
      ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_read_id=MAX(last_read_id, excluded.last_read_id)`).run(c.id, u.id, r.lastInsertRowid));
    return { message: { id: Number(r.lastInsertRowid), body, mine: true, sender_name: u.name, sender_role: u.role, created_at: new Date().toISOString().slice(0, 19).replace('T', ' ') }, __status: 201 };
  });
  route('PUT', '/api/conversations/:id/assign', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const c = await loadConv(u, nid(ctx.params.id));
    const aid = ctx.body.advisor_id ? Number(ctx.body.advisor_id) : null;
    if (aid && !(await q("SELECT 1 FROM users WHERE id=? AND role='advisor' AND active=1").get(aid))) throw new HttpError(422, 'Conseiller invalide.');
    (await q('UPDATE conversations SET advisor_id=? WHERE id=?').run(aid, c.id));
    await audit(u, 'conversation.assign', c.id, `conseiller ${aid}`);
    return { ok: true };
  });

  // ---- Administration
  route('GET', '/api/admin/stats', async (ctx) => {
    requireRole(ctx, 'admin');
    const byStatus = Object.fromEntries(Object.keys(STATUSES).map((s) => [s, 0]));
    for (const r of (await q('SELECT status, COUNT(*) n FROM orders GROUP BY status').all())) byStatus[r.status] = r.n;
    return { by_status: byStatus, total_orders: Object.values(byStatus).reduce((a, b) => a + b, 0),
      unassigned: (await q("SELECT COUNT(*) n FROM orders WHERE advisor_id IS NULL AND status NOT IN('annulee','terminee')").get()).n,
      clients: (await q("SELECT COUNT(*) n FROM users WHERE role='client'").get()).n,
      awaiting_conversations: (await q(`SELECT COUNT(*) n FROM conversations c WHERE (SELECT s.role FROM messages m JOIN users s ON s.id=m.sender_id WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1)='client'`).get()).n,
      new_contacts: (await q('SELECT COUNT(*) n FROM contact_messages WHERE handled=0').get()).n,
      recent: (await q('SELECT o.id,o.ref,o.service_name,o.status,o.created_at,c.name client_name FROM orders o JOIN users c ON c.id=o.user_id ORDER BY o.id DESC LIMIT 8').all()).map((o) => ({ ...o, status_label: STATUSES[o.status] })) };
  });
  const catBody = (b, partial) => {
    const errs = {}; const name = clean(b.name, 100);
    if (!partial || 'name' in b) if (name.length < 2) errs.name = 'Indiquez un nom.';
    needFields(errs);
    return { name, description: clean(b.description, 600), icon: clean(b.icon, 8), position: Number.isFinite(Number(b.position)) ? Number(b.position) : 0, published: b.published === false || b.published === 0 ? 0 : 1 };
  };
  route('GET', '/api/admin/categories', async (ctx) => { requireRole(ctx, 'admin'); return { categories: (await q('SELECT * FROM categories WHERE deleted=0 ORDER BY position,id').all()).map((c) => ({ ...c, published: !!c.published })) }; });
  route('POST', '/api/admin/categories', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const c = catBody(ctx.body);
    let slug = slugify(c.name), i = 2; while ((await q('SELECT 1 FROM categories WHERE slug=?').get(slug))) slug = slugify(c.name) + '-' + i++;
    const r = (await q('INSERT INTO categories(slug,name,description,icon,position,published) VALUES(?,?,?,?,?,?)').run(slug, c.name, c.description, c.icon, c.position, c.published));
    await audit(u, 'category.create', slug);
    return { id: Number(r.lastInsertRowid), slug, __status: 201 };
  });
  route('PUT', '/api/admin/categories/:id', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const id = nid(ctx.params.id);
    const cur = (await q('SELECT * FROM categories WHERE id=? AND deleted=0').get(id)); if (!cur) throw new HttpError(404, 'Catégorie introuvable.');
    const c = catBody({ ...cur, ...ctx.body });
    (await q('UPDATE categories SET name=?,description=?,icon=?,position=?,published=? WHERE id=?').run(c.name, c.description, c.icon, c.position, c.published, id));
    await audit(u, 'category.update', cur.slug, c.published ? '' : 'dépubliée');
    return { ok: true };
  });
  route('DELETE', '/api/admin/categories/:id', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const id = nid(ctx.params.id);
    const cur = (await q('SELECT * FROM categories WHERE id=? AND deleted=0').get(id)); if (!cur) throw new HttpError(404, 'Catégorie introuvable.');
    await tx(async (q) => { (await q('UPDATE categories SET deleted=1, published=0 WHERE id=?').run(id)); (await q('UPDATE services SET deleted=1, published=0 WHERE category_id=?').run(id)); });
    await audit(u, 'category.delete', cur.slug);
    return { ok: true };
  });
  const svcBody = async (b) => {
    const errs = {}; const name = clean(b.name, 120);
    if (name.length < 2) errs.name = 'Indiquez un nom.';
    const cat = (await q('SELECT id FROM categories WHERE id=? AND deleted=0').get(Number(b.category_id)));
    if (!cat) errs.category_id = 'Choisissez une catégorie.';
    const list = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => clean(x, 200)).filter(Boolean).slice(0, 30);
    needFields(errs);
    return { category_id: cat.id, name, summary: clean(b.summary, 300), description: clean(b.description, 5000),
      deliverables: JSON.stringify(list(b.deliverables)), options: JSON.stringify(list(b.options)),
      delay_text: clean(b.delay_text, 120), price_text: clean(b.price_text, 120), position: Number.isFinite(Number(b.position)) ? Number(b.position) : 0,
      published: b.published === false || b.published === 0 ? 0 : 1 };
  };
  route('GET', '/api/admin/services', async (ctx) => { requireRole(ctx, 'admin'); return { services: (await q('SELECT * FROM services WHERE deleted=0 ORDER BY category_id,position,id').all()).map(svcView) }; });
  route('POST', '/api/admin/services', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const s = await svcBody(ctx.body);
    let slug = slugify(s.name), i = 2; while ((await q('SELECT 1 FROM services WHERE slug=?').get(slug))) slug = slugify(s.name) + '-' + i++;
    const r = await q('INSERT INTO services(category_id,slug,name,summary,description,deliverables,options,delay_text,price_text,position,published) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(s.category_id, slug, s.name, s.summary, s.description, s.deliverables, s.options, s.delay_text, s.price_text, s.position, s.published);
    await audit(u, 'service.create', slug);
    return { id: Number(r.lastInsertRowid), slug, __status: 201 };
  });
  route('PUT', '/api/admin/services/:id', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const id = nid(ctx.params.id);
    const cur = (await q('SELECT * FROM services WHERE id=? AND deleted=0').get(id)); if (!cur) throw new HttpError(404, 'Service introuvable.');
    const merged = { ...svcView(cur), ...ctx.body };
    const s = await svcBody(merged);
    await q('UPDATE services SET category_id=?,name=?,summary=?,description=?,deliverables=?,options=?,delay_text=?,price_text=?,position=?,published=? WHERE id=?')
      .run(s.category_id, s.name, s.summary, s.description, s.deliverables, s.options, s.delay_text, s.price_text, s.position, s.published, id);
    await audit(u, 'service.update', cur.slug, s.published ? '' : 'dépublié');
    return { ok: true };
  });
  route('DELETE', '/api/admin/services/:id', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const id = nid(ctx.params.id);
    const cur = (await q('SELECT * FROM services WHERE id=? AND deleted=0').get(id)); if (!cur) throw new HttpError(404, 'Service introuvable.');
    (await q('UPDATE services SET deleted=1, published=0 WHERE id=?').run(id));
    await audit(u, 'service.delete', cur.slug);
    return { ok: true };
  });
  route('GET', '/api/admin/users', async (ctx) => {
    requireRole(ctx, 'admin');
    const role = ['client', 'advisor', 'admin'].includes(ctx.query.role) ? ctx.query.role : null;
    const rows = role ? (await q('SELECT * FROM users WHERE role=? ORDER BY id DESC').all(role)) : (await q('SELECT * FROM users ORDER BY id DESC').all());
    return { users: await Promise.all(rows.map(async (r) => ({ ...userView(r), orders: (await q('SELECT COUNT(*) n FROM orders WHERE user_id=?').get(r.id)).n, assigned: (await q('SELECT COUNT(*) n FROM orders WHERE advisor_id=?').get(r.id)).n }))) };
  });
  route('GET', '/api/admin/advisors', async (ctx) => { requireRole(ctx, 'admin'); return { advisors: (await q("SELECT id,name,email FROM users WHERE role='advisor' AND active=1 ORDER BY name").all()) }; });
  route('POST', '/api/admin/users', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const b = ctx.body, errs = {};
    const name = clean(b.name, 100), email = clean(b.email, 200).toLowerCase();
    if (name.length < 2) errs.name = 'Indiquez un nom.';
    if (!EMAIL_RE.test(email)) errs.email = 'Adresse e-mail invalide.';
    if (!['advisor', 'admin'].includes(b.role)) errs.role = 'Rôle invalide.';
    validatePassword(b.password, errs); needFields(errs);
    if ((await q('SELECT 1 FROM users WHERE email=?').get(email))) throw new HttpError(409, 'Cet e-mail est déjà utilisé.', { email: 'Cet e-mail est déjà utilisé.' });
    const r = (await q('INSERT INTO users(email,name,phone,password_hash,role) VALUES(?,?,?,?,?)').run(email, name, clean(b.phone, 40), hashPassword(b.password), b.role));
    await audit(u, 'user.create', email, b.role);
    return { id: Number(r.lastInsertRowid), __status: 201 };
  });
  route('PUT', '/api/admin/users/:id', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const id = nid(ctx.params.id);
    const t = (await q('SELECT * FROM users WHERE id=?').get(id)); if (!t) throw new HttpError(404, 'Utilisateur introuvable.');
    const b = ctx.body;
    if (id === u.id && (b.active === false || (b.role && b.role !== 'admin'))) throw new HttpError(409, 'Vous ne pouvez pas retirer vos propres droits.');
    const role = b.role !== undefined ? b.role : t.role;
    if (!['client', 'advisor', 'admin'].includes(role)) throw new HttpError(422, 'Rôle invalide.');
    const active = b.active === undefined ? t.active : (b.active ? 1 : 0);
    (await q('UPDATE users SET role=?, active=? WHERE id=?').run(role, active, id));
    if (!active) (await q('DELETE FROM sessions WHERE user_id=?').run(id));
    await audit(u, 'user.update', t.email, `rôle=${role} actif=${active}`);
    return { ok: true };
  });
  route('PUT', '/api/admin/users/:id/password', async (ctx) => {
    const u = requireRole(ctx, 'admin'); const id = nid(ctx.params.id); const errs = {};
    const t = (await q('SELECT * FROM users WHERE id=?').get(id)); if (!t) throw new HttpError(404, 'Utilisateur introuvable.');
    validatePassword(ctx.body.password, errs); needFields(errs);
    (await q('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(ctx.body.password), id));
    (await q('DELETE FROM sessions WHERE user_id=?').run(id));
    await audit(u, 'user.password_reset', t.email);
    return { ok: true };
  });
  route('GET', '/api/admin/settings', async (ctx) => { requireRole(ctx, 'admin'); return { settings: await getSettings() }; });
  route('PUT', '/api/admin/settings', async (ctx) => {
    const u = requireRole(ctx, 'admin');
    const w0 = clean(String(ctx.body.whatsapp ?? ''), 300);
    if (w0 && !/^https?:\/\//.test(w0) && !/^\+?[\d\s]+$/.test(w0)) throw new HttpError(422, 'WhatsApp : saisissez un lien https:// ou un numéro.', { whatsapp: 'Lien https:// ou numéro attendu.' });
    await tx(async (q) => { for (const k of SETTING_KEYS) if (k in ctx.body) (await q('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, clean(String(ctx.body[k] ?? ''), 300))); });
    await audit(u, 'settings.update', '', Object.keys(ctx.body).join(','));
    return { settings: await getSettings() };
  });
  route('GET', '/api/admin/audit', async (ctx) => { requireRole(ctx, 'admin'); return { entries: (await q('SELECT a.*, u.name actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200').all()) }; });
  route('GET', '/api/admin/contacts', async (ctx) => { requireRole(ctx, 'admin'); return { contacts: (await q('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 200').all()).map((c) => ({ ...c, handled: !!c.handled })) }; });
  route('PUT', '/api/admin/contacts/:id', async (ctx) => {
    const u = requireRole(ctx, 'admin'); (await q('UPDATE contact_messages SET handled=? WHERE id=?').run(ctx.body.handled ? 1 : 0, nid(ctx.params.id))); await audit(u, 'contact.handled', ctx.params.id); return { ok: true };
  });

  // ====================== SERVEUR ======================
  const SEC = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
  function serveStatic(req, res, pathname) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    let file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep) && file !== publicDir) { res.writeHead(400, SEC); return res.end('Bad request'); }
    const isAsset = path.extname(rel) !== '';
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (isAsset) { res.writeHead(404, { ...SEC, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
      file = path.join(publicDir, 'index.html'); // routes de l'application (SPA)
    }
    const ext = path.extname(file);
    res.writeHead(200, { ...SEC, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/')) { try { await ready; } catch { throw new HttpError(503, 'Base de données indisponible. Vérifiez la configuration.'); } }
      if (!pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, SEC); return res.end(); }
        if (pathname === '/robots.txt') { res.writeHead(200, { ...SEC, 'Content-Type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /admin\nDisallow: /espace\nDisallow: /api/\n'); }
        return serveStatic(req, res, pathname);
      }
      const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
      if (!r) {
        if (routes.some((x) => x.re.test(pathname))) throw new HttpError(405, 'Méthode non autorisée.');
        throw new HttpError(404, 'Ressource introuvable.');
      }
      const m = pathname.match(r.re); const params = {}; r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
      let body = {};
      if (!['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origine non autorisée.');
        if (!String(req.headers['content-type'] || '').startsWith('application/json') && Number(req.headers['content-length'] || 0) > 0) throw new HttpError(415, 'Content-Type JSON requis.');
        body = await readBody(req, r.opt.limit || 64 * 1024);
      }
      const ctx = { req, res, params, body, query: Object.fromEntries(url.searchParams), user: await currentUser(req) };
      const out = await r.handler(ctx);
      const status = out?.__status || r.opt.status || 200;
      if (out?.__status) delete out.__status;
      if (out?.__session) return await startSession(res, out.__session, status);
      if (out?.__clear) return json(res, 200, { ok: true }, { 'Set-Cookie': setCookie('', 0) });
      if (out?.__buffer) {
        res.writeHead(200, { ...SEC, 'Content-Type': out.mime, 'Content-Length': out.__buffer.length, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.name)}`, 'Cache-Control': 'private, no-store' });
        return res.end(out.__buffer);
      }
      json(res, status, out);
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message, fields: e.fields });
      console.error('Erreur serveur :', e.message);
      json(res, 500, { error: 'Une erreur interne est survenue. Réessayez plus tard.' });
    }
  };
  const server = http.createServer(handler);
  server.on('close', () => { try { db.close(); } catch {} });
  return { server, handler, db, ready, get bootstrapInfo() { return bootstrapInfo; }, STATUSES };
}
module.exports = { createApp, STATUSES };
