// Chrome ne laisse pas une extension retenir un onglet qui se ferme.
// On fait donc l'inverse : dès qu'un onglet vient d'être fermé, un bandeau
// "Onglet fermé · Rouvrir" apparaît dans la page active (toast.js). "Rouvrir"
// remet l'onglet à sa place, avec son historique, via l'API sessions.
// Les fermetures qui se suivent s'ajoutent au même bandeau, une ligne chacune,
// et le bandeau suit l'onglet actif jusqu'à la fin du décompte.
// Si la page active n'accepte pas de script (nouvel onglet, chrome://...),
// la proposition s'affiche dans la bulle de l'icône de l'extension
// (popup.html), ouverte pour l'occasion ; l'icône porte aussi le nombre
// d'onglets à rouvrir.

const DURATION_MS = 7000;
const BULK_WINDOW_MS = 120;
const MAX_AGE_S = 5;
const MAX_ASKED_IDS = 100;
const RESTORABLE = /^(https?|file):/;

// Onglets proposés, du plus récent au plus ancien : { sessionId, title, url, icon, batch }.
// Cet état disparaît si le service worker s'endort, ce qui demande bien plus
// d'inactivité que la durée d'un décompte.
let pending = [];
let expiresAt = 0;
let lastRemovedAt = 0;
let currentBatch = 0;
let lastWindowId = null;
let toastTabId = null;

// Les évènements arrivent groupés (fermeture + changement d'onglet) : on les
// traite un par un pour que la liste et l'affichage restent cohérents.
let queue = Promise.resolve();
const enqueue = (task) => {
  queue = queue.then(task).catch(() => {});
};

// Le badge de l'icône : "OFF" en pause, sinon le nombre d'onglets proposés
// quand aucun bandeau ne peut les montrer dans la page.
const updateBadge = async () => {
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  const waiting = toastTabId === null ? activePending().length : 0;
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#1a73e8' : '#b3261e' });
  await chrome.action.setBadgeText({ text: enabled ? (waiting ? String(waiting) : '') : chrome.i18n.getMessage('badgeOff') });
};

const restoreTab = (sessionId, url) =>
  chrome.sessions.restore(sessionId).catch(() => {
    // Entrée expirée dans les onglets récemment fermés : on rouvre l'adresse.
    if (url) chrome.tabs.create({ url });
  });

// L'icône du site, lue ici et transmise telle quelle au bandeau. La page où
// il s'affiche n'a ainsi aucune adresse d'extension à charger, et aucun site
// ne peut interroger les icônes de l'extension.
const faviconOf = async (url) => {
  try {
    const response = await fetch(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`));
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { type: response.headers.get('content-type') || 'image/png', data: btoa(String.fromCharCode(...bytes)) };
  } catch {
    return null;
  }
};

const activePending = () => {
  if (Date.now() >= expiresAt) pending = [];
  return pending;
};

// Une ligne par onglet ; les onglets fermés d'un même geste partagent une ligne.
const currentState = () => {
  const rows = [];
  // L'adresse reste ici : le bandeau ne reçoit que ce qu'il affiche.
  for (const { batch, url, ...tab } of activePending()) {
    const last = rows.at(-1);
    if (last?.batch === batch) last.tabs.push(tab);
    else rows.push({ batch, tabs: [tab] });
  }
  return { rows, remainingMs: Math.max(0, expiresAt - Date.now()), durationMs: DURATION_MS };
};

const hideToast = () => {
  if (toastTabId === null) return;
  chrome.tabs.sendMessage(toastTabId, { type: 'hide-closed-tabs' }).catch(() => {});
  toastTabId = null;
};

// Met à jour le badge et, si elle est ouverte, la fenêtre de l'icône.
const refreshAction = () => {
  chrome.runtime.sendMessage({ type: 'closed-tabs-changed', ...currentState() }).catch(() => {});
  return updateBadge();
};

const hidePrompt = () => {
  hideToast();
  return refreshAction();
};

// Sans bandeau dans la page, personne ne signale la fin du décompte : on la
// surveille ici. Avec un bandeau, c'est lui qui la signale, car il met le
// décompte en pause tant que la souris est dessus.
let expiryTimer = null;
const watchExpiry = () => {
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    enqueue(() => {
      if (toastTabId !== null || Date.now() < expiresAt) return;
      pending = [];
      return hidePrompt();
    });
  }, DURATION_MS + 50);
};

const showToast = async (tabId, message) => {
  try {
    return (await chrome.tabs.sendMessage(tabId, message))?.shown === true;
  } catch {
    // Onglet ouvert avant l'installation de l'extension : toast.js n'y est pas encore.
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['banner.js', 'toast.js'] });
    return (await chrome.tabs.sendMessage(tabId, message))?.shown === true;
  } catch {
    return false; // page protégée
  }
};

// Sur une page de Chrome, une extension ne peut rien dessiner : la bulle de
// son icône est le seul endroit où proposer les onglets sans ouvrir de fenêtre.
const openBubble = async (windowId) => {
  try {
    await chrome.action.openPopup(windowId === null ? undefined : { windowId });
  } catch {
    // Bulle déjà ouverte, ou fenêtre sans barre d'outils : il reste le badge.
  }
};

// Affiche la liste en cours dans l'onglet actif, ou retire tout s'il n'y a plus
// rien à proposer. `announce` : si la page refuse le bandeau, ouvrir la bulle
// de l'icône. Réservé aux fermetures : un simple changement d'onglet ne doit
// rien faire surgir, le badge suffit.
const render = async (windowId, { announce = false } = {}) => {
  const state = currentState();
  if (!state.rows.length) return hidePrompt();

  const [activeTab] = await chrome.tabs.query(
    windowId === null ? { active: true, lastFocusedWindow: true } : { active: true, windowId },
  );
  if (activeTab) {
    if (toastTabId !== activeTab.id) hideToast();
    const shown = await showToast(activeTab.id, { type: 'show-closed-tabs', ...state });
    toastTabId = shown ? activeTab.id : null;
  }
  await refreshAction();
  if (toastTabId === null && announce) await openBubble(windowId);
};

// Ajoute à la liste les onglets que Chrome vient d'enregistrer comme fermés.
const collectClosedTabs = async (windowId, batch) => {
  const [{ enabled }, sessions, { askedIds }] = await Promise.all([
    chrome.storage.local.get({ enabled: true }),
    chrome.sessions.getRecentlyClosed(),
    chrome.storage.session.get({ askedIds: [] }),
  ]);
  if (!enabled) return;

  const now = Date.now() / 1000;
  const closed = sessions
    // Les pages internes (nouvel onglet, chrome://, extensions) ne sont pas concernées.
    .filter((session) => session.tab && RESTORABLE.test(session.tab.url ?? ''))
    // Un onglet que Chrome n'enregistre pas laisse en tête d'anciennes
    // fermetures : on écarte celles qui datent, et celles déjà proposées.
    .filter((session) => now - session.lastModified <= MAX_AGE_S)
    .map((session) => session.tab)
    .filter((tab) => !askedIds.includes(tab.sessionId));
  if (!closed.length) return;

  await chrome.storage.session.set({
    askedIds: [...askedIds, ...closed.map((tab) => tab.sessionId)].slice(-MAX_ASKED_IDS),
  });
  const icons = await Promise.all(closed.map((tab) => faviconOf(tab.url)));
  activePending().unshift(
    ...closed.map(({ sessionId, title, url }, index) => ({ sessionId, title: title || url, url, icon: icons[index], batch })),
  );
  // Chaque fermeture relance le décompte pour toute la liste.
  expiresAt = Date.now() + DURATION_MS;
  watchExpiry();
  lastWindowId = windowId;
  await render(windowId, { announce: true });
};

// Le bandeau ne désigne les onglets que par leur identifiant : seuls ceux que
// l'extension a proposés sont rouverts, à l'adresse qu'elle a relevée elle-même.
const restoreTabs = async (sessionIds) => {
  const wanted = new Set(sessionIds);
  // Sans passer par activePending : le décompte du bandeau est en pause tant
  // que la souris est dessus, et un clic doit garder les autres lignes.
  const tabs = pending.filter((tab) => wanted.has(tab.sessionId));
  pending = pending.filter((tab) => !wanted.has(tab.sessionId));
  if (pending.length) {
    expiresAt = Date.now() + DURATION_MS;
    watchExpiry();
  }
  for (const { sessionId, url } of tabs) await restoreTab(sessionId, url);
  await render(lastWindowId);
};

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // Fenêtre entière fermée : rien à faire.
  if (removeInfo.isWindowClosing) return;

  // Plusieurs onglets d'un coup ("Fermer les autres onglets", etc.) : un seul
  // geste, donc une seule ligne dans le bandeau.
  const now = Date.now();
  if (now - lastRemovedAt >= BULK_WINDOW_MS) currentBatch += 1;
  lastRemovedAt = now;
  if (tabId === toastTabId) toastTabId = null;

  const batch = currentBatch;
  enqueue(() => collectClosedTabs(removeInfo.windowId, batch));
});

// Changement d'onglet sans avoir répondu : le bandeau suit, avec le temps qu'il lui reste.
chrome.tabs.onActivated.addListener(({ windowId }) => {
  enqueue(() => {
    if (!activePending().length) return;
    lastWindowId = windowId;
    return render(windowId);
  });
});

// Page de l'onglet actif (re)chargée pendant un décompte, par exemple un onglet
// tout juste rouvert : on y remet le bandeau.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.active || tab.windowId !== lastWindowId) return;
  enqueue(() => {
    if (activePending().length) return render(tab.windowId);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'get-closed-tabs') {
    sendResponse(currentState());
  } else if (message?.type === 'restore-closed-tabs') {
    const sessionIds = Array.isArray(message.sessionIds) ? message.sessionIds.map(String) : [];
    enqueue(() => restoreTabs(sessionIds));
  } else if (message?.type === 'dismiss-closed-tabs') {
    enqueue(() => {
      pending = [];
      return hidePrompt();
    });
  } else if (message?.type === 'closed-tabs-expired') {
    enqueue(() => {
      // Un onglet fermé à l'instant a pu relancer le décompte entre-temps.
      if (Date.now() < expiresAt - 250) return;
      pending = [];
      return hidePrompt();
    });
  }
});

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) updateBadge();
});
