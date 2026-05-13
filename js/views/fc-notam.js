import store from '../store.js';

export function mount(container) {
  _render(container);
}

export function unmount(container) {}

function _render(container) {
  const f = store.flight;
  const airports = f ? [f.dep, f.dest].filter(Boolean) : [];

  container.innerHTML = `
    <div class="view-content">
      <div class="section-title">NOTAM on Map</div>

      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input class="input input-upper" id="notam-icao" placeholder="ICAO (e.g. RCTP)" style="width:130px">
          <button class="btn btn-primary btn-sm" id="btn-notam-open">開啟 NOTAM →</button>
        </div>
        ${airports.length ? `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          ${airports.map(a => `<button class="btn btn-ghost btn-sm notam-quick" data-icao="${a}">${a}</button>`).join('')}
        </div>` : ''}
      </div>

      <div class="section-title">快速連結</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${_link('Skyinfo NOTAM 地圖（日本）', 'https://www.skyinfo.jp/notam/')}
        ${_link('ICAO NOTAMam', 'https://www.notams.faa.gov/dinsQueryWeb/')}
        ${_link('FAA NOTAM Search', 'https://notams.aim.faa.gov/notamSearch/')}
      </div>

      <div style="margin-top:20px;padding:14px;background:var(--surface);border-radius:10px;border:1px solid var(--border);color:var(--text3);font-size:13px;line-height:1.6">
        🗺️ 嵌入式 NOTAM 地圖（自動帶入本次機場）計畫在後續版本加入。
      </div>
    </div>`;

  document.getElementById('btn-notam-open').onclick = () => {
    const icao = document.getElementById('notam-icao').value.trim().toUpperCase();
    if (!icao) return;
    window.open(`https://notams.aim.faa.gov/notamSearch/nsapp.html#/?searchType=icaos&icaoQuery=${icao}`, '_blank');
  };

  container.querySelectorAll('.notam-quick').forEach(btn => {
    btn.onclick = () => {
      document.getElementById('notam-icao').value = btn.dataset.icao;
    };
  });
}

function _link(label, url) {
  return `<a href="${url}" target="_blank" rel="noopener"
    style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:10px;color:var(--text);text-decoration:none;font-size:14px;font-weight:600">
    ${label} <span style="color:var(--text3);font-size:12px">↗</span>
  </a>`;
}
