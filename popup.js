const checkbox = document.getElementById('enabled');
const status = document.getElementById('status');
const closed = document.getElementById('closed');

const render = (enabled) => {
  checkbox.checked = enabled;
  status.textContent = t(enabled ? 'statusOn' : 'statusOff');
};

chrome.storage.local.get({ enabled: true }, ({ enabled }) => render(enabled));

checkbox.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: checkbox.checked });
  render(checkbox.checked);
});

// Les onglets qui viennent d'être fermés, avec le même bandeau que dans la
// page (banner.js). C'est là qu'on les retrouve quand la page active est une
// page de Chrome, où aucun bandeau ne peut s'afficher.
const sheet = new CSSStyleSheet();
sheet.replaceSync(closedTabsBanner.CSS);
document.adoptedStyleSheets = [sheet];

const send = (message) => chrome.runtime.sendMessage(message).catch(() => {});

// La bulle ouverte pour proposer des onglets se referme quand il n'y en a plus.
let hadTabs = false;

const renderClosed = (state) => {
  closed.replaceChildren();
  closed.hidden = !state?.rows.length;
  if (closed.hidden) {
    if (hadTabs) window.close();
    return;
  }
  hadTabs = true;
  closed.append(
    closedTabsBanner.build(
      state,
      {
        restore: (tabs) => send({ type: 'restore-closed-tabs', sessionIds: tabs.map((tab) => tab.sessionId) }),
        dismiss: () => send({ type: 'dismiss-closed-tabs' }),
        expire: () => send({ type: 'closed-tabs-expired' }),
      },
      { animate: false },
    ),
  );
};

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'closed-tabs-changed') renderClosed(message);
});

chrome.runtime.sendMessage({ type: 'get-closed-tabs' }).then(renderClosed);
