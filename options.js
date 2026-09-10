const DEFAULTS = {
  phrase:
    "Bonjour, j'aimerais avoir des photos de la carte {carte}, avant et arrière, est-ce possible ? S'il vous plaît.",
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
  $("autoSend").checked = !!items.autoSend;
  $("rowButtons").checked = !!items.rowButtons;
  refreshWarn();
});

$("autoSend").addEventListener("change", refreshWarn);

$("save").addEventListener("click", () => {
  const phrase = $("phrase").value.trim() || DEFAULTS.phrase;
  chrome.storage.sync.set(
    {
      phrase,
      autoSend: $("autoSend").checked,
      rowButtons: $("rowButtons").checked,
    },
    () => {
      $("phrase").value = phrase;
      $("status").textContent = "Enregistré ✓";
      setTimeout(() => ($("status").textContent = ""), 2000);
    }
  );
});
