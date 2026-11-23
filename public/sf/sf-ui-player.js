(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});

  let fullscreenOpen = false;
  let lyricsOpen = false;
  let isSeeking = false;
  let manualLyricScrollUntil = 0;

  function esc(v) {
    return SF.utils.escapeHtml(v);
  }

  function updateStageColor(track) {
    const pal = SF.utils.getPalette(track?.title || 'SpotyFlow');
    document.documentElement.style.setProperty('--cover-rgb', pal[2]);
    const fs = document.getElementById('sf-fullscreen-player');
    if (fs) {
      fs.style.setProperty('--stage-base', `rgb(${Math.round(parseInt(pal[2].split(',')[0], 10) * 0.14)}, ${Math.round(parseInt(pal[2].split(',')[1], 10) * 0.14)}, ${Math.round(parseInt(pal[2].split(',')[2], 10) * 0.18)})`);
    }
  }

  // =========================================================================
  // 1. FLOATING MINI-PLAYER CAPSULE
  // =========================================================================
  function buildMiniPlayerDom() {
    const mini = document.getElementById('sf-mini-player');
    if (!mini) return;
    mini.innerHTML = `
      <div id="sf-mini-progress-wrap"><div id="sf-mini-progress-fill"></div></div>
      <div class="sf-mini-body">
        <div id="sf-mini-open" class="sf-row-gap" style="flex:1;min-width:0;cursor:pointer;">
          <div id="sf-mini-art"></div>
          <div style="flex:1;min-width:0;">
            <div id="sf-mini-title" class="sf-trunc" style="font-size:13.5px;font-weight:800;line-height:1.2;">Siap Memutar</div>
            <div id="sf-mini-artist" class="sf-trunc sf-muted" style="font-size:11.5px;margin-top:1px;">Ketuk putar atau pilih lagu</div>
          </div>
        </div>
        <button type="button" class="sf-icon-btn" id="sf-mini-like" aria-label="Suka">${SF.icons.heart(19, false)}</button>
        <button type="button" class="sf-mini-play-btn" id="sf-mini-play" aria-label="Putar/Jeda">${SF.icons.play(18)}</button>
        <button type="button" class="sf-icon-btn" id="sf-mini-next" aria-label="Berikutnya">${SF.icons.next(19)}</button>
      </div>
    `;

    mini.querySelector('#sf-mini-open').onclick = () => {
      if (!SF.store.state.currentTrack) {
        SF.audio.togglePlay();
        return;
      }
      player.openFullscreen();
    };
    mini.querySelector('#sf-mini-like').onclick = (e) => {
      e.stopPropagation();
      const t = SF.store.state.currentTrack;
      if (!t) return;
      const liked = SF.store.toggleLike(t);
      if (liked) {
        e.currentTarget.classList.add('sf-anim-heart');
        SF.ui.burstHeart(e.currentTarget);
        setTimeout(() => e.currentTarget.classList.remove('sf-anim-heart'), 450);
      }
      SF.utils.haptic(10);
    };
    mini.querySelector('#sf-mini-play').onclick = (e) => {
      e.stopPropagation();
      SF.utils.haptic(8);
      SF.audio.togglePlay();
    };
    mini.querySelector('#sf-mini-next').onclick = (e) => {
      e.stopPropagation();
      SF.utils.haptic(8);
      SF.audio.next(false);
    };

    // Swipe Left/Right on Mini-Player to Skip Next/Prev
    let sx = 0;
    let sy = 0;
    let swiping = false;
    mini.addEventListener('touchstart', (e) => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      swiping = true;
    }, { passive: true });
    mini.addEventListener('touchend', (e) => {
      if (!swiping) return;
      swiping = false;
      const dx = e.changedTouches[0].clientX - sx;
      const dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 35) {
        if (dx < 0) SF.audio.next(false);
        else SF.audio.prev();
        SF.utils.haptic(10);
      }
    }, { passive: true });
  }

  // =========================================================================
  // 2. FULLSCREEN CLEAN PLAYER + FULLSCREEN SYNCED LYRICS OVERLAY
  // =========================================================================
  function buildFullscreenDom() {
    const fs = document.getElementById('sf-fullscreen-player');
    if (!fs) return;
    fs.innerHTML = `
      <div class="sf-stage-hero" id="sf-stage-media-slot">
        <div id="sf-stage-cover-bg" style="position:absolute;inset:0;"></div>
        <div class="sf-stage-hero-fade"></div>
        <div style="position:relative;z-index:4;display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top, 0px) + 12px) 16px 0;">
          <button type="button" id="sf-fs-close" class="sf-icon-btn" style="background:rgba(0,0,0,0.34);color:#FFF;" aria-label="Tutup">${SF.icons.chevDown(22)}</button>
          <div style="text-align:center;flex:1;min-width:0;padding:0 10px;">
            <div style="font-size:10.5px;text-transform:uppercase;letter-spacing:0.12em;opacity:0.78;font-weight:700;">Sedang diputar</div>
            <div id="sf-fs-source" class="sf-trunc" style="font-size:13.5px;font-weight:900;font-style:italic;margin-top:1px;">SpotyFlow</div>
          </div>
          <button type="button" id="sf-fs-top-more" class="sf-icon-btn" style="background:rgba(0,0,0,0.34);color:#FFF;" aria-label="Menu">${SF.icons.more(20)}</button>
        </div>

        <div id="sf-av-switch-wrap" style="position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:5;">
          <div style="display:inline-flex;padding:3px;border-radius:999px;background:rgba(15,17,22,0.58);border:1px solid rgba(255,255,255,0.22);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);">
            <button type="button" id="sf-mode-audio" style="padding:6px 16px;border-radius:999px;font-size:12px;font-weight:800;">Audio</button>
            <button type="button" id="sf-mode-video" style="padding:6px 16px;border-radius:999px;font-size:12px;font-weight:800;">Video</button>
          </div>
        </div>
      </div>

      <div class="sf-stage-body">
        <div class="sf-row-between" style="gap:10px;">
          <div style="min-width:0;flex:1;">
            <div id="sf-fs-title" class="sf-trunc" style="font-size:22px;font-weight:900;letter-spacing:-0.02em;line-height:1.18;">Belum ada lagu</div>
            <button type="button" id="sf-fs-artist" class="sf-trunc" style="font-size:14.5px;font-weight:600;color:rgba(255,255,255,0.74);margin-top:3px;max-width:100%;text-align:left;">SpotyFlow</button>
          </div>
          <div class="sf-row-gap" style="gap:8px;">
            <button type="button" id="sf-fs-like" class="sf-icon-btn" style="width:42px;height:42px;background:rgba(255,255,255,0.12);color:#FFF;" aria-label="Suka">${SF.icons.heart(20, false)}</button>
            <button type="button" id="sf-fs-more" class="sf-icon-btn" style="width:42px;height:42px;background:rgba(255,255,255,0.12);color:#FFF;" aria-label="Opsi">${SF.icons.more(20)}</button>
          </div>
        </div>

        <button type="button" id="sf-fs-mini-lyric" style="text-align:left;padding:8px 12px;border-radius:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.10);color:rgba(255,255,255,0.9);font-size:13.5px;font-weight:700;min-height:38px;display:flex;align-items:center;">
          <span class="sf-trunc" id="sf-fs-mini-lyric-text" style="width:100%;">Ketuk untuk membuka Lirik Sinkron...</span>
        </button>

        <div>
          <input id="sf-fs-seek" class="sf-slider" type="range" min="0" max="1000" value="0" style="background:rgba(255,255,255,0.22);">
          <div class="sf-row-between" style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.68);margin-top:6px;">
            <span id="sf-fs-cur">0:00</span>
            <span id="sf-fs-rem">-0:00</span>
          </div>
        </div>

        <div class="sf-row-between" style="padding:2px 4px;">
          <button type="button" id="sf-fs-shuffle" class="sf-icon-btn" style="color:rgba(255,255,255,0.72);" aria-label="Acak">${SF.icons.shuffle(21)}</button>
          <button type="button" id="sf-fs-prev" class="sf-icon-btn" style="width:46px;height:46px;color:#FFF;" aria-label="Sebelumnya">${SF.icons.prev(28)}</button>
          <button type="button" id="sf-fs-play" style="width:68px;height:68px;border-radius:999px;background:#FFFFFF;color:#111215;display:flex;align-items:center;justify-content:center;box-shadow:0 12px 30px rgba(0,0,0,0.34);" aria-label="Putar/Jeda">${SF.icons.play(28)}</button>
          <button type="button" id="sf-fs-next" class="sf-icon-btn" style="width:46px;height:46px;color:#FFF;" aria-label="Berikutnya">${SF.icons.next(28)}</button>
          <button type="button" id="sf-fs-repeat" class="sf-icon-btn" style="color:rgba(255,255,255,0.72);" aria-label="Ulangi">${SF.icons.repeat(21)}</button>
        </div>

        <div class="sf-row-gap" style="gap:10px;">
          <span style="color:rgba(255,255,255,0.72);display:flex;">${SF.icons.volume(18)}</span>
          <input id="sf-fs-vol" class="sf-slider" type="range" min="0" max="100" value="85" style="flex:1;background:rgba(255,255,255,0.22);">
          <button type="button" id="sf-fs-output" class="sf-icon-btn" style="width:36px;height:36px;background:rgba(255,255,255,0.12);color:#FFF;" aria-label="Output Audio / Bluetooth">${SF.icons.bluetooth(17)}</button>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding-top:2px;">
          <button type="button" id="sf-fs-btn-lyrics" style="display:flex;flex-direction:column;align-items:center;gap:4px;color:rgba(255,255,255,0.85);font-size:11px;font-weight:700;">
            ${SF.icons.lyrics(20)}<span>Lirik</span>
          </button>
          <button type="button" id="sf-fs-btn-queue" style="display:flex;flex-direction:column;align-items:center;gap:4px;color:rgba(255,255,255,0.85);font-size:11px;font-weight:700;">
            ${SF.icons.queue(20)}<span>Antrean</span>
          </button>
          <button type="button" id="sf-fs-btn-share" style="display:flex;flex-direction:column;align-items:center;gap:4px;color:rgba(255,255,255,0.85);font-size:11px;font-weight:700;">
            ${SF.icons.share(20)}<span>Poster 3D</span>
          </button>
          <button type="button" id="sf-fs-btn-sleep" style="display:flex;flex-direction:column;align-items:center;gap:4px;color:rgba(255,255,255,0.85);font-size:11px;font-weight:700;">
            ${SF.icons.moon(20)}<span>Timer</span>
          </button>
        </div>
      </div>

      <!-- FULLSCREEN SYNCED LYRICS OVERLAY -->
      <div id="sf-lyrics-overlay">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top, 0px) + 12px) 16px 10px;border-bottom:1px solid rgba(255,255,255,0.12);">
          <div class="sf-row-gap" style="flex:1;min-width:0;">
            <button type="button" id="sf-lyr-close" class="sf-icon-btn" style="background:rgba(255,255,255,0.14);color:#FFF;">${SF.icons.chevDown(21)}</button>
            <div style="min-width:0;">
              <div id="sf-lyr-title" class="sf-trunc" style="font-size:15px;font-weight:900;">Lirik</div>
              <div id="sf-lyr-artist" class="sf-trunc" style="font-size:12px;opacity:0.78;">SpotyFlow</div>
            </div>
          </div>
          <button type="button" id="sf-lyr-poster" class="sf-pill-btn" style="background:rgba(255,255,255,0.16);color:#FFF;padding:7px 12px;font-size:12px;">Poster Lirik</button>
        </div>

        <div id="sf-lyrics-scroll"></div>

        <div style="padding:10px 14px calc(env(safe-area-inset-bottom, 0px) + 14px);border-top:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);">
          <div class="sf-scroll-x" style="gap:8px;">
            <button type="button" id="sf-lyr-translate" class="sf-chip" style="background:rgba(255,255,255,0.14);color:#FFF;border-color:rgba(255,255,255,0.16);font-size:12px;padding:7px 12px;">Terjemahkan</button>
            <button type="button" id="sf-lyr-romanize" class="sf-chip" style="display:none;background:rgba(255,255,255,0.14);color:#FFF;border-color:rgba(255,255,255,0.16);font-size:12px;padding:7px 12px;">Romaji</button>
            <button type="button" id="sf-lyr-off-minus" class="sf-chip" style="background:rgba(255,255,255,0.14);color:#FFF;border-color:rgba(255,255,255,0.16);font-size:12px;padding:7px 12px;">-0.5s</button>
            <span id="sf-lyr-off-val" style="display:inline-flex;align-items:center;font-size:12px;font-weight:800;opacity:0.85;padding:0 4px;">0.0s</span>
            <button type="button" id="sf-lyr-off-plus" class="sf-chip" style="background:rgba(255,255,255,0.14);color:#FFF;border-color:rgba(255,255,255,0.16);font-size:12px;padding:7px 12px;">+0.5s</button>
            <button type="button" id="sf-lyr-manual" class="sf-chip" style="background:rgba(255,255,255,0.14);color:#FFF;border-color:rgba(255,255,255,0.16);font-size:12px;padding:7px 12px;">Cari Manual</button>
          </div>
        </div>
      </div>
    `;

    // Close & Controls
    fs.querySelector('#sf-fs-close').onclick = () => player.closeFullscreen();
    fs.querySelector('#sf-fs-top-more').onclick = () => SF.ui.openTrackMenu(SF.store.state.currentTrack);
    fs.querySelector('#sf-fs-more').onclick = () => SF.ui.openTrackMenu(SF.store.state.currentTrack);
    fs.querySelector('#sf-fs-artist').onclick = () => {
      const t = SF.store.state.currentTrack;
      if (!t) return;
      player.closeFullscreen();
      SF.views.openArtistProfile(t.artist, t.artistId || '');
    };
    fs.querySelector('#sf-fs-like').onclick = (e) => {
      const t = SF.store.state.currentTrack;
      if (!t) return;
      const liked = SF.store.toggleLike(t);
      if (liked) {
        e.currentTarget.classList.add('sf-anim-heart');
        SF.ui.burstHeart(e.currentTarget);
        setTimeout(() => e.currentTarget.classList.remove('sf-anim-heart'), 450);
      }
      SF.utils.haptic(10);
    };
    fs.querySelector('#sf-fs-mini-lyric').onclick = () => player.openLyrics();

    fs.querySelector('#sf-mode-audio').onclick = () => SF.audio.setVideoMode(false);
    fs.querySelector('#sf-mode-video').onclick = () => SF.audio.setVideoMode(true);

    const seek = fs.querySelector('#sf-fs-seek');
    seek.addEventListener('pointerdown', () => { isSeeking = true; });
    seek.addEventListener('input', () => {
      const dur = SF.store.state.duration || 0;
      const target = (Number(seek.value) / 1000) * dur;
      fs.querySelector('#sf-fs-cur').textContent = SF.utils.formatTime(target);
      fs.querySelector('#sf-fs-rem').textContent = SF.utils.formatRemaining(target, dur);
    });
    const commitSeek = () => {
      if (!isSeeking) return;
      isSeeking = false;
      const dur = SF.store.state.duration || 0;
      SF.audio.seekTo((Number(seek.value) / 1000) * dur);
    };
    seek.addEventListener('pointerup', commitSeek);
    seek.addEventListener('change', commitSeek);

    fs.querySelector('#sf-fs-play').onclick = () => {
      SF.utils.haptic(8);
      SF.audio.togglePlay();
    };
    fs.querySelector('#sf-fs-prev').onclick = () => { SF.utils.haptic(8); SF.audio.prev(); };
    fs.querySelector('#sf-fs-next').onclick = () => { SF.utils.haptic(8); SF.audio.next(false); };
    fs.querySelector('#sf-fs-shuffle').onclick = () => {
      const s = SF.store.toggleShuffle();
      SF.ui.toast(s ? 'Mode Acak Aktif' : 'Mode Acak Mati');
      syncPlaybackUi();
    };
    fs.querySelector('#sf-fs-repeat').onclick = () => {
      const r = SF.store.cycleRepeat();
      const labels = { off: 'Ulangi Mati', all: 'Ulangi Semua', one: 'Ulangi Satu Lagu' };
      SF.ui.toast(labels[r] || 'Ulangi');
      syncPlaybackUi();
    };

    const vol = fs.querySelector('#sf-fs-vol');
    vol.value = Math.round((SF.store.state.volume ?? 0.85) * 100);
    vol.addEventListener('input', () => {
      SF.audio.setVolume(Number(vol.value) / 100);
    });
    fs.querySelector('#sf-fs-output').onclick = () => {
      const br = SF.utils.getBridge();
      if (br && typeof br.openAudioOutputPicker === 'function') {
        try { br.openAudioOutputPicker(); } catch {}
      } else {
        SF.ui.toast('Output audio: Speaker / Perangkat Sistem');
      }
    };

    // 4 Bottom Action Buttons
    fs.querySelector('#sf-fs-btn-lyrics').onclick = () => player.openLyrics();
    fs.querySelector('#sf-fs-btn-queue').onclick = () => openQueueSheet();
    fs.querySelector('#sf-fs-btn-share').onclick = () => openSharePosterChoice();
    fs.querySelector('#sf-fs-btn-sleep').onclick = () => openSleepTimerSheet();

    // Lyrics Overlay Controls
    fs.querySelector('#sf-lyr-close').onclick = () => player.closeLyrics();
    const lyrScroll = fs.querySelector('#sf-lyrics-scroll');
    lyrScroll.addEventListener('touchstart', () => { manualLyricScrollUntil = Date.now() + 3200; }, { passive: true });
    lyrScroll.addEventListener('wheel', () => { manualLyricScrollUntil = Date.now() + 3200; }, { passive: true });

    fs.querySelector('#sf-lyr-translate').onclick = async () => {
      SF.ui.toast('Menerjemahkan lirik...');
      await SF.lyrics.toggleTranslation();
    };
    fs.querySelector('#sf-lyr-romanize').onclick = async () => {
      SF.ui.toast('Memuat romanisasi...');
      await SF.lyrics.toggleRomanization();
    };
    fs.querySelector('#sf-lyr-off-minus').onclick = () => {
      const v = SF.lyrics.setOffset(-0.5);
      fs.querySelector('#sf-lyr-off-val').textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + 's';
    };
    fs.querySelector('#sf-lyr-off-plus').onclick = () => {
      const v = SF.lyrics.setOffset(0.5);
      fs.querySelector('#sf-lyr-off-val').textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + 's';
    };
    fs.querySelector('#sf-lyr-manual').onclick = openManualLyricsModal;
    fs.querySelector('#sf-lyr-poster').onclick = () => {
      player.closeFullscreen();
      if (SF.poster3d && typeof SF.poster3d.open === 'function') {
        SF.poster3d.open(SF.store.state.currentTrack);
      }
    };

    // Swipe-Down Gesture on Hero to Close Fullscreen (Axis-Locked)
    const hero = fs.querySelector('.sf-stage-hero');
    let sy = 0;
    let sx = 0;
    let sw = false;
    hero.addEventListener('touchstart', (e) => {
      if (lyricsOpen) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
      sw = true;
    }, { passive: true });
    hero.addEventListener('touchend', (e) => {
      if (!sw) return;
      sw = false;
      const dy = e.changedTouches[0].clientY - sy;
      const dx = Math.abs(e.changedTouches[0].clientX - sx);
      if (dy > 80 && dx < 60) player.closeFullscreen();
    }, { passive: true });
  }

  // =========================================================================
  // 3. QUEUE, SLEEP TIMER, SHARE/POSTER & MANUAL LYRICS SHEETS
  // =========================================================================
  function openQueueSheet() {
    const st = SF.store.state;
    const queue = st.queue || [];
    SF.ui.openModal(
      `
      <div class="sf-row-between" style="margin-bottom:12px;">
        <div>
          <b style="font-size:17px;">Antrean (${queue.length})</b>
          <div class="sf-muted" style="font-size:12px;">${esc(st.sourceLabel || 'SpotyFlow')}</div>
        </div>
        <div class="sf-row-gap">
          <button type="button" class="sf-pill-btn soft" id="sf-q-shuf" style="padding:7px 11px;font-size:12px;">Acak</button>
          <button type="button" class="sf-pill-btn soft" id="sf-q-clear" style="padding:7px 11px;font-size:12px;">Bersihkan</button>
          <button type="button" class="sf-icon-btn" id="sf-q-close">${SF.icons.close(18)}</button>
        </div>
      </div>
      <div class="sf-stack" style="gap:4px;" id="sf-q-items">
        ${queue.length ? queue.map((t, i) => `
          <div class="sf-track-row" data-qi="${i}" style="${i === st.queueIndex ? 'background:var(--accent-soft);' : ''}">
            ${SF.ui.renderArtHtml(t, 44, 10, t.title)}
            <div style="flex:1;min-width:0;">
              <div class="sf-trunc" style="font-size:13.5px;font-weight:800;color:${i === st.queueIndex ? 'var(--accent)' : 'var(--text)'};">${esc(t.title)}</div>
              <div class="sf-trunc sf-muted" style="font-size:11.5px;">${esc(t.artist)}</div>
            </div>
            <button type="button" class="sf-icon-btn sf-q-rm" data-rm="${i}" aria-label="Hapus">${SF.icons.close(16)}</button>
          </div>
        `).join('') : '<div class="sf-muted" style="text-align:center;padding:24px;">Antrean kosong.</div>'}
      </div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-q-close').onclick = SF.ui.closeModal;
        sheet.querySelector('#sf-q-clear').onclick = () => {
          SF.store.clearQueue();
          SF.ui.closeModal();
          SF.ui.toast('Antrean dibersihkan');
        };
        sheet.querySelector('#sf-q-shuf').onclick = () => {
          if (queue.length < 2) return;
          const cur = queue[st.queueIndex];
          const rest = queue.filter((_, idx) => idx !== st.queueIndex).sort(() => Math.random() - 0.5);
          SF.store.setQueue(cur ? [cur, ...rest] : rest, 0, st.sourceLabel);
          SF.ui.closeModal();
          openQueueSheet();
        };
        sheet.querySelectorAll('[data-qi]').forEach((row) => {
          row.onclick = (e) => {
            if (e.target.closest('.sf-q-rm')) return;
            const i = parseInt(row.getAttribute('data-qi'), 10);
            if (queue[i]) {
              SF.audio.playTrack(queue[i], queue, i, st.sourceLabel);
              SF.ui.closeModal();
            }
          };
        });
        sheet.querySelectorAll('.sf-q-rm').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            const i = parseInt(btn.getAttribute('data-rm'), 10);
            SF.store.removeFromQueue(i);
            SF.ui.closeModal();
            openQueueSheet();
          };
        });
      }
    );
  }

  function openSleepTimerSheet() {
    const sl = SF.audio.getSleepState();
    const prefs = SF.store.state.prefs;
    const remMin = sl.active && sl.endAt ? Math.max(1, Math.ceil((sl.endAt - Date.now()) / 60000)) : 0;
    SF.ui.openModal(
      `
      <div class="sf-row-between" style="margin-bottom:12px;">
        <div>
          <b style="font-size:17px;">Timer Tidur</b>
          <div class="sf-muted" style="font-size:12px;">${sl.active ? (sl.stopAtTrackEnd ? 'Berhenti di akhir lagu ini' : `Aktif • ~${remMin} menit lagi`) : 'Tidak aktif'}</div>
        </div>
        <button type="button" class="sf-icon-btn" id="sf-sl-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-grid-2" style="margin-bottom:12px;">
        ${[15, 30, 45, 60].map((m) => `<button type="button" class="sf-card-soft" data-slm="${m}" style="padding:14px;font-weight:800;font-size:14px;">${m} Menit</button>`).join('')}
      </div>
      <button type="button" class="sf-card-soft sf-list-row" id="sf-sl-end" style="border-radius:16px;margin-bottom:10px;">
        <b>Berhenti di akhir lagu saat ini</b>${SF.icons.moon(18)}
      </button>
      <div class="sf-list-row" style="padding:10px 4px;">
        <div><b>Memudar perlahan</b><div class="sf-muted" style="font-size:12px;">Turunkan volume 8 detik sebelum berhenti</div></div>
        <button type="button" class="sf-switch ${prefs.sleepTimerFadeOut ? 'on' : ''}" id="sf-sl-fade"></button>
      </div>
      ${sl.active ? `<button type="button" class="sf-pill-btn soft" id="sf-sl-cancel" style="width:100%;margin-top:10px;">Batalkan Timer Tidur</button>` : ''}
      `,
      (sheet) => {
        sheet.querySelector('#sf-sl-close').onclick = SF.ui.closeModal;
        sheet.querySelectorAll('[data-slm]').forEach((b) => {
          b.onclick = () => {
            const m = parseInt(b.getAttribute('data-slm'), 10);
            SF.audio.startSleepTimer({ minutes: m, stopAtTrackEnd: false, fadeOut: SF.store.state.prefs.sleepTimerFadeOut });
            SF.ui.closeModal();
            SF.ui.toast(`Timer tidur ${m} menit aktif`);
          };
        });
        sheet.querySelector('#sf-sl-end').onclick = () => {
          SF.audio.startSleepTimer({ minutes: 0, stopAtTrackEnd: true, fadeOut: SF.store.state.prefs.sleepTimerFadeOut });
          SF.ui.closeModal();
          SF.ui.toast('Musik berhenti di akhir lagu ini');
        };
        sheet.querySelector('#sf-sl-fade').onclick = (e) => {
          const next = !SF.store.state.prefs.sleepTimerFadeOut;
          SF.store.setPref('sleepTimerFadeOut', next);
          e.currentTarget.classList.toggle('on', next);
        };
        const cancel = sheet.querySelector('#sf-sl-cancel');
        if (cancel) cancel.onclick = () => {
          SF.audio.cancelSleepTimer();
          SF.ui.closeModal();
          SF.ui.toast('Timer tidur dibatalkan');
        };
      }
    );
  }

  function openSharePosterChoice() {
    const t = SF.store.state.currentTrack;
    if (!t) return;
    SF.ui.openModal(
      `
      <div class="sf-row-between" style="margin-bottom:10px;">
        <b style="font-size:17px;">Bagikan & Poster 3D</b>
        <button type="button" class="sf-icon-btn" id="sf-sp-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-stack" style="gap:8px;">
        <button type="button" class="sf-card-soft sf-list-row" id="sf-sp-3d" style="border-radius:16px;">
          <span class="sf-row-gap">${SF.icons.layers(20)} <div><b>Poster Lagu 3D Depth Effect</b><div class="sf-muted" style="font-size:12px;">1–5 lagu, AI Depth di belakang foto, Full HD</div></div></span>
          ${SF.icons.chevRight(18)}
        </button>
        <button type="button" class="sf-card-soft sf-list-row" id="sf-sp-link" style="border-radius:16px;">
          <span class="sf-row-gap">${SF.icons.share(20)} <div><b>Bagikan Tautan Lagu</b><div class="sf-muted" style="font-size:12px;">${esc(t.title)} — ${esc(t.artist)}</div></div></span>
          ${SF.icons.chevRight(18)}
        </button>
      </div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-sp-close').onclick = SF.ui.closeModal;
        sheet.querySelector('#sf-sp-3d').onclick = () => {
          SF.ui.closeModal();
          player.closeFullscreen();
          if (SF.poster3d && typeof SF.poster3d.open === 'function') SF.poster3d.open(t);
        };
        sheet.querySelector('#sf-sp-link').onclick = () => {
          SF.ui.closeModal();
          const url = `https://spotyflow.vercel.app/?q=${encodeURIComponent(t.title + ' ' + t.artist)}`;
          if (navigator.share) navigator.share({ title: t.title, text: `${t.title} — ${t.artist}`, url }).catch(() => {});
          else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => SF.ui.toast('Tautan disalin'));
        };
      }
    );
  }

  function openManualLyricsModal() {
    const t = SF.store.state.currentTrack || { title: '', artist: '' };
    SF.ui.openModal(
      `
      <div class="sf-row-between" style="margin-bottom:12px;">
        <b style="font-size:17px;">Cari Lirik Manual</b>
        <button type="button" class="sf-icon-btn" id="sf-ml-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-stack" style="gap:10px;">
        <input id="sf-ml-title" type="text" value="${esc(t.title)}" placeholder="Judul lagu..." style="width:100%;padding:11px 13px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:14px;outline:none;">
        <input id="sf-ml-artist" type="text" value="${esc(t.artist)}" placeholder="Nama artis..." style="width:100%;padding:11px 13px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:14px;outline:none;">
        <button type="button" class="sf-pill-btn accent" id="sf-ml-go">Cari Lirik</button>
      </div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-ml-close').onclick = SF.ui.closeModal;
        sheet.querySelector('#sf-ml-go').onclick = async () => {
          const title = sheet.querySelector('#sf-ml-title').value.trim();
          const artist = sheet.querySelector('#sf-ml-artist').value.trim();
          if (!title) return SF.ui.toast('Masukkan judul lagu');
          SF.ui.closeModal();
          SF.ui.toast('Mencari lirik...');
          await SF.lyrics.searchManual(title, artist);
        };
      }
    );
  }

  // =========================================================================
  // 4. LIVE SYNC RENDERERS (BUS SUBSCRIBERS — 0% DESYNC!)
  // =========================================================================
  function syncTrackUi() {
    const st = SF.store.state;
    const t = st.currentTrack;
    updateStageColor(t);

    const miniArt = document.getElementById('sf-mini-art');
    const miniTitle = document.getElementById('sf-mini-title');
    const miniArtist = document.getElementById('sf-mini-artist');
    if (miniArt) miniArt.innerHTML = SF.ui.renderArtHtml(t || '', 44, 999, t?.title || 'SpotyFlow');
    if (miniTitle) miniTitle.textContent = t ? t.title : 'Siap Memutar';
    if (miniArtist) miniArtist.textContent = t ? t.artist : 'Ketuk putar atau pilih lagu';

    const fsTitle = document.getElementById('sf-fs-title');
    const fsArtist = document.getElementById('sf-fs-artist');
    const fsSource = document.getElementById('sf-fs-source');
    const fsCover = document.getElementById('sf-stage-cover-bg');
    const lyrTitle = document.getElementById('sf-lyr-title');
    const lyrArtist = document.getElementById('sf-lyr-artist');

    if (fsTitle) fsTitle.textContent = t ? t.title : 'Belum ada lagu';
    if (fsArtist) fsArtist.textContent = t ? t.artist : 'SpotyFlow';
    if (fsSource) fsSource.textContent = st.sourceLabel || 'SpotyFlow';
    if (lyrTitle) lyrTitle.textContent = t ? t.title : 'Lirik';
    if (lyrArtist) lyrArtist.textContent = t ? t.artist : 'SpotyFlow';

    if (fsCover) {
      const url = SF.utils.getCoverUrl(t);
      const pal = SF.utils.getPalette(t?.title || 'SpotyFlow');
      fsCover.style.background = `linear-gradient(135deg, ${pal[0]}, ${pal[1]})`;
      fsCover.innerHTML = url
        ? `<img src="${esc(url)}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.remove()">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.85);">${SF.icons.music(72)}</div>`;
    }

    syncLikeUi();
    syncPlaybackUi();
  }

  function syncLikeUi() {
    const t = SF.store.state.currentTrack;
    const liked = t ? SF.store.isLiked(t.id) : false;
    const mLike = document.getElementById('sf-mini-like');
    const fLike = document.getElementById('sf-fs-like');
    if (mLike) mLike.innerHTML = SF.icons.heart(19, liked);
    if (fLike) fLike.innerHTML = SF.icons.heart(20, liked);
  }

  function syncPlaybackUi() {
    const st = SF.store.state;
    const mPlay = document.getElementById('sf-mini-play');
    const fPlay = document.getElementById('sf-fs-play');
    if (mPlay) mPlay.innerHTML = st.isPlaying ? SF.icons.pause(18) : SF.icons.play(18);
    if (fPlay) fPlay.innerHTML = st.isPlaying ? SF.icons.pause(28) : SF.icons.play(28);

    const shBtn = document.getElementById('sf-fs-shuffle');
    const rpBtn = document.getElementById('sf-fs-repeat');
    if (shBtn) shBtn.style.color = st.shuffle ? 'var(--accent)' : 'rgba(255,255,255,0.72)';
    if (rpBtn) rpBtn.style.color = st.repeat !== 'off' ? 'var(--accent)' : 'rgba(255,255,255,0.72)';

    const avWrap = document.getElementById('sf-av-switch-wrap');
    if (avWrap) avWrap.style.display = st.prefs.videoModeEnabled === false ? 'none' : 'block';

    const aBtn = document.getElementById('sf-mode-audio');
    const vBtn = document.getElementById('sf-mode-video');
    if (aBtn && vBtn) {
      const vm = Boolean(st.videoMode);
      aBtn.style.background = !vm ? '#FFFFFF' : 'transparent';
      aBtn.style.color = !vm ? '#111215' : 'rgba(255,255,255,0.78)';
      vBtn.style.background = vm ? '#FFFFFF' : 'transparent';
      vBtn.style.color = vm ? '#111215' : 'rgba(255,255,255,0.78)';
    }

    const miniLyr = document.getElementById('sf-fs-mini-lyric');
    if (miniLyr) miniLyr.style.display = st.prefs.miniLyricsInPlayer === false ? 'none' : 'flex';
  }

  function syncTimeUi(cur, dur) {
    const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
    const fill = document.getElementById('sf-mini-progress-fill');
    if (fill) fill.style.transform = `scaleX(${ratio.toFixed(4)})`;

    if (!isSeeking) {
      const seek = document.getElementById('sf-fs-seek');
      const curEl = document.getElementById('sf-fs-cur');
      const remEl = document.getElementById('sf-fs-rem');
      if (seek) seek.value = Math.round(ratio * 1000);
      if (curEl) curEl.textContent = SF.utils.formatTime(cur);
      if (remEl) remEl.textContent = SF.utils.formatRemaining(cur, dur);
    }
  }

  function renderLyricsList(lyrState) {
    const scroll = document.getElementById('sf-lyrics-scroll');
    const miniText = document.getElementById('sf-fs-mini-lyric-text');
    const romBtn = document.getElementById('sf-lyr-romanize');
    const trBtn = document.getElementById('sf-lyr-translate');
    const offVal = document.getElementById('sf-lyr-off-val');
    if (!scroll) return;

    const prefs = SF.store.state.prefs;
    if (offVal) {
      const o = Number(prefs.lyricsOffsetSec || 0);
      offVal.textContent = (o >= 0 ? '+' : '') + o.toFixed(1) + 's';
    }
    if (romBtn) romBtn.style.display = SF.lyrics.hasNonLatin() ? 'inline-flex' : 'none';
    if (trBtn) trBtn.style.background = lyrState.showTranslation ? 'var(--accent)' : 'rgba(255,255,255,0.14)';
    if (trBtn) trBtn.style.color = lyrState.showTranslation ? '#05130A' : '#FFFFFF';
    if (romBtn) romBtn.style.background = lyrState.showRomanization ? 'var(--accent)' : 'rgba(255,255,255,0.14)';
    if (romBtn) romBtn.style.color = lyrState.showRomanization ? '#05130A' : '#FFFFFF';

    if (lyrState.status === 'loading') {
      scroll.innerHTML = `<div style="padding:60px 10px;text-align:center;font-size:17px;font-weight:800;opacity:0.8;">Mencari lirik sinkron...</div>`;
      if (miniText) miniText.textContent = 'Mencari lirik sinkron...';
      return;
    }

    if (!lyrState.lines || !lyrState.lines.length) {
      scroll.innerHTML = `
        <div style="padding:60px 12px;text-align:center;">
          <div style="font-size:18px;font-weight:900;">Lirik belum ditemukan</div>
          <div style="font-size:13.5px;opacity:0.75;margin-top:6px;">Ketuk <b>Cari Manual</b> di bawah untuk mencari dengan judul/artis berbeda.</div>
        </div>
      `;
      if (miniText) miniText.textContent = 'Lirik belum tersedia • Ketuk untuk Cari Manual';
      return;
    }

    const blurCls = prefs.blurOtherLyricLines ? 'blur-inactive' : '';
    const align = prefs.lyricsCenterAlign ? 'center' : 'left';
    const fontScale = Number(prefs.lyricsFontSize || 23);

    scroll.innerHTML = lyrState.lines.map((line, i) => {
      const tr = lyrState.showTranslation && lyrState.translated?.[i] ? `<div class="sf-lyric-sub">${esc(lyrState.translated[i])}</div>` : '';
      const rm = lyrState.showRomanization && lyrState.romanized?.[i] ? `<div class="sf-lyric-sub" style="font-style:italic;">${esc(lyrState.romanized[i])}</div>` : '';
      return `
        <div class="sf-lyric-line ${blurCls} ${i === lyrState.activeIndex ? 'active' : ''}" data-li="${i}" style="text-align:${align};font-size:${fontScale}px;">
          <div>${esc(line.text)}</div>
          ${rm}${tr}
        </div>
      `;
    }).join('');

    scroll.querySelectorAll('.sf-lyric-line').forEach((el) => {
      el.onclick = () => {
        const idx = parseInt(el.getAttribute('data-li'), 10);
        SF.lyrics.seekToLine(idx);
        SF.utils.haptic(8);
      };
    });

    const curLine = lyrState.lines[Math.max(0, lyrState.activeIndex)];
    if (miniText && curLine) miniText.textContent = curLine.text;
  }

  function highlightActiveLyric(index, line) {
    const miniText = document.getElementById('sf-fs-mini-lyric-text');
    if (miniText && line?.text) miniText.textContent = line.text;

    const scroll = document.getElementById('sf-lyrics-scroll');
    if (!scroll) return;
    scroll.querySelectorAll('.sf-lyric-line.active').forEach((el) => el.classList.remove('active'));
    const activeEl = scroll.querySelector(`.sf-lyric-line[data-li="${index}"]`);
    if (activeEl) {
      activeEl.classList.add('active');
      if (lyricsOpen && Date.now() > manualLyricScrollUntil) {
        const top = activeEl.offsetTop - scroll.clientHeight * 0.38;
        scroll.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      }
    }
  }

  const player = {
    init() {
      buildMiniPlayerDom();
      buildFullscreenDom();

      SF.bus.on('track:change', syncTrackUi);
      SF.bus.on('playback:state', syncPlaybackUi);
      SF.bus.on('like:change', syncLikeUi);
      SF.bus.on('pref:change', syncPlaybackUi);
      SF.bus.on('playback:time', ({ currentTime, duration }) => syncTimeUi(currentTime, duration));
      SF.bus.on('lyrics:update', (st) => renderLyricsList(st));
      SF.bus.on('lyrics:line', ({ index, line }) => highlightActiveLyric(index, line));

      syncTrackUi();
      syncTimeUi(SF.store.state.currentTime || 0, SF.store.state.duration || 0);
    },

    openFullscreen() {
      fullscreenOpen = true;
      const fs = document.getElementById('sf-fullscreen-player');
      if (fs) fs.classList.add('open');
      if (SF.store.state.prefs.keepScreenOnPlayer) {
        try { SF.utils.getBridge()?.setKeepScreenOn?.(true); } catch {}
      }
      setTimeout(() => SF.bus.emit('stage:layout'), 390);
    },

    closeFullscreen() {
      fullscreenOpen = false;
      player.closeLyrics();
      const fs = document.getElementById('sf-fullscreen-player');
      if (fs) fs.classList.remove('open');
      try { SF.utils.getBridge()?.setKeepScreenOn?.(false); } catch {}
      SF.bus.emit('stage:layout');
    },

    openLyrics() {
      lyricsOpen = true;
      const ov = document.getElementById('sf-lyrics-overlay');
      if (ov) ov.classList.add('open');
      renderLyricsList(SF.lyrics.getState());
    },

    closeLyrics() {
      lyricsOpen = false;
      const ov = document.getElementById('sf-lyrics-overlay');
      if (ov) ov.classList.remove('open');
    },

    isFullscreenOpen() {
      return fullscreenOpen;
    },

    openQueueSheet,
    openSleepTimerSheet,
  };

  SF.player = player;
})();
