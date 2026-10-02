const DEFAULTS = {
  phrase:
    "Bonjour, j'aimerais avoir des photos de la carte {carte}, avant et arrière, est-ce possible ? S'il vous plaît.",
  phraseEn:
    "Hello, could I please have photos of the card {carte}, front and back? Thank you very much.",
  autoSend: false,
  rowButtons: true,
  ageBadges: true,
};

// Phrase de la version précédente, sans nom de carte : remplacée automatiquement.
const ANCIENNE_PHRASE =
  "Bonjour, j'aimerais avoir des photos de l'avant et de l'arrière, est-ce possible ? S'il vous plaît.";

const $ = (id) => document.getElementById(id);

function refreshWarn() {
  $("autoSendWarn").hidden = !$("autoSend").checked;
}

chrome.storage.sync.get(DEFAULTS, (items) => {
  $("phrase").value = items.phrase === ANCIENNE_PHRASE ? DEFAULTS.phrase : items.phrase;
  $("phraseEn").value = items.phraseEn || DEFAULTS.phraseEn;
  $("autoSend").checked = !!items.autoSend;
  $("rowButtons").checked = !!items.rowButtons;
  $("ageBadges").checked = !!items.ageBadges;
  refreshWarn();
});

$("autoSend").addEventListener("change", refreshWarn);

$("save").addEventListener("click", () => {
  const phrase = $("phrase").value.trim() || DEFAULTS.phrase;
  const phraseEn = $("phraseEn").value.trim() || DEFAULTS.phraseEn;
  chrome.storage.sync.set(
    {
      phrase,
      phraseEn,
      autoSend: $("autoSend").checked,
      rowButtons: $("rowButtons").checked,
      ageBadges: $("ageBadges").checked,
    },
    () => {
      $("phrase").value = phrase;
      $("phraseEn").value = phraseEn;
      $("status").textContent = "Enregistré ✓";
      setTimeout(() => ($("status").textContent = ""), 2000);
    }
  );
});

// ---------------------------------------------------------------------------
// Demandes de photos déjà faites (écrites par content.js dans chrome.storage.local)
// ---------------------------------------------------------------------------
const DEMANDE_PREFIX = "cmx_d:";

function lien(url, texte) {
  if (!url) return document.createTextNode(texte);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = texte;
  return a;
}

function cellule(...enfants) {
  const td = document.createElement("td");
  td.append(...enfants);
  return td;
}

function afficherDemandes() {
  chrome.storage.local.get(null, (items) => {
    const liste = Object.entries(items)
      .filter(([k]) => k.startsWith(DEMANDE_PREFIX))
      .sort((a, b) => b[1].ts - a[1].ts);

    const tbody = document.querySelector("#demandes tbody");
    tbody.replaceChildren();
    for (const [cle, d] of liste) {
      const tr = document.createElement("tr");
      const date = new Date(d.ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
      const etat = document.createElement("span");
      etat.className = d.statut === "envoye" ? "etat-envoye" : "etat-insere";
      etat.textContent = d.statut === "envoye" ? "Envoyé" : "Inséré";
      etat.title = d.statut === "envoye" ? "Message envoyé" : "Texte inséré, envoi non confirmé";

      const suppr = document.createElement("button");
      suppr.className = "suppr";
      suppr.textContent = "×";
      suppr.title = "Retirer cette demande";
      suppr.addEventListener("click", () => chrome.storage.local.remove(cle));

      tr.append(
        cellule(date),
        cellule(lien(d.profil, d.seller)),
        cellule(lien(d.carteUrl, d.carte || "(carte inconnue)")),
        cellule(etat),
        cellule(suppr)
      );
      tbody.appendChild(tr);
    }

    $("demandes").hidden = !liste.length;
    $("toutEffacer").hidden = !liste.length;
    $("demandesVide").hidden = !!liste.length;
  });
}

$("toutEffacer").addEventListener("click", () => {
  if (!confirm("Effacer tout l'historique des demandes de photos ?")) return;
  chrome.storage.local.get(null, (items) => {
    chrome.storage.local.remove(Object.keys(items).filter((k) => k.startsWith(DEMANDE_PREFIX)));
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") afficherDemandes();
});

afficherDemandes();
