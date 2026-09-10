const DEFAULTS = {
  phrase:
    "Bonjour, j'aimerais avoir des photos de la carte {carte}, avant et arrière, est-ce possible ? S'il vous plaît.",
  phraseEn:
    "Hello, could I please have photos of the card {carte}, front and back? Thank you very much.",
  autoSend: false,
  rowButtons: true,
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
    },
    () => {
      $("phrase").value = phrase;
      $("phraseEn").value = phraseEn;
      $("status").textContent = "Enregistré ✓";
      setTimeout(() => ($("status").textContent = ""), 2000);
    }
  );
});
