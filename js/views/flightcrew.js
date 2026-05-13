import * as Briefing from './fc-briefing.js';
import * as ELB      from './fc-elb.js';
import * as Weather  from './fc-weather.js';
import * as NOTAM    from './fc-notam.js';
import * as Gate     from './fc-gate.js';

const SUB_TABS = [
  { id: 'briefing', label: '📋 Briefing',   mod: Briefing },
  { id: 'elb',      label: '🔧 ELB',        mod: ELB      },
  { id: 'weather',  label: '🌤 Weather',     mod: Weather  },
  { id: 'notam',    label: '🗺 NOTAM',       mod: NOTAM    },
  { id: 'gate',     label: '🚪 Gate Info',   mod: Gate     },
];

let activeId = 'briefing';
let activePanel = null;

export function mount(container) {
  _render(container);
}

export function unmount(container) {
  if (activePanel && SUB_TABS.find(t => t.id === activeId)?.mod?.unmount) {
    SUB_TABS.find(t => t.id === activeId).mod.unmount(activePanel);
  }
}

function _render(container) {
  container.innerHTML = `
    <div class="sub-tabbar" id="fc-subtabs">
      ${SUB_TABS.map(t =>
        `<button class="sub-tab-btn ${t.id === activeId ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`
      ).join('')}
    </div>
    <div id="fc-panel"></div>`;

  container.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.onclick = () => _switchTab(btn.dataset.tab, container);
  });

  _mountTab(activeId, container.querySelector('#fc-panel'));
}

function _switchTab(id, container) {
  if (id === activeId) return;

  const prev = SUB_TABS.find(t => t.id === activeId);
  if (prev?.mod?.unmount && activePanel) prev.mod.unmount(activePanel);

  activeId = id;
  container.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === id);
  });
  _mountTab(id, container.querySelector('#fc-panel'));
}

function _mountTab(id, panel) {
  panel.innerHTML = '';
  activePanel = panel;
  const tab = SUB_TABS.find(t => t.id === id);
  if (tab?.mod?.mount) tab.mod.mount(panel);
}
