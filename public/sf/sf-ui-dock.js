(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});

  // =========================================================================
  // 1. SHARP MONOCHROME SVG ICON LIBRARY (ZERO CARTOON EMOJIS!)
  // =========================================================================
  function svg(body, size = 20, extra = '') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
  }

  const icons = {
    home: (s = 21) => svg('<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z"/>', s),
    search: (s = 21) => svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>', s),
    library: (s = 21) => svg('<path d="M4 19.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v14.5"/><path d="M10 19.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v15.5"/><path d="M16 7l4 12.5"/>', s),
    user: (s = 21) => svg('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/>', s),
    music: (s = 22) => svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', s),
    play: (s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z"/></svg>`,
    pause: (s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>`,
    prev: (s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12l9 6V6z"/></svg>`,
    next: (s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><path d="M5.5 18l9-6-9-6zM16 6h2v12h-2z"/></svg>`,
    heart: (s = 20, filled = false) =>
      filled
        ? `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="#EF4444" stroke="#EF4444" stroke-width="1.6"><path d="M19.5 12.57L12 20l-7.5-7.43A5 5 0 1 1 12 6.01a5 5 0 1 1 7.5 6.56z"/></svg>`
        : svg('<path d="M19.5 12.57L12 20l-7.5-7.43A5 5 0 1 1 12 6.01a5 5 0 1 1 7.5 6.56z"/>', s),
    shuffle: (s = 20) => svg('<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>', s),
    repeat: (s = 20) => svg('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>', s),
    mic: (s = 20) => svg('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/>', s),
    lyrics: (s = 20) => svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>', s),
    queue: (s = 20) => svg('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/><polygon points="17 14 21 16.5 17 19 17 14" fill="currentColor" stroke="none"/>', s),
    share: (s = 20) => svg('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>', s),
    moon: (s = 20) => svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>', s),
    more: (s = 20) => svg('<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>', s),
    chevDown: (s = 22) => svg('<polyline points="6 9 12 15 18 9"/>', s),
    chevLeft: (s = 22) => svg('<polyline points="15 18 9 12 15 6"/>', s),
    chevRight: (s = 18) => svg('<polyline points="9 18 15 12 9 6"/>', s),
    close: (s = 20) => svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', s),
    plus: (s = 20) => svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', s),
    volume: (s = 18) => svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>', s),
    bluetooth: (s = 18) => svg('<polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/>', s),
    history: (s = 19) => svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>', s),
    chart: (s = 19) => svg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>', s),
    users: (s = 19) => svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', s),
    sliders: (s = 19) => svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>', s),
    settings: (s = 19) => svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', s),
    info: (s = 19) => svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>', s),
    download: (s = 19) => svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>', s),
    cloudCheck: (s = 19) => svg('<path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><polyline points="9 15 11 17 15 13"/>', s),
    folder: (s = 19) => svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', s),
    upload: (s = 19) => svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>', s),
    trend: (s = 19) => svg('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>', s),
    grid: (s = 18) => svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>', s),
    list: (s = 18) => svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>', s),
    widget: (s = 19) => svg('<rect x="3" y="3" width="18" height="8" rx="3"/><rect x="3" y="14" width="8" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>', s),
    layers: (s = 19) => svg('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>', s),
    globe: (s = 19) => svg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>', s),
    shield: (s = 19) => svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', s),
    database: (s = 19) => svg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>', s),
    link: (s = 19) => svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', s),
    car: (s = 19) => svg('<path d="M5 17H3a1 1 0 0 1-1-1v-4l2.5-6h15L22 12v4a1 1 0 0 1-1 1h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/>', s),
    disc: (s = 19) => svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>', s),
    radio: (s = 19) => svg('<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M7.76 16.24a6 6 0 0 1 0-8.49"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14"/>', s),
    trash: (s = 18) => svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>', s),
    smartphone: (s = 20) => svg('<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>', s),
    // Permitted Colored Icons: Streak Flame Gradient + Official YT Music & Spotify Badges
    flame: (s = 28) => `<svg class="sf-anim-flame" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="sfFlameGrad" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#FDE047"/><stop offset="45%" stop-color="#FB923C"/><stop offset="100%" stop-color="#EA580C"/></linearGradient></defs><path d="M12.5 2C12.5 2 18 6.8 18 12.6C18 16.9 15.1 21 11.8 21C8.3 21 6 18.2 6 14.6C6 11.7 7.6 9.3 8.9 7.8C8.9 9.5 9.8 10.6 10.7 10.9C10.1 8.1 11 4.5 12.5 2Z" fill="url(#sfFlameGrad)"/><path d="M12 12.2C13.6 13.7 14.5 15.2 14.5 16.9C14.5 18.7 13.3 20 11.8 20C10.2 20 9.1 18.8 9.1 17.1C9.1 15.7 10.2 14.1 12 12.2Z" fill="#FEF08A"/></svg>`,
    ytMusicLogo: (s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#EF4444"/><circle cx="12" cy="12" r="6.8" fill="none" stroke="#FFFFFF" stroke-width="1.3"/><polygon points="10,8.8 15.8,12 10,15.2" fill="#FFFFFF"/></svg>`,
    spotifyLogo: (s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1DB954"/><path d="M7.2 9.4C10.6 8.3 14.6 8.6 17.5 10.3" stroke="#000" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M8.1 12.4C10.9 11.6 14.1 11.9 16.5 13.3" stroke="#000" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M9 15.3C11.2 14.7 13.7 14.9 15.6 16" stroke="#000" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>`,
  };

  // =========================================================================
  // 2. INTERACTIVE DRAGGABLE PRISMATIC GLASS LENS DOCK + MORPH ON SCROLL
  // =========================================================================
  const TABS = [
    { id: 'home', label: 'Beranda', icon: icons.home, anim: 'sf-anim-home' },
    { id: 'search', label: 'Cari', icon: icons.search, anim: 'sf-anim-search' },
    { id: 'library', label: 'Pustaka', icon: icons.library, anim: 'sf-anim-library' },
    { id: 'you', label: 'Kamu', icon: icons.user, anim: 'sf-anim-user' },
  ];

  let activeTabId = 'home';

  function snapBubble(tabId, instant = false) {
    const dock = document.getElementById('sf-bottom-dock');
    const bubble = document.getElementById('sf-lens-bubble');
    if (!dock || !bubble) return;
    const idx = Math.max(0, TABS.findIndex((t) => t.id === tabId));
    const innerW = Math.max(200, dock.clientWidth - 10);
    const slotW = innerW / TABS.length;
    if (instant) bubble.classList.add('dragging');
    bubble.style.width = `${slotW.toFixed(1)}px`;
    bubble.style.transform = `translate3d(${(idx * slotW).toFixed(1)}px, 0, 0) scale(1)`;
    if (instant) requestAnimationFrame(() => bubble.classList.remove('dragging'));
  }

  function triggerTabAnim(tabId) {
    const t = TABS.find((x) => x.id === tabId);
    const el = document.querySelector(`#sf-bottom-dock .sf-dock-tab[data-tab="${tabId}"] .sf-dock-ic`);
    if (!t || !el) return;
    el.classList.remove(t.anim);
    void el.offsetWidth;
    el.classList.add(t.anim);
    setTimeout(() => el.classList.remove(t.anim), 520);
  }

  function bindInteractiveDrag() {
    const dock = document.getElementById('sf-bottom-dock');
    const bubble = document.getElementById('sf-lens-bubble');
    if (!dock || !bubble) return;

    let dragging = false;
    let moved = false;
    let pointerId = null;
    let startX = 0;
    let lastX = 0;
    let lastTs = 0;
    let hoveredIdx = 0;

    function highlightUnder(idx) {
      dock.querySelectorAll('.sf-dock-tab').forEach((btn, i) => {
        btn.classList.toggle('under-lens', i === idx);
      });
    }

    dock.addEventListener('pointerdown', (e) => {
      if (document.body.classList.contains('sf-dock-collapsed')) {
        document.body.classList.remove('sf-dock-collapsed');
        requestAnimationFrame(() => snapBubble(activeTabId, false));
        return;
      }
      dragging = true;
      moved = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      lastX = e.clientX;
      lastTs = performance.now();
      try { dock.setPointerCapture(pointerId); } catch {}
      SF.utils.haptic(10);

      const rect = dock.getBoundingClientRect();
      const innerW = Math.max(160, rect.width - 10);
      const slotW = innerW / TABS.length;
      const relX = Math.max(0, Math.min(innerW - slotW, (e.clientX - rect.left - 5) - slotW / 2));
      hoveredIdx = Math.max(0, Math.min(TABS.length - 1, Math.floor(((e.clientX - rect.left - 5) / innerW) * TABS.length)));
      bubble.classList.remove('dragging');
      bubble.style.width = `${slotW.toFixed(1)}px`;
      bubble.style.transform = `translate3d(${relX.toFixed(1)}px, -3px, 0) scale(1.18)`;
      highlightUnder(hoveredIdx);
    });

    dock.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const rect = dock.getBoundingClientRect();
      const innerW = Math.max(160, rect.width - 10);
      const slotW = innerW / TABS.length;
      const now = performance.now();
      const dt = Math.max(8, now - lastTs);
      const vx = (e.clientX - lastX) / dt;
      lastX = e.clientX;
      lastTs = now;
      if (Math.abs(e.clientX - startX) > 6) moved = true;

      const relX = Math.max(0, Math.min(innerW - slotW, (e.clientX - rect.left - 5) - slotW / 2));
      const skew = Math.max(-9, Math.min(9, vx * -4.2));
      const stretchX = 1.18 + Math.min(0.08, Math.abs(vx) * 0.04);
      const nextIdx = Math.max(0, Math.min(TABS.length - 1, Math.round(relX / Math.max(1, slotW))));
      if (nextIdx !== hoveredIdx) {
        hoveredIdx = nextIdx;
        SF.utils.haptic(6);
        highlightUnder(hoveredIdx);
      }
      bubble.classList.add('dragging');
      bubble.style.transform = `translate3d(${relX.toFixed(1)}px, -4px, 0) scale(${stretchX.toFixed(3)}, 1.15) skewX(${skew.toFixed(2)}deg)`;
    });

    function release(e) {
      if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
      dragging = false;
      try { if (pointerId !== null) dock.releasePointerCapture(pointerId); } catch {}
      pointerId = null;
      bubble.classList.remove('dragging');
      highlightUnder(-1);

      const rect = dock.getBoundingClientRect();
      const innerW = Math.max(160, rect.width - 10);
      const tapIdx = Math.max(0, Math.min(TABS.length - 1, Math.floor(((e.clientX - rect.left - 5) / innerW) * TABS.length)));
      const targetTab = TABS[moved ? hoveredIdx : tapIdx]?.id || activeTabId;
      if (SF.views && typeof SF.views.openTab === 'function') {
        SF.views.openTab(targetTab);
      } else {
        dockApi.setActive(targetTab);
      }
    }

    dock.addEventListener('pointerup', release);
    dock.addEventListener('pointercancel', release);
    window.addEventListener('resize', () => snapBubble(activeTabId, true));
  }

  function bindScrollMorph() {
    const scroller = document.getElementById('sf-main-scroll');
    if (!scroller) return;
    let lastTop = 0;
    scroller.addEventListener('scroll', () => {
      if (!SF.store.state.prefs.collapseNavOnScroll) {
        document.body.classList.remove('sf-dock-collapsed');
        return;
      }
      const st = scroller.scrollTop;
      if (st > 52 && st > lastTop + 6) {
        document.body.classList.add('sf-dock-collapsed');
      } else if (st < lastTop - 8 || st <= 20) {
        if (document.body.classList.contains('sf-dock-collapsed')) {
          document.body.classList.remove('sf-dock-collapsed');
          requestAnimationFrame(() => snapBubble(activeTabId, false));
        }
      }
      lastTop = Math.max(0, st);
    }, { passive: true });
  }

  const dockApi = {
    init() {
      const dockEl = document.getElementById('sf-bottom-dock');
      if (!dockEl) return;
      dockEl.innerHTML = `
        <div id="sf-lens-bubble" aria-hidden="true"></div>
        ${TABS.map((t) => `
          <button type="button" class="sf-dock-tab ${t.id === activeTabId ? 'active' : ''}" data-tab="${t.id}" aria-label="${t.label}">
            <span class="sf-dock-ic">${t.icon(21)}</span>
            <span class="sf-dock-label">${t.label}</span>
          </button>
        `).join('')}
      `;
      bindInteractiveDrag();
      bindScrollMorph();
      requestAnimationFrame(() => snapBubble(activeTabId, true));
    },
    setActive(tabId) {
      activeTabId = tabId;
      document.body.classList.remove('sf-dock-collapsed');
      document.querySelectorAll('#sf-bottom-dock .sf-dock-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
      });
      snapBubble(tabId, false);
      triggerTabAnim(tabId);
      const fabs = document.getElementById('sf-home-fabs');
      if (fabs) fabs.style.display = tabId === 'home' ? 'flex' : 'none';
    },
    snapBubble,
  };

  SF.icons = icons;
  SF.dock = dockApi;
})();
