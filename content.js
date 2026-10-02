// Cardmarket Helper - script de contenu
// Ajoute une barre de boutons flottante + un bouton "photos" à côté de chaque vendeur.
(function () {
  "use strict";

  if (window.__cmxHelperLoaded) return;
  window.__cmxHelperLoaded = true;

  // ---------------------------------------------------------------------------
  // Réglages
  // ---------------------------------------------------------------------------
  // {carte} est remplacé par le nom de la carte de la page en cours.
  const DEFAULTS = {
    phrase:
      "Bonjour, j'aimerais avoir des photos de la carte {carte}, avant et arrière, est-ce possible ? S'il vous plaît.",
    phraseEn:
      "Hello, could I please have photos of the card {carte}, front and back? Thank you very much.",
    autoSend: false,
    rowButtons: true,
    ageBadges: true,
  };

  // Phrase de la version précédente, sans nom de carte : remplacée automatiquement
  // pour que la nouvelle formule s'applique sans avoir à toucher aux options.
  const ANCIENNE_PHRASE =
    "Bonjour, j'aimerais avoir des photos de l'avant et de l'arrière, est-ce possible ? S'il vous plaît.";

  const INTENT_KEY = "cmx_intent";
  const INTENT_TTL_MS = 10 * 60 * 1000; // une intention "demander des photos" reste valable 10 min
  const LANGS = ["en", "de", "fr", "es", "it"];

  let settings = { ...DEFAULTS };

  function loadSettings() {
    return new Promise((resolve) => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.get(DEFAULTS, (items) => {
            settings = { ...DEFAULTS, ...items };
            if (settings.phrase === ANCIENNE_PHRASE) {
              settings.phrase = DEFAULTS.phrase;
              try {
                chrome.storage.sync.set({ phrase: DEFAULTS.phrase });
              } catch (e) {
                /* la phrase reste corrigée pour cette page */
              }
            }
            resolve(settings);
          });
          return;
        }
      } catch (e) {
        /* pas de chrome.storage (mode test / userscript) */
      }
      resolve(settings);
    });
  }

  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local") {
          majDemandes(changes);
          return;
        }
        for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
      });
    }
  } catch (e) {
    /* ignore */
  }

  // ---------------------------------------------------------------------------
  // Utilitaires URL
  // ---------------------------------------------------------------------------
  function parsePath() {
    // /en/Magic/Products/Singles/Alpha/Black-Lotus  ->  lang=en, game=Magic, rest=[Products, ...]
    const parts = location.pathname.split("/").filter(Boolean);
    const lang = LANGS.includes(parts[0]) ? parts[0] : null;
    const game = (lang ? parts[1] : parts[0]) || null; // null sur la page d'accueil
    const rest = lang ? parts.slice(2) : parts.slice(1);
    return { lang, game, rest };
  }

  function isProductPage() {
    return parsePath().rest[0] === "Products";
  }

  function sellerFromProfilePath() {
    const { rest } = parsePath();
    if (rest[0] === "Users" && rest[1]) return decodeURIComponent(rest[1]);
    return null;
  }

  function isMessagePage() {
    return /\/Messages(\/|$)/i.test(location.pathname);
  }

  // /fr/Pokemon/Messages/<vendeur> : sert de filet quand l'intention ne nomme pas le vendeur.
  function sellerFromMessagePath() {
    const { rest } = parsePath();
    if (/^Messages?$/i.test(rest[0] || "") && rest[1]) return decodeURIComponent(rest[1]);
    return null;
  }

  function frenchUrl() {
    const { lang, game, rest } = parsePath();
    if (lang === "fr") return null;
    // Page d'accueil ou URL sans segment de jeu : on bascule seulement la langue.
    const path = game ? "/fr/" + [game, ...rest].join("/") : "/fr";
    return location.origin + path + location.search + location.hash;
  }

  function profileUrl(seller) {
    const { lang, game } = parsePath();
    return `${location.origin}/${lang || "fr"}/${game || "Magic"}/Users/${encodeURIComponent(seller)}`;
  }

  // ---------------------------------------------------------------------------
  // Nom de la carte affichée
  // ---------------------------------------------------------------------------
  function slugEnTexte(slug) {
    return decodeURIComponent(slug || "").replace(/-/g, " ").trim();
  }

  // Texte propre à un élément, sans celui de ses enfants : le titre d'une fiche produit
  // contient un sous-titre (l'édition) qu'il ne faut pas recopier dans le nom de la carte.
  function texteDirect(el) {
    const t = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return t || el.textContent.replace(/\s+/g, " ").trim();
  }

  // Nom de la carte affiché par la page, donc en français. Le titre du site est écarté,
  // ainsi qu'un titre situé dans l'en-tête ou le menu.
  function cardNameFromDom() {
    const h1 =
      document.querySelector('main h1, [role="main"] h1, #content h1, .page-title-container h1') ||
      document.querySelector("h1");
    if (!h1 || h1.closest("header, nav")) return "";
    const t = texteDirect(h1);
    if (!t || t.length > 80 || /^cardmarket$/i.test(t)) return "";
    return t;
  }

  // Nom traduit de l'édition, pris sur le lien « Édité dans » de la fiche :
  //   <a href="/fr/Pokemon/Expansions/151" class="mb-2">151</a>
  // On exige que l'adresse se termine par l'identifiant d'édition de la page courante, et que
  // le lien porte du texte : le premier lien vers l'édition n'est qu'une icône, sans nom.
  function editionNameFromDom(slug) {
    if (!slug) return "";
    const echappe = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp("/Expansions/" + echappe + "/?$", "i");
    for (const a of document.querySelectorAll('a[href*="/Expansions/"]')) {
      if (!rx.test((a.getAttribute("href") || "").split(/[?#]/)[0])) continue;
      let t = a.textContent.replace(/\s+/g, " ").trim();
      // Cardmarket suffixe parfois le nom par le type de produit : « … - Cartes ».
      t = t.replace(/\s*[-–—]\s*(cartes?|cards?|karten|carte|cartas|singles)\s*$/i, "").trim();
      if (t && t.length <= 60) return t;
    }
    return "";
  }

  // Numéro de la carte, lu sur la ligne "Nombre" de la fiche. Cardmarket n'y met que le numéro
  // (« 6 » pour une carte 6/95) : le total imprimé sur la carte n'existe pas dans ses données.
  // Le motif accepte quand même la forme 22/107 au cas où le site l'afficherait un jour.
  function cardNumberFromDom() {
    const label = /^(nombre|numéro|numero|número|number|nummer)\s*:?$/i;
    for (const cell of document.querySelectorAll("dt, th")) {
      if (!label.test(cell.textContent.replace(/\s+/g, " ").trim())) continue;
      const valeur = cell.nextElementSibling;
      const t = valeur ? valeur.textContent.replace(/\s+/g, "").trim() : "";
      if (/^\d{1,4}(\/\d{1,4})?[A-Za-z]?$/.test(t)) return t;
    }
    return "";
  }

  // Nom de la carte, avec son édition entre parenthèses : un vendeur qui propose la même carte
  // dans plusieurs éditions sait alors laquelle photographier.
  // La page (en français) passe en premier ; l'adresse /Products/Singles/<Édition>/<Carte>,
  // en anglais mais toujours présente, sert de filet.
  function currentCardLabel() {
    if (!isProductPage()) return "";
    const { rest } = parsePath();
    let nom = cardNameFromDom() || slugEnTexte(rest[3]);
    const edition = editionNameFromDom(rest[2]) || slugEnTexte(rest[2]);
    if (!nom) return "";

    // Cardmarket suffixe le nom par son code interne : « Groudon ex (NP 38) », « Rayquaza (DX 22) ».
    // Ce n'est pas le numéro imprimé sur la carte, on le remplace par celui de la fiche.
    // L'espace entre les lettres et les chiffres est exigé pour ne pas toucher aux mentions
    // de version, « (V1) », qui distinguent deux illustrations d'une même carte.
    const numero = cardNumberFromDom();
    if (numero) {
      nom = nom.replace(/\s*\([A-Za-z]{1,5}\s+\d{1,4}[a-z]?\)\s*$/, "").trim();
      if (!nom.includes(numero)) nom = `${nom} n° ${numero}`;
    }

    // Le nom contient parfois déjà l'édition : on évite de la répéter.
    if (edition && !nom.toLowerCase().includes(edition.toLowerCase())) return `${nom} (${edition})`;
    return nom;
  }

  // ---------------------------------------------------------------------------
  // Pays du vendeur
  // ---------------------------------------------------------------------------
  // Cardmarket n'expose aucun code pays : le drapeau est une image-sprite, et le seul indice
  // est l'infobulle, qui contient le pays dans une phrase (title="Item location: Italy",
  // « Localisation de l'article : Italie »). On cherche donc le nom du pays à l'intérieur du
  // texte, entouré de caractères non alphabétiques pour ne pas confondre Chine et Chinese.
  function motDansTexte(noms) {
    return new RegExp("(^|[^\\p{L}])(" + noms + ")([^\\p{L}]|$)", "iu");
  }

  const FRANCE = motDansTexte("france|frankreich|francia|frança|francja|frankrijk");

  // Noms de pays tels que Cardmarket peut les afficher en infobulle, dans les langues du site.
  // Sert uniquement à reconnaître qu'une infobulle désigne bien un pays : ce qui n'est pas
  // la France est traité comme étranger, sans qu'il soit utile de savoir lequel.
  const PAYS_CONNUS = motDansTexte(
    "allemagne|deutschland|germany|italie|italy|italia|espagne|spanien|spain|españa|belgique|belgien|belgium|belgië|pays-bas|niederlande|netherlands|nederland|portugal|autriche|österreich|austria|pologne|polen|poland|polska|royaume-uni|vereinigtes königreich|united kingdom|great britain|grande-bretagne|angleterre|england|irlande|ireland|irland|danemark|dänemark|denmark|suède|schweden|sweden|finlande|finnland|finland|norvège|norwegen|norway|suisse|schweiz|switzerland|svizzera|grèce|griechenland|greece|hongrie|ungarn|hungary|tchéquie|république tchèque|tschechien|czech republic|czechia|slovaquie|slowakei|slovakia|slovénie|slowenien|slovenia|croatie|kroatien|croatia|roumanie|rumänien|romania|bulgarie|bulgarien|bulgaria|lituanie|litauen|lithuania|lettonie|lettland|latvia|estonie|estland|estonia|luxembourg|luxemburg|malte|malta|chypre|zypern|cyprus|japon|japan|états-unis|etats-unis|usa|united states|vereinigte staaten|canada|kanada|australie|australia|singapour|singapore|hong kong|chine|china|corée du sud|corée|south korea|brésil|brazil|brasilien|mexique|mexico|turquie|türkei|turkey|ukraine|serbie|serbia|islande|iceland|andorre|andorra|monaco|liechtenstein|saint-marin|san marino|israël|israel|thaïlande|thailand|taïwan|taiwan|philippines|indonésie|indonesia|malaisie|malaysia|inde|india|nouvelle-zélande|new zealand|afrique du sud|south africa|argentine|argentina|chili|chile|colombie|colombia|pérou|peru|russie|russland|russia|biélorussie|belarus|moldavie|moldova|bosnie-herzégovine|bosnia|macédoine|macedonia|albanie|albania|monténégro|montenegro|kosovo|géorgie|georgia|arménie|armenia"
  );

  function codeVersPays(code) {
    if (!code) return "";
    return code.toLowerCase() === "fr" ? "fr" : "autre";
  }

  // Reconnaît une pastille de drapeau, quelle que soit la façon dont Cardmarket la dessine :
  // image, sprite SVG, classe css, ou simple infobulle portant le nom du pays.
  // Renvoie "fr", "autre", ou "" si l'élément n'est pas un drapeau.
  function paysDe(el) {
    if (!el.getAttribute) return "";

    const chemin =
      el.getAttribute("src") ||
      el.getAttribute("data-src") ||
      el.getAttribute("href") ||
      el.getAttribute("xlink:href") ||
      "";
    let m = chemin.match(/(?:flags?|icons?)[/_-]([a-z]{2})(?:[.\-_@]|$)/i) || chemin.match(/#flag[-_]?([a-z]{2})$/i);
    if (m) return codeVersPays(m[1]);

    // getAttribute plutôt que .className : sur un élément SVG, className n'est pas une chaîne.
    const classes = el.getAttribute("class") || "";
    m = classes.match(/(?:^|[\s_-])(?:flag|fi|country)[-_]?(?:icon[-_]?)?([a-z]{2})(?:$|[\s_-])/i);
    if (m) return codeVersPays(m[1]);

    for (const attr of ["data-country", "data-country-code", "data-iso", "data-flag"]) {
      const v = (el.getAttribute(attr) || "").trim();
      if (/^[a-z]{2}$/i.test(v)) return codeVersPays(v);
    }

    // Infobulle de la pastille : « Item location: Italy », « Localisation de l'article : Italie ».
    // Le texte propre de l'élément est aussi examiné, au cas où le pays serait dans une
    // étiquette masquée à l'écran mais présente dans le code.
    const textes = ["title", "aria-label", "alt", "data-original-title", "data-bs-original-title"]
      .map((a) => el.getAttribute(a) || "")
      .concat(el.children.length <= 1 ? [texteDirect(el)] : []);
    for (const brut of textes) {
      const v = brut.replace(/\s+/g, " ").trim();
      if (!v) continue;
      // Le pays est ce qui suit le dernier deux-points : « Localisation de l'article: Belgique ».
      // Indispensable, car la ligne porte aussi une infobulle de livraison qui cite deux pays,
      // « Délai moyen de livraison de Belgique vers France : 6 jours » : y chercher un nom de
      // pays au hasard ferait passer tous les vendeurs pour des Français.
      const fin = v.split(/\s*:\s*/).pop().trim();
      if (!fin || fin.length > 40) continue;
      if (FRANCE.test(fin)) return "fr";
      if (PAYS_CONNUS.test(fin)) return "autre";
    }
    return "";
  }

  // Le drapeau du pays du vendeur précède son nom dans la ligne. On ne regarde donc que ce qui
  // est situé avant le lien : la ligne contient aussi le drapeau de la langue de la carte,
  // et l'en-tête du site contient le sélecteur de langue.
  function chercherPays(scope, link) {
    if (!scope) return "";
    for (const el of scope.querySelectorAll("*")) {
      if (!(link.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
      const pays = paysDe(el);
      if (pays) return pays;
    }
    return "";
  }

  // On tente d'abord la cellule du vendeur ; si elle est introuvable ou trop étroite pour
  // contenir le drapeau, on repasse sur la ligne entière. Se limiter à ce qui précède le nom
  // suffit à écarter le drapeau de la langue de la carte, qui vient après.
  function sellerPays(link) {
    const cellule =
      link.closest('[class*="col-seller"], [class*="seller-info"]') ||
      (link.closest(".seller-name") || link).parentElement;
    return chercherPays(cellule, link) || chercherPays(rowFor(link), link);
  }

  // Français au vendeur français, anglais partout ailleurs. Pays illisible : anglais aussi,
  // qui est la langue d'échange du site.
  function phrasePourVendeur(link) {
    const carte = currentCardLabel();
    const pays = link ? sellerPays(link) : "";
    if (pays === "fr") return { texte: resolvePhrase(settings.phrase, carte), langue: "français" };
    const en = resolvePhrase(settings.phraseEn || DEFAULTS.phraseEn, carte);
    return { texte: en, langue: pays ? "anglais" : "anglais (pays du vendeur non détecté)" };
  }

  // Remplace {carte} par le nom de la carte ; sans carte identifiée, la phrase reste correcte.
  function resolvePhrase(phrase, carte) {
    const p = String(phrase || "");
    if (carte) return p.replace(/\{carte\}/gi, carte);
    return p.replace(/(la |le |cette )?carte \{carte\}/gi, "cette carte").replace(/\{carte\}/gi, "cette carte");
  }

  // ---------------------------------------------------------------------------
  // Suivi des demandes déjà faites (chrome.storage.local)
  // ---------------------------------------------------------------------------
  // Une entrée par couple vendeur + carte, sous sa propre clé : l'écriture se fait en un seul
  // appel, sans relire la liste, ce qui lui laisse le temps d'aboutir quand l'envoi du
  // formulaire fait quitter la page.
  //   statut "insere" : texte placé dans le message ; "envoye" : formulaire envoyé.
  const DEMANDE_PREFIX = "cmx_d:";
  const DEMANDE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // au-delà de 90 jours, une demande est oubliée

  const demandes = {};

  // Carte de la fiche produit en cours, identifiée par son adresse sans la langue du site
  // ni les filtres : la même carte vue en /fr/ ou en /en/ donne la même clé.
  function cleCarte() {
    if (!isProductPage()) return "";
    const { game, rest } = parsePath();
    return [game, ...rest.slice(1)].join("/").toLowerCase();
  }

  function carteCourante() {
    if (!isProductPage()) return null;
    return {
      cle: cleCarte(),
      nom: currentCardLabel(),
      url: location.origin + location.pathname,
    };
  }

  function cleDemande(seller, carte) {
    return DEMANDE_PREFIX + String(seller).toLowerCase() + "|" + ((carte && carte.cle) || "");
  }

  function storageLocal() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) return chrome.storage.local;
    } catch (e) {
      /* contexte d'extension invalidé (extension rechargée) */
    }
    return null;
  }

  function chargerDemandes() {
    return new Promise((resolve) => {
      const st = storageLocal();
      if (!st) return resolve();
      st.get(null, (items) => {
        const perimees = [];
        for (const [k, v] of Object.entries(items || {})) {
          if (k === REPERES_KEY && v) {
            Object.assign(reperes, v);
            nettoyerReperes();
          }
          if (!k.startsWith(DEMANDE_PREFIX)) continue;
          if (!v || Date.now() - v.ts > DEMANDE_TTL_MS) perimees.push(k);
          else demandes[k] = v;
        }
        if (perimees.length) st.remove(perimees);
        resolve();
      });
    });
  }

  function majDemandes(changes) {
    let touche = false;
    for (const [k, c] of Object.entries(changes)) {
      if (!k.startsWith(DEMANDE_PREFIX)) continue;
      if (c.newValue) demandes[k] = c.newValue;
      else delete demandes[k];
      touche = true;
    }
    if (touche) document.querySelectorAll(".cmx-row-btn").forEach(marquerBouton);
  }

  // Un envoi confirmé n'est jamais rétrogradé en simple insertion.
  function enregistrerDemande(demande, statut) {
    if (!demande || !demande.seller) return;
    const cle = cleDemande(demande.seller, demande.carte);
    if (statut === "insere" && demandes[cle] && demandes[cle].statut === "envoye") return;
    const carte = demande.carte || {};
    const entree = {
      seller: demande.seller,
      carte: carte.nom || "",
      carteUrl: carte.url || "",
      profil: profileUrl(demande.seller),
      langue: demande.langue || "",
      statut,
      ts: Date.now(),
    };
    demandes[cle] = entree;
    const st = storageLocal();
    if (st) st.set({ [cle]: entree });
  }

  // Le texte inséré n'est pas forcément envoyé : on attend l'envoi du formulaire pour le noter.
  // Le clic sur le bouton d'envoi est surveillé aussi, au cas où le site enverrait le message
  // en JavaScript sans déclencher l'événement submit. Écouté en phase de capture, il passe
  // avant les gestionnaires du site.
  function suivreEnvoi(textarea, demande) {
    const form = textarea.closest("form");
    if (!form || form.dataset.cmxSuivi) return;
    form.dataset.cmxSuivi = "1";
    const noter = () => {
      if (textarea.value.trim()) enregistrerDemande(demande, "envoye");
    };
    form.addEventListener("submit", noter, true);
    form.addEventListener(
      "click",
      (ev) => {
        if (ev.target.closest('button[type="submit"], input[type="submit"], button:not([type])')) noter();
      },
      true
    );
  }

  function dateCourte(ts) {
    return new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  }

  // ---------------------------------------------------------------------------
  // Intention "demander des photos" (survit à la navigation via sessionStorage)
  // ---------------------------------------------------------------------------
  // La phrase est résolue ici, sur la fiche produit, tant que le nom de la carte est connu :
  // la page du message, elle, ne sait plus de quelle carte il s'agit. La carte voyage donc
  // avec l'intention, pour le suivi des demandes.
  function setIntent(seller, phrase, langue, carte) {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ seller, phrase, langue, carte, ts: Date.now() }));
  }

  function getIntent() {
    try {
      const raw = sessionStorage.getItem(INTENT_KEY);
      if (!raw) return null;
      const intent = JSON.parse(raw);
      if (Date.now() - intent.ts > INTENT_TTL_MS) {
        clearIntent();
        return null;
      }
      return intent;
    } catch (e) {
      return null;
    }
  }

  function clearIntent() {
    sessionStorage.removeItem(INTENT_KEY);
  }

  // ---------------------------------------------------------------------------
  // Détection du formulaire de message
  // ---------------------------------------------------------------------------
  // Zone de texte du message au vendeur.
  // Les sélecteurs précis (nom/id contenant "message") sont acceptés partout ;
  // les sélecteurs généraux ne sont acceptés que sur une page de messagerie,
  // pour ne jamais remplir un autre champ (évaluation, commentaire...).
  function findMessageTextarea() {
    const strict = [
      'textarea[name="message"]',
      "textarea#message",
      'textarea[name*="essage" i]',
      'textarea[id*="essage" i]',
    ];
    const loose = ['textarea[name*="text" i]', "form textarea", "textarea"];
    const visible = (el) => el && el.offsetParent !== null && !isSearchField(el);

    for (const sel of strict) {
      const el = document.querySelector(sel);
      if (visible(el)) return el;
    }
    if (!isMessagePage()) return null;
    for (const sel of loose) {
      const el = [...document.querySelectorAll(sel)].find(visible);
      if (el) return el;
    }
    return null;
  }

  function isSearchField(el) {
    const f = el.closest("form");
    return !!(f && /Search/i.test(f.getAttribute("action") || ""));
  }

  function findSendMessageLink() {
    // Lien / bouton "Envoyer un message" sur la page profil d'un vendeur (visible uniquement connecté)
    const byHref = [...document.querySelectorAll('a[href*="/Messages/"], a[href*="/Message/"]')].find(
      (a) => !/\/Messages\/?$/.test(a.getAttribute("href") || "")
    );
    if (byHref) return byHref;

    const byIcon = document.querySelector(
      '[class*="fonticon-message"], [class*="fonticon-envelope"], [class*="fonticon-mail"]'
    );
    if (byIcon) return byIcon.closest("a, button") || byIcon;

    const rx = /^(send (a )?message|envoyer un message|nachricht senden|enviar mensaje|invia messaggio|message|nachricht)$/i;
    return (
      [...document.querySelectorAll("a, button")].find((e) => rx.test(e.textContent.trim())) || null
    );
  }

  function fillTextarea(textarea, phrase) {
    textarea.focus();
    textarea.value = phrase;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    textarea.classList.add("cmx-filled");
    setTimeout(() => textarea.classList.remove("cmx-filled"), 1500);
  }

  function submitForm(textarea) {
    const form = textarea.closest("form");
    if (!form) return false;
    const btn =
      form.querySelector('button[type="submit"], input[type="submit"]') ||
      form.querySelector("button:not([type])");
    if (btn) {
      btn.click();
      return true;
    }
    if (form.requestSubmit) {
      form.requestSubmit();
      return true;
    }
    return false;
  }

  // Remplit le formulaire (et envoie si l'option est activée). Retourne true si un textarea a été trouvé.
  // demande : { seller, carte, langue }, pour le suivi des demandes.
  function applyPhrase(phrase, { send, langue, demande } = {}) {
    const ta = findMessageTextarea();
    if (!ta) return false;
    fillTextarea(ta, phrase);
    if (demande && !demande.seller) demande.seller = sellerFromMessagePath();
    if (demande && demande.seller) {
      demande.langue = langue;
      enregistrerDemande(demande, "insere");
      suivreEnvoi(ta, demande);
    }
    const envoyer = send === undefined ? settings.autoSend : send;
    const en = langue ? ` en ${langue}` : "";
    if (envoyer) {
      const ok = submitForm(ta);
      if (ok) enregistrerDemande(demande, "envoye");
      toast(
        ok
          ? `Message envoyé au vendeur${en}.`
          : `Texte inséré${en}, mais bouton d'envoi introuvable : clique sur Envoyer.`
      );
    } else {
      toast(`Texte inséré${en}. Vérifie et clique sur Envoyer.`);
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Actions des boutons
  // ---------------------------------------------------------------------------
  // Langue du SITE (menus, textes de Cardmarket) : segment /fr/ dans l'adresse.
  function actionFrenchSite() {
    const url = frenchUrl();
    if (!url) {
      toast("Cette page est déjà en français : l'adresse commence par /fr/.", 4500);
      return;
    }
    location.href = url;
  }

  // Langue des CARTES (les drapeaux dans la liste des offres) : filtre de Cardmarket,
  // passé dans l'adresse. 2 = français dans la numérotation des langues du site.
  const FR_CARD_LANG = "2";

  function frenchCardsActive() {
    return new URL(location.href).searchParams.getAll("language").includes(FR_CARD_LANG);
  }

  function actionFrenchCards() {
    const u = new URL(location.href);
    if (frenchCardsActive()) u.searchParams.delete("language");
    else u.searchParams.set("language", FR_CARD_LANG);
    location.href = u.toString();
  }

  function actionAskPhotos(seller, sellerLink) {
    let { texte: phrase, langue } = phrasePourVendeur(sellerLink);

    // Sans ligne d'origine (bouton de la barre ou de la page profil), le pays est inconnu ici.
    // Si la fiche produit a déjà tranché pour ce vendeur, on garde sa décision au lieu de
    // l'écraser par un anglais par défaut.
    const enCours = getIntent();
    let carte = carteCourante();
    if (!sellerLink && enCours && enCours.phrase && (!seller || enCours.seller === seller)) {
      phrase = enCours.phrase;
      langue = enCours.langue || langue;
      carte = carte || enCours.carte || null;
    }

    // 1) Déjà sur un formulaire de message : on remplit directement.
    const demande = { seller: seller || (enCours && enCours.seller) || null, carte };
    if (applyPhrase(phrase, { langue, demande })) {
      clearIntent();
      return;
    }

    // 2) Sur la page profil d'un vendeur : on suit le lien "Envoyer un message".
    const profileSeller = sellerFromProfilePath();
    if (profileSeller && (!seller || seller === profileSeller)) {
      setIntent(profileSeller, phrase, langue, carte);
      const link = findSendMessageLink();
      if (link) {
        link.click();
        return;
      }
      toast(
        "Bouton \"Envoyer un message\" introuvable. Es-tu connecté ? Ouvre la messagerie du vendeur : le texte se remplira tout seul."
      );
      return;
    }

    // 3) Depuis une fiche produit : on mémorise le vendeur et on va sur son profil.
    if (seller) {
      setIntent(seller, phrase, langue, carte);
      location.href = profileUrl(seller);
      return;
    }

    toast("Clique sur le bouton photo à droite de la ligne du vendeur.");
  }

  // ---------------------------------------------------------------------------
  // Interface : barre flottante
  // ---------------------------------------------------------------------------
  function buildToolbar() {
    if (document.getElementById("cmx-toolbar")) return;
    const bar = document.createElement("div");
    bar.id = "cmx-toolbar";

    // Sur une fiche produit, le bouton filtre les offres sur les cartes en français.
    // Ailleurs (accueil, recherche, profil), il bascule la langue du site.
    const btnFr = document.createElement("button");
    btnFr.type = "button";
    if (isProductPage()) {
      const actif = frenchCardsActive();
      btnFr.className = actif ? "cmx-btn cmx-btn-done" : "cmx-btn";
      btnFr.textContent = actif ? "🇫🇷 Cartes FR ✓" : "🇫🇷 Cartes en français";
      btnFr.title = actif
        ? "Retirer le filtre et réafficher toutes les langues"
        : "N'afficher que les offres de cartes en langue française";
      btnFr.addEventListener("click", actionFrenchCards);
    } else {
      const dejaFr = parsePath().lang === "fr";
      btnFr.className = dejaFr ? "cmx-btn cmx-btn-done" : "cmx-btn";
      btnFr.textContent = dejaFr ? "🇫🇷 Français ✓" : "🇫🇷 Français";
      btnFr.title = dejaFr ? "Le site est déjà en français" : "Afficher le site en français";
      btnFr.addEventListener("click", actionFrenchSite);
    }

    const btnPhotos = document.createElement("button");
    btnPhotos.type = "button";
    btnPhotos.className = "cmx-btn cmx-btn-primary";
    btnPhotos.textContent = "📷 Demander des photos";
    btnPhotos.title = "Insère la demande de photos dans le message au vendeur";
    btnPhotos.addEventListener("click", () => actionAskPhotos(null));

    const btnHide = document.createElement("button");
    btnHide.type = "button";
    btnHide.className = "cmx-btn cmx-btn-ghost";
    btnHide.textContent = "×";
    btnHide.title = "Masquer la barre (jusqu'au prochain chargement)";
    btnHide.addEventListener("click", () => bar.remove());

    // Numéro de version : permet de vérifier d'un coup d'œil que l'extension rechargée est la bonne.
    const version = document.createElement("span");
    version.className = "cmx-version";
    try {
      version.textContent = "v" + chrome.runtime.getManifest().version;
    } catch (e) {
      version.textContent = "";
    }

    bar.append(btnFr, btnPhotos, version, btnHide);
    document.body.appendChild(bar);
  }

  // ---------------------------------------------------------------------------
  // Interface : bouton photos sur chaque ligne d'annonce (fiches produit)
  // ---------------------------------------------------------------------------
  const SVG_NS = "http://www.w3.org/2000/svg";
  const CAMERA_PATH =
    "M9 3h6l1.2 2H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.8L9 3Z" +
    "m3 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 2.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z";

  // Icône dessinée en SVG plutôt qu'en emoji : rendu identique quel que soit le système.
  function cameraIcon(size) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("fill", "currentColor");
    p.setAttribute("d", CAMERA_PATH);
    svg.appendChild(p);
    return svg;
  }

  function isVisible(el) {
    return !!(el && el.offsetParent !== null);
  }

  const SELLER_LINK_SEL = '.seller-name a[href*="/Users/"]';

  // Remonte depuis le lien du vendeur jusqu'à la ligne d'annonce, sans se fier au nom des classes :
  // la bonne ligne est le plus grand ancêtre qui ne contient encore qu'un seul vendeur.
  // Le calcul remonte le DOM à chaque appel : on le garde en mémoire, la fonction étant
  // rappelée à chaque modification de la page.
  const rowCache = new WeakMap();

  function rowFor(link) {
    const cached = rowCache.get(link);
    if (cached && cached.isConnected) return cached;
    let el = link.parentElement;
    let row = null;
    for (let i = 0; el && el !== document.body && i < 10; i++, el = el.parentElement) {
      if (el.querySelectorAll(SELLER_LINK_SEL).length > 1) break; // on a dépassé la ligne
      row = el;
      if (/article-row/.test(String(el.className || ""))) break;
    }
    if (row) rowCache.set(link, row);
    return row;
  }

  // Bouton d'achat de la ligne : on se place juste à côté pour rester dans la colonne de droite.
  // Cardmarket duplique les lignes (version écran large / version mobile) et en masque une :
  // on ne retient donc qu'un point d'ancrage réellement affiché, le plus à droite.
  function findRowCartButton(row) {
    const icons = [
      ...row.querySelectorAll(
        '[class*="fonticon-cart"], [class*="fonticon-basket"], [class*="icon-cart"], [class*="cart-icon"]'
      ),
    ];
    for (let i = icons.length - 1; i >= 0; i--) {
      const btn = icons[i].closest("button, a.btn, a, .btn") || icons[i];
      if (isVisible(btn)) return btn;
    }
    const buttons = [...row.querySelectorAll('button, a.btn, input[type="submit"]')].filter(isVisible);
    return buttons.length ? buttons[buttons.length - 1] : null;
  }

  // sellerLink sert à retrouver le drapeau du pays du vendeur, donc la langue du message.
  // Le pays est évalué dès la construction du bouton et affiché dessus (FR / EN) : on voit
  // avant de cliquer dans quelle langue partira le message, et si le drapeau a été lu.
  function makePhotoButton(seller, big, sellerLink) {
    const pays = sellerLink ? sellerPays(sellerLink) : "";
    const langue = pays === "fr" ? "français" : "anglais";
    const detail = pays ? "" : " (pays du vendeur non détecté)";

    const b = document.createElement("button");
    b.type = "button";
    b.className = big ? "cmx-row-btn cmx-row-btn-lg" : "cmx-row-btn cmx-row-btn-sm";
    b.dataset.pays = pays || "inconnu";
    b.dataset.seller = seller;
    b.dataset.titre = `Demander des photos à ${seller} — message en ${langue}${detail}`;
    b.appendChild(cameraIcon(big ? 18 : 13));
    if (big) {
      const badge = document.createElement("span");
      badge.className = "cmx-lang";
      badge.textContent = pays === "fr" ? "FR" : pays ? "EN" : "EN?";
      b.appendChild(badge);
    }
    marquerBouton(b);
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      actionAskPhotos(seller, sellerLink);
    });
    return b;
  }

  // Pastille ✓ sur le bouton d'un vendeur déjà sollicité pour cette carte. Le bouton reste
  // utilisable : relancer un vendeur qui n'a pas répondu est un choix légitime.
  function marquerBouton(b) {
    const d = demandes[cleDemande(b.dataset.seller, { cle: cleCarte() })];
    let pastille = b.querySelector(".cmx-deja");
    b.classList.toggle("cmx-row-btn-deja", !!d);
    if (d) {
      if (!pastille) {
        pastille = document.createElement("span");
        pastille.className = "cmx-deja";
        pastille.textContent = "✓";
        b.appendChild(pastille);
      }
      pastille.dataset.statut = d.statut;
      const etat = d.statut === "envoye" ? "message envoyé" : "texte inséré, envoi non confirmé";
      b.title = `${b.dataset.titre}\nDéjà demandé le ${dateCourte(d.ts)} (${etat})`;
    } else {
      if (pastille) pastille.remove();
      b.title = b.dataset.titre;
    }
    b.setAttribute("aria-label", b.title);
  }

  function decorateSellerRows() {
    if (!settings.rowButtons || !isProductPage()) return;
    const links = document.querySelectorAll(SELLER_LINK_SEL);
    const placed = [];

    links.forEach((a) => {
      const seller = decodeURIComponent((a.getAttribute("href") || "").split("/Users/")[1] || "").split(/[/?#]/)[0];
      if (!seller) return;

      const row = rowFor(a);
      // Une ligne déjà équipée est laissée telle quelle. On regarde le bouton lui-même plutôt
      // qu'une marque sur le lien : si Cardmarket réaffiche la ligne et efface notre bouton,
      // le prochain passage le remet.
      const done = row ? row.querySelector(".cmx-row-btn") : null;
      if (done) return;
      if (!row && a.nextElementSibling && a.nextElementSibling.classList.contains("cmx-row-btn")) return;

      const cart = row ? findRowCartButton(row) : null;

      // Cible : dans la colonne de droite, juste avant le bouton panier.
      if (cart && cart.parentElement) {
        const btn = makePhotoButton(seller, true, a);
        cart.parentElement.insertBefore(btn, cart);
        placed.push({ btn, link: a, seller });
        return;
      }
      // Repli : si la colonne de droite est introuvable, à côté du nom du vendeur.
      a.insertAdjacentElement("afterend", makePhotoButton(seller, false, a));
    });

    // Vérification après coup : un bouton qui n'occupe aucun pixel a atterri dans un conteneur
    // masqué. On le déplace à côté du nom du vendeur, où il est forcément visible.
    // Les lectures sont groupées ici, après toutes les insertions, pour ne forcer qu'un seul calcul de mise en page.
    placed.forEach(({ btn, link, seller }) => {
      if (btn.getClientRects().length) return;
      btn.remove();
      link.insertAdjacentElement("afterend", makePhotoButton(seller, false, link));
    });
  }

  // ---------------------------------------------------------------------------
  // Ancienneté des annonces (fiches produit)
  // ---------------------------------------------------------------------------
  // Cardmarket n'affiche pas la date de mise en vente. Chaque ligne porte en revanche le numéro
  // de l'annonce (id="articleRow2102771147"), attribué dans l'ordre de création : plus il est
  // petit, plus l'annonce est ancienne. Deux usages :
  //   - comparer les offres de la page entre elles (récente / moyenne / ancienne) ;
  //   - dater approximativement, grâce à des repères « tel jour, les numéros allaient jusqu'à N ».
  // Les repères se constituent tout seuls : chaque jour, l'extension note le plus grand numéro
  // vu. Tant qu'aucun jour passé n'est connu, la pastille ne donne que le rang.
  // Limite : une annonce modifiée a peut-être reçu un nouveau numéro, la date est alors celle
  // de la modification.
  const REPERES_KEY = "cmx_reperes";
  const reperes = {};

  // Repère de la version 1.3.0, tiré d'une page enregistrée et non d'une observation : trop
  // approximatif, il est retiré des données déjà stockées.
  const REPERE_RETIRE = ["2026-09-10", 2148614315];

  function nettoyerReperes() {
    const [jour, id] = REPERE_RETIRE;
    if (reperes[jour] !== id) return;
    delete reperes[jour];
    const st = storageLocal();
    if (st) st.set({ [REPERES_KEY]: reperes });
  }

  function jourCle(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function jourDate(cle) {
    return new Date(cle + "T12:00:00");
  }

  function jourCourt(cle) {
    return dateCourte(jourDate(cle).getTime());
  }

  function jourLong(cle) {
    return jourDate(cle).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  function idAnnonce(row) {
    if (!row) return 0;
    const rx = /^articleRow(\d+)$/;
    const el = rx.test(row.id) ? row : row.closest('[id^="articleRow"]') || row.querySelector('[id^="articleRow"]');
    const m = el && el.id.match(rx);
    return m ? Number(m[1]) : 0;
  }

  // Note le plus grand numéro vu aujourd'hui, s'il dépasse celui déjà connu.
  function noterRepere(maxId) {
    const jour = jourCle(new Date());
    if (!(maxId > (reperes[jour] || 0))) return;
    reperes[jour] = maxId;
    const st = storageLocal();
    if (st) st.set({ [REPERES_KEY]: reperes });
  }

  // Encadre la date de mise en vente : l'annonce existait au plus tard le premier jour où un
  // numéro au moins aussi grand a été vu (borne sûre), et après le jour précédent, où tous
  // étaient plus petits (borne approximative : on n'a vu qu'une partie des annonces ce jour-là).
  // Renvoie null quand la seule information est « avant aujourd'hui », qui n'apprend rien.
  function estimerDate(id) {
    const jours = Object.keys(reperes).sort();
    let max = 0;
    for (let i = 0; i < jours.length; i++) {
      max = Math.max(max, reperes[jours[i]]);
      if (max < id) continue;
      if (i === 0) {
        if (jours[0] === jourCle(new Date())) return null;
        return { court: `avant ${jourCourt(jours[0])}`, long: `Mise en vente avant le ${jourLong(jours[0])} (certain).` };
      }
      const a = jours[i - 1];
      const b = jours[i];
      const ecart = (jourDate(b) - jourDate(a)) / 86400000;
      if (ecart <= 3) return { court: `≈ ${jourCourt(b)}`, long: `Mise en vente vers le ${jourLong(b)} (approximatif).` };
      return {
        court: `${jourCourt(a)}–${jourCourt(b)}`,
        long: `Mise en vente au plus tard le ${jourLong(b)} (certain), probablement après le ${jourLong(a)}.`,
      };
    }
    return null;
  }

  const MOTS_AGE = { recente: "récente", moyenne: "moyenne", ancienne: "ancienne" };

  // Rappelée à chaque modification de la page : les pastilles ne sont réécrites que si leur
  // contenu change, sinon l'écriture relancerait l'observateur en boucle.
  function decorateAges() {
    if (!settings.ageBadges || !isProductPage()) return;
    const lignes = [];
    for (const a of document.querySelectorAll(SELLER_LINK_SEL)) {
      const id = idAnnonce(rowFor(a));
      if (id) lignes.push({ a, id });
    }
    if (!lignes.length) return;

    const ids = [...new Set(lignes.map((l) => l.id))].sort((x, y) => y - x);
    noterRepere(ids[0]);
    const n = ids.length;

    for (const { a, id } of lignes) {
      const rang = ids.indexOf(id); // 0 = la plus récente
      let classe = "";
      if (n >= 3) {
        const f = rang / (n - 1);
        classe = f < 1 / 3 ? "recente" : f > 2 / 3 ? "ancienne" : "moyenne";
      }
      const est = estimerDate(id);
      const texte = est ? est.court : classe ? MOTS_AGE[classe] : "";
      if (!texte) continue;

      const titre = [
        `Annonce n° ${id}${n > 1 ? ` : la ${rang + 1}${rang ? "e" : "re"} plus récente sur ${n} de la page` : ""}.`,
        est ? est.long : "",
        "Estimation tirée du numéro de l'annonce ; une annonce modifiée a peut-être reçu un nouveau numéro.",
      ]
        .filter(Boolean)
        .join("\n");

      const ancre = a.parentElement && a.parentElement.closest(".seller-name") ? a.parentElement : a;
      let badge = ancre.parentElement && ancre.parentElement.querySelector(":scope > .cmx-age");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "cmx-age";
        ancre.insertAdjacentElement("afterend", badge);
      }
      if (badge.textContent !== texte) badge.textContent = texte;
      if (badge.dataset.age !== (classe || "inconnu")) badge.dataset.age = classe || "inconnu";
      if (badge.title !== titre) badge.title = titre;
    }
  }

  function decorateProfilePage() {
    const seller = sellerFromProfilePath();
    if (!seller) return;
    const link = findSendMessageLink();
    if (!link || link.dataset.cmxDone) return;
    link.dataset.cmxDone = "1";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cmx-btn cmx-btn-primary cmx-inline";
    b.textContent = "📷 Demander des photos";
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      actionAskPhotos(seller);
    });
    link.insertAdjacentElement("afterend", b);
  }

  // ---------------------------------------------------------------------------
  // Reprise d'une intention après navigation
  // ---------------------------------------------------------------------------
  function resumeIntent() {
    const intent = getIntent();
    if (!intent) return;

    // Sur un formulaire de message : remplir.
    if (findMessageTextarea()) {
      applyPhrase(intent.phrase || phrasePourVendeur(null).texte, {
        langue: intent.langue,
        demande: { seller: intent.seller, carte: intent.carte || null },
      });
      clearIntent();
      return;
    }

    // Sur le profil du vendeur visé : suivre le lien "Envoyer un message".
    const profileSeller = sellerFromProfilePath();
    if (profileSeller && profileSeller === intent.seller) {
      const link = findSendMessageLink();
      if (link) {
        link.click();
      } else {
        toast(
          `Connecte-toi puis clique sur "Envoyer un message" à ${profileSeller} : le texte se remplira automatiquement.`,
          6000
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, ms = 3500) {
    let el = document.getElementById("cmx-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "cmx-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("cmx-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("cmx-show"), ms);
  }

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------
  Promise.all([loadSettings(), chargerDemandes()]).then(() => {
    buildToolbar();
    decorateSellerRows();
    decorateAges();
    decorateProfilePage();
    resumeIntent();

    // Les listes de vendeurs se chargent en plusieurs fois ("Afficher plus") : on surveille le DOM.
    // Les mutations arrivent par rafales : on ne repasse qu'une fois par frame.
    let scheduled = false;
    const obs = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        decorateSellerRows();
        decorateAges();
        decorateProfilePage();
        if (getIntent() && findMessageTextarea()) resumeIntent();
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
})();
