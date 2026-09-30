# Bibliothèque numérique SM

Application web Node.js avec comptes lecteurs, catalogue partagé et prêts numériques de 14 jours.

## Démarrer sur Windows

1. Installer Node.js 22 ou plus récent.
2. Ouvrir PowerShell dans ce dossier.
3. Lancer `.\start.ps1` et saisir l’adresse e-mail et le mot de passe du gestionnaire lorsqu’ils sont demandés. Le mot de passe doit faire au moins 14 caractères.
4. Ouvrir <http://localhost:3000>.

Les lecteurs créent ensuite leur compte depuis **Mon espace**. Le mot de passe n’est jamais enregistré en clair. La base SQLite est créée dans `data/bibliotheque-sm.sqlite`.

## Fonctions disponibles

- Catalogue partagé avec recherche et filtres.
- Comptes lecteurs, connexion et déconnexion.
- Emprunt numérique pendant 14 jours, limite de trois emprunts et un renouvellement de sept jours.
- Retour des livres et lecteur de texte en ligne.
- Interface gestionnaire : ajout, modification, retrait de livres et suivi des emprunts.
- Protection des pages d’administration et stockage persistant SQLite.

Le compte gestionnaire initial est créé au premier démarrage avec les identifiants saisis dans `start.ps1`. Les livres déjà présents sont des exemples fictifs. Tu peux les retirer et saisir ton propre catalogue.

## Mise en ligne proposée : Railway

La structure convient à Railway : le service lance `npm start` et la base doit vivre sur un volume monté sur `/data`. Dans les variables du service, définir `DATA_DIR=/data`, `NODE_ENV=production`, `ADMIN_EMAIL` et `ADMIN_PASSWORD`. Créer ensuite un domaine depuis les réglages réseau du service. Il faut publier le contenu de ce dossier dans un dépôt Git relié à Railway, ou déployer un dossier local avec Railway CLI.

Railway indique une période d’essai avec crédits limités, puis un forfait gratuit limité. Le forfait Hobby est affiché à 5 USD minimum d’usage mensuel, avec 5 USD de crédits inclus ; le dépassement d’usage est facturé. Le plan gratuit donne 0,5 Go de volume et ne permet plus de domaine personnalisé après la période d’essai. Vérifier les tarifs avant d’activer une formule payante.

## Avant d’ouvrir au public

- Remplacer les exemples par des livres dont tu as le droit de diffuser la version numérique.
- Créer le compte gestionnaire avec un mot de passe unique et fort.
- Prévoir une politique de confidentialité, des conditions d’utilisation et une politique de sauvegarde.
- Cette version stocke le texte des livres dans SQLite ; elle n’importe pas encore les fichiers EPUB/PDF et n’envoie pas de courriels de rappel.
- L’application utilise une base SQLite et un seul exemplaire numérique empruntable par titre. Les réservations et notifications de rappel ne sont pas encore mises en place.

Pour un catalogue important ou plusieurs instances simultanées, il faudra migrer la base vers PostgreSQL et stocker les fichiers de lecture séparément.

