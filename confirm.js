// Le même bandeau que dans la page (banner.js), dans une petite fenêtre : pour
// les pages où Chrome n'accepte pas de script (nouvel onglet, chrome://...).
const sheet = new CSSStyleSheet();
sheet.replaceSync(closedTabsBanner.CSS);
document.adoptedStyleSheets = [sheet];

// La fenêtre se ferme une fois le message parti, pas avant.
const answer = (message) =>
  chrome.runtime
    .sendMessage(message)
    .catch(() => {})
    .finally(() => window.close());

const dismiss = () => answer({ type: 'dismiss-closed-tabs' });

// La fenêtre prend la hauteur du bandeau, qui dépend du nombre de lignes.
const fitWindow = async (toast) => {
  const frame = window.outerHeight - window.innerHeight;
  const { id } = await chrome.windows.getCurrent();
  await chrome.windows.update(id, { height: Math.ceil(toast.getBoundingClientRect().height) + frame });
};

const render = (state) => {
  if (!state?.rows.length) {
    window.close();
    return;
  }
  const toast = closedTabsBanner.build(
    state,
    {
      restore: (tabs) => answer({ type: 'restore-closed-tabs', sessionIds: tabs.map((tab) => tab.sessionId) }),
      dismiss,
      expire: () => answer({ type: 'closed-tabs-expired' }),
    },
    { animate: false },
  );
  document.body.querySelector('.toast')?.remove();
  document.body.prepend(toast);
  toast.querySelector('.restore').focus();
  // Hauteur refusée par Chrome (fenêtre en partie hors écran) : on garde la taille actuelle.
  fitWindow(toast).catch(() => {});
};

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') dismiss();
});

// Cliquer ailleurs = on passe à autre chose. La liste reste proposée : elle
// réapparaîtra en bandeau si on change d'onglet avant la fin du décompte.
// On attend d'avoir eu le focus une fois pour ne pas se fermer à l'ouverture.
let hadFocus = document.hasFocus();
window.addEventListener('focus', () => {
  hadFocus = true;
});
window.addEventListener('blur', () => {
  if (hadFocus) window.close();
});

// Un onglet de plus fermé pendant que la fenêtre est ouverte : la liste se met à jour.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'show-closed-tabs') render(message);
});

chrome.runtime.sendMessage({ type: 'get-closed-tabs' }).then(render);
