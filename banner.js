// Le bandeau "Onglet fermé · Rouvrir", commun à la page (toast.js) et à la
// petite fenêtre de secours (confirm.js). Une ligne par onglet fermé ; les
// onglets fermés d'un même geste partagent une ligne.
// Affectation plutôt que déclaration : le fichier peut être injecté deux fois.
globalThis.closedTabsBanner = (() => {
  const MAX_ROWS = 5;

  // Les couleurs suivent le thème clair ou sombre du système ; l'orange est
  // celui de l'icône de l'extension.
  const CSS = `
    .toast {
      --card: #ffffff;
      --text: #1c1c1e;
      --muted: #8e8e93;
      --line: rgba(60, 60, 67, 0.14);
      --hover: rgba(60, 60, 67, 0.08);
      --accent: #f08a00;
      --accent-text: #ffffff;
      --shadow: 0 10px 30px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(60, 60, 67, 0.12);
      position: relative;
      box-sizing: border-box;
      width: min(440px, calc(100vw - 24px));
      padding: 12px 10px 15px 14px;
      overflow: hidden;
      border-radius: 14px;
      background: var(--card);
      color: var(--text);
      font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
      text-align: left;
      box-shadow: var(--shadow);
    }
    @media (prefers-color-scheme: dark) {
      .toast {
        --card: #2c2c2e;
        --text: #f2f2f7;
        --line: rgba(235, 235, 245, 0.14);
        --hover: rgba(235, 235, 245, 0.1);
        --accent: #ff9f0a;
        --accent-text: #1c1c1e;
        --shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(235, 235, 245, 0.12);
      }
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
      border-top: 1px solid var(--line);
    }
    .row {
      min-height: 30px;
    }
    .icon {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 5px;
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
      color: var(--muted);
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
      color: var(--muted);
    }
    button {
      flex: none;
      margin: 0;
      border: 0;
      font: inherit;
      cursor: pointer;
    }
    button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .restore {
      padding: 7px 16px;
      border-radius: 999px;
      background: var(--accent);
      color: var(--accent-text);
      font-weight: 600;
    }
    .restore:hover {
      filter: brightness(1.08);
    }
    .link {
      padding: 4px 10px;
      border-radius: 999px;
      background: transparent;
      color: var(--accent);
      font-weight: 600;
    }
    .link:hover,
    .dismiss:hover {
      background: var(--hover);
    }
    .dismiss {
      width: 28px;
      height: 28px;
      padding: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--muted);
      font-size: 14px;
      line-height: 1;
    }
    .timer {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 3px;
      background: var(--accent);
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

  // L'icône arrive déjà lue par l'extension ({ type, data } en base64). Elle
  // est dessinée dans un canvas : une balise image chargerait une adresse que
  // la page pourrait voir, ou que ses règles de sécurité pourraient bloquer.
  const favicon = (icon) => {
    if (!icon) return null;
    const canvas = element('canvas', 'icon');
    canvas.width = canvas.height = 32;
    const bytes = Uint8Array.from(atob(icon.data), (character) => character.charCodeAt(0));
    createImageBitmap(new Blob([bytes], { type: icon.type }))
      .then((bitmap) => canvas.getContext('2d').drawImage(bitmap, 0, 0, 32, 32))
      .catch(() => canvas.remove());
    return canvas;
  };

  // state : { rows: [{ tabs: [{ sessionId, title, icon }] }], remainingMs, durationMs }
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
      text.append(element('div', 'label', 'Onglet fermé'), element('div', 'title', tabs[0].title));
      head.append(...[favicon(tabs[0].icon), text, button('restore', 'Rouvrir', tabs), dismiss].filter(Boolean));
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
        const name = row.tabs.length === 1 ? first.title : `${row.tabs.length} onglets fermés ensemble`;
        const line = element('div', 'row');
        line.append(...[favicon(first.icon), element('div', 'name', name), button('link', 'Rouvrir', row.tabs)].filter(Boolean));
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
