// Un clic sur l'icône de l'extension ouvre la page d'options.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
