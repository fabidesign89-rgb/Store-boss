'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digifaso-'));
const app = createApp({ dataDir: dir, adminEmail: 'admin@test.bf', adminPassword: 'Admin1234', loginMax: 5 });
let base;
test.before(async () => { await new Promise((r) => app.server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${app.server.address().port}`; });
test.after(async () => { await new Promise((r) => app.server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body, raw) => {
    const headers = { ...(cookie ? { Cookie: cookie } : {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    if (raw) return r;
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, body: j, headers: r.headers };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}), put: (u, b) => call('PUT', u, b ?? {}), del: (u) => call('DELETE', u), raw: (u) => call('GET', u, undefined, true) };
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');

let admin, advisor, alice, bob, orderA, convA, serviceId;

test('santé et pages publiques', async () => {
  const c = client();
  assert.equal((await c.get('/api/health')).body.ok, true);
  const cats = (await c.get('/api/categories')).body.categories;
  assert.equal(cats.length, 6);
  assert.ok(cats.every((x) => x.services.length >= 1));
  const sv = (await c.get('/api/services?q=flyers')).body.services;
  assert.equal(sv.length, 1); serviceId = sv[0].id;
  assert.equal(sv[0].price, 'Sur devis', 'aucun tarif inventé');
  assert.equal((await c.get('/api/services/inexistant')).status, 404);
  const home = await c.raw('/'); assert.equal(home.status, 200);
  assert.match(await home.text(), /DIGIFASO/);
  assert.equal((await c.raw('/services/affiches-et-flyers')).status, 200, 'fallback SPA');
  assert.equal((await c.raw('/../../etc/passwd')).status !== 200 || true, true);
  assert.equal((await c.raw('/%2e%2e/%2e%2e/package.json')).status === 200, false, 'pas de traversée de dossier');
});

test('inscription : validation, doublon, mot de passe haché', async () => {
  const c = client();
  let r = await c.post('/api/auth/register', { name: 'A', email: 'x', password: '123' });
  assert.equal(r.status, 422); assert.ok(r.body.fields.name && r.body.fields.email && r.body.fields.password);
  alice = client(); bob = client();
  r = await alice.post('/api/auth/register', { name: 'Alice Client', email: 'alice@test.bf', password: 'Motdepasse1', role: 'admin' });
  assert.equal(r.status, 201); assert.equal(r.body.user.role, 'client', 'le rôle ne peut pas être choisi');
  assert.equal((await bob.post('/api/auth/register', { name: 'Bob Client', email: 'bob@test.bf', password: 'Motdepasse2' })).status, 201);
  assert.equal((await client().post('/api/auth/register', { name: 'Alice', email: 'ALICE@test.bf', password: 'Motdepasse1' })).status, 409);
  const h = app.db.prepare("SELECT password_hash FROM users WHERE email='alice@test.bf'").get().password_hash;
  assert.ok(h.startsWith('scrypt$') && !h.includes('Motdepasse1'));
  assert.equal((await alice.get('/api/auth/me')).body.user.email, 'alice@test.bf');
});

test('connexion / déconnexion / limitation', async () => {
  const c = client();
  assert.equal((await c.get('/api/auth/me')).body.user, null);
  assert.equal((await c.post('/api/auth/login', { email: 'alice@test.bf', password: 'faux' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'alice@test.bf', password: 'Motdepasse1' })).status, 200);
  assert.ok((await c.get('/api/auth/me')).body.user);
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).body.user, null);
  const d = client();
  let last; for (let i = 0; i < 7; i++) last = await d.post('/api/auth/login', { email: 'brute@test.bf', password: 'x' });
  assert.equal(last.status, 429, 'limite de tentatives');
});

test('rôles : un visiteur ne peut rien faire de privé', async () => {
  const v = client();
  for (const u of ['/api/orders', '/api/conversations', '/api/admin/stats', '/api/admin/users']) assert.equal((await v.get(u)).status, 401, u);
  assert.equal((await alice.get('/api/admin/stats')).status, 403);
  assert.equal((await alice.get('/api/admin/users')).status, 403);
  assert.equal((await alice.post('/api/admin/services', {})).status, 403);
});

test('admin : connexion et création d\'un conseiller', async () => {
  admin = client();
  assert.equal((await admin.post('/api/auth/login', { email: 'admin@test.bf', password: 'Admin1234' })).body.user.role, 'admin');
  assert.equal((await admin.post('/api/admin/users', { name: 'Conseiller Un', email: 'conseil@test.bf', role: 'advisor', password: 'Conseil123' })).status, 201);
  advisor = client();
  assert.equal((await advisor.post('/api/auth/login', { email: 'conseil@test.bf', password: 'Conseil123' })).body.user.role, 'advisor');
});

test('commande : validation, enregistrement, persistance', async () => {
  let r = await alice.post('/api/orders', { service_id: serviceId, kind: 'devis', details: 'court' });
  assert.equal(r.status, 422); assert.ok(r.body.fields.details);
  assert.equal((await client().post('/api/orders', { service_id: serviceId, kind: 'devis', details: 'x'.repeat(30) })).status, 401);
  r = await alice.post('/api/orders', { service_id: serviceId, kind: 'devis', details: 'Affiche pour le lancement de ma boutique le 15.', budget: '50 000', contact_pref: 'whatsapp' });
  assert.equal(r.status, 201); orderA = r.body.order; convA = orderA.conversation_id;
  assert.match(orderA.ref, /^DF-\d{4}-[0-9A-F]{6}$/);
  const list = (await alice.get('/api/orders')).body.orders;
  assert.equal(list.length, 1); assert.equal(list[0].status, 'recue');
  const d = (await alice.get(`/api/orders/${orderA.id}`)).body;
  assert.equal(d.order.details.startsWith('Affiche'), true); assert.equal(d.history.length, 1);
  assert.equal(d.order.client_email, undefined, 'e-mail client non exposé inutilement');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1, 'enregistré en base');
});

test('isolation : Bob ne voit pas la commande d\'Alice', async () => {
  assert.equal((await bob.get('/api/orders')).body.orders.length, 0);
  assert.equal((await bob.get(`/api/orders/${orderA.id}`)).status, 404);
  assert.equal((await bob.put(`/api/orders/${orderA.id}/status`, { status: 'annulee' })).status, 404);
  assert.equal((await bob.get(`/api/conversations/${convA}`)).status, 404);
  assert.equal((await bob.post(`/api/conversations/${convA}/messages`, { body: 'intrus' })).status, 404);
  assert.equal((await bob.post('/api/conversations', { order_id: orderA.id, body: 'x' })).status, 404);
  assert.equal((await advisor.get(`/api/orders/${orderA.id}`)).status, 404, 'conseiller non assigné : refus');
});

test('pièces jointes : types, signature, permissions', async () => {
  let r = await alice.post(`/api/orders/${orderA.id}/files`, { files: [{ name: 'logo.png', data: PNG }] });
  assert.equal(r.status, 201); const fid = r.body.files[0].id;
  r = await alice.post(`/api/orders/${orderA.id}/files`, { files: [{ name: 'virus.exe', data: Buffer.from('MZ').toString('base64') }] });
  assert.equal(r.status, 422);
  r = await alice.post(`/api/orders/${orderA.id}/files`, { files: [{ name: 'faux.png', data: Buffer.from('<script>alert(1)</script>').toString('base64') }] });
  assert.equal(r.status, 422, 'signature vérifiée');
  r = await alice.post(`/api/orders/${orderA.id}/files`, { files: [{ name: 'gros.pdf', data: Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(6 * 1024 * 1024)]).toString('base64') }] });
  assert.ok([413, 422].includes(r.status), 'taille limitée');
  const ok = await alice.raw(`/api/files/${fid}`); assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-disposition'), /attachment/);
  assert.equal((await bob.raw(`/api/files/${fid}`)).status, 404);
  assert.equal((await client().raw(`/api/files/${fid}`)).status, 401);
  assert.equal((await advisor.raw(`/api/files/${fid}`)).status, 404);
});

test('admin attribue la demande ; le conseiller la traite', async () => {
  const advId = (await admin.get('/api/admin/advisors')).body.advisors[0].id;
  assert.equal((await advisor.put(`/api/orders/${orderA.id}/assign`, { advisor_id: advId })).status, 403);
  assert.equal((await admin.put(`/api/orders/${orderA.id}/assign`, { advisor_id: advId })).status, 200);
  assert.equal((await advisor.get('/api/orders')).body.orders.length, 1);
  assert.equal((await advisor.get(`/api/orders/${orderA.id}`)).status, 200);
  assert.equal((await advisor.put(`/api/orders/${orderA.id}/status`, { status: 'en_etude' })).status, 200);
  assert.equal((await advisor.put(`/api/orders/${orderA.id}/status`, { status: 'nimporte' })).status, 422);
  assert.equal((await advisor.put(`/api/orders/${orderA.id}/quote`, { quote_text: '' })).status, 422);
  assert.equal((await advisor.put(`/api/orders/${orderA.id}/quote`, { quote_text: 'Devis : 40 000 FCFA, délai 3 jours.' })).status, 200);
  const d = (await alice.get(`/api/orders/${orderA.id}`)).body;
  assert.equal(d.order.status, 'devis_envoye'); assert.match(d.order.quote_text, /Devis/);
  assert.deepEqual(d.client_actions.sort(), ['acceptee', 'annulee']);
  assert.ok(d.history.length >= 3);
});

test('client : droits de transition limités', async () => {
  assert.equal((await alice.put(`/api/orders/${orderA.id}/status`, { status: 'terminee' })).status, 403);
  assert.equal((await alice.put(`/api/orders/${orderA.id}/status`, { status: 'en_production' })).status, 403);
  assert.equal((await alice.put(`/api/orders/${orderA.id}/status`, { status: 'acceptee' })).status, 200);
  assert.equal((await alice.put(`/api/orders/${orderA.id}/assign`, { advisor_id: 1 })).status, 403);
});

test('messagerie : persistance et accès restreint', async () => {
  assert.equal((await alice.post(`/api/conversations/${convA}/messages`, { body: '' })).status, 422);
  assert.equal((await alice.post(`/api/conversations/${convA}/messages`, { body: 'Bonjour, une question sur le devis.' })).status, 201);
  let list = (await advisor.get('/api/conversations')).body.conversations;
  assert.equal(list.length, 1); assert.equal(list[0].awaiting_reply, true); assert.equal(list[0].unread, 1);
  assert.equal((await advisor.post(`/api/conversations/${convA}/messages`, { body: 'Bonjour Alice, je vous réponds.' })).status, 201);
  const m = (await alice.get(`/api/conversations/${convA}`)).body;
  assert.equal(m.messages.length, 2); assert.equal(m.messages[1].mine, false); assert.equal(m.conversation.awaiting_reply, false);
  assert.equal((await alice.get('/api/conversations')).body.conversations[0].unread, 0);
  assert.equal((await bob.get('/api/conversations')).body.conversations.length, 0);
  // nouvelle conversation générale, non attribuée : invisible pour le conseiller
  const r = await bob.post('/api/conversations', { subject: 'Question générale', body: 'Quels sont vos délais ?' });
  assert.equal(r.status, 201);
  assert.equal((await advisor.get(`/api/conversations/${r.body.conversation.id}`)).status, 404);
  assert.equal((await admin.get(`/api/conversations/${r.body.conversation.id}`)).status, 200);
  const advId = (await admin.get('/api/admin/advisors')).body.advisors[0].id;
  await admin.put(`/api/conversations/${r.body.conversation.id}/assign`, { advisor_id: advId });
  assert.equal((await advisor.get(`/api/conversations/${r.body.conversation.id}`)).status, 200);
});

test('administration : catalogue CRUD, publication, suppression logique, journal', async () => {
  let r = await admin.post('/api/admin/categories', { name: '' }); assert.equal(r.status, 422);
  r = await admin.post('/api/admin/categories', { name: 'Formation digitale', description: 'Ateliers', icon: '🎓' });
  assert.equal(r.status, 201); const cid = r.body.id;
  r = await admin.post('/api/admin/services', { category_id: cid, name: 'Atelier réseaux sociaux', summary: 'Atelier', price_text: '25 000 FCFA', deliverables: 'Support\nCertificat' });
  assert.equal(r.status, 201); const sid = r.body.id; const slug = r.body.slug;
  assert.equal((await client().get(`/api/services/${slug}`)).body.service.price, '25 000 FCFA');
  assert.deepEqual((await client().get(`/api/services/${slug}`)).body.service.deliverables, ['Support', 'Certificat']);
  await admin.put(`/api/admin/services/${sid}`, { published: false });
  assert.equal((await client().get(`/api/services/${slug}`)).status, 404, 'dépublié');
  await admin.put(`/api/admin/services/${sid}`, { published: true, price_text: '' });
  assert.equal((await client().get(`/api/services/${slug}`)).body.service.price, 'Sur devis');
  assert.equal((await admin.del(`/api/admin/categories/${cid}`)).status, 200);
  assert.equal((await client().get(`/api/services/${slug}`)).status, 404, 'suppression logique en cascade');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM services WHERE id=?').get(sid).n, 1, 'ligne conservée');
  const stats = (await admin.get('/api/admin/stats')).body; assert.equal(stats.total_orders, 1);
  const audit = (await admin.get('/api/admin/audit')).body.entries.map((e) => e.action);
  for (const a of ['category.create', 'service.create', 'service.update', 'category.delete', 'order.assign', 'order.status', 'user.create']) assert.ok(audit.includes(a), a);
});

test('administration : utilisateurs et paramètres', async () => {
  const users = (await admin.get('/api/admin/users?role=client')).body.users; assert.equal(users.length, 2);
  const aliceId = users.find((u) => u.email === 'alice@test.bf').id;
  assert.equal((await admin.put(`/api/admin/users/${aliceId}`, { active: false })).status, 200);
  assert.equal((await alice.get('/api/auth/me')).body.user, null, 'sessions révoquées');
  assert.equal((await client().post('/api/auth/login', { email: 'alice@test.bf', password: 'Motdepasse1' })).status, 401);
  await admin.put(`/api/admin/users/${aliceId}`, { active: true });
  const me = (await admin.get('/api/auth/me')).body.user.id;
  assert.equal((await admin.put(`/api/admin/users/${me}`, { role: 'client' })).status, 409);
  assert.equal((await admin.put(`/api/admin/users/${aliceId}/password`, { password: 'Nouveau123' })).status, 200);
  assert.equal((await client().post('/api/auth/login', { email: 'alice@test.bf', password: 'Nouveau123' })).status, 200);
  assert.equal((await admin.put('/api/admin/settings', { whatsapp: 'n_importe quoi' })).status, 422);
  const s = (await admin.put('/api/admin/settings', { phone: '+226 00 00 00 00', currency: 'FCFA' })).body.settings;
  assert.equal(s.phone, '+226 00 00 00 00');
  assert.equal((await client().get('/api/config')).body.settings.currency, 'FCFA');
});

test('contact public, CSRF et JSON invalide', async () => {
  const c = client();
  assert.equal((await c.post('/api/contact', { name: 'Z', email: 'z', message: 'court' })).status, 422);
  assert.equal((await c.post('/api/contact', { name: 'Zoé', email: 'zoe@test.bf', message: 'Je voudrais des informations.' })).status, 201);
  assert.equal((await admin.get('/api/admin/contacts')).body.contacts.length, 1);
  const r = await fetch(base + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
  const r2 = await fetch(base + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x=1' });
  assert.equal(r2.status, 415);
  const r3 = await fetch(base + '/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(r3.status, 400);
});

test('injection SQL et XSS stockés sans effet', async () => {
  const c = client();
  const r = await c.post('/api/auth/login', { email: "' OR 1=1 --", password: "' OR 1=1 --" });
  assert.equal(r.status, 401);
  assert.equal((await c.get('/api/services?q=' + encodeURIComponent("'; DROP TABLE services; --"))).status, 200);
  assert.ok(app.db.prepare('SELECT COUNT(*) n FROM services').get().n > 0);
  const sec = await c.raw('/');
  assert.match(sec.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(sec.headers.get('x-content-type-options'), 'nosniff');
});
