# Cahier des charges fonctionnel — DIGIFASO

## 1. Vision
DIGIFASO est une agence et une plateforme de services digitaux. Elle permet aux particuliers, entrepreneurs, commerçants, associations et entreprises de découvrir des prestations numériques, demander un devis ou commander une prestation, échanger avec un conseiller et suivre le traitement de leur demande.

DIGIFASO n'est pas une boutique de produits physiques.

## 2. Langue et zone
- Langue de l'interface initiale : français.
- Pays, devise, coordonnées, fuseau horaire et moyens de paiement : à rendre configurables et à confirmer avec le propriétaire avant mise en production.
- L'interface doit être responsive : téléphone, tablette et ordinateur.

## 3. Services à présenter
### A. Community management
- Gestion et animation de pages et communautés.
- Calendrier éditorial et planification de publications.
- Création de contenus et modération.
- Rapports de performance, si les données sont disponibles.

### B. Création et configuration de comptes professionnels
- Accompagnement à la création de pages Facebook professionnelles et de profils professionnels sur les plateformes compatibles.
- Configuration de profils, informations, visuels et paramètres.
- Processus respectueux des règles de chaque plateforme.
- Ne jamais demander ni stocker le mot de passe personnel du client. Utiliser les mécanismes officiels de rôles, invitations et autorisations lorsque disponibles.

### C. Gestion professionnelle des réseaux sociaux
- Gestion de pages Facebook, Instagram, TikTok et autres plateformes, selon les accès autorisés.
- Publication, modération, assistance et suivi.
- Ne pas promettre une intégration API tant qu'elle n'est pas développée, approuvée et testée.

### D. Création graphique
- Affiches publicitaires et événementielles.
- Flyers.
- Logos et identité visuelle.
- Visuels pour réseaux sociaux et supports promotionnels.
- Formulaire permettant au client de décrire son besoin et de joindre des fichiers de référence.

### E. Production audiovisuelle
- Spots publicitaires.
- Vidéos promotionnelles.
- Montage vidéo et formats courts.
- Animations, selon les capacités réelles de l'équipe.

### F. Marketing et publicité digitale
- Conseil en stratégie digitale.
- Accompagnement aux campagnes publicitaires.
- Analyse et recommandations.
- Les budgets publicitaires des plateformes doivent être distingués des frais de prestation DIGIFASO.

Les services, descriptions, prix, délais et options doivent être modifiables depuis l'administration. Ne pas inventer de tarifs : prévoir « Sur devis » tant que le propriétaire n'a pas fourni les prix.

## 4. Parcours visiteur
1. Arriver sur la page d'accueil.
2. Comprendre l'offre DIGIFASO et accéder aux catégories.
3. Parcourir les services.
4. Ouvrir une fiche service avec description, livrables, délai indicatif et tarif ou mention « Sur devis ».
5. Cliquer sur « Commander » ou « Demander un devis ».
6. Renseigner les informations nécessaires et envoyer la demande.
7. Recevoir une confirmation et pouvoir contacter un conseiller.

## 5. Parcours client
- Créer un compte et se connecter.
- Consulter et modifier son profil.
- Envoyer une demande de commande/devis.
- Joindre des fichiers utiles (brief, logo, images), avec limites de taille et contrôles de sécurité.
- Consulter l'historique de ses demandes.
- Voir le statut de chaque commande : reçue, en étude, devis envoyé, en attente de validation, acceptée, en production, en attente de retour client, terminée, annulée.
- Échanger avec un conseiller au sujet d'une demande.
- Retrouver les informations et messages liés à ses commandes.

## 6. Messagerie et conseiller
- Prévoir une messagerie liée au compte client et, si possible, à une commande.
- Afficher clairement si un conseiller est disponible ou si une réponse est en attente, sans simuler une disponibilité réelle.
- Conserver l'historique des conversations.
- Contrôler les accès : un client ne voit que ses propres conversations ; les conseillers voient uniquement les conversations qui leur sont attribuées ou autorisées.
- Prévoir une solution de contact alternative configurable (téléphone, WhatsApp ou e-mail) si elle est choisie par le propriétaire.
- Les messages et notifications doivent gérer les erreurs d'envoi.

## 7. Espace administrateur
- Connexion protégée et rôles distincts.
- Tableau de bord avec demandes récentes et commandes par statut.
- Créer, modifier, publier, dépublier et supprimer logiquement des catégories et services.
- Gérer descriptions, images, prix, options et délais.
- Consulter les clients et leurs demandes.
- Attribuer une demande à un conseiller.
- Répondre aux clients et modifier le statut d'une commande.
- Consulter les fichiers envoyés en respectant les permissions.
- Journaliser les actions administratives importantes.

## 8. Rôles et permissions
- Visiteur : consulter les pages et services, démarrer une demande selon le parcours retenu.
- Client : gérer son profil, ses commandes et ses conversations.
- Conseiller : traiter les demandes qui lui sont attribuées et communiquer avec les clients.
- Administrateur : gérer la plateforme et les utilisateurs autorisés.

Appliquer les permissions côté serveur, pas uniquement en masquant des boutons dans l'interface.

## 9. Pages prévues
- Accueil.
- Services / catégories.
- Détail d'un service.
- À propos de DIGIFASO.
- Contact.
- Inscription et connexion.
- Espace client : tableau de bord, commandes, détail d'une commande, messages, profil.
- Espace conseiller : demandes assignées, détails, conversations.
- Administration : tableau de bord, services, catégories, commandes, clients, conseillers, paramètres.

## 10. Exigences de qualité
- Interface claire, professionnelle, moderne et mobile-first.
- Navigation accessible et formulaires compréhensibles.
- Validation côté client et côté serveur.
- Protection contre accès non autorisé, injections, abus et téléversements dangereux.
- Mots de passe hachés avec une méthode éprouvée ; sessions sécurisées.
- Sauvegardes et politique de conservation à définir.
- Pages légales et politique de confidentialité à préparer avant ouverture publique.
- Référencement de base : titres, descriptions, URLs lisibles.
- Journalisation technique sans enregistrer de secrets.

## 11. Hors périmètre tant que non confirmé
- Paiement en ligne.
- Connexion directe aux API Meta, TikTok ou autres plateformes.
- Publication automatique sur les réseaux.
- Application mobile native.
- Tarifs, délais et garanties commerciaux définitifs.

Ces fonctions ne doivent pas être présentées comme opérationnelles avant intégration, autorisations et tests réels.

## 12. Critères d'acceptation essentiels
- Un visiteur peut consulter les services sur téléphone et ordinateur.
- Un client peut créer un compte, se connecter et envoyer une demande réelle enregistrée en base de données.
- Un client ne peut pas voir les commandes d'un autre client.
- Un conseiller autorisé peut consulter et traiter une demande qui lui est attribuée.
- Les messages sont persistés et accessibles uniquement aux participants autorisés.
- Un administrateur peut gérer les services et les statuts.
- Les formulaires affichent des erreurs compréhensibles.
- Les tests automatisés et les vérifications manuelles sont documentés.
