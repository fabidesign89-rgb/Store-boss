'use strict';
const subnav = (items) => `<nav class="subnav" aria-label="Sections">${items.map(([h, t]) => `<a href="${h}" class="${location.pathname === h || (h.length > 8 && location.pathname.startsWith(h)) ? 'on' : ''}">${t}</a>`).join('')}</nav>`;
const clientNav = () => subnav([['/espace', 'Tableau de bord'], ['/espace/commandes', 'Mes demandes'], ['/espace/messages', `Messages${DF.unread ? ` (${DF.unread})` : ''}`], ['/espace/profil', 'Profil']]);

// ---- Formulaire de commande / devis
route('/commander/:slug', async ({ slug }, qs) => {
  if (!DF.user) return navigate('/connexion?retour=' + encodeURIComponent(location.pathname + location.search), true);
  if (DF.user.role !== 'client') return render(`<div class="wrap page"><div class="alert info">Seuls les comptes clients peuvent envoyer une demande. Connectez-vous avec un compte client pour tester ce parcours.</div></div>`);
  const { service: s } = await api('GET', '/api/services/' + encodeURIComponent(slug));
  setMeta('Demande — ' + s.name);
  const kind = qs.get('type') === 'commande' ? 'commande' : 'devis';
  const m = render(`<div class="wrap page mid"><p class="small"><a href="/services/${esc(s.slug)}">‹ ${esc(s.name)}</a></p><h1>${kind === 'devis' ? 'Demander un devis' : 'Commander'}</h1>
   <p><strong>${esc(s.name)}</strong> — <span class="price">${esc(s.price)}</span> · ${esc(s.delay)}</p>
   <form id="of" class="card"><div class="formerr"></div><input type="hidden" name="service_id" value="${s.id}">
   <div class="f"><fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:600">Type de demande</legend>
     <label class="check"><input type="radio" name="kind" value="devis" ${kind === 'devis' ? 'checked' : ''}> Demande de devis (sans engagement)</label>
     <label class="check"><input type="radio" name="kind" value="commande" ${kind === 'commande' ? 'checked' : ''}> Commande</label></fieldset></div>
   ${area('details', 'Décrivez votre besoin', { req: true, rows: 6, hint: 'Activité, objectif, public visé, style souhaité, textes à inclure… (20 caractères minimum)' })}
   ${s.options.length ? `<div class="f"><fieldset style="border:0;padding:0;margin:0"><legend style="font-weight:600">Options souhaitées</legend>${s.options.map((o) => `<label class="check"><input type="checkbox" name="selected_options" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</fieldset></div>` : ''}
   ${field('budget', 'Budget indicatif (facultatif)', { hint: 'Le budget publicitaire versé aux plateformes est distinct des frais de prestation.' })}${field('deadline', 'Date ou délai souhaité (facultatif)')}
   <div class="f"><label for="f-contact_pref">Mode de contact préféré</label><select id="f-contact_pref" name="contact_pref"><option value="messagerie">Messagerie du site</option><option value="telephone">Téléphone</option><option value="whatsapp">WhatsApp</option><option value="email">E-mail</option></select></div>
   <div class="f"><label for="f-files">Fichiers de référence (facultatif)</label><input id="f-files" type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.txt"><div class="small muted">Jusqu'à 5 fichiers, ${DF.config.max_file_mb} Mo chacun : ${DF.config.allowed_files.join(', ')}. Ne joignez jamais de mot de passe.</div></div>
   <button class="btn" type="submit">Envoyer ma demande</button></form></div>`);
  bindForm($('#of', m), async (d, form) => {
    const files = [...$('#f-files').files];
    if (files.length > 5) throw { message: 'Maximum 5 fichiers par envoi.' };
    const payload = await readFiles(files);
    const r = await api('POST', '/api/orders', { ...d, service_id: Number(d.service_id), selected_options: d.selected_options || [] });
    let warn = false;
    for (const f of payload) { try { await api('POST', `/api/orders/${r.order.id}/files`, { files: [f] }); } catch (e) { warn = true; } }
    navigate(`/espace/commandes/${r.order.id}?nouvelle=1${warn ? '&fichiers=erreur' : ''}`);
  });
});
function readFiles(files) {
  return Promise.all(files.map((f) => new Promise((res, rej) => {
    if (f.size > DF.config.max_file_mb * 1048576) return rej({ message: `${f.name} dépasse ${DF.config.max_file_mb} Mo.` });
    const r = new FileReader(); r.onerror = () => rej({ message: 'Lecture du fichier impossible.' });
    r.onload = () => res({ name: f.name, data: String(r.result).split(',')[1] }); r.readAsDataURL(f);
  })));
}

// ---- Détail d'une demande (client, conseiller et administrateur)
async function orderDetail(id, qs) {
  const d = await api('GET', '/api/orders/' + id);
  const o = d.order, staff = DF.user.role !== 'client', admin = DF.user.role === 'admin';
  const base = admin ? '/admin' : staff ? '/conseiller' : '/espace';
  setMeta('Demande ' + o.ref);
  let advisors = []; if (admin) advisors = (await api('GET', '/api/admin/advisors')).advisors;
  const m = render(`<div class="wrap page">${staff ? staffNav() : clientNav()}<p class="small"><a href="${base}/commandes">‹ Toutes les demandes</a></p>
   <h1>${esc(o.service_name)}</h1><p>${pill(o.status)} <span class="muted small">Réf. ${esc(o.ref)} · ${o.kind === 'devis' ? 'Demande de devis' : 'Commande'} · ${fmtDate(o.created_at)}</span></p>
   ${qs.get('nouvelle') ? `<div class="alert ok" role="status"><strong>Votre demande a bien été enregistrée.</strong> Un conseiller la traitera depuis son espace ; vous pouvez lui écrire ci-dessous.${qs.get('fichiers') ? ' <br>Attention : l\'envoi des fichiers a échoué, vous pouvez les rajouter plus bas.' : ''}</div>` : ''}
   <div class="grid g2"><div class="card"><h2>Demande</h2><p style="white-space:pre-line">${esc(o.details)}</p>
     <dl class="kv">${o.selected_options.length ? `<dt>Options</dt><dd>${o.selected_options.map(esc).join(', ')}</dd>` : ''}<dt>Budget</dt><dd>${esc(o.budget || '—')}</dd><dt>Délai souhaité</dt><dd>${esc(o.deadline || '—')}</dd><dt>Contact préféré</dt><dd>${esc(o.contact_pref)}</dd>
     ${staff ? `<dt>Client</dt><dd>${esc(o.client_name)}<br>${esc(o.client_email || '')} ${esc(o.client_phone || '')}</dd>` : ''}<dt>Conseiller</dt><dd>${esc(o.advisor_name || 'Pas encore attribué')}</dd></dl></div>
   <div class="card"><h2>Suivi</h2><ul class="timeline">${d.history.map((h) => `<li>${pill(h.status)} <span class="small muted">${fmtDate(h.created_at)}${h.actor ? ' · ' + esc(h.actor) : ''}</span>${h.note ? `<div class="small">${esc(h.note)}</div>` : ''}</li>`).join('')}</ul></div></div>
   ${o.quote_text ? `<div class="card" style="margin-top:1rem"><h2>Devis</h2><p style="white-space:pre-line">${esc(o.quote_text)}</p></div>` : ''}
   <div id="cl" class="row" style="margin:1rem 0"></div>
   <div class="card" style="margin-top:1rem"><h2>Fichiers</h2><div id="files"></div>
     <form id="uf" class="row" style="margin-top:.6rem"><label class="sr" for="up">Ajouter des fichiers</label><input id="up" type="file" multiple style="flex:1;min-width:180px" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.txt"><button class="btn sm" type="submit">Ajouter</button><div class="formerr" style="flex-basis:100%"></div></form></div>
   ${staff ? `<div class="card" style="margin-top:1rem"><h2>Traitement</h2>
     <form id="sf"><div class="formerr"></div><div class="grid g2"><div class="f"><label for="f-status">Statut</label><select id="f-status" name="status">${Object.entries(DF.config.statuses).map(([k, v]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>${field('note', 'Note (visible par le client)')}</div><button class="btn sm" type="submit">Mettre à jour le statut</button></form>
     <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">
     <form id="qf"><div class="formerr"></div>${area('quote_text', 'Devis (montant, détail, délai)', { value: o.quote_text, rows: 4, hint: 'Enregistrer le devis le passe à « Devis envoyé » si la demande est en attente.' })}<button class="btn sm" type="submit">Enregistrer le devis</button></form>
     ${admin ? `<hr style="border:0;border-top:1px solid var(--line);margin:1rem 0"><form id="af"><div class="formerr"></div><div class="f"><label for="f-advisor_id">Conseiller attribué</label><select id="f-advisor_id" name="advisor_id"><option value="">— Non attribué —</option>${advisors.map((a) => `<option value="${a.id}" ${a.id === o.advisor_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div><button class="btn sm" type="submit">Attribuer</button>${advisors.length ? '' : '<p class="small muted">Aucun conseiller : créez-en un dans Administration › Utilisateurs.</p>'}</form>` : ''}</div>` : ''}
   <div style="margin-top:1rem">${d.conversation_id ? `<a class="btn" href="${base}/messages/${d.conversation_id}">${staff ? 'Ouvrir la conversation' : 'Écrire à mon conseiller'}</a>` : ''}</div></div>`);
  const reload = () => orderDetail(id, new URLSearchParams());
  $('#files', m).innerHTML = d.files.length ? `<ul>${d.files.map((f) => `<li><a href="/api/files/${f.id}">${esc(f.original_name)}</a> <span class="small muted">${fmtSize(f.size)} · ${fmtDate(f.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted small">Aucun fichier joint.</p>';
  const cl = $('#cl', m);
  for (const a of d.client_actions) {
    const b = document.createElement('button'); b.className = 'btn ' + (a === 'annulee' ? 'ghost' : ''); b.textContent = a === 'acceptee' ? 'Accepter le devis' : 'Annuler la demande';
    b.onclick = async () => { if (a === 'annulee' && !window.confirm('Annuler cette demande ?')) return; try { await api('PUT', `/api/orders/${id}/status`, { status: a }); reload(); } catch (e) { cl.insertAdjacentHTML('beforeend', `<div class="alert err" role="alert">${esc(e.message)}</div>`); } };
    cl.appendChild(b);
  }
  bindForm($('#uf', m), async (_, f) => {
    const files = [...$('#up').files]; if (!files.length) throw { message: 'Choisissez au moins un fichier.' };
    for (const f of await readFiles(files)) await api('POST', `/api/orders/${id}/files`, { files: [f] }); reload();
  });
  if (staff) {
    bindForm($('#sf', m), async (v) => { await api('PUT', `/api/orders/${id}/status`, v); reload(); });
    bindForm($('#qf', m), async (v) => { await api('PUT', `/api/orders/${id}/quote`, v); reload(); });
    if (admin) bindForm($('#af', m), async (v) => { await api('PUT', `/api/orders/${id}/assign`, { advisor_id: v.advisor_id || null }); reload(); });
  }
}
async function ordersList(base, title) {
  const qs = new URLSearchParams(location.search); const st = qs.get('statut') || '';
  const { orders } = await api('GET', '/api/orders' + (st ? '?status=' + encodeURIComponent(st) : ''));
  setMeta(title);
  const staff = base !== '/espace';
  render(`<div class="wrap page">${staff ? staffNav() : clientNav()}<h1>${title}</h1>
   <div class="chips"><a class="chip ${!st ? 'on' : ''}" href="${base}/commandes">Toutes</a>${Object.entries(DF.config.statuses).map(([k, v]) => `<a class="chip ${st === k ? 'on' : ''}" href="${base}/commandes?statut=${k}">${esc(v)}</a>`).join('')}</div>
   ${orders.length ? `<div class="tablewrap"><table><thead><tr><th>Réf.</th><th>Service</th>${staff ? '<th>Client</th><th>Conseiller</th>' : ''}<th>Statut</th><th>Date</th></tr></thead><tbody>
   ${orders.map((o) => `<tr><td><a href="${base}/commandes/${o.id}">${esc(o.ref)}</a></td><td>${esc(o.service_name)}</td>${staff ? `<td>${esc(o.client_name)}</td><td>${esc(o.advisor_name || '—')}</td>` : ''}<td>${pill(o.status)}</td><td class="small">${fmtDate(o.created_at)}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="empty">${staff ? 'Aucune demande pour le moment.' : 'Vous n\'avez pas encore de demande.'} ${staff ? '' : '<a href="/services">Parcourir les services</a>'}</p>`}</div>`);
}

// ---- Messagerie (partagée)
async function messagesList(base) {
  const { conversations } = await api('GET', '/api/conversations');
  DF.unread = conversations.reduce((a, c) => a + c.unread, 0); drawNav();
  setMeta('Messages');
  const staff = base !== '/espace';
  const m = render(`<div class="wrap page">${staff ? staffNav() : clientNav()}<h1>Messages</h1>
   ${staff ? '' : `<details class="card" ${conversations.length ? '' : 'open'}><summary><strong>Nouvelle conversation</strong></summary><form id="nf" style="margin-top:.7rem"><div class="formerr"></div>${field('subject', 'Sujet', { req: true })}${area('body', 'Message', { req: true, rows: 4 })}<button class="btn" type="submit">Envoyer</button></form></details>`}
   <div class="grid" style="margin-top:1rem">${conversations.map((c) => `<a class="card" href="${base}/messages/${c.id}"><div class="row sp"><strong>${esc(c.subject)}</strong>${c.unread ? `<span class="badge">${c.unread} nouveau(x)</span>` : ''}</div>
     <div class="small muted">${staff ? esc(c.client_name) + ' · ' : ''}${c.advisor_name ? 'Conseiller : ' + esc(c.advisor_name) : 'Conseiller non attribué'}${c.awaiting_reply ? ' · <strong>Réponse en attente</strong>' : ''}</div>
     ${c.last_message ? `<div class="small">${esc(c.last_message.body)}</div>` : '<div class="small muted">Aucun message</div>'}</a>`).join('') || '<p class="empty">Aucune conversation.</p>'}</div></div>`);
  const nf = $('#nf', m);
  if (nf) bindForm(nf, async (d) => { const r = await api('POST', '/api/conversations', d); navigate(`${base}/messages/${r.conversation.id}`); });
}
async function thread(id, base) {
  const staff = base !== '/espace';
  let d = await api('GET', '/api/conversations/' + id); let last = 0;
  setMeta(d.conversation.subject);
  const c = d.conversation;
  const m = render(`<div class="wrap page mid">${staff ? staffNav() : clientNav()}<p class="small"><a href="${base}/messages">‹ Messages</a></p><h1>${esc(c.subject)}</h1>
   <p class="small muted">${staff ? 'Client : ' + esc(c.client_name) + ' · ' : ''}${c.advisor_name ? 'Conseiller : ' + esc(c.advisor_name) : 'Pas encore attribuée à un conseiller : un administrateur doit la traiter'}${c.order_id ? ` · <a href="${base}/commandes/${c.order_id}">Voir la demande ${esc(c.order_ref)}</a>` : ''}</p>
   <div class="honest small" style="margin-bottom:.6rem">Les réponses ne sont pas instantanées : ${esc(DF.config.settings.hours || 'les horaires de disponibilité des conseillers ne sont pas encore renseignés')}. ${staff ? '' : 'Vous serez prévenu(e) ici (pastille « nouveau »).'}</div>
   <div class="chat" id="chat" role="log" aria-live="polite" aria-label="Messages"></div>
   <form id="mf" style="margin-top:.7rem"><div class="formerr"></div><label class="sr" for="f-body">Votre message</label><textarea id="f-body" name="body" rows="3" placeholder="Votre message…"></textarea><button class="btn" type="submit" style="margin-top:.5rem">Envoyer</button></form></div>`);
  const chat = $('#chat', m);
  const add = (msgs) => {
    for (const x of msgs) { last = Math.max(last, x.id); const div = document.createElement('div'); div.className = 'msg' + (x.mine ? ' me' : ''); div.innerHTML = `<span class="who">${esc(x.sender_name)}${x.sender_role !== 'client' ? ' (' + (x.sender_role === 'admin' ? 'administrateur' : 'conseiller') + ')' : ''} · ${fmtDate(x.created_at)}</span>${esc(x.body)}`; chat.appendChild(div); }
    if (msgs.length) chat.scrollTop = chat.scrollHeight;
  };
  if (!d.messages.length) chat.innerHTML = '<p class="muted small" id="nomsg">Aucun message pour le moment.</p>'; else add(d.messages);
  bindForm($('#mf', m), async (v, f) => {
    if (!v.body.trim()) throw { message: 'Écrivez votre message.', fields: { body: 'Écrivez votre message.' } };
    const r = await api('POST', `/api/conversations/${id}/messages`, v); $('#nomsg')?.remove(); add([r.message]); f.reset(); f.elements.body.focus();
  });
  DF.timers.push(setInterval(async () => {
    if (document.hidden) return;
    try { const n = await api('GET', `/api/conversations/${id}?after=${last}`); if (n.messages.length) { $('#nomsg')?.remove(); add(n.messages); } } catch {}
  }, 8000));
}

route('/espace', async () => {
  await refreshUnread(); const { orders } = await api('GET', '/api/orders'); setMeta('Mon espace');
  const open = orders.filter((o) => !['terminee', 'annulee'].includes(o.status));
  render(`<div class="wrap page">${clientNav()}<h1>Bonjour ${esc(DF.user.name.split(' ')[0])}</h1>
   <div class="grid g3"><div class="card"><div class="kpi">${open.length}</div>demande(s) en cours</div><div class="card"><div class="kpi">${orders.length}</div>demande(s) au total</div><a class="card" href="/espace/messages"><div class="kpi">${DF.unread}</div>message(s) non lu(s)</a></div>
   <div class="actions"><a class="btn" href="/services">Nouvelle demande</a><a class="btn ghost" href="/espace/messages">Contacter un conseiller</a></div>
   <h2 style="margin-top:1.4rem">Dernières demandes</h2>${orders.slice(0, 5).map((o) => `<a class="card" style="margin-bottom:.6rem" href="/espace/commandes/${o.id}"><div class="row sp"><strong>${esc(o.service_name)}</strong>${pill(o.status)}</div><span class="small muted">${esc(o.ref)} · ${fmtDate(o.created_at)}</span></a>`).join('') || '<p class="empty">Aucune demande pour le moment.</p>'}</div>`);
}, { roles: ['client'] });
route('/espace/commandes', () => ordersList('/espace', 'Mes demandes'), { roles: ['client'] });
route('/espace/commandes/:id', ({ id }, qs) => orderDetail(id, qs), { roles: ['client'] });
route('/espace/messages', () => messagesList('/espace'), { roles: ['client'] });
route('/espace/messages/:id', ({ id }) => thread(id, '/espace'), { roles: ['client'] });
route('/espace/profil', async () => {
  setMeta('Mon profil');
  const u = DF.user;
  const m = render(`<div class="wrap page mid">${clientNav()}<h1>Mon profil</h1><form id="pf" class="card"><div class="formerr"></div>${field('name', 'Nom', { value: u.name, req: true })}<div class="f"><label>E-mail</label><input value="${esc(u.email)}" disabled></div>${field('phone', 'Téléphone', { value: u.phone, type: 'tel' })}<button class="btn" type="submit">Enregistrer</button></form>
   <form id="pw" class="card" style="margin-top:1rem"><h2>Changer le mot de passe</h2><div class="formerr"></div>${field('current', 'Mot de passe actuel', { type: 'password', attrs: 'autocomplete="current-password"' })}${field('password', 'Nouveau mot de passe', { type: 'password', attrs: 'autocomplete="new-password"', hint: '8 caractères minimum, avec lettre et chiffre.' })}<button class="btn" type="submit">Modifier</button></form></div>`);
  bindForm($('#pf', m), async (d, f) => { const r = await api('PUT', '/api/me', d); DF.user = r.user; $('.formerr', f).innerHTML = '<div class="alert ok" role="status">Profil enregistré.</div>'; });
  bindForm($('#pw', m), async (d, f) => { await api('PUT', '/api/me/password', d); f.reset(); $('.formerr', f).innerHTML = '<div class="alert ok" role="status">Mot de passe modifié.</div>'; });
}, { roles: ['client', 'advisor', 'admin'] });
