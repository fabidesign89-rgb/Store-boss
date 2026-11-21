'use strict';
// Noyau : API, routeur, mise en page, utilitaires. Toutes les données viennent du serveur (base SQLite).
const DF = { user: null, config: { settings: {}, statuses: {} }, routes: [], timers: [], unread: 0 };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TOR = 'À renseigner';

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw { status: 0, message: 'Connexion impossible. Vérifiez votre réseau et réessayez.' };
  }
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) throw { status: res.status, message: (data && data.error) || 'Erreur inattendue.', fields: data && data.fields };
  return data;
}
const fmtDate = (s) => { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }); };
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' Mo' : Math.max(1, Math.round(n / 1024)) + ' Ko');
const pill = (st) => `<span class="pill s-${esc(st)}">${esc(DF.config.statuses[st] || st)}</span>`;
const announce = (t) => { $('#live').textContent = ''; setTimeout(() => ($('#live').textContent = t), 50); };
const setMeta = (title, desc) => {
  document.title = title + ' — DIGIFASO';
  if (desc) $('meta[name=description]').setAttribute('content', desc);
};
const render = (html) => { const m = $('#main'); m.innerHTML = html; return m; };
const homeOf = (u) => (u.role === 'admin' ? '/admin' : u.role === 'advisor' ? '/conseiller' : '/espace');

// ---- Formulaires
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.type === 'file' || el.type === 'submit') continue;
    if (el.type === 'checkbox') { o[el.name] = o[el.name] || []; if (el.checked) o[el.name].push(el.value); continue; }
    if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; continue; }
    o[el.name] = el.value;
  }
  return o;
}
function showErrors(form, e) {
  $$('.err.field', form).forEach((n) => n.remove()); $$('.f.bad', form).forEach((n) => n.classList.remove('bad'));
  const box = $('.formerr', form); if (box) box.innerHTML = '';
  let first = null;
  for (const [k, msg] of Object.entries(e.fields || {})) {
    const el = form.elements[k]; const f = el && el.closest && el.closest('.f');
    if (f) { f.classList.add('bad'); const d = document.createElement('div'); d.className = 'err field'; d.setAttribute('role', 'alert'); d.textContent = msg; f.appendChild(d); el.setAttribute('aria-invalid', 'true'); first = first || el; }
  }
  if (box) box.innerHTML = `<div class="alert err" role="alert">${esc(e.message)}</div>`;
  if (first) first.focus();
}
// Branche un formulaire : handler(data) async ; gère erreurs et double envoi
function bindForm(form, handler) {
  form.noValidate = true;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('button[type=submit]', form); if (btn) btn.disabled = true;
    try { showErrors(form, { fields: {}, message: '' }); await handler(formData(form), form); }
    catch (e) { showErrors(form, e.fields || e.message !== undefined ? e : { message: String(e) }); }
    finally { if (btn) btn.disabled = false; }
  });
}
const field = (name, label, { type = 'text', value = '', req = false, hint = '', attrs = '' } = {}) =>
  `<div class="f"><label for="f-${name}">${esc(label)}${req ? ' *' : ''}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}>${hint ? `<div class="small muted">${esc(hint)}</div>` : ''}</div>`;
const area = (name, label, { value = '', req = false, rows = 5, hint = '' } = {}) =>
  `<div class="f"><label for="f-${name}">${esc(label)}${req ? ' *' : ''}</label><textarea id="f-${name}" name="${name}" rows="${rows}">${esc(value)}</textarea>${hint ? `<div class="small muted">${esc(hint)}</div>` : ''}</div>`;

// ---- Routeur (History API)
function route(pattern, handler, opts = {}) {
  const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  DF.routes.push({ re, keys, handler, opts });
}
function navigate(path, replace) { if (replace) history.replaceState({}, '', path); else history.pushState({}, '', path); return run(); }
async function run() {
  DF.timers.forEach(clearInterval); DF.timers = [];
  const path = location.pathname;
  for (const r of DF.routes) {
    const m = path.match(r.re); if (!m) continue;
    const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const need = r.opts.roles;
    if (need) {
      if (!DF.user) return navigate('/connexion?retour=' + encodeURIComponent(path + location.search), true);
      if (!need.includes(DF.user.role)) return navigate(homeOf(DF.user), true);
    }
    try { await r.handler(params, new URLSearchParams(location.search)); }
    catch (e) { render(`<div class="wrap page"><div class="alert err" role="alert">${esc(e.message || 'Erreur')}</div><p><a href="/">Retour à l'accueil</a></p></div>`); }
    drawNav(); window.scrollTo(0, 0); const h = $('#main h1'); if (h) { h.setAttribute('tabindex', '-1'); } return;
  }
  setMeta('Page introuvable');
  render(`<div class="wrap page"><h1>Page introuvable</h1><p>Cette page n'existe pas ou a été déplacée.</p><a class="btn" href="/">Retour à l'accueil</a></div>`); drawNav();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || u.pathname.startsWith('/api/') || a.hasAttribute('download')) return;
  if (u.pathname === location.pathname && u.hash) return;
  e.preventDefault(); navigate(u.pathname + u.search);
});
window.addEventListener('popstate', run);

// ---- Navigation et pied de page
function drawNav() {
  const u = DF.user, p = location.pathname;
  const on = (x) => (p === x || (x !== '/' && p.startsWith(x)) ? ' class="on"' : '');
  let links = `<a href="/"${p === '/' ? ' class="on"' : ''}>Accueil</a><a href="/services"${on('/services')}>Services</a><a href="/a-propos"${on('/a-propos')}>À propos</a><a href="/contact"${on('/contact')}>Contact</a>`;
  if (!u) links += `<a href="/connexion"${on('/connexion')}>Connexion</a><a href="/inscription" class="btn gold sm">Créer un compte</a>`;
  else links += `<a href="${homeOf(u)}"${on(homeOf(u))}>${u.role === 'client' ? 'Mon espace' : u.role === 'admin' ? 'Administration' : 'Espace conseiller'}${DF.unread ? `<span class="badge" aria-label="${DF.unread} message(s) non lu(s)">${DF.unread}</span>` : ''}</a><button class="lnk" id="logout">Déconnexion</button>`;
  $('#topbar').innerHTML = `<div class="wrap"><a class="brand" href="/" aria-label="DIGIFASO accueil">DIGI<b>FASO</b></a><button class="burger" id="burger" aria-expanded="false" aria-controls="nav">Menu</button><nav class="nav" id="nav" aria-label="Navigation principale">${links}</nav></div>`;
  $('#burger').onclick = (e) => { const n = $('#nav'); const o = n.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o); };
  $('#nav').addEventListener('click', (e) => { if (e.target.closest('a')) $('#nav').classList.remove('open'); });
  const lo = $('#logout'); if (lo) lo.onclick = async () => { await api('POST', '/api/auth/logout', {}); DF.user = null; DF.unread = 0; navigate('/'); };
  const s = DF.config.settings;
  $('#footer').innerHTML = `<div class="wrap grid g3"><div><strong>DIGIFASO</strong><br>${esc(s.tagline || '')}</div>
   <div><strong>Contact</strong><br>Téléphone : ${esc(s.phone || TOR)}<br>E-mail : ${esc(s.email || TOR)}${s.whatsapp ? `<br>WhatsApp : <a href="${esc(/^https?:/.test(s.whatsapp) ? s.whatsapp : 'https://wa.me/' + s.whatsapp.replace(/\D/g, ''))}" rel="noopener" target="_blank">écrire sur WhatsApp</a>` : ''}</div>
   <div><strong>Liens</strong><br><a href="/services">Nos services</a> · <a href="/contact">Contact</a> · <a href="/mentions-legales">Mentions légales</a> · <a href="/confidentialite">Confidentialité</a></div></div>`;
}
async function refreshUnread() {
  if (!DF.user) { DF.unread = 0; return; }
  try { const { conversations } = await api('GET', '/api/conversations'); DF.unread = conversations.reduce((a, c) => a + c.unread, 0); } catch {}
}
const contactBlock = () => {
  const s = DF.config.settings; const rows = [];
  rows.push(`<dt>Téléphone</dt><dd>${esc(s.phone || TOR)}</dd><dt>E-mail</dt><dd>${esc(s.email || TOR)}</dd>`);
  if (s.whatsapp) rows.push(`<dt>WhatsApp</dt><dd><a href="${esc(/^https?:/.test(s.whatsapp) ? s.whatsapp : 'https://wa.me/' + s.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">Ouvrir WhatsApp</a></dd>`);
  rows.push(`<dt>Adresse / zone</dt><dd>${esc(s.address || TOR)}</dd><dt>Disponibilité des conseillers</dt><dd>${esc(s.hours || TOR)}</dd>`);
  return `<dl class="kv">${rows.join('')}</dl>`;
};
