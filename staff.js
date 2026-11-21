'use strict';
const staffNav = () => DF.user.role === 'admin'
  ? subnav([['/admin', 'Tableau de bord'], ['/admin/commandes', 'Demandes'], ['/admin/messages', `Messages${DF.unread ? ` (${DF.unread})` : ''}`], ['/admin/services', 'Services'], ['/admin/categories', 'Catégories'], ['/admin/utilisateurs', 'Utilisateurs'], ['/admin/contacts', 'Contacts'], ['/admin/parametres', 'Paramètres'], ['/admin/journal', 'Journal']])
  : subnav([['/conseiller', 'Tableau de bord'], ['/conseiller/commandes', 'Mes demandes'], ['/conseiller/messages', `Messages${DF.unread ? ` (${DF.unread})` : ''}`], ['/espace/profil', 'Profil']]);

// ---- Conseiller
route('/conseiller', async () => {
  await refreshUnread(); const { orders } = await api('GET', '/api/orders'); setMeta('Espace conseiller');
  const todo = orders.filter((o) => ['recue', 'en_etude', 'en_attente_retour_client', 'acceptee', 'en_production'].includes(o.status));
  render(`<div class="wrap page">${staffNav()}<h1>Espace conseiller</h1>
   <div class="grid g3"><div class="card"><div class="kpi">${orders.length}</div>demande(s) attribuée(s)</div><div class="card"><div class="kpi">${todo.length}</div>à traiter</div><a class="card" href="/conseiller/messages"><div class="kpi">${DF.unread}</div>message(s) non lu(s)</a></div>
   <h2 style="margin-top:1.4rem">Demandes attribuées</h2>${orders.slice(0, 10).map((o) => `<a class="card" style="margin-bottom:.6rem" href="/conseiller/commandes/${o.id}"><div class="row sp"><strong>${esc(o.service_name)}</strong>${pill(o.status)}</div><span class="small muted">${esc(o.client_name)} · ${esc(o.ref)}</span></a>`).join('') || '<p class="empty">Aucune demande ne vous est attribuée pour le moment.</p>'}</div>`);
}, { roles: ['advisor'] });
route('/conseiller/commandes', () => ordersList('/conseiller', 'Mes demandes'), { roles: ['advisor'] });
route('/conseiller/commandes/:id', ({ id }, qs) => orderDetail(id, qs), { roles: ['advisor'] });
route('/conseiller/messages', () => messagesList('/conseiller'), { roles: ['advisor'] });
route('/conseiller/messages/:id', ({ id }) => thread(id, '/conseiller'), { roles: ['advisor'] });

// ---- Administration
route('/admin', async () => {
  await refreshUnread(); const s = await api('GET', '/api/admin/stats'); setMeta('Administration');
  render(`<div class="wrap page">${staffNav()}<h1>Tableau de bord</h1>
   <div class="grid g4"><div class="card"><div class="kpi">${s.total_orders}</div>demande(s)</div><a class="card" href="/admin/commandes"><div class="kpi">${s.unassigned}</div>non attribuée(s)</a><a class="card" href="/admin/messages"><div class="kpi">${s.awaiting_conversations}</div>conversation(s) en attente de réponse</a><a class="card" href="/admin/contacts"><div class="kpi">${s.new_contacts}</div>message(s) de contact à traiter</a></div>
   <h2 style="margin-top:1.4rem">Demandes par statut</h2><div class="chips">${Object.entries(s.by_status).map(([k, n]) => `<a class="chip" href="/admin/commandes?statut=${k}">${esc(DF.config.statuses[k])} : <strong>${n}</strong></a>`).join('')}</div>
   <h2>Demandes récentes</h2>${s.recent.map((o) => `<a class="card" style="margin-bottom:.6rem" href="/admin/commandes/${o.id}"><div class="row sp"><strong>${esc(o.service_name)}</strong>${pill(o.status)}</div><span class="small muted">${esc(o.client_name)} · ${esc(o.ref)} · ${fmtDate(o.created_at)}</span></a>`).join('') || '<p class="empty">Aucune demande pour le moment.</p>'}
   <p class="small muted">Clients inscrits : ${s.clients}</p></div>`);
}, { roles: ['admin'] });
route('/admin/commandes', () => ordersList('/admin', 'Demandes'), { roles: ['admin'] });
route('/admin/commandes/:id', ({ id }, qs) => orderDetail(id, qs), { roles: ['admin'] });
route('/admin/messages', () => messagesList('/admin'), { roles: ['admin'] });
route('/admin/messages/:id', async ({ id }) => {
  await thread(id, '/admin');
  const { advisors } = await api('GET', '/api/admin/advisors'); const d = await api('GET', '/api/conversations/' + id);
  const form = document.createElement('form'); form.className = 'card'; form.style.marginTop = '1rem';
  form.innerHTML = `<h3>Attribuer la conversation</h3><div class="formerr"></div><div class="f"><label for="f-advisor_id">Conseiller</label><select id="f-advisor_id" name="advisor_id"><option value="">— Aucun —</option>${advisors.map((a) => `<option value="${a.id}" ${a.name === d.conversation.advisor_name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div><button class="btn sm" type="submit">Attribuer</button>`;
  $('#main .wrap').appendChild(form);
  bindForm(form, async (v, f) => { await api('PUT', `/api/conversations/${id}/assign`, { advisor_id: v.advisor_id || null }); $('.formerr', f).innerHTML = '<div class="alert ok" role="status">Conversation attribuée.</div>'; });
}, { roles: ['admin'] });

route('/admin/services', async () => {
  const [{ services }, { categories }] = await Promise.all([api('GET', '/api/admin/services'), api('GET', '/api/admin/categories')]); setMeta('Services');
  const cn = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const m = render(`<div class="wrap page">${staffNav()}<div class="row sp"><h1>Services</h1><a class="btn" href="/admin/services/nouveau">Nouveau service</a></div>
   <div class="tablewrap"><table><thead><tr><th>Service</th><th>Catégorie</th><th>Tarif</th><th>État</th><th>Actions</th></tr></thead><tbody>
   ${services.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(cn[s.category_id] || '')}</td><td>${esc(s.price)}</td><td>${s.published ? '<span class="pill s-acceptee">Publié</span>' : '<span class="pill s-annulee">Non publié</span>'}</td>
   <td class="row"><a class="btn sm ghost" href="/admin/services/${s.id}">Modifier</a><button class="btn sm ghost" data-pub="${s.id}" data-v="${s.published ? 0 : 1}">${s.published ? 'Dépublier' : 'Publier'}</button><button class="btn sm danger" data-del="${s.id}">Supprimer</button></td></tr>`).join('')}</tbody></table></div></div>`);
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.pub) await api('PUT', '/api/admin/services/' + b.dataset.pub, { published: b.dataset.v === '1' });
      else if (b.dataset.del) { if (!window.confirm('Supprimer ce service ? Il ne sera plus visible (suppression logique).')) return; await api('DELETE', '/api/admin/services/' + b.dataset.del); }
      else return; run();
    } catch (er) { alert2(er.message); }
  });
}, { roles: ['admin'] });
const alert2 = (msg) => { announce(msg); $('#main').insertAdjacentHTML('afterbegin', `<div class="wrap"><div class="alert err" role="alert">${esc(msg)}</div></div>`); };

async function serviceForm(id) {
  const { categories } = await api('GET', '/api/admin/categories');
  let s = { category_id: categories[0]?.id, name: '', summary: '', description: '', deliverables: [], options: [], delay_text: '', price_text: '', position: 0, published: true };
  if (id) s = (await api('GET', '/api/admin/services')).services.find((x) => x.id === Number(id)); if (!s) throw { message: 'Service introuvable.' };
  setMeta(id ? 'Modifier le service' : 'Nouveau service');
  const m = render(`<div class="wrap page mid">${staffNav()}<h1>${id ? 'Modifier' : 'Nouveau'} service</h1><form id="svf" class="card"><div class="formerr"></div>
   <div class="f"><label for="f-category_id">Catégorie *</label><select id="f-category_id" name="category_id">${categories.map((c) => `<option value="${c.id}" ${c.id === s.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
   ${field('name', 'Nom', { value: s.name, req: true })}${field('summary', 'Résumé court', { value: s.summary })}${area('description', 'Description', { value: s.description, rows: 6 })}
   ${area('deliverables', 'Livrables (un par ligne)', { value: s.deliverables.join('\n'), rows: 4 })}${area('options', 'Options (une par ligne)', { value: s.options.join('\n'), rows: 3 })}
   ${field('price_text', 'Tarif', { value: s.price_text, hint: 'Laisser vide pour afficher « Sur devis ». Ne saisissez que des prix confirmés.' })}${field('delay_text', 'Délai indicatif', { value: s.delay_text, hint: 'Vide : « À définir avec votre conseiller ».' })}${field('position', 'Ordre d\'affichage', { type: 'number', value: s.position })}
   <label class="check"><input type="checkbox" name="published" value="1" ${s.published ? 'checked' : ''}> Publié (visible sur le site)</label>
   <div class="actions"><button class="btn" type="submit">Enregistrer</button><a class="btn ghost" href="/admin/services">Annuler</a></div></form></div>`);
  bindForm($('#svf', m), async (d) => {
    const body = { ...d, category_id: Number(d.category_id), position: Number(d.position) || 0, published: (d.published || []).length > 0 };
    if (id) await api('PUT', '/api/admin/services/' + id, body); else await api('POST', '/api/admin/services', body);
    navigate('/admin/services');
  });
}
route('/admin/services/nouveau', () => serviceForm(), { roles: ['admin'] });
route('/admin/services/:id', ({ id }) => serviceForm(id), { roles: ['admin'] });

route('/admin/categories', async () => {
  const { categories } = await api('GET', '/api/admin/categories'); setMeta('Catégories');
  const m = render(`<div class="wrap page">${staffNav()}<h1>Catégories</h1>
   <div class="tablewrap"><table><thead><tr><th>Nom</th><th>État</th><th>Actions</th></tr></thead><tbody>${categories.map((c) => `<tr><td>${esc(c.icon)} ${esc(c.name)}<div class="small muted">${esc(c.description)}</div></td><td>${c.published ? 'Publiée' : 'Non publiée'}</td><td class="row"><button class="btn sm ghost" data-edit="${c.id}">Modifier</button><button class="btn sm ghost" data-pub="${c.id}" data-v="${c.published ? 0 : 1}">${c.published ? 'Dépublier' : 'Publier'}</button><button class="btn sm danger" data-del="${c.id}">Supprimer</button></td></tr>`).join('')}</tbody></table></div>
   <form id="cf" class="card" style="margin-top:1rem"><h2 id="cft">Nouvelle catégorie</h2><div class="formerr"></div><input type="hidden" name="id">${field('name', 'Nom', { req: true })}${field('icon', 'Icône (emoji)')}${area('description', 'Description', { rows: 3 })}${field('position', 'Ordre', { type: 'number', value: 0 })}
   <label class="check"><input type="checkbox" name="published" value="1" checked> Publiée</label><div class="actions"><button class="btn" type="submit">Enregistrer</button></div></form></div>`);
  const f = $('#cf', m);
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-edit],button[data-pub],button[data-del]'); if (!b) return;
    try {
      if (b.dataset.edit) { const c = categories.find((x) => x.id === Number(b.dataset.edit)); f.elements.id.value = c.id; f.elements.name.value = c.name; f.elements.icon.value = c.icon; f.elements.description.value = c.description; f.elements.position.value = c.position; f.elements.published.checked = c.published; $('#cft').textContent = 'Modifier la catégorie'; f.scrollIntoView(); return; }
      if (b.dataset.pub) await api('PUT', '/api/admin/categories/' + b.dataset.pub, { published: b.dataset.v === '1' });
      if (b.dataset.del) { if (!window.confirm('Supprimer cette catégorie et ses services (suppression logique) ?')) return; await api('DELETE', '/api/admin/categories/' + b.dataset.del); }
      run();
    } catch (er) { alert2(er.message); }
  });
  bindForm(f, async (d) => {
    const body = { name: d.name, icon: d.icon, description: d.description, position: Number(d.position) || 0, published: (d.published || []).length > 0 };
    if (d.id) await api('PUT', '/api/admin/categories/' + d.id, body); else await api('POST', '/api/admin/categories', body);
    run();
  });
}, { roles: ['admin'] });

route('/admin/utilisateurs', async (_, qs) => {
  const role = qs.get('role') || ''; const { users } = await api('GET', '/api/admin/users' + (role ? '?role=' + role : '')); setMeta('Utilisateurs');
  const RL = { client: 'Client', advisor: 'Conseiller', admin: 'Administrateur' };
  const m = render(`<div class="wrap page">${staffNav()}<h1>Utilisateurs</h1><div class="chips"><a class="chip ${!role ? 'on' : ''}" href="/admin/utilisateurs">Tous</a>${Object.entries(RL).map(([k, v]) => `<a class="chip ${role === k ? 'on' : ''}" href="/admin/utilisateurs?role=${k}">${v}s</a>`).join('')}</div>
   <div class="tablewrap"><table><thead><tr><th>Nom</th><th>Rôle</th><th>Demandes</th><th>État</th><th>Actions</th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.name)}<div class="small muted">${esc(u.email)} ${esc(u.phone)}</div></td><td>${RL[u.role]}</td><td>${u.role === 'client' ? u.orders : u.assigned}</td><td>${u.active ? 'Actif' : 'Désactivé'}</td>
   <td class="row"><button class="btn sm ghost" data-act="${u.id}" data-v="${u.active ? 0 : 1}" ${u.id === DF.user.id ? 'disabled' : ''}>${u.active ? 'Désactiver' : 'Réactiver'}</button><button class="btn sm ghost" data-pw="${u.id}">Nouveau mot de passe</button>${u.role === 'client' ? `<button class="btn sm ghost" data-role="${u.id}" data-r="advisor">→ Conseiller</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
   <form id="uf" class="card" style="margin-top:1rem"><h2>Créer un conseiller ou un administrateur</h2><div class="formerr"></div>${field('name', 'Nom', { req: true })}${field('email', 'E-mail', { type: 'email', req: true })}${field('phone', 'Téléphone', { type: 'tel' })}
   <div class="f"><label for="f-role">Rôle</label><select id="f-role" name="role"><option value="advisor">Conseiller</option><option value="admin">Administrateur</option></select></div>${field('password', 'Mot de passe initial', { type: 'password', hint: '8 caractères minimum, lettre + chiffre. Communiquez-le à la personne de façon sûre.', attrs: 'autocomplete="new-password"' })}<button class="btn" type="submit">Créer</button></form></div>`);
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act],button[data-pw],button[data-role]'); if (!b) return;
    try {
      if (b.dataset.act) await api('PUT', '/api/admin/users/' + b.dataset.act, { active: b.dataset.v === '1' });
      else if (b.dataset.role) { if (!window.confirm('Passer ce compte client en conseiller ?')) return; await api('PUT', '/api/admin/users/' + b.dataset.role, { role: 'advisor' }); }
      else { const pw = window.prompt('Nouveau mot de passe (8 caractères min., lettre + chiffre) :'); if (!pw) return; await api('PUT', `/api/admin/users/${b.dataset.pw}/password`, { password: pw }); announce('Mot de passe modifié.'); return; }
      run();
    } catch (er) { alert2(er.message); }
  });
  bindForm($('#uf', m), async (d) => { await api('POST', '/api/admin/users', d); run(); });
}, { roles: ['admin'] });

route('/admin/contacts', async () => {
  const { contacts } = await api('GET', '/api/admin/contacts'); setMeta('Contacts');
  const m = render(`<div class="wrap page">${staffNav()}<h1>Messages du formulaire de contact</h1>${contacts.map((c) => `<div class="card" style="margin-bottom:.7rem"><div class="row sp"><strong>${esc(c.name)}</strong><span class="small muted">${fmtDate(c.created_at)}</span></div><div class="small">${esc(c.email)} ${esc(c.phone)}</div><p style="white-space:pre-line">${esc(c.message)}</p><button class="btn sm ghost" data-h="${c.id}" data-v="${c.handled ? 0 : 1}">${c.handled ? 'Marqué traité — rouvrir' : 'Marquer comme traité'}</button></div>`).join('') || '<p class="empty">Aucun message.</p>'}</div>`);
  m.addEventListener('click', async (e) => { const b = e.target.closest('button[data-h]'); if (!b) return; await api('PUT', '/api/admin/contacts/' + b.dataset.h, { handled: b.dataset.v === '1' }); run(); });
}, { roles: ['admin'] });

route('/admin/parametres', async () => {
  const { settings: s } = await api('GET', '/api/admin/settings'); setMeta('Paramètres');
  const L = { site_name: 'Nom du site', tagline: 'Slogan', country: 'Pays principal', currency: 'Devise', timezone: 'Fuseau horaire', phone: 'Téléphone professionnel', email: 'E-mail de contact', whatsapp: 'WhatsApp (lien https:// ou numéro)', address: 'Adresse ou zone desservie', hours: 'Horaires de disponibilité des conseillers', payment_methods: 'Moyens de paiement souhaités (information)' };
  const m = render(`<div class="wrap page mid">${staffNav()}<h1>Paramètres</h1><div class="honest">Les informations vides s'affichent « ${TOR} » sur le site. Le paiement en ligne n'est pas intégré : le champ « moyens de paiement » est purement informatif.</div>
   <form id="pf" class="card" style="margin-top:1rem"><div class="formerr"></div>${Object.entries(L).map(([k, l]) => field(k, l, { value: s[k] || '' })).join('')}<button class="btn" type="submit">Enregistrer</button></form></div>`);
  bindForm($('#pf', m), async (d, f) => { const r = await api('PUT', '/api/admin/settings', d); DF.config.settings = r.settings; drawNav(); $('.formerr', f).innerHTML = '<div class="alert ok" role="status">Paramètres enregistrés.</div>'; });
}, { roles: ['admin'] });

route('/admin/journal', async () => {
  const { entries } = await api('GET', '/api/admin/audit'); setMeta('Journal');
  render(`<div class="wrap page">${staffNav()}<h1>Journal des actions</h1><div class="tablewrap"><table><thead><tr><th>Date</th><th>Auteur</th><th>Action</th><th>Cible</th><th>Détail</th></tr></thead><tbody>${entries.map((e) => `<tr><td class="small">${fmtDate(e.created_at)}</td><td>${esc(e.actor || '—')}</td><td>${esc(e.action)}</td><td>${esc(e.target)}</td><td class="small">${esc(e.detail)}</td></tr>`).join('')}</tbody></table></div></div>`);
}, { roles: ['admin'] });
