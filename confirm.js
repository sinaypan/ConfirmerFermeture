const sessionId = new URLSearchParams(location.search).get('sid');
let closedTab = null;

const keepTab = async () => {
  try {
    await chrome.sessions.restore(sessionId);
  } catch {
    // Entrée expirée dans les onglets récemment fermés : on rouvre l'adresse.
    if (closedTab?.url) await chrome.tabs.create({ url: closedTab.url });
  }
  window.close();
};

document.getElementById('keep').addEventListener('click', keepTab);
document.getElementById('close').addEventListener('click', () => window.close());

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') keepTab();
});

// Cliquer ailleurs = on passe à autre chose, la fermeture est confirmée.
// On attend d'avoir eu le focus une fois pour ne pas se fermer à l'ouverture.
let hadFocus = document.hasFocus();
window.addEventListener('focus', () => {
  hadFocus = true;
});
window.addEventListener('blur', () => {
  if (hadFocus) window.close();
});

chrome.sessions.getRecentlyClosed().then((sessions) => {
  closedTab = sessions.find((session) => session.tab?.sessionId === sessionId)?.tab ?? null;
  if (!closedTab) return;
  document.getElementById('title').textContent = closedTab.title || closedTab.url;
  try {
    document.getElementById('host').textContent = new URL(closedTab.url).host;
  } catch {
    // adresse non analysable : on n'affiche que le titre
  }
});
