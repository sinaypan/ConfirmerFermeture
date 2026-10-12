// Bandeau "Onglet fermé · Rouvrir" affiché dans la page active, à la demande
// de background.js. Il disparaît seul à la fin du décompte.
(() => {
  const HOST_ID = 'confirmer-fermeture-toast';
  const DURATION_MS = 7000;

  const CSS = `
    .toast {
      position: relative;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 12px;
      width: min(440px, calc(100vw - 24px));
      padding: 12px 10px 15px 14px;
      overflow: hidden;
      border-radius: 12px;
      background: #202124;
      color: #e8eaed;
      font: 13px/1.35 system-ui, "Segoe UI", sans-serif;
      text-align: left;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
      animation: slide-in 0.16s ease-out;
    }
    .icon {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 4px;
    }
    .text {
      flex: 1;
      min-width: 0;
    }
    .label {
      font-size: 12px;
      color: #9aa0a6;
    }
    .title {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-weight: 600;
    }
    button {
      flex: none;
      margin: 0;
      border: 0;
      font: inherit;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid #8ab4f8;
      outline-offset: 2px;
    }
    .restore {
      padding: 7px 16px;
      border-radius: 16px;
      background: #8ab4f8;
      color: #202124;
      font-weight: 600;
    }
    .restore:hover {
      background: #aecbfa;
    }
    .dismiss {
      width: 28px;
      height: 28px;
      padding: 0;
      border-radius: 50%;
      background: transparent;
      color: #9aa0a6;
      font-size: 14px;
      line-height: 1;
    }
    .dismiss:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #e8eaed;
    }
    .timer {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 3px;
      background: #8ab4f8;
      transform-origin: left;
      animation: countdown ${DURATION_MS}ms linear forwards;
    }
    .toast:hover .timer {
      animation-play-state: paused;
    }
    @keyframes slide-in {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
    }
    @keyframes countdown {
      to {
        transform: scaleX(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast {
        animation: none;
      }
    }
  `;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const hide = () => document.getElementById(HOST_ID)?.remove();

  const show = ({ sessionId, title, url }) => {
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

    const root = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];

    const toast = element('div', 'toast');
    toast.setAttribute('role', 'status');

    const icon = element('img', 'icon');
    icon.alt = '';
    icon.addEventListener('error', () => icon.remove());
    icon.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);

    const text = element('div', 'text');
    text.append(element('div', 'label', 'Onglet fermé'), element('div', 'title', title || url));

    const restore = element('button', 'restore', 'Rouvrir');
    restore.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'restore-closed-tab', sessionId, url });
      hide();
    });

    const dismiss = element('button', 'dismiss', '✕');
    dismiss.setAttribute('aria-label', 'Ignorer');
    dismiss.addEventListener('click', hide);

    const timer = element('div', 'timer');
    timer.addEventListener('animationend', hide);

    toast.append(icon, text, restore, dismiss, timer);
    root.append(toast);
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
    if (message?.type === 'show-closed-tab') {
      show(message);
      sendResponse({ shown: true });
    } else if (message?.type === 'hide-closed-tab') {
      hide();
    }
  });
})();
