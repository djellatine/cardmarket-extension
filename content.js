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
    autoSend: false,
    rowButtons: true,
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
      chrome.storage.onChanged.addListener((changes) => {
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

  // Nom de la carte affiché par la page, donc en français. Le titre du site est écarté,
  // ainsi qu'un titre situé dans l'en-tête ou le menu.
  function cardNameFromDom() {
    const h1 =
      document.querySelector('main h1, [role="main"] h1, #content h1, .page-title-container h1') ||
      document.querySelector("h1");
    if (!h1 || h1.closest("header, nav")) return "";
    const t = h1.textContent.replace(/\s+/g, " ").trim();
    if (!t || t.length > 80 || /^cardmarket$/i.test(t)) return "";
    return t;
  }

  // Nom français de l'édition, pris sur le lien qui pointe vers cette édition précise.
  // On exige que l'adresse du lien se termine par l'identifiant d'édition de la page courante :
  // impossible d'attraper le nom d'une autre extension au passage.
  function editionNameFromDom(slug) {
    if (!slug) return "";
    const echappe = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp("/Products/Singles/" + echappe + "/?$", "i");
    const link = [...document.querySelectorAll('a[href*="/Products/Singles/"]')].find((a) =>
      rx.test((a.getAttribute("href") || "").split(/[?#]/)[0])
    );
    const t = link ? link.textContent.replace(/\s+/g, " ").trim() : "";
    return t && t.length <= 60 ? t : "";
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

    // Cardmarket met souvent déjà le numéro dans le nom (« Rayquaza (DX 22) ») : on ne le répète pas.
    const numero = cardNumberFromDom();
    if (numero && !nom.includes(numero)) nom = `${nom} n° ${numero}`;

    // Le nom contient parfois déjà l'édition : on évite de la répéter.
    if (edition && !nom.toLowerCase().includes(edition.toLowerCase())) return `${nom} (${edition})`;
    return nom;
  }

  // Remplace {carte} par le nom de la carte ; sans carte identifiée, la phrase reste correcte.
  function resolvePhrase(phrase, carte) {
    const p = String(phrase || "");
    if (carte) return p.replace(/\{carte\}/gi, carte);
    return p.replace(/(la |le |cette )?carte \{carte\}/gi, "cette carte").replace(/\{carte\}/gi, "cette carte");
  }

  // ---------------------------------------------------------------------------
  // Intention "demander des photos" (survit à la navigation via sessionStorage)
  // ---------------------------------------------------------------------------
  // La phrase est résolue ici, sur la fiche produit, tant que le nom de la carte est connu :
  // la page du message, elle, ne sait plus de quelle carte il s'agit.
  function setIntent(seller, phrase) {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ seller, phrase, ts: Date.now() }));
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
  function applyPhrase(phrase, { send } = { send: settings.autoSend }) {
    const ta = findMessageTextarea();
    if (!ta) return false;
    fillTextarea(ta, phrase);
    if (send) {
      const ok = submitForm(ta);
      toast(ok ? "Message envoyé au vendeur." : "Texte inséré, mais bouton d'envoi introuvable : clique sur Envoyer.");
    } else {
      toast("Texte inséré. Vérifie et clique sur Envoyer.");
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

  function actionAskPhotos(seller) {
    const phrase = resolvePhrase(settings.phrase, currentCardLabel());

    // 1) Déjà sur un formulaire de message : on remplit directement.
    if (applyPhrase(phrase)) {
      clearIntent();
      return;
    }

    // 2) Sur la page profil d'un vendeur : on suit le lien "Envoyer un message".
    const profileSeller = sellerFromProfilePath();
    if (profileSeller && (!seller || seller === profileSeller)) {
      setIntent(profileSeller, phrase);
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
      setIntent(seller, phrase);
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

    bar.append(btnFr, btnPhotos, btnHide);
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

  function makePhotoButton(seller, big) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = big ? "cmx-row-btn cmx-row-btn-lg" : "cmx-row-btn cmx-row-btn-sm";
    b.title = `Demander des photos à ${seller}`;
    b.setAttribute("aria-label", `Demander des photos à ${seller}`);
    b.appendChild(cameraIcon(big ? 18 : 13));
    b.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      actionAskPhotos(seller);
    });
    return b;
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
        const btn = makePhotoButton(seller, true);
        cart.parentElement.insertBefore(btn, cart);
        placed.push({ btn, link: a, seller });
        return;
      }
      // Repli : si la colonne de droite est introuvable, à côté du nom du vendeur.
      a.insertAdjacentElement("afterend", makePhotoButton(seller, false));
    });

    // Vérification après coup : un bouton qui n'occupe aucun pixel a atterri dans un conteneur
    // masqué. On le déplace à côté du nom du vendeur, où il est forcément visible.
    // Les lectures sont groupées ici, après toutes les insertions, pour ne forcer qu'un seul calcul de mise en page.
    placed.forEach(({ btn, link, seller }) => {
      if (btn.getClientRects().length) return;
      btn.remove();
      link.insertAdjacentElement("afterend", makePhotoButton(seller, false));
    });
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
      applyPhrase(intent.phrase || resolvePhrase(settings.phrase, currentCardLabel()));
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
  loadSettings().then(() => {
    buildToolbar();
    decorateSellerRows();
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
        decorateProfilePage();
        if (getIntent() && findMessageTextarea()) resumeIntent();
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
})();
