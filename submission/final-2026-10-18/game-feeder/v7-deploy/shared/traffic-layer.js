(function (root) {
  'use strict';

  // A small, shared visual layer for modes 1, 2 and 4. The simulations already
  // calculate buses, metro trips and people; this layer makes those three
  // flows visible at a glance while the player is learning the board.
  function boot() {
    var nav = document.getElementById('navrow');
    var mode = Number(nav && nav.dataset.current);
    if (![1, 2, 4].includes(mode)) return;
    var plate = document.querySelector('.mapplate');
    if (!plate || document.getElementById('tlTrafficLayer')) return;

    var style = document.createElement('style');
    style.textContent = [
      '.tl-traffic-card{position:absolute;right:12px;bottom:74px;z-index:9;width:min(280px,calc(100% - 24px));padding:9px 11px;border:1px solid var(--s-line);border-radius:8px;background:var(--s-chrome);backdrop-filter:blur(18px) saturate(1.2);box-shadow:var(--s-shadow);pointer-events:none;animation:tlTrafficIn .65s cubic-bezier(.2,.7,.2,1) both}',
      '.tl-traffic-head{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--s-ink2);letter-spacing:.04em}',
      '.tl-traffic-head b{color:var(--s-ink);font-size:12px;font-weight:600}',
      '.tl-traffic-live{width:6px;height:6px;border-radius:50%;background:var(--s-accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--s-accent) 16%,transparent);animation:tlPulse 1.8s ease-in-out infinite}',
      '.tl-traffic-flow{position:relative;height:24px;margin:6px 0 4px;overflow:hidden;border-top:1px solid var(--s-line);border-bottom:1px solid var(--s-line)}',
      '.tl-traffic-flow:before{content:"";position:absolute;left:0;right:0;top:11px;border-top:2px dashed color-mix(in srgb,var(--s-ink3) 38%,transparent)}',
      '.tl-traffic-dot{position:absolute;top:7px;width:10px;height:10px;border-radius:50%;background:var(--s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--s-accent) 18%,transparent);animation:tlTravel var(--tl-speed,4.6s) linear infinite}',
      '.tl-traffic-dot:nth-child(2n){background:var(--s-info);animation-delay:-1.7s}.tl-traffic-dot:nth-child(3n){background:var(--s-warn);animation-delay:-3.1s}',
      '.tl-traffic-modes{display:flex;gap:6px;flex-wrap:wrap}.tl-traffic-mode{display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border:1px solid var(--s-line);border-radius:999px;background:var(--s-panel);font-size:10.5px;color:var(--s-ink2)}.tl-traffic-mode b{font:500 11px var(--s-mono);color:var(--s-ink)}',
      '.tl-traffic-hint{margin-top:6px;color:var(--s-ink3);font:500 9.5px var(--s-mono);letter-spacing:.04em}.tl-traffic-hint kbd{padding:1px 5px;border:1px solid var(--s-line2);border-bottom-width:2px;border-radius:4px;background:var(--s-panel);color:var(--s-ink)}',
      '@keyframes tlTravel{0%{left:-12px;opacity:0}12%{opacity:1}88%{opacity:1}100%{left:calc(100% + 12px);opacity:0}}@keyframes tlPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.78)}}@keyframes tlTrafficIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
      '@media(max-width:700px){.tl-traffic-card{right:8px;bottom:70px;width:min(248px,calc(100% - 16px));padding:7px 9px}.tl-traffic-hint{font-size:9px}}',
      '@media(prefers-reduced-motion:reduce){.tl-traffic-card,.tl-traffic-live,.tl-traffic-dot{animation:none!important}}'
    ].join('');
    document.head.appendChild(style);

    var card = document.createElement('div');
    card.id = 'tlTrafficLayer';
    card.className = 'tl-traffic-card';
    var metroMode = mode === 2 || mode === 4;
    card.innerHTML = '<div class="tl-traffic-head"><i class="tl-traffic-live"></i><b>' +
      (metroMode ? 'LIVE TRANSIT · 公交＋地铁＋人流' : 'LIVE TRANSIT · 公交＋人流') +
      '</b><span class="sp"></span></div>' +
      '<div class="tl-traffic-flow" aria-hidden="true"><i class="tl-traffic-dot"></i><i class="tl-traffic-dot"></i><i class="tl-traffic-dot"></i><i class="tl-traffic-dot"></i></div>' +
      '<div class="tl-traffic-modes">' +
      (metroMode ? '<span class="tl-traffic-mode">🚇 地铁 <b id="tlTrafficMetro">0</b></span>' : '<span class="tl-traffic-mode">🚌 公交 <b id="tlTrafficBus">0</b></span>') +
      (metroMode ? '<span class="tl-traffic-mode">🚌 接驳 <b id="tlTrafficBus">0</b></span>' : '') +
      '<span class="tl-traffic-mode">👥 人流 <b id="tlTrafficPeople">0</b></span></div>' +
      '<div class="tl-traffic-hint">按住 <kbd>F</kbd> 加速观察 · hold F to fast-forward</div>';
    plate.appendChild(card);

    function value(id) {
      var el = document.getElementById(id);
      return el ? el.textContent.trim() : '0';
    }
    function update() {
      var bus = mode === 1 ? value('score') : value('hudBus');
      var people = mode === 1 ? value('cars') : value('hudRail');
      var busEl = document.getElementById('tlTrafficBus');
      var peopleEl = document.getElementById('tlTrafficPeople');
      if (busEl) busEl.textContent = bus || '0';
      if (peopleEl) peopleEl.textContent = people || '0';
      var metroEl = document.getElementById('tlTrafficMetro');
      if (metroEl) metroEl.textContent = mode === 2 || mode === 4 ? value('hudBus') : '0';
    }
    update();
    root.setInterval(update, 420);
    root.addEventListener('tl:lang', update);
    root.addEventListener('keydown', function (event) {
      if (event.code !== 'KeyF' || event.repeat || event.target.closest?.('input,textarea,select')) return;
      plate.style.setProperty('--tl-speed', '1.25s');
      plate.classList.add('tl-fast-forward');
    });
    root.addEventListener('keyup', function (event) {
      if (event.code !== 'KeyF') return;
      plate.style.setProperty('--tl-speed', '4.6s');
      plate.classList.remove('tl-fast-forward');
    });
    root.addEventListener('blur', function () {
      plate.style.setProperty('--tl-speed', '4.6s');
      plate.classList.remove('tl-fast-forward');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
