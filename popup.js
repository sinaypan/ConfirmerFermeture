const checkbox = document.getElementById('enabled');
const status = document.getElementById('status');

const render = (enabled) => {
  checkbox.checked = enabled;
  status.textContent = enabled
    ? 'Un bandeau « Rouvrir » s\'affiche quand vous fermez un onglet.'
    : 'Protection en pause : aucun bandeau à la fermeture d\'un onglet.';
};

chrome.storage.local.get({ enabled: true }, ({ enabled }) => render(enabled));

checkbox.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: checkbox.checked });
  render(checkbox.checked);
});
