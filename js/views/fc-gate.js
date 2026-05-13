export function mount(container) {
  container.innerHTML = `
    <div class="view-content">
      <div class="section-title">閘門 / 停機位 Gate Info</div>
      <div style="padding:14px;background:var(--surface);border-radius:10px;border:1px solid var(--border);color:var(--text3);font-size:13px;line-height:1.6;margin-bottom:16px">
        🚧 桃園機場即時閘門資訊整合建置中。目前請使用下方外部連結。
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${_link('桃園機場官網航班資訊', 'https://www.taoyuan-airport.com/flight/arrivalList')}
        ${_link('FlightAware TPE 即時動態', 'https://www.flightaware.com/live/airport/RCTP')}
        ${_link('FR24 桃園機場', 'https://www.flightradar24.com/airport/tpe')}
      </div>
    </div>`;
}

export function unmount(container) {}

function _link(label, url) {
  return `<a href="${url}" target="_blank" rel="noopener"
    style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:10px;color:var(--text);text-decoration:none;font-size:14px;font-weight:600">
    ${label} <span style="color:var(--text3);font-size:12px">↗</span>
  </a>`;
}
