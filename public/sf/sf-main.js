(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});

  let alarmTimer = null;
  let lastTriggeredMinute = '';

  function unregisterSwInNativeApk() {
    if (!SF.utils.isNativeApk()) return;
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister().catch(() => {}));
        }).catch(() => {});
      }
      if ('caches' in window) {
        caches.keys().then((keys) => {
          keys.forEach((k) => caches.delete(k).catch(() => {}));
        }).catch(() => {});
      }
    } catch {}
  }

  function startAlarmScheduler() {
    if (alarmTimer) clearInterval(alarmTimer);
    alarmTimer = setInterval(() => {
      const alarms = SF.store.state.alarms || [];
      if (!alarms.length) return;
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const key = `${now.toDateString()}_${hh}:${mm}`;
      if (key === lastTriggeredMinute) return;

      const hit = alarms.find((a) => a.enabled && a.time === `${hh}:${mm}`);
      if (!hit) return;
      lastTriggeredMinute = key;

      let pool = [];
      if (hit.playlistId === 'liked') pool = SF.store.state.likedTracks;
      else if (hit.playlistId === 'home') pool = SF.views.getHomeFeedCache();
      else {
        const pl = SF.store.state.playlists.find((p) => p.id === hit.playlistId);
        if (pl) pool = pl.tracks || [];
      }
      if (!pool.length) pool = SF.store.state.history.length ? SF.store.state.history : SF.views.getHomeFeedCache();
      if (pool.length) {
        SF.audio.playTrack(pool[0], pool, 0, `Alarm • ${hit.label || hit.time}`);
        SF.ui.toast(`Alarm ${hit.time} berbunyi!`);
      }
    }, 20000);
  }

  function handleDeepLinks() {
    try {
      const qs = new URLSearchParams(window.location.search || '');
      const q = qs.get('q');
      const jam = qs.get('jam');
      if (q) {
        SF.views.openTab('search');
        const inp = document.getElementById('sf-search-input');
        if (inp) {
          inp.value = q;
          inp.dispatchEvent(new Event('input'));
        }
      } else if (jam) {
        SF.settings.openJam();
      }
    } catch {}
  }

  function showWelcomeOnce() {
    try {
      if (localStorage.getItem('sf_v4_seen_welcome') === '1') return;
      localStorage.setItem('sf_v4_seen_welcome', '1');
      SF.ui.openModal(
        `
        <div style="text-align:center;padding:6px 4px;">
          <div style="width:58px;height:58px;border-radius:18px;margin:0 auto 12px;background:linear-gradient(135deg,#1DB954,#14B8A6);display:flex;align-items:center;justify-content:center;color:#FFF;">
            ${SF.icons.music(28)}
          </div>
          <div style="font-size:20px;font-weight:900;">Selamat Datang di SpotyFlow v4.0.0</div>
          <div class="sf-muted" style="font-size:13.5px;margin-top:6px;line-height:1.45;">
            Arsitektur modular baru yang jauh lebih bersih, ringan, dan bebas konflik: True Liquid Glass Auralys, Gelembung Lensa Geser Jari, Lirik Sinkron Live, 5 Widget Native, dan Poster Lagu 3D AI Depth.
          </div>
          <button type="button" class="sf-pill-btn accent" id="sf-wel-ok" style="width:100%;margin-top:16px;">Mulai Dengarkan</button>
        </div>
        `,
        (sheet) => {
          sheet.querySelector('#sf-wel-ok').onclick = SF.ui.closeModal;
        }
      );
    } catch {}
  }

  function installErrorGuards() {
    window.onerror = function (msg) {
      console.warn('[SF.guard]', msg);
      return false;
    };
    window.onunhandledrejection = function (ev) {
      console.warn('[SF.guard.promise]', ev?.reason);
    };
    document.addEventListener('visibilitychange', () => {
      document.body.classList.toggle('sf-bg-paused', document.hidden);
    });
  }

  function boot() {
    installErrorGuards();

    // Deterministic strict boot order
    SF.store.init();
    unregisterSwInNativeApk();
    SF.dock.init();
    SF.views.init();
    SF.player.init();
    SF.lyrics.init();
    SF.audio.init();
    SF.settings.init();
    SF.poster3d.init();

    // Open configured default tab
    const startTab = SF.store.state.prefs.defaultTab || 'home';
    SF.views.openTab(startTab);

    // Restore last queue metadata cleanly if persistentQueue is enabled
    if (SF.store.state.prefs.persistentQueue && SF.store.state.currentTrack) {
      SF.bus.emit('track:change', {
        track: SF.store.state.currentTrack,
        sourceLabel: SF.store.state.sourceLabel || 'SpotyFlow',
      });
    }

    startAlarmScheduler();
    handleDeepLinks();
    setTimeout(showWelcomeOnce, 450);

    // Register Service Worker on Web Browser only (NEVER inside APK)
    if (!SF.utils.isNativeApk() && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }

  SF.main = { boot };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
