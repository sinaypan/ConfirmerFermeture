// Le bandeau "Onglet fermé · Rouvrir", commun à la page (toast.js) et à la
// petite fenêtre de secours (confirm.js). Une ligne par onglet fermé ; les
// onglets fermés d'un même geste partagent une ligne.
// Affectation plutôt que déclaration : le fichier peut être injecté deux fois.
globalThis.closedTabsBanner = (() => {
  const MAX_ROWS = 5;

  const CSS = `
    .toast {
      position: relative;
      box-sizing: border-box;
      width: min(440px, calc(100vw - 24px));
      padding: 12px 10px 15px 14px;
      overflow: hidden;
      border-radius: 12px;
      background: #202124;
      color: #e8eaed;
      font: 13px/1.35 system-ui, "Segoe UI", sans-serif;
      text-align: left;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .toast.enter {
      animation: slide-in 0.16s ease-out;
    }
    .head,
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .list {
      margin: 10px 4px 0 0;
      padding-top: 6px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .row {
      min-height: 30px;
    }
    .icon {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 4px;
    }
    .row .icon {
      width: 16px;
      height: 16px;
    }
    .text {
      flex: 1;
      min-width: 0;
    }
    .label {
      font-size: 12px;
      color: #9aa0a6;
    }
    .title,
    .name {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .title {
      font-weight: 600;
    }
    .name {
      flex: 1;
      min-width: 0;
    }
    .more {
      padding-top: 4px;
      font-size: 12px;
      color: #9aa0a6;
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
    .link {
      padding: 4px 10px;
      border-radius: 12px;
      background: transparent;
      color: #8ab4f8;
      font-weight: 600;
    }
    .link:hover {
      background: rgba(138, 180, 248, 0.14);
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
      animation: countdown linear forwards;
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
      from {
        transform: scaleX(1);
      }
      to {
        transform: scaleX(0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast.enter {
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

  const favicon = (url) => {
    const icon = element('img', 'icon');
    icon.alt = '';
    icon.addEventListener('error', () => icon.remove());
    icon.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
    return icon;
  };

  // state : { rows: [{ tabs: [{ sessionId, title, url }] }], remainingMs, durationMs }
  // handlers : { restore(tabs), dismiss(), expire() }
  const build = (state, handlers, { animate = true } = {}) => {
    const { rows, remainingMs, durationMs } = state;
    const tabs = rows.flatMap((row) => row.tabs);

    const button = (className, label, targets) => {
      const node = element('button', className, label);
      node.addEventListener('click', () => handlers.restore(targets));
      return node;
    };

    const toast = element('div', animate ? 'toast enter' : 'toast');
    toast.setAttribute('role', 'status');

    const dismiss = element('button', 'dismiss', '✕');
    dismiss.setAttribute('aria-label', 'Ignorer');
    dismiss.addEventListener('click', handlers.dismiss);

    const head = element('div', 'head');
    if (tabs.length === 1) {
      const text = element('div', 'text');
      text.append(element('div', 'label', 'Onglet fermé'), element('div', 'title', tabs[0].title || tabs[0].url));
      head.append(favicon(tabs[0].url), text, button('restore', 'Rouvrir', tabs), dismiss);
    } else {
      head.append(
        element('div', 'text title', `${tabs.length} onglets fermés`),
        button('restore', 'Tout rouvrir', tabs),
        dismiss,
      );
    }
    toast.append(head);

    // Un seul geste (un onglet, ou plusieurs fermés ensemble) : l'en-tête suffit.
    if (rows.length > 1) {
      const list = element('div', 'list');
      for (const row of rows.slice(0, MAX_ROWS)) {
        const [first] = row.tabs;
        const name =
          row.tabs.length === 1 ? first.title || first.url : `${row.tabs.length} onglets fermés ensemble`;
        const line = element('div', 'row');
        line.append(favicon(first.url), element('div', 'name', name), button('link', 'Rouvrir', row.tabs));
        list.append(line);
      }
      const hidden = rows.slice(MAX_ROWS).flatMap((row) => row.tabs).length;
      if (hidden) list.append(element('div', 'more', `+ ${hidden} ${hidden === 1 ? 'autre' : 'autres'}`));
      toast.append(list);
    }

    // Délai négatif : le décompte reprend là où il en était si le bandeau a changé d'onglet.
    const timer = element('div', 'timer');
    timer.style.animationDuration = `${durationMs}ms`;
    timer.style.animationDelay = `${Math.min(0, remainingMs - durationMs)}ms`;
    timer.addEventListener('animationend', handlers.expire);
    toast.append(timer);

    return toast;
  };

  return { CSS, build };
})();
