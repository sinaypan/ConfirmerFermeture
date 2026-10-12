// Chrome ne laisse pas une extension retenir un onglet qui se ferme.
// On fait donc l'inverse : dès qu'un onglet vient d'être fermé, un bandeau
// "Onglet fermé · Rouvrir" apparaît dans la page active (toast.js). "Rouvrir"
// remet l'onglet à sa place, avec son historique, via l'API sessions.
// Si la page active n'accepte pas de script (nouvel onglet, chrome://...),
// on retombe sur une petite fenêtre (confirm.html).

const DIALOG_SIZE = { width: 440, height: 250 };
const BULK_WINDOW_MS = 120;
const MAX_AGE_S = 5;
const MAX_ASKED_IDS = 30;
const RESTORABLE = /^(https?|file):/;

let lastRemovedAt = 0;
let generation = 0;
let toastTabId = null;

const updateBadge = async () => {
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  await chrome.action.setBadgeBackgroundColor({ color: '#b3261e' });
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
};

const restoreTab = (sessionId, url) =>
  chrome.sessions.restore(sessionId).catch(() => {
    // Entrée expirée dans les onglets récemment fermés : on rouvre l'adresse.
    if (url) chrome.tabs.create({ url });
  });

const closeDialog = async () => {
  const { dialogWindowId } = await chrome.storage.session.get('dialogWindowId');
  if (dialogWindowId === undefined) return;
  await chrome.storage.session.remove('dialogWindowId');
  await chrome.windows.remove(dialogWindowId).catch(() => {});
};

const hidePrompt = () => {
  if (toastTabId !== null) {
    chrome.tabs.sendMessage(toastTabId, { type: 'hide-closed-tab' }).catch(() => {});
    toastTabId = null;
  }
  return closeDialog();
};

const showToast = async (tabId, closedTab) => {
  const message = {
    type: 'show-closed-tab',
    sessionId: closedTab.sessionId,
    title: closedTab.title,
    url: closedTab.url,
  };
  try {
    return (await chrome.tabs.sendMessage(tabId, message))?.shown === true;
  } catch {
    // Onglet ouvert avant l'installation de l'extension : toast.js n'y est pas encore.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['toast.js'] });
    return (await chrome.tabs.sendMessage(tabId, message))?.shown === true;
  } catch {
    return false; // page protégée
  }
};

const openDialog = async (closedTab, windowId) => {
  const parent = await chrome.windows.get(windowId).catch(() => null);
  const position =
    parent && parent.state !== 'minimized'
      ? {
          left: Math.round(parent.left + (parent.width - DIALOG_SIZE.width) / 2),
          top: Math.round(parent.top + (parent.height - DIALOG_SIZE.height) / 3),
        }
      : {};

  const dialog = await chrome.windows.create({
    url: chrome.runtime.getURL(`confirm.html?sid=${encodeURIComponent(closedTab.sessionId)}`),
    type: 'popup',
    focused: true,
    ...DIALOG_SIZE,
    ...position,
  });
  await chrome.storage.session.set({ dialogWindowId: dialog.id });
};

const promptForClosedTab = async (windowId, current) => {
  const [{ enabled }, [session], { askedIds }] = await Promise.all([
    chrome.storage.local.get({ enabled: true }),
    chrome.sessions.getRecentlyClosed({ maxResults: 1 }),
    chrome.storage.session.get({ askedIds: [] }),
  ]);
  if (!enabled) return;

  const closedTab = session?.tab;
  // Les pages internes (nouvel onglet, chrome://, extensions) ne sont pas concernées.
  if (!closedTab || !RESTORABLE.test(closedTab.url ?? '')) return;
  // L'onglet fermé n'a pas été enregistré par Chrome : l'entrée la plus
  // récente est alors une ancienne fermeture, qu'il ne faut pas reproposer.
  if (Date.now() / 1000 - session.lastModified > MAX_AGE_S) return;
  // Même cas, pour une fermeture toute récente déjà proposée une fois.
  if (askedIds.includes(closedTab.sessionId)) return;

  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  // Un autre onglet a été fermé entre-temps : cette demande est périmée.
  if (current !== generation) return;

  await hidePrompt();
  chrome.storage.session.set({
    askedIds: [...askedIds, closedTab.sessionId].slice(-MAX_ASKED_IDS),
  });
  if (activeTab) {
    toastTabId = activeTab.id;
    if (await showToast(activeTab.id, closedTab)) return;
    toastTabId = null;
  }
  if (current !== generation) return;
  await openDialog(closedTab, windowId);
};

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // Fenêtre entière fermée : rien à faire.
  if (removeInfo.isWindowClosing) return;

  const now = Date.now();
  const isBulk = now - lastRemovedAt < BULK_WINDOW_MS;
  lastRemovedAt = now;
  const current = ++generation;

  // Plusieurs onglets d'un coup ("Fermer les autres onglets", etc.) :
  // c'est une action volontaire, on ne propose rien.
  if (isBulk) {
    hidePrompt();
    return;
  }
  promptForClosedTab(removeInfo.windowId, current);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'restore-closed-tab') restoreTab(message.sessionId, message.url);
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) updateBadge();
});
