# DIGIFASO

Plateforme de services digitaux (cahier des charges : `docs/CAHIER_DES_CHARGES.md`).
Application web réelle : serveur Node.js, base SQLite, interface mobile-first. **Aucune dépendance npm** (Node 22.13+ uniquement).

## Démarrer (ordinateur ou téléphone avec Node)
```
cp .env.example .env      # puis adaptez ADMIN_EMAIL / ADMIN_PASSWORD
npm start                 # http://localhost:3000
```
Au premier démarrage, un compte administrateur est créé. Si `ADMIN_PASSWORD` est vide, un mot de passe aléatoire s'affiche **une seule fois** dans la console.
Dans l'admin : *Utilisateurs* → créer des conseillers ; *Paramètres* → téléphone, e-mail, WhatsApp, horaires.

## Tests
```
npm test            # 16 tests d'API (aussi : TEST_TURSO_FAKE=1 npm test, via le protocole Turso) (accès, isolation clients, fichiers, CRUD, sécurité)
node tests/e2e.js   # parcours complet dans Chrome mobile/bureau (nécessite Playwright + Chrome)
```

## Fonctionnel (testé)
Accueil, catalogue (6 catégories, 12 services modifiables, recherche/filtre), fiche service, devis/commande avec pièces jointes sécurisées, comptes (client/conseiller/admin, permissions côté serveur), espace client (suivi, 9 statuts, acceptation/annulation), messagerie persistante par demande (indicateur « réponse en attente », non-lus), espace conseiller, administration (tableau de bord, services, catégories, utilisateurs, attribution, statuts, devis, contacts, paramètres, journal d'audit).

## Limites (honnêtes)
- Pas de paiement en ligne, pas d'API Meta/TikTok, pas de publication automatique (hors périmètre §11 du cahier).
- Pas d'envoi d'e-mails/SMS : les notifications sont dans l'application (pastille « nouveau »). Mot de passe oublié : réinitialisation par un administrateur.
- Messagerie par rafraîchissement toutes les 8 s (pas de temps réel instantané).
- Tarifs « Sur devis », pages légales, À propos, coordonnées : **à renseigner par le propriétaire** (`docs/QUESTIONS_A_CONFIRMER.md`).
- Fichiers clients stockés dans la base (3 Mo max chacun) : adapté à un volume modeste.

## Déploiement sur Vercel (recommandé pour démarrer)
Vercel n'a pas de disque durable : les données sont dans **Turso** (SQLite hébergé, plan gratuit) et les fichiers clients sont stockés dans la base.
1. Créez une base sur turso.tech ; notez son URL (`libsql://…`) et créez un jeton d'accès (« token »).
2. Mettez le contenu de ce dossier **à la racine** d'un dépôt GitHub (`package.json` et `vercel.json` à la racine, pas dans un sous-dossier).
3. Sur Vercel : *Add New → Project*, importez le dépôt, laissez « Framework Preset : Other », puis ajoutez les variables d'environnement :
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (8+ caractères, lettre + chiffre), `TRUST_PROXY=1`.
4. Déployez. Au premier appel, les tables, le catalogue initial et le compte administrateur sont créés automatiquement.
5. Choisissez la région de la fonction Vercel proche de celle de la base Turso (Réglages → Functions) pour la vitesse.
Limites Vercel : corps de requête 4,5 Mo → fichiers limités à **3 Mo** ; la limitation anti-abus des tentatives de connexion est en mémoire par instance (best-effort).
Ce chemin Vercel/Turso est testé avec un faux serveur respectant le protocole Turso, **pas encore contre un vrai compte Turso ni un vrai déploiement Vercel**.

## Autres hébergeurs (serveur permanent)
`Dockerfile` et `render.yaml` fournis (SQLite local sur disque persistant `DATA_DIR`, HTTPS, `NODE_ENV=production`).
**Sauvegarde** : copier le dossier `DATA_DIR` (ou, avec Turso, utiliser les sauvegardes/exports Turso). **Restauration** : remettre le dossier en place puis redémarrer.
