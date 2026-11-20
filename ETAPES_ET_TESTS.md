# Étapes de réalisation et tests

Claude doit traiter une seule étape à la fois et attendre la confirmation de l'utilisateur.

## Étape 0 — Diagnostic et choix techniques
- Inspecter le dossier et les outils déjà installés.
- Vérifier versions de Node.js, gestionnaire de paquets et Git si présents.
- Proposer une architecture front-end, back-end, base de données et stockage de fichiers.
- Expliquer les avantages et demander validation avant installation.
- Test : fournir les versions détectées et confirmer qu'aucun fichier existant ne sera écrasé.

## Étape 1 — Initialisation
- Créer le projet, les scripts, la configuration et `.env.example`.
- Ajouter un contrôle de santé du serveur si l'architecture le prévoit.
- Test : installer les dépendances, démarrer le projet et ouvrir l'URL locale indiquée.

## Étape 2 — Site public et catalogue
- Accueil, navigation, catégories, liste et détail des services.
- Contenu administrable à terme ; ne pas coder les services uniquement en dur si une base de données est déjà en place.
- Test : navigation, affichage mobile, recherche/filtrage si prévu, liens et états vides.

## Étape 3 — Comptes et authentification
- Inscription, connexion, déconnexion, récupération de compte si configurée.
- Rôles client, conseiller et administrateur.
- Test : accès autorisé/refusé et isolation des données.

## Étape 4 — Commandes et devis
- Formulaire de commande/devis, validation, pièces jointes sécurisées.
- Enregistrement persistant en base.
- Test : créer une demande, la retrouver après rechargement et vérifier les validations.

## Étape 5 — Espace client
- Liste des commandes, détail, historique et statuts.
- Test : le client A ne peut pas accéder aux demandes du client B, même en modifiant l'URL.

## Étape 6 — Messagerie conseiller
- Conversations persistantes, attribution et permissions.
- Test : envoyer et relire des messages avec deux comptes de test ; vérifier les refus d'accès.

## Étape 7 — Administration
- Gestion des services, catégories, commandes, clients et conseillers.
- Test : opérations CRUD autorisées, contrôle des rôles et journalisation.

## Étape 8 — Notifications et intégrations
- Ajouter uniquement les canaux validés et réellement configurés.
- Test : succès, échec, reprise et absence de fuite de secrets.

## Étape 9 — Vérification et déploiement
- Tests unitaires, intégration et parcours complet.
- Vérifications de sécurité, accessibilité, responsive et performance.
- Guide de déploiement, sauvegarde et restauration.
- Ne jamais publier sans validation explicite du propriétaire.

## Compte rendu obligatoire à la fin de chaque étape
- Fichiers créés/modifiés.
- Commandes exécutées.
- Tests et résultats observés.
- Problèmes rencontrés et corrections.
- Ce qui reste à faire.
- Question : « As-tu exécuté les tests et confirmé que tout fonctionne ? »
