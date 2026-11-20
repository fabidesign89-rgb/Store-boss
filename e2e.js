'use strict';
// Parcours complet dans un vrai navigateur (Chrome + Playwright). Lancer : node tests/e2e.js
// Nécessite Playwright et Chrome installés localement (non requis pour l'application elle-même).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const { createApp } = require('../src/app');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-e2e-'));
  const app = createApp({ dataDir: dir, adminEmail: 'admin@test.bf', adminPassword: 'Admin1234' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const shots = process.env.SHOTS || ''; if (shots) fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const newPage = async (viewport = { width: 390, height: 780 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'fr-FR' }); const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (404|422|401|403)/.test(m.text())) errors.push('console: ' + m.text()); });
    p.on('dialog', (d) => d.accept('Nouveau123'));
    return p;
  };
  const shot = (p, n) => shots && p.screenshot({ path: path.join(shots, n + '.png'), fullPage: true });
  const noOverflow = async (p, label) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(o <= 1, `débordement horizontal (${o}px) sur ${label}`); };
  const step = (n) => console.log('✔', n);

  // 1. Visiteur (mobile)
  const v = await newPage();
  await v.goto(base + '/'); await v.waitForSelector('.hero h1');
  assert.ok((await v.locator('.card h3').count()) >= 6, 'catégories affichées'); await noOverflow(v, 'accueil'); await shot(v, '01-accueil');
  await v.click('#burger'); await v.click('#nav >> text=Services'); await v.waitForSelector('#list .card');
  assert.ok((await v.locator('#list .card').count()) >= 10); await noOverflow(v, 'catalogue'); await shot(v, '02-catalogue');
  await v.fill('#q', 'flyer'); await v.click('#sf button'); await v.waitForFunction(() => document.querySelectorAll('#list .card').length === 1);
  await v.click('#list .card'); await v.waitForSelector('h1:has-text("Affiches et flyers")');
  await v.waitForSelector('text=Sur devis'); await shot(v, '03-service');
  step('visiteur : accueil, menu mobile, catalogue, recherche, fiche service');
  await v.goto(base + '/services/n-existe-pas'); await v.waitForSelector('text=Service introuvable');
  await v.goto(base + '/page-inconnue'); await v.waitForSelector('text=Page introuvable');
  step('états vides / 404');

  // 2. Inscription via « Demander un devis » puis commande avec fichier
  await v.goto(base + '/services/affiches-et-flyers'); await v.click('text=Demander un devis');
  await v.waitForURL(/connexion/); await v.click('text=Créer un compte >> nth=-1');
  await v.waitForSelector('#rf');
  await v.click('#rf button[type=submit]'); await v.waitForSelector('.err.field'); assert.ok(await v.locator('.err.field').count() >= 3, 'erreurs de validation visibles');
  await v.fill('#f-name', 'Awa Ouedraogo'); await v.fill('#f-email', 'awa@test.bf'); await v.fill('#f-password', 'Motdepasse1');
  await v.click('#rf button[type=submit]'); await v.waitForURL(/commander\/affiches-et-flyers/);
  step('inscription avec retour vers le formulaire');
  await v.click('#of button[type=submit]'); await v.waitForSelector('.err.field'); await shot(v, '04-erreurs-form');
  await v.fill('#f-details', 'Affiche pour l\'ouverture de ma boutique de vêtements le 15 décembre.');
  await v.fill('#f-budget', '50 000'); await v.check('input[name=selected_options] >> nth=0');
  const png = path.join(dir, 'logo.png'); fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  await v.setInputFiles('#f-files', png);
  await v.click('#of button[type=submit]'); await v.waitForURL(/espace\/commandes\/\d+\?nouvelle=1/);
  await v.waitForSelector('text=Votre demande a bien été enregistrée'); await v.waitForSelector('#files a');
  await v.waitForSelector('#files a:has-text("logo.png")'); await noOverflow(v, 'détail commande'); await shot(v, '05-commande');
  const orderUrl = v.url().split('?')[0];
  await v.reload(); await v.waitForSelector('h1:has-text("Affiches et flyers")'); await v.waitForSelector('.pill:has-text("Reçue")');
  step('commande enregistrée avec pièce jointe, retrouvée après rechargement');

  // 3. Conseiller créé par l'admin (bureau)
  const a = await newPage({ width: 1200, height: 800 });
  await a.goto(base + '/admin'); await a.waitForURL(/connexion/);
  await a.fill('#f-email', 'admin@test.bf'); await a.fill('#f-password', 'Admin1234'); await a.click('button[type=submit]'); await a.waitForURL(base + '/admin');
  await a.waitForSelector('h1:has-text("Tableau de bord")'); assert.ok(await a.locator('.kpi').first().textContent() === '1'); await shot(a, '06-admin');
  await a.goto(base + '/admin/utilisateurs'); await a.fill('#uf [name=name]', 'Issa Conseiller'); await a.fill('#uf [name=email]', 'issa@test.bf'); await a.fill('#uf [name=password]', 'Conseil123');
  await a.click('#uf button[type=submit]'); await a.waitForSelector('td:has-text("Issa Conseiller")');
  await a.goto(base + '/admin/commandes'); await a.click('table a'); await a.waitForSelector('#af');
  await a.selectOption('#f-advisor_id', { label: 'Issa Conseiller' }); await a.click('#af button'); await a.waitForSelector('dd:has-text("Issa Conseiller")');
  step('admin : création conseiller et attribution');

  // 4. Le conseiller traite
  const c = await newPage({ width: 1200, height: 800 });
  await c.goto(base + '/connexion'); await c.fill('#f-email', 'issa@test.bf'); await c.fill('#f-password', 'Conseil123'); await c.click('button[type=submit]'); await c.waitForURL(/conseiller/);
  await c.click('text=Mes demandes'); await c.click('table a'); await c.waitForSelector('#qf');
  await c.fill('#f-quote_text', 'Devis : 40 000 FCFA, livraison sous 3 jours.'); await c.click('#qf button'); await c.waitForSelector('.pill:has-text("Devis envoyé") >> nth=0');
  await c.click('text=Ouvrir la conversation'); await c.fill('#f-body', 'Bonjour Awa, votre devis est prêt.'); await c.click('#mf button'); await c.waitForSelector('.msg.me');
  step('conseiller : devis et message');
  const cc = await newPage({ width: 1200, height: 800 }); // le conseiller ne voit pas les autres espaces
  await cc.goto(base + '/connexion'); await cc.fill('#f-email', 'issa@test.bf'); await cc.fill('#f-password', 'Conseil123'); await cc.click('button[type=submit]'); await cc.waitForURL(/conseiller/);
  await cc.goto(base + '/admin'); await cc.waitForURL(/conseiller/);

  // 5. Client : voit le devis, le message, accepte
  await v.goto(orderUrl); await v.waitForSelector('h2:has-text("Devis")'); await v.waitForSelector('text=40 000 FCFA');
  await v.click('text=Accepter le devis'); await v.waitForSelector('.timeline .pill:has-text("Acceptée")');
  await v.goto(base + '/espace/messages'); await v.waitForSelector('a.card .badge'); await v.click('a.card >> nth=0');
  await v.waitForSelector('.msg:has-text("votre devis est prêt")'); await v.fill('#f-body', 'Merci, je valide !'); await v.click('#mf button'); await shot(v, '07-messagerie');
  await c.reload(); await c.waitForSelector('.msg:has-text("Merci, je valide")');
  step('client : devis, acceptation, messagerie bidirectionnelle');

  // 6. Isolation : un 2e client ne voit rien
  const b = await newPage();
  await b.goto(base + '/inscription'); await b.fill('#f-name', 'Bob Test'); await b.fill('#f-email', 'bob@test.bf'); await b.fill('#f-password', 'Motdepasse2'); await b.click('button[type=submit]'); await b.waitForURL(/espace/);
  await b.goto(orderUrl); await b.waitForSelector('.alert.err'); assert.ok(!(await b.content()).includes('boutique de vêtements'), 'pas de fuite de données');
  step('isolation entre clients');

  // 7. Admin : catalogue modifiable -> visible côté public
  await a.goto(base + '/admin/services/nouveau'); await a.fill('#f-name', 'Atelier Zorglub'); await a.fill('#f-summary', 'Initiation'); await a.fill('#f-price_text', '25 000 FCFA'); await a.click('#svf button[type=submit]'); await a.waitForURL(/admin\/services$/);
  await v.goto(base + '/services?q=Zorglub'); await v.waitForSelector('#list .card:has-text("Atelier Zorglub")'); await v.waitForSelector('text=25 000 FCFA');
  await a.click('tr:has-text("Atelier Zorglub") >> text=Dépublier'); await a.waitForSelector('tr:has-text("Atelier Zorglub") >> text=Non publié');
  await v.goto(base + '/services?q=Zorglub'); await v.waitForSelector('#list .empty, #list .card'); assert.equal(await v.locator('#list .card').count(), 0, 'service dépublié encore visible'); await v.waitForSelector('#list .empty');
  await a.goto(base + '/admin/parametres'); await a.fill('#f-phone', '+226 70 00 00 00'); await a.click('#pf button'); await a.waitForSelector('.alert.ok');
  await v.goto(base + '/contact'); await v.waitForSelector('dd:has-text("+226 70 00 00 00")');
  await a.goto(base + '/admin/journal'); await a.waitForSelector('td:has-text("service.create")');
  await noOverflow(v, 'contact'); await shot(a, '08-admin-services');
  step('admin : CRUD catalogue, publication, paramètres, journal');

  assert.deepEqual(errors, [], 'aucune erreur console/page : ' + errors.join(' | '));
  step('aucune erreur JavaScript');
  await browser.close(); await new Promise((r) => app.server.close(r)); fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nE2E OK');
})().catch((e) => { console.error('\nE2E ÉCHEC :', e.message); process.exit(1); });
