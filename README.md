# Cardmarket Helper

Extension Chrome / Edge / Brave (Manifest V3) qui ajoute des boutons rapides sur cardmarket.com :

- **🇫🇷 Cartes en français** : sur une fiche produit, n'affiche que les offres de cartes en langue
  française (filtre `language=2` de Cardmarket, ajouté à l'adresse). Un second clic retire le filtre.
  Sur les autres pages, le même bouton bascule la langue du site (`/en/` → `/fr/`).
- **📷 Demander des photos** : insère dans le message au vendeur la phrase
  « Bonjour, j'aimerais avoir des photos de la carte *Groudon (L'Appel des Légendes)*, avant et arrière,
  est-ce possible ? S'il vous plaît. »
  Le repère `{carte}` de la phrase (modifiable dans les options) est remplacé par la carte de la page
  et son édition, lus dans le titre de la fiche produit ou, à défaut, dans l'adresse.
  **La langue s'adapte au vendeur** : le drapeau affiché devant son nom donne son pays. Vendeur en
  France → message français ; partout ailleurs, et si le drapeau n'est pas reconnu → message anglais.
  La notification indique la langue employée, et signale le cas « pays non détecté ».
- Un bouton **photo** bleu sur chaque ligne d'annonce, juste à gauche du bouton panier : un clic ouvre
  le profil du vendeur, suit le lien « Envoyer un message » et pré-remplit le texte.
  Si la colonne de droite est introuvable, le bouton se replie à côté du nom du vendeur.

Par défaut, le message est **inséré mais pas envoyé** : tu relis et tu cliques sur Envoyer.
L'envoi automatique peut être activé dans les options (à utiliser avec prudence).

## Installation (Chrome, Edge, Brave)

1. Ouvre `chrome://extensions` (ou `edge://extensions`).
2. Active le **Mode développeur** (interrupteur en haut à droite).
3. Clique sur **Charger l'extension non empaquetée** et choisis le dossier `cardmarket-extension`.
4. Recharge une page Cardmarket : la barre de boutons apparaît en bas à droite.

Chrome affiche un avertissement jaune du type « Unrecognized manifest key » : c'est normal, ce sont les
clés qui servent à Firefox (`background.scripts`, `browser_specific_settings`). L'extension fonctionne
malgré cet avertissement.

## Installation (Firefox)

1. Ouvre `about:debugging#/runtime/this-firefox`.
2. **Charger un module complémentaire temporaire…** puis choisis `manifest.json`.
3. Le module est retiré à la fermeture de Firefox (limitation de Firefox pour les extensions non signées).

## Options

Clique sur l'icône de l'extension (ou clic droit → Options) pour :

- modifier la phrase envoyée au vendeur ;
- afficher ou masquer les boutons 📷 à côté des vendeurs ;
- activer l'envoi automatique sans relecture.

## Fonctionnement du bouton photos

1. Sur une fiche produit, clique sur 📷 à côté du vendeur voulu.
2. L'extension mémorise ce vendeur (10 minutes) et ouvre sa page profil.
3. Sur le profil, elle clique sur « Envoyer un message » (visible uniquement si tu es connecté).
4. Sur le formulaire de message, elle remplit la zone de texte. Tu cliques sur Envoyer.

Si tu n'es pas connecté, l'extension affiche un rappel ; dès que tu ouvres la messagerie du vendeur,
le texte se remplit tout seul.

## Si Cardmarket change son site

Les éléments repérés par l'extension sont dans `content.js` :

- `decorateSellerRows()` : lien du vendeur (`.article-row .seller-name a[href*="/Users/"]`) puis `findRowCartButton()` pour placer le bouton dans la colonne de droite.
- `findSendMessageLink()` : lien « Envoyer un message » sur le profil.
- `findMessageTextarea()` : zone de texte du formulaire de message.

Chaque fonction essaie plusieurs sélecteurs, du plus précis au plus général.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | Déclaration de l'extension |
| `content.js` | Boutons et logique injectés sur cardmarket.com |
| `content.css` | Styles des boutons et notifications |
| `options.html` / `options.js` | Page d'options |
| `background.js` | Ouvre les options au clic sur l'icône |
| `icons/` | Icône de l'extension en 16, 48 et 128 px |
