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
npm test            # 15 tests d'API (accès, isolation clients, fichiers, CRUD, sécurité)
node tests/e2e.js   # parcours complet dans Chrome mobile/bureau (nécessite Playwright + Chrome)
```

## Fonctionnel (testé)
Accueil, catalogue (6 catégories, 12 services modifiables, recherche/filtre), fiche service, devis/commande avec pièces jointes sécurisées, comptes (client/conseiller/admin, permissions côté serveur), espace client (suivi, 9 statuts, acceptation/annulation), messagerie persistante par demande (indicateur « réponse en attente », non-lus), espace conseiller, administration (tableau de bord, services, catégories, utilisateurs, attribution, statuts, devis, contacts, paramètres, journal d'audit).

## Limites (honnêtes)
- Pas de paiement en ligne, pas d'API Meta/TikTok, pas de publication automatique (hors périmètre §11 du cahier).
- Pas d'envoi d'e-mails/SMS : les notifications sont dans l'application (pastille « nouveau »). Mot de passe oublié : réinitialisation par un administrateur.
- Messagerie par rafraîchissement toutes les 8 s (pas de temps réel instantané).
- Tarifs « Sur devis », pages légales, À propos, coordonnées : **à renseigner par le propriétaire** (`docs/QUESTIONS_A_CONFIRMER.md`).
- SQLite : adapté à une petite/moyenne activité sur un seul serveur.

## Déploiement
Nécessite un hébergeur Node ou Docker avec **disque persistant** (`DATA_DIR`) et HTTPS (`NODE_ENV=production`).
`Dockerfile` et `render.yaml` fournis. **Sauvegarde** : copier régulièrement le dossier `DATA_DIR` (arrêter le serveur ou utiliser `sqlite3 digifaso.db ".backup copie.db"`). **Restauration** : remettre le dossier en place puis redémarrer.
