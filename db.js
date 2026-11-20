'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'digifaso.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  phone TEXT DEFAULT '', password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('client','advisor','admin')) DEFAULT 'client',
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT DEFAULT '',
  icon TEXT DEFAULT '', position INTEGER DEFAULT 0, published INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS services(
  id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id),
  slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, summary TEXT DEFAULT '', description TEXT DEFAULT '',
  deliverables TEXT NOT NULL DEFAULT '[]', options TEXT NOT NULL DEFAULT '[]',
  delay_text TEXT DEFAULT '', price_text TEXT DEFAULT '', position INTEGER DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER REFERENCES services(id), service_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('devis','commande')), details TEXT NOT NULL,
  selected_options TEXT NOT NULL DEFAULT '[]', budget TEXT DEFAULT '', deadline TEXT DEFAULT '',
  contact_pref TEXT DEFAULT 'messagerie', status TEXT NOT NULL DEFAULT 'recue',
  advisor_id INTEGER REFERENCES users(id), quote_text TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_advisor ON orders(advisor_id);
CREATE TABLE IF NOT EXISTS order_files(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), uploader_id INTEGER NOT NULL REFERENCES users(id),
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS status_history(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), status TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id), note TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS conversations(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id), advisor_id INTEGER REFERENCES users(id),
  subject TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  sender_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
CREATE TABLE IF NOT EXISTS conversation_reads(
  conversation_id INTEGER NOT NULL, user_id INTEGER NOT NULL, last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(conversation_id, user_id));
CREATE TABLE IF NOT EXISTS contact_messages(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT DEFAULT '', message TEXT NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, target TEXT DEFAULT '', detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);
  return db;
}

const SETTING_KEYS = ['site_name', 'tagline', 'country', 'currency', 'timezone', 'phone', 'email', 'whatsapp',
  'address', 'hours', 'payment_methods'];

function seed(db) {
  const hasCat = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  const insSet = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  const defaults = { site_name: 'DIGIFASO', tagline: 'Votre présence digitale, gérée par des professionnels' };
  for (const k of SETTING_KEYS) insSet.run(k, defaults[k] || '');
  if (hasCat) return;
  // Contenu initial issu du cahier des charges (§3). Aucun tarif inventé : « Sur devis » (price_text vide).
  const cats = [
    ['community-management', 'Community management', 'Animation et gestion de vos pages et communautés.', '💬'],
    ['comptes-professionnels', 'Comptes professionnels', 'Création et configuration de vos pages et profils professionnels.', '🏢'],
    ['gestion-reseaux-sociaux', 'Gestion des réseaux sociaux', 'Gestion professionnelle de vos réseaux, selon les accès que vous autorisez.', '📱'],
    ['creation-graphique', 'Création graphique', 'Affiches, flyers, logos et visuels pour vos supports.', '🎨'],
    ['production-audiovisuelle', 'Production audiovisuelle', 'Spots publicitaires et vidéos promotionnelles.', '🎬'],
    ['marketing-digital', 'Marketing et publicité digitale', 'Stratégie, campagnes publicitaires, analyse et recommandations.', '📈'],
  ];
  const insCat = db.prepare('INSERT INTO categories(slug,name,description,icon,position) VALUES(?,?,?,?,?)');
  cats.forEach((c, i) => insCat.run(c[0], c[1], c[2], c[3], i));
  const cid = (slug) => db.prepare('SELECT id FROM categories WHERE slug=?').get(slug).id;
  const svc = [
    ['community-management', 'animation-de-page', 'Animation de page et communauté',
      'Animation régulière de votre page et de votre communauté.',
      'Nous animons votre page : réponses aux commentaires et messages, modération, et publication de contenus selon un calendrier éditorial défini avec vous.',
      ['Calendrier éditorial', 'Publications planifiées', 'Modération des commentaires', 'Rapport de performance (si les données sont disponibles)'],
      ['Nombre de publications par semaine', 'Plateformes concernées'], 'À définir avec votre conseiller'],
    ['community-management', 'creation-de-contenus', 'Création de contenus pour vos publications',
      'Textes et visuels adaptés à votre audience.', 'Rédaction et conception de contenus pour vos publications, validés avec vous avant diffusion.',
      ['Textes de publications', 'Visuels adaptés aux réseaux'], ['Ton de communication', 'Langue(s)'], 'À définir avec votre conseiller'],
    ['comptes-professionnels', 'creation-page-facebook', 'Création de page Facebook professionnelle',
      'Accompagnement pour créer et configurer votre page Facebook.',
      'Nous vous accompagnons dans la création de votre page professionnelle, la configuration des informations, visuels et paramètres, dans le respect des règles de la plateforme. Nous ne vous demandons jamais votre mot de passe : l\'accès nous est donné via les rôles et invitations officiels.',
      ['Page configurée (informations, visuels, paramètres)', 'Guide de prise en main'], ['Photo de profil et couverture', 'Boutons d\'action'], 'À définir avec votre conseiller'],
    ['comptes-professionnels', 'profils-professionnels', 'Profils professionnels (autres plateformes)',
      'Création de profils professionnels sur les plateformes compatibles.', 'Configuration de profils professionnels sur Instagram, TikTok et autres plateformes compatibles.',
      ['Profils configurés', 'Recommandations de bonnes pratiques'], ['Plateformes souhaitées'], 'À définir avec votre conseiller'],
    ['gestion-reseaux-sociaux', 'gestion-complete', 'Gestion complète de vos réseaux sociaux',
      'Publication, modération, assistance et suivi.', 'Gestion de vos pages Facebook, Instagram, TikTok et autres, selon les accès que vous nous autorisez. Aucune connexion automatique aux plateformes n\'est proposée à ce stade : les publications sont réalisées par notre équipe.',
      ['Publication', 'Modération', 'Assistance', 'Suivi'], ['Plateformes concernées', 'Fréquence de publication'], 'À définir avec votre conseiller'],
    ['creation-graphique', 'affiches-et-flyers', 'Affiches et flyers',
      'Affiches publicitaires et événementielles, flyers.', 'Conception d\'affiches et de flyers pour votre activité ou vos événements. Décrivez votre besoin et joignez vos références.',
      ['Fichier prêt pour l\'impression et le web', 'Corrections selon accord'], ['Format', 'Quantité de variantes'], 'À définir avec votre conseiller'],
    ['creation-graphique', 'logo-identite-visuelle', 'Logo et identité visuelle',
      'Création de logo et de charte graphique.', 'Création de votre logo et de votre identité visuelle (couleurs, typographies, déclinaisons).',
      ['Logo', 'Charte graphique'], ['Déclinaisons réseaux sociaux'], 'À définir avec votre conseiller'],
    ['creation-graphique', 'visuels-reseaux-sociaux', 'Visuels pour réseaux sociaux',
      'Visuels et supports promotionnels.', 'Création de visuels pour vos publications et supports promotionnels.',
      ['Visuels aux bons formats'], ['Nombre de visuels'], 'À définir avec votre conseiller'],
    ['production-audiovisuelle', 'spot-publicitaire', 'Spot publicitaire',
      'Conception et production de spots publicitaires.', 'Production de spots publicitaires pour la télévision, la radio ou le web, selon les capacités de l\'équipe et votre besoin.',
      ['Spot finalisé', 'Formats de diffusion convenus'], ['Durée', 'Voix off'], 'À définir avec votre conseiller'],
    ['production-audiovisuelle', 'video-promotionnelle', 'Vidéos promotionnelles et montage',
      'Vidéos promotionnelles, montage et formats courts.', 'Montage vidéo, formats courts pour les réseaux et animations, selon les capacités réelles de l\'équipe.',
      ['Vidéo montée', 'Formats courts'], ['Sous-titres', 'Musique'], 'À définir avec votre conseiller'],
    ['marketing-digital', 'conseil-strategie-digitale', 'Conseil en stratégie digitale',
      'Analyse et recommandations pour votre présence en ligne.', 'Analyse de votre situation et recommandations pour votre stratégie digitale.',
      ['Analyse', 'Recommandations écrites'], [], 'À définir avec votre conseiller'],
    ['marketing-digital', 'campagnes-publicitaires', 'Accompagnement aux campagnes publicitaires',
      'Mise en place et suivi de vos campagnes.', 'Accompagnement pour vos campagnes publicitaires. Important : les budgets publicitaires versés aux plateformes sont distincts des frais de prestation DIGIFASO.',
      ['Paramétrage de campagne', 'Suivi et recommandations'], ['Plateformes publicitaires'], 'À définir avec votre conseiller'],
  ];
  const insSvc = db.prepare(`INSERT INTO services(category_id,slug,name,summary,description,deliverables,options,delay_text,price_text,position)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  svc.forEach((s, i) => insSvc.run(cid(s[0]), s[1], s[2], s[3], s[4], JSON.stringify(s[5]), JSON.stringify(s[6]), s[7], '', i));
}

module.exports = { openDb, seed, SETTING_KEYS };
