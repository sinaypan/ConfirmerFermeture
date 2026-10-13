// Bandeau "Onglet fermé · Rouvrir" affiché dans la page active, à la demande
// de background.js. Il disparaît seul à la fin du décompte.
(() => {
  const HOST_ID = 'confirmer-fermeture-toast';

  const hide = () => document.getElementById(HOST_ID)?.remove();

  // Extension rechargée pendant qu'un bandeau était affiché : ce script n'a plus
  // de lien avec elle. Le bandeau doit quand même pouvoir se fermer.
  const answer = (message) => {
    hide();
    if (chrome.runtime?.id) chrome.runtime.sendMessage(message);
  };

  const show = (state) => {
    // Mise à jour d'un bandeau déjà affiché : pas de nouvelle animation d'entrée.
    const animate = !document.getElementById(HOST_ID);
    hide();

    const host = document.createElement('div');
    host.id = HOST_ID;
    // !important partout : la page ne doit pas pouvoir déformer le bandeau.
    const hostStyle = {
      all: 'initial',
      display: 'block',
      position: 'fixed',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      'z-index': '2147483647',
    };
    for (const [property, value] of Object.entries(hostStyle)) {
      host.style.setProperty(property, value, 'important');
    }

    // Fermé : les scripts de la page ne peuvent ni lire le bandeau (le titre
    // d'un onglet fermé ne regarde pas le site affiché) ni cliquer dedans.
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(closedTabsBanner.CSS);
    root.adoptedStyleSheets = [sheet];

    root.append(
      closedTabsBanner.build(
        state,
        {
          restore: (tabs) => answer({ type: 'restore-closed-tabs', sessionIds: tabs.map((tab) => tab.sessionId) }),
          dismiss: () => answer({ type: 'dismiss-closed-tabs' }),
          expire: () => answer({ type: 'closed-tabs-expired' }),
        },
        { animate },
      ),
    );
    document.documentElement.append(host);

    // Couche supérieure du navigateur : passe au-dessus des fenêtres modales de la page.
    try {
      host.popover = 'manual';
      host.showPopover();
    } catch {
      // popover indisponible : le z-index suffit
    }
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'show-closed-tabs') {
      show(message);
      sendResponse({ shown: true });
    } else if (message?.type === 'hide-closed-tabs') {
      hide();
    }
  });
})();
