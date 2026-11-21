'use strict';
const svcCard = (s) => `<a class="card" href="/services/${esc(s.slug)}"><h3>${esc(s.name)}</h3><p class="muted">${esc(s.summary)}</p><p class="small"><span class="price">${esc(s.price)}</span> · ${esc(s.delay)}</p></a>`;

route('/', async () => {
  setMeta('Services digitaux pour votre activité', 'DIGIFASO : community management, création de pages professionnelles, affiches, flyers, spots publicitaires et marketing digital.');
  const { categories } = await api('GET', '/api/categories');
  render(`<section class="hero"><div class="wrap"><h1>${esc(DF.config.settings.tagline || 'Votre présence digitale, gérée par des professionnels')}</h1>
    <p>Community management, pages professionnelles, affiches et flyers, spots publicitaires, marketing digital : décrivez votre besoin, recevez un devis et échangez directement avec un conseiller.</p>
    <div class="actions"><a class="btn gold" href="/services">Découvrir les services</a><a class="btn ghost" href="/inscription">Créer mon compte</a></div></div></section>
  <div class="wrap"><section class="sect"><h2>Nos domaines d'intervention</h2><div class="grid g3">
  ${categories.map((c) => `<a class="card" href="/services?categorie=${esc(c.slug)}"><div class="ico" aria-hidden="true">${esc(c.icon)}</div><h3>${esc(c.name)}</h3><p class="muted">${esc(c.description)}</p><p class="small">${c.services.length} service(s)</p></a>`).join('') || '<p class="empty">Le catalogue est en cours de préparation.</p>'}
  </div></section>
  <section class="sect"><h2>Comment ça marche</h2><ol class="steps">
   <li><strong>Choisissez un service</strong> dans le catalogue.</li>
   <li><strong>Envoyez votre demande</strong> de devis ou de commande, avec vos fichiers de référence.</li>
   <li><strong>Échangez avec un conseiller</strong> depuis votre espace client.</li>
   <li><strong>Suivez l'avancement</strong> de chaque demande, du devis à la livraison.</li></ol></section>
  <section class="sect"><div class="honest"><strong>Transparence :</strong> les tarifs sont communiqués sur devis. Les publications et la gestion de vos réseaux sont réalisées par notre équipe avec les accès que vous autorisez ; nous ne vous demandons jamais votre mot de passe.</div></section></div>`);
});

route('/services', async (_, qs) => {
  setMeta('Catalogue de services', 'Tous les services digitaux DIGIFASO : community management, comptes professionnels, graphisme, vidéo, marketing.');
  const [{ categories }] = await Promise.all([api('GET', '/api/categories')]);
  const cat = qs.get('categorie') || '', term = qs.get('q') || '';
  const m = render(`<div class="wrap page"><h1>Catalogue de services</h1>
   <form id="sf" role="search" class="row"><label class="sr" for="q">Rechercher un service</label><input id="q" type="search" placeholder="Rechercher (ex. flyer, Facebook…)" value="${esc(term)}" style="flex:1;min-width:200px"><button class="btn" type="submit">Rechercher</button></form>
   <div class="chips" role="group" aria-label="Catégories"><a class="chip ${!cat ? 'on' : ''}" href="/services${term ? '?q=' + encodeURIComponent(term) : ''}">Tous</a>${categories.map((c) => `<a class="chip ${cat === c.slug ? 'on' : ''}" href="/services?categorie=${esc(c.slug)}${term ? '&q=' + encodeURIComponent(term) : ''}">${esc(c.name)}</a>`).join('')}</div>
   <div id="list" class="grid g3"><p class="loading">Chargement…</p></div></div>`);
  $('#sf', m).onsubmit = (e) => { e.preventDefault(); const v = $('#q').value.trim(); navigate('/services?' + new URLSearchParams({ ...(cat && { categorie: cat }), ...(v && { q: v }) })); };
  const { services } = await api('GET', '/api/services?' + new URLSearchParams({ ...(cat && { category: cat }), ...(term && { q: term }) }));
  $('#list').innerHTML = services.length ? services.map(svcCard).join('') : `<p class="empty" style="grid-column:1/-1">Aucun service ne correspond à votre recherche. <a href="/services">Voir tout le catalogue</a></p>`;
  announce(`${services.length} service(s) affiché(s)`);
});

route('/services/:slug', async ({ slug }) => {
  const { service: s } = await api('GET', '/api/services/' + encodeURIComponent(slug)).catch((e) => { if (e.status === 404) return {}; throw e; });
  if (!s) { setMeta('Service introuvable'); return render(`<div class="wrap page"><h1>Service introuvable</h1><p>Ce service n'existe plus ou n'est pas publié.</p><a class="btn" href="/services">Voir le catalogue</a></div>`); }
  setMeta(s.name, s.summary);
  render(`<div class="wrap page mid"><p class="small"><a href="/services">Services</a> › <a href="/services?categorie=${esc(s.category_slug)}">${esc(s.category_name)}</a></p>
   <h1>${esc(s.name)}</h1><p class="muted">${esc(s.summary)}</p>
   <div class="card"><dl class="kv"><dt>Tarif</dt><dd class="price">${esc(s.price)}</dd><dt>Délai indicatif</dt><dd>${esc(s.delay)}</dd></dl>
   <div class="actions"><a class="btn" href="/commander/${esc(s.slug)}?type=commande">Commander</a><a class="btn ghost" href="/commander/${esc(s.slug)}?type=devis">Demander un devis</a></div></div>
   <h2 style="margin-top:1.4rem">Description</h2><p style="white-space:pre-line">${esc(s.description)}</p>
   ${s.deliverables.length ? `<h2>Livrables</h2><ul class="ticks">${s.deliverables.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
   ${s.options.length ? `<h2>Options possibles</h2><ul class="ticks">${s.options.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
   <p class="small muted">Une question avant de commander ? <a href="/contact">Contactez-nous</a>.</p></div>`);
});

route('/a-propos', () => {
  setMeta('À propos', 'DIGIFASO, agence et plateforme de services digitaux.');
  render(`<div class="wrap page mid"><h1>À propos de DIGIFASO</h1>
   <p>DIGIFASO est une agence et une plateforme de services digitaux. Elle permet aux particuliers, entrepreneurs, commerçants, associations et entreprises de découvrir des prestations numériques, demander un devis ou commander, échanger avec un conseiller et suivre leurs demandes.</p>
   <h2>Nos engagements</h2><ul class="ticks"><li>Des tarifs clairs : prix affichés ou « Sur devis ».</li><li>Jamais de demande de mot de passe : nous utilisons les rôles et invitations officiels des plateformes.</li><li>Vos données et fichiers ne sont visibles que de vous et des conseillers autorisés.</li></ul>
   <div class="honest">Cette présentation sera complétée avec l'histoire, l'équipe et les références de l'agence lorsque le propriétaire les aura fournies.</div></div>`);
});

route('/contact', () => {
  setMeta('Contact', 'Contactez l\'équipe DIGIFASO.');
  const m = render(`<div class="wrap page"><h1>Contact</h1><div class="grid g2"><div><form id="cf" class="card"><div class="formerr"></div>
   ${field('name', 'Votre nom', { req: true, attrs: 'autocomplete="name"', value: DF.user?.name || '' })}${field('email', 'E-mail', { type: 'email', req: true, attrs: 'autocomplete="email"', value: DF.user?.email || '' })}
   ${field('phone', 'Téléphone (facultatif)', { type: 'tel', attrs: 'autocomplete="tel"' })}${area('message', 'Message', { req: true })}
   <button class="btn" type="submit">Envoyer</button></form>
   <p class="small muted">Déjà client ? Écrivez plutôt à votre conseiller depuis votre espace pour un suivi plus rapide.</p></div>
   <div class="card"><h2>Nos coordonnées</h2>${contactBlock()}<p class="small muted">Les informations marquées « ${TOR} » seront complétées par l'agence.</p></div></div></div>`);
  bindForm($('#cf', m), async (d, f) => {
    const r = await api('POST', '/api/contact', d); f.reset();
    $('.formerr', f).innerHTML = `<div class="alert ok" role="status">${esc(r.message)}</div>`;
  });
});

for (const [p, t, body] of [
  ['/mentions-legales', 'Mentions légales', 'Les mentions légales (raison sociale, adresse, responsable de publication, hébergeur) doivent être rédigées et validées par le propriétaire avant l\'ouverture publique du site.'],
  ['/confidentialite', 'Politique de confidentialité', 'Données collectées par ce site : nom, e-mail, téléphone, contenu des demandes, messages et fichiers joints, uniquement pour traiter vos demandes. Les mots de passe sont stockés sous forme hachée. La politique complète (durée de conservation, droits d\'accès et de suppression, contact) doit être rédigée et validée par le propriétaire avant l\'ouverture publique du site.'],
]) route(p, () => { setMeta(t); render(`<div class="wrap page mid"><h1>${t}</h1><p>${body}</p><div class="honest">Document à finaliser avant la mise en production.</div></div>`); });

// ---- Authentification
route('/connexion', (_, qs) => {
  if (DF.user) return navigate(homeOf(DF.user), true);
  setMeta('Connexion');
  const m = render(`<div class="wrap page narrow"><h1>Connexion</h1><form id="lf" class="card"><div class="formerr"></div>
   ${field('email', 'E-mail', { type: 'email', req: true, attrs: 'autocomplete="username"' })}${field('password', 'Mot de passe', { type: 'password', req: true, attrs: 'autocomplete="current-password"' })}
   <button class="btn" type="submit">Se connecter</button></form>
   <p>Pas encore de compte ? <a href="/inscription${qs.get('retour') ? '?retour=' + encodeURIComponent(qs.get('retour')) : ''}">Créer un compte</a></p>
   <p class="small muted">Mot de passe oublié ? Contactez un conseiller via la page <a href="/contact">Contact</a> : un administrateur pourra le réinitialiser (la récupération automatique par e-mail n'est pas encore configurée).</p></div>`);
  bindForm($('#lf', m), async (d) => {
    if (!d.email) throw { message: 'Veuillez corriger les champs indiqués.', fields: { email: 'Indiquez votre e-mail.' } };
    if (!d.password) throw { message: 'Veuillez corriger les champs indiqués.', fields: { password: 'Indiquez votre mot de passe.' } };
    const r = await api('POST', '/api/auth/login', d); DF.user = r.user; await refreshUnread();
    const back = qs.get('retour'); navigate(back && back.startsWith('/') && !back.startsWith('//') ? back : homeOf(r.user));
  });
});
route('/inscription', (_, qs) => {
  if (DF.user) return navigate(homeOf(DF.user), true);
  setMeta('Créer un compte');
  const m = render(`<div class="wrap page narrow"><h1>Créer mon compte</h1><form id="rf" class="card"><div class="formerr"></div>
   ${field('name', 'Nom complet', { req: true, attrs: 'autocomplete="name"' })}${field('email', 'E-mail', { type: 'email', req: true, attrs: 'autocomplete="email"' })}
   ${field('phone', 'Téléphone (facultatif)', { type: 'tel', attrs: 'autocomplete="tel"' })}
   ${field('password', 'Mot de passe', { type: 'password', req: true, hint: '8 caractères minimum, avec au moins une lettre et un chiffre.', attrs: 'autocomplete="new-password"' })}
   <button class="btn" type="submit">Créer mon compte</button></form>
   <p>Déjà inscrit ? <a href="/connexion${qs.get('retour') ? '?retour=' + encodeURIComponent(qs.get('retour')) : ''}">Se connecter</a></p></div>`);
  bindForm($('#rf', m), async (d) => {
    const r = await api('POST', '/api/auth/register', d); DF.user = r.user;
    const back = qs.get('retour'); navigate(back && back.startsWith('/') && !back.startsWith('//') ? back : '/espace');
  });
});
