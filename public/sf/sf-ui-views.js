(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});

  // =========================================================================
  // 1. REUSABLE UI PRIMITIVES (SF.ui: Toast, Modal, Subpage Stack, Cover Art)
  // =========================================================================
  const subpageStack = [];
  let activeModalClose = null;

  function esc(v) {
    return SF.utils.escapeHtml(v);
  }

  function renderArtHtml(trackOrUrl, sizePx, radiusPx, seedText, extraStyle = '') {
    const url = typeof trackOrUrl === 'string' ? trackOrUrl : SF.utils.getCoverUrl(trackOrUrl);
    const seed = seedText || (typeof trackOrUrl === 'object' ? trackOrUrl?.title || trackOrUrl?.name : 'SpotyFlow');
    const pal = SF.utils.getPalette(seed);
    const iconSize = Math.max(16, Math.round(sizePx * 0.42));
    const safeUrl = url ? esc(url) : '';
    return `
      <div class="sf-art" style="width:${sizePx}px;height:${sizePx}px;border-radius:${radiusPx}px;background:linear-gradient(135deg,${pal[0]},${pal[1]});${extraStyle}">
        ${SF.icons.music(iconSize)}
        ${safeUrl ? `<img src="${safeUrl}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}
      </div>
    `;
  }

  function toast(msg, durationMs = 2400) {
    const root = document.getElementById('sf-toast-root');
    if (!root || !msg) return;
    const pill = document.createElement('div');
    pill.className = 'sf-toast-pill';
    pill.textContent = String(msg);
    root.innerHTML = '';
    root.appendChild(pill);
    setTimeout(() => {
      if (pill.parentNode) pill.remove();
    }, durationMs);
  }

  function burstHeart(originEl) {
    if (!originEl) return;
    const rect = originEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = ['#EF4444', '#F97316', '#EC4899', '#F43F5E', '#FB7185', '#FBBF24'];
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI * 2 * i) / 6 + (Math.random() * 0.35 - 0.17);
      const dist = 18 + Math.random() * 14;
      const dot = document.createElement('span');
      dot.className = 'sf-heart-particle';
      dot.style.left = `${cx}px`;
      dot.style.top = `${cy}px`;
      dot.style.background = colors[i % colors.length];
      dot.style.setProperty('--dx', `${(Math.cos(ang) * dist).toFixed(1)}px`);
      dot.style.setProperty('--dy', `${(Math.sin(ang) * dist).toFixed(1)}px`);
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 560);
    }
  }

  function openModal(html, onBind, onClose) {
    const root = document.getElementById('sf-modal-root');
    if (!root) return;
    activeModalClose = typeof onClose === 'function' ? onClose : null;
    root.innerHTML = `<div class="sf-modal-sheet" role="dialog" aria-modal="true">${html}</div>`;
    root.classList.add('open');
    root.onclick = (e) => {
      if (e.target === root) closeModal();
    };
    const sheet = root.querySelector('.sf-modal-sheet');
    if (typeof onBind === 'function' && sheet) {
      try { onBind(sheet); } catch (err) { console.warn('[SF.ui.modal]', err); }
    }
  }

  function closeModal() {
    const root = document.getElementById('sf-modal-root');
    if (!root) return;
    root.classList.remove('open');
    root.innerHTML = '';
    if (activeModalClose) {
      const fn = activeModalClose;
      activeModalClose = null;
      try { fn(); } catch {}
    }
  }

  function renderSubpageTop() {
    const root = document.getElementById('sf-subpage-root');
    if (!root) return;
    const top = subpageStack[subpageStack.length - 1];
    if (!top) {
      root.classList.remove('open');
      root.innerHTML = '';
      return;
    }
    root.innerHTML = `
      <div class="sf-sub-header">
        <div class="sf-row-gap" style="flex:1;min-width:0;">
          <button type="button" class="sf-icon-btn" id="sf-sub-back" aria-label="Kembali">${SF.icons.chevLeft(22)}</button>
          <div class="sf-trunc" style="font-size:17px;font-weight:800;">${esc(top.title)}</div>
        </div>
        <div class="sf-row-gap" id="sf-sub-actions">${top.actionsHtml || ''}</div>
      </div>
      <div class="sf-sub-scroll" id="sf-sub-body">${top.bodyHtml || ''}</div>
    `;
    root.classList.add('open');
    const backBtn = root.querySelector('#sf-sub-back');
    if (backBtn) backBtn.onclick = () => closeSubpage();
    if (typeof top.onBind === 'function') {
      try { top.onBind(root.querySelector('#sf-sub-body'), root); } catch (err) { console.warn('[SF.ui.subpage]', err); }
    }
  }

  function openSubpage(opts) {
    subpageStack.push({
      id: opts.id || 'sub-' + Date.now(),
      title: opts.title || 'SpotyFlow',
      actionsHtml: opts.actionsHtml || '',
      bodyHtml: opts.bodyHtml || '',
      onBind: opts.onBind || null,
      onClose: opts.onClose || null,
    });
    renderSubpageTop();
  }

  function replaceSubpage(opts) {
    if (subpageStack.length) {
      const prev = subpageStack.pop();
      if (prev && typeof prev.onClose === 'function') {
        try { prev.onClose(); } catch {}
      }
    }
    openSubpage(opts);
  }

  function closeSubpage() {
    const popped = subpageStack.pop();
    if (popped && typeof popped.onClose === 'function') {
      try { popped.onClose(); } catch {}
    }
    renderSubpageTop();
  }

  function closeAllSubpages() {
    while (subpageStack.length) {
      const p = subpageStack.pop();
      if (p && typeof p.onClose === 'function') {
        try { p.onClose(); } catch {}
      }
    }
    renderSubpageTop();
  }

  function openTrackMenu(rawTrack) {
    const track = SF.utils.normalizeTrack(rawTrack);
    if (!track) return;
    const liked = SF.store.isLiked(track.id);
    const offline = SF.store.isOffline(track.id);
    const pal = SF.utils.getPalette(track.title);
    openModal(
      `
      <div class="sf-row-gap" style="padding-bottom:14px;border-bottom:1px solid var(--border);margin-bottom:8px;">
        ${renderArtHtml(track, 50, 14, track.title)}
        <div style="min-width:0;flex:1;">
          <div class="sf-trunc" style="font-size:15px;font-weight:800;">${esc(track.title)}</div>
          <div class="sf-trunc sf-muted" style="font-size:12.5px;">${esc(track.artist)}</div>
        </div>
        <button type="button" class="sf-icon-btn" id="sf-tm-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-stack" style="gap:2px;">
        <button type="button" class="sf-list-row" data-act="next"><span class="sf-row-gap">${SF.icons.queue(19)} <b>Putar Berikutnya</b></span></button>
        <button type="button" class="sf-list-row" data-act="queue"><span class="sf-row-gap">${SF.icons.plus(19)} <b>Tambah ke Antrean</b></span></button>
        <button type="button" class="sf-list-row" data-act="like"><span class="sf-row-gap">${SF.icons.heart(19, liked)} <b>${liked ? 'Hapus dari Disukai' : 'Tambahkan ke Disukai'}</b></span></button>
        <button type="button" class="sf-list-row" data-act="playlist"><span class="sf-row-gap">${SF.icons.library(19)} <b>Tambah ke Playlist</b></span></button>
        <button type="button" class="sf-list-row" data-act="artist"><span class="sf-row-gap">${SF.icons.user(19)} <b>Lihat Profil Artis</b></span></button>
        <button type="button" class="sf-list-row" data-act="radio"><span class="sf-row-gap">${SF.icons.radio(19)} <b>Mulai Radio Lagu Serupa</b></span></button>
        <button type="button" class="sf-list-row" data-act="offline"><span class="sf-row-gap">${SF.icons.download(19)} <b>${offline ? 'Hapus Unduhan Offline' : 'Unduh Offline (APK)'}</b></span></button>
        <button type="button" class="sf-list-row" data-act="poster"><span class="sf-row-gap">${SF.icons.layers(19)} <b>Buat Poster Lagu 3D</b></span></button>
        <button type="button" class="sf-list-row" data-act="share"><span class="sf-row-gap">${SF.icons.share(19)} <b>Bagikan Lagu</b></span></button>
      </div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-tm-close').onclick = closeModal;
        sheet.querySelectorAll('[data-act]').forEach((btn) => {
          btn.onclick = async () => {
            const act = btn.getAttribute('data-act');
            closeModal();
            if (act === 'next') {
              SF.store.addToQueue(track, true);
              toast('Akan diputar berikutnya');
            } else if (act === 'queue') {
              SF.store.addToQueue(track, false);
              toast('Ditambahkan ke antrean');
            } else if (act === 'like') {
              const nowLiked = SF.store.toggleLike(track);
              toast(nowLiked ? 'Ditambahkan ke Disukai' : 'Dihapus dari Disukai');
            } else if (act === 'playlist') {
              openAddToPlaylistModal(track);
            } else if (act === 'artist') {
              views.openArtistProfile(track.artist, track.artistId || '');
            } else if (act === 'radio') {
              toast('Menyiapkan Radio...');
              const sim = await SF.api.getSimilarTracks(track);
              if (sim.length) {
                SF.audio.playTrack(track, [track, ...sim], 0, `Radio • ${track.artist}`);
              } else {
                toast('Lagu serupa belum ditemukan');
              }
            } else if (act === 'offline') {
              if (offline) {
                SF.store.removeOfflineTrack(track.id);
                toast('Unduhan offline dihapus');
              } else {
                const ok = SF.store.requestOfflineDownload(track);
                toast(ok ? 'Mengunduh lagu ke penyimpanan APK...' : 'Tersimpan di daftar offline');
              }
            } else if (act === 'poster') {
              if (SF.poster3d && typeof SF.poster3d.open === 'function') {
                SF.poster3d.open(track);
              }
            } else if (act === 'share') {
              const shareText = `${track.title} — ${track.artist} di SpotyFlow`;
              const shareUrl = `https://spotyflow.vercel.app/?q=${encodeURIComponent(track.title + ' ' + track.artist)}`;
              if (navigator.share) {
                navigator.share({ title: track.title, text: shareText, url: shareUrl }).catch(() => {});
              } else if (navigator.clipboard) {
                navigator.clipboard.writeText(`${shareText}\n${shareUrl}`).then(() => toast('Tautan disalin'));
              } else {
                toast(shareText);
              }
            }
          };
        });
      }
    );
    return pal;
  }

  function openAddToPlaylistModal(track) {
    const playlists = SF.store.state.playlists || [];
    openModal(
      `
      <div class="sf-row-between" style="margin-bottom:12px;">
        <b style="font-size:17px;">Tambah ke Playlist</b>
        <button type="button" class="sf-icon-btn" id="sf-atp-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-row-gap" style="margin-bottom:12px;">
        <input id="sf-atp-new-name" type="text" placeholder="Nama playlist baru..." style="flex:1;padding:11px 14px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:14px;outline:none;">
        <button type="button" class="sf-pill-btn accent" id="sf-atp-create">Buat</button>
      </div>
      <div class="sf-stack" style="gap:6px;" id="sf-atp-list">
        ${playlists.length
          ? playlists.map((pl) => `
              <button type="button" class="sf-card-soft sf-list-row" style="border-radius:14px;" data-pl-id="${esc(pl.id)}">
                <div>
                  <div style="font-weight:800;font-size:14px;">${esc(pl.name)}</div>
                  <div class="sf-muted" style="font-size:12px;">${(pl.tracks || []).length} lagu</div>
                </div>
                ${SF.icons.plus(18)}
              </button>
            `).join('')
          : `<div class="sf-muted" style="text-align:center;padding:18px;font-size:13px;">Belum ada playlist. Buat baru di atas!</div>`}
      </div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-atp-close').onclick = closeModal;
        sheet.querySelector('#sf-atp-create').onclick = () => {
          const name = (sheet.querySelector('#sf-atp-new-name').value || '').trim();
          if (!name) return toast('Masukkan nama playlist');
          const pl = SF.store.createPlaylist(name, [track]);
          closeModal();
          toast(`Disimpan ke "${pl.name}"`);
        };
        sheet.querySelectorAll('[data-pl-id]').forEach((btn) => {
          btn.onclick = () => {
            const id = btn.getAttribute('data-pl-id');
            const added = SF.store.addTrackToPlaylist(id, track);
            closeModal();
            toast(added ? 'Ditambahkan ke playlist' : 'Lagu sudah ada di playlist');
          };
        });
      }
    );
  }

  // =========================================================================
  // 2. TRACK ROW RENDERER + OPTIONAL SWIPE GESTURE
  // =========================================================================
  function renderTrackRow(track, idx, listTag) {
    const curId = SF.store.state.currentTrack?.id;
    const isCurrent = curId && curId === track.id;
    const isPlaying = isCurrent && SF.store.state.isPlaying;
    const liked = SF.store.isLiked(track.id);
    return `
      <div class="sf-track-row" data-track-idx="${idx}" data-list-tag="${esc(listTag)}" style="${isCurrent ? 'background:var(--accent-soft);' : ''}">
        ${renderArtHtml(track, 48, 12, track.title)}
        <div style="flex:1;min-width:0;">
          <div class="sf-row-gap" style="gap:6px;">
            ${isPlaying ? '<span class="sf-eq-bars"><span class="sf-eq-bar"></span><span class="sf-eq-bar"></span><span class="sf-eq-bar"></span></span>' : ''}
            <span class="sf-trunc" style="font-size:14px;font-weight:800;color:${isCurrent ? 'var(--accent)' : 'var(--text)'};">${esc(track.title)}</span>
          </div>
          <div class="sf-trunc sf-muted" style="font-size:12px;margin-top:2px;">
            ${esc(track.artist)}${track.duration > 0 ? ' • ' + SF.utils.formatTime(track.duration) : ''}
          </div>
        </div>
        <button type="button" class="sf-icon-btn sf-row-like" data-like-idx="${idx}" aria-label="Suka">${SF.icons.heart(18, liked)}</button>
        <button type="button" class="sf-icon-btn sf-row-more" data-more-idx="${idx}" aria-label="Opsi">${SF.icons.more(18)}</button>
      </div>
    `;
  }

  function bindTrackList(container, tracks, sourceLabel) {
    if (!container || !Array.isArray(tracks)) return;
    container.querySelectorAll('.sf-track-row').forEach((row) => {
      const idx = parseInt(row.getAttribute('data-track-idx'), 10);
      const track = tracks[idx];
      if (!track) return;

      row.onclick = (e) => {
        if (e.target.closest('.sf-row-like') || e.target.closest('.sf-row-more')) return;
        SF.utils.haptic(8);
        SF.audio.playTrack(track, tracks, idx, sourceLabel);
      };

      const likeBtn = row.querySelector('.sf-row-like');
      if (likeBtn) {
        likeBtn.onclick = (e) => {
          e.stopPropagation();
          const nowLiked = SF.store.toggleLike(track);
          likeBtn.innerHTML = SF.icons.heart(18, nowLiked);
          if (nowLiked) {
            likeBtn.classList.add('sf-anim-heart');
            burstHeart(likeBtn);
            setTimeout(() => likeBtn.classList.remove('sf-anim-heart'), 450);
          }
          SF.utils.haptic(10);
        };
      }

      const moreBtn = row.querySelector('.sf-row-more');
      if (moreBtn) {
        moreBtn.onclick = (e) => {
          e.stopPropagation();
          openTrackMenu(track);
        };
      }

      // Optional Swipe Gesture (Swipe Right = Play Next, Swipe Left = Like)
      if (SF.store.state.prefs.swipeTrackGestures) {
        let sx = 0;
        let sy = 0;
        let active = false;
        row.addEventListener('touchstart', (e) => {
          const t = e.touches[0];
          sx = t.clientX;
          sy = t.clientY;
          active = true;
        }, { passive: true });
        row.addEventListener('touchend', (e) => {
          if (!active) return;
          active = false;
          const t = e.changedTouches[0];
          const dx = t.clientX - sx;
          const dy = t.clientY - sy;
          if (Math.abs(dx) > 72 && Math.abs(dy) < 34) {
            if (dx > 0) {
              SF.store.addToQueue(track, true);
              toast(`Putar berikutnya: ${track.title}`);
            } else {
              const nowLiked = SF.store.toggleLike(track);
              if (likeBtn) likeBtn.innerHTML = SF.icons.heart(18, nowLiked);
              toast(nowLiked ? 'Disukai' : 'Batal disukai');
            }
          }
        }, { passive: true });
      }
    });
  }

  // =========================================================================
  // 3. TAB STATE & DATA
  // =========================================================================
  const MOODS = [
    { id: '', label: 'Semua' },
    { id: 'senang', label: 'Senang' },
    { id: 'bersantai', label: 'Bersantai' },
    { id: 'perjalanan', label: 'Perjalanan' },
    { id: 'energi', label: 'Mengisi energi' },
    { id: 'fokus', label: 'Fokus' },
    { id: 'malam', label: 'Malam' },
  ];

  let homeMood = '';
  let homeFeed = [];
  let homeLoading = false;

  let searchQuery = '';
  let searchFilter = 'all';
  let searchResults = { tracks: [], artists: [], albums: [], playlists: [], videos: [] };
  let searchSuggestions = { tracks: [], artists: [] };
  let searchLoading = false;

  let libSubTab = 'all';
  let libSort = 'recent';
  let libSortDir = 'desc';
  let libGrid = false;
  let libQuery = '';

  function getGreeting() {
    const h = new Date().getHours();
    if (h >= 4 && h < 11) return 'Selamat pagi';
    if (h >= 11 && h < 15) return 'Selamat siang';
    if (h >= 15 && h < 19) return 'Selamat sore';
    return 'Selamat malam';
  }

  // =========================================================================
  // 4. TAB 1 — BERANDA (AURALYS CLEAN HOME)
  // =========================================================================
  async function loadHomeFeed(mood, silent = false) {
    homeMood = mood || '';
    homeLoading = true;
    if (!silent && SF.store.state.activeTab === 'home') renderHome();
    try {
      const tracks = await SF.api.getHomeFeed(homeMood);
      if (Array.isArray(tracks) && tracks.length) {
        homeFeed = tracks;
      }
    } catch {}
    homeLoading = false;
    if (SF.store.state.activeTab === 'home') renderHome();
  }

  function renderHome() {
    const root = document.getElementById('sf-view-root');
    if (!root) return;
    const st = SF.store.state;
    const prefs = st.prefs;

    // Build Quick Grid (4-6 items from History + Liked + Feed)
    const quickMap = new Map();
    for (const t of [...st.history, ...st.likedTracks, ...homeFeed]) {
      if (t && !quickMap.has(t.id)) quickMap.set(t.id, t);
      if (quickMap.size >= 6) break;
    }
    const quickItems = Array.from(quickMap.values());
    const gridClass = prefs.gridSize === 'large' ? 'sf-grid-2' : 'sf-grid-3';

    root.innerHTML = `
      <div class="sf-stack" style="gap:16px;">
        <h1 class="sf-page-title" style="padding-top:4px;">${esc(getGreeting())}</h1>

        ${quickItems.length ? `
          <div class="sf-grid-2" id="sf-home-quick">
            ${quickItems.map((t, i) => `
              <button type="button" class="sf-quick-item" data-qidx="${i}">
                ${renderArtHtml(t, 54, 12, t.title)}
                <div style="min-width:0;flex:1;">
                  <div class="sf-quick-title sf-clamp-2">${esc(t.title)}</div>
                  <div class="sf-quick-sub sf-trunc">${esc(t.artist)}</div>
                </div>
              </button>
            `).join('')}
          </div>
        ` : ''}

        ${prefs.showHomeStreak !== false ? `
          <button type="button" class="sf-streak-card" id="sf-home-streak">
            <div class="sf-row-gap" style="gap:14px;">
              <div class="sf-streak-orb">${SF.icons.flame(28)}</div>
              <div>
                <div style="display:flex;align-items:baseline;gap:6px;">
                  <span class="sf-streak-num">${Number(st.streak?.count || 0)}</span>
                  <span style="font-size:14px;font-weight:700;">hari berturut-turut</span>
                </div>
                <div class="sf-muted" style="font-size:12.5px;margin-top:2px;">Percikan • ${Math.round(st.streak?.minutesToday || 0)} mnt hari ini</div>
              </div>
            </div>
            <span class="sf-muted">${SF.icons.chevRight(18)}</span>
          </button>
        ` : ''}

        <div class="sf-scroll-x" id="sf-home-moods">
          ${MOODS.map((m) => `
            <button type="button" class="sf-chip ${homeMood === m.id ? 'active' : ''}" data-mood="${esc(m.id)}">${esc(m.label)}</button>
          `).join('')}
        </div>

        <div>
          <div class="sf-sec-head" style="margin-top:4px;">
            <h2 class="sf-sec-title">${homeMood ? 'Pilihan ' + esc(MOODS.find((x) => x.id === homeMood)?.label || '') : 'Andalanmu'}</h2>
            ${homeFeed.length ? `<button type="button" class="sf-muted" id="sf-home-play-all" style="font-size:13px;font-weight:700;">Putar semua</button>` : ''}
          </div>
          ${homeLoading && !homeFeed.length ? `
            <div class="${gridClass}">
              ${Array.from({ length: 6 }).map(() => `
                <div>
                  <div style="aspect-ratio:1/1;border-radius:16px;background:var(--surface-2);"></div>
                  <div style="height:12px;width:80%;border-radius:6px;background:var(--surface-2);margin-top:8px;"></div>
                </div>
              `).join('')}
            </div>
          ` : homeFeed.length ? `
            <div class="${gridClass}" id="sf-home-andalan">
              ${homeFeed.slice(0, 18).map((t, i) => `
                <button type="button" data-fidx="${i}" style="text-align:left;min-width:0;">
                  <div style="position:relative;aspect-ratio:1/1;width:100%;border-radius:16px;overflow:hidden;box-shadow:var(--card-shadow);">
                    ${renderArtHtml(t, 200, 16, t.title, 'width:100%;height:100%;')}
                  </div>
                  <div class="sf-trunc" style="font-size:13px;font-weight:800;margin-top:7px;">${esc(t.title)}</div>
                  <div class="sf-trunc sf-muted" style="font-size:11.5px;margin-top:1px;">${esc(t.artist)}</div>
                </button>
              `).join('')}
            </div>
          ` : `
            <div class="sf-card" style="padding:20px;text-align:center;">
              <div style="font-weight:800;margin-bottom:6px;">Memuat katalog musik...</div>
              <div class="sf-muted" style="font-size:13px;margin-bottom:12px;">Pastikan koneksi internet aktif atau cari lagu favoritmu di tab Cari.</div>
              <button type="button" class="sf-pill-btn accent" id="sf-home-retry">Muat Ulang</button>
            </div>
          `}
        </div>

        ${st.history.length ? `
          <div>
            <div class="sf-sec-head">
              <h2 class="sf-sec-title">Baru Diputar</h2>
              <button type="button" class="sf-muted" id="sf-home-all-history" style="font-size:13px;font-weight:700;">Lihat semua</button>
            </div>
            <div class="sf-card" style="padding:6px;" id="sf-home-recent">
              ${st.history.slice(0, 6).map((t, i) => renderTrackRow(t, i, 'recent')).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    root.querySelectorAll('#sf-home-quick [data-qidx]').forEach((el) => {
      el.onclick = () => {
        const i = parseInt(el.getAttribute('data-qidx'), 10);
        SF.audio.playTrack(quickItems[i], quickItems, i, 'Akses Cepat');
      };
    });
    const streakBtn = root.querySelector('#sf-home-streak');
    if (streakBtn) streakBtn.onclick = () => SF.settings?.openStats?.();

    root.querySelectorAll('#sf-home-moods [data-mood]').forEach((btn) => {
      btn.onclick = () => loadHomeFeed(btn.getAttribute('data-mood') || '');
    });

    const playAll = root.querySelector('#sf-home-play-all');
    if (playAll) playAll.onclick = () => {
      if (homeFeed.length) SF.audio.playTrack(homeFeed[0], homeFeed, 0, 'Andalanmu');
    };

    root.querySelectorAll('#sf-home-andalan [data-fidx]').forEach((el) => {
      el.onclick = () => {
        const i = parseInt(el.getAttribute('data-fidx'), 10);
        SF.audio.playTrack(homeFeed[i], homeFeed, i, 'Andalanmu');
      };
    });

    const retry = root.querySelector('#sf-home-retry');
    if (retry) retry.onclick = () => loadHomeFeed(homeMood);

    const allHist = root.querySelector('#sf-home-all-history');
    if (allHist) allHist.onclick = () => openHistorySubpage();

    bindTrackList(root.querySelector('#sf-home-recent'), st.history.slice(0, 6), 'Baru Diputar');
  }

  // =========================================================================
  // 5. TAB 2 — CARI (SEARCH + SUGGESTIONS + PROFILES + ALBUMS + PLAYLISTS)
  // =========================================================================
  const SEARCH_FILTERS = [
    { id: 'all', label: 'Semua' },
    { id: 'tracks', label: 'Lagu' },
    { id: 'videos', label: 'Video' },
    { id: 'albums', label: 'Album' },
    { id: 'artists', label: 'Artis' },
    { id: 'playlists', label: 'Playlist' },
  ];

  async function executeSearch(query) {
    const q = String(query || '').trim();
    searchQuery = q;
    if (!q) {
      searchResults = { tracks: [], artists: [], albums: [], playlists: [], videos: [] };
      searchSuggestions = { tracks: [], artists: [] };
      searchLoading = false;
      renderSearchResults();
      return;
    }
    SF.store.addSearchHistory(q);
    searchLoading = true;
    searchSuggestions = { tracks: [], artists: [] };
    renderSearchResults();
    try {
      const res = await SF.api.searchAll(q, searchFilter);
      if (searchQuery !== q) return;
      searchResults = res || { tracks: [], artists: [], albums: [], playlists: [], videos: [] };
    } catch {
      if (searchQuery !== q) return;
      searchResults = { tracks: [], artists: [], albums: [], playlists: [], videos: [] };
    }
    searchLoading = false;
    renderSearchResults();
  }

  const debouncedSuggest = SF.utils.debounce(async (q) => {
    const clean = String(q || '').trim();
    if (clean.length < 2 || clean !== searchQuery) return;
    const sug = await SF.api.searchSuggest(clean);
    if (clean !== searchQuery || !searchLoading) return;
    searchSuggestions = sug;
  }, 240);

  const debouncedSearch = SF.utils.debounce((q) => {
    executeSearch(q);
  }, 380);

  function renderSearch() {
    const root = document.getElementById('sf-view-root');
    if (!root) return;
    root.innerHTML = `
      <div class="sf-stack" style="gap:14px;">
        <h1 class="sf-page-title" style="padding-top:4px;">Cari</h1>
        <div class="sf-card" style="display:flex;align-items:center;gap:10px;padding:6px 10px 6px 14px;border-radius:999px;">
          <span class="sf-muted">${SF.icons.search(19)}</span>
          <input id="sf-search-input" type="search" autocomplete="off" value="${esc(searchQuery)}" placeholder="Lagu, artis, album, atau lirik..." style="flex:1;background:transparent;border:none;outline:none;font-size:15px;font-weight:600;padding:8px 0;">
          <button type="button" class="sf-icon-btn" id="sf-search-clear" style="display:${searchQuery ? 'inline-flex' : 'none'};width:32px;height:32px;" aria-label="Hapus">${SF.icons.close(16)}</button>
          <button type="button" class="sf-pill-btn accent" id="sf-search-go" style="padding:8px 14px;">Cari</button>
        </div>
        <div class="sf-scroll-x" id="sf-search-filters">
          ${SEARCH_FILTERS.map((f) => `
            <button type="button" class="sf-chip ${searchFilter === f.id ? 'active' : ''}" data-sf="${f.id}">${f.label}</button>
          `).join('')}
        </div>
        <div id="sf-search-body"></div>
      </div>
    `;

    const input = root.querySelector('#sf-search-input');
    const clearBtn = root.querySelector('#sf-search-clear');
    const goBtn = root.querySelector('#sf-search-go');

    input.oninput = () => {
      searchQuery = input.value;
      clearBtn.style.display = searchQuery ? 'inline-flex' : 'none';
      if (!searchQuery.trim()) {
        searchResults = { tracks: [], artists: [], albums: [], playlists: [], videos: [] };
        renderSearchResults();
      } else {
        debouncedSuggest(searchQuery);
        debouncedSearch(searchQuery);
      }
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSearch(input.value);
      }
    };
    clearBtn.onclick = () => {
      input.value = '';
      searchQuery = '';
      clearBtn.style.display = 'none';
      executeSearch('');
      input.focus();
    };
    goBtn.onclick = () => executeSearch(input.value);

    root.querySelectorAll('#sf-search-filters [data-sf]').forEach((btn) => {
      btn.onclick = () => {
        searchFilter = btn.getAttribute('data-sf') || 'all';
        root.querySelectorAll('#sf-search-filters [data-sf]').forEach((b) => b.classList.toggle('active', b === btn));
        renderSearchResults();
      };
    });

    renderSearchResults();
  }

  function renderSearchResults() {
    const body = document.getElementById('sf-search-body');
    if (!body) return;
    const st = SF.store.state;

    if (!searchQuery.trim()) {
      const hist = st.searchHistory || [];
      body.innerHTML = `
        <div class="sf-stack" style="gap:16px;">
          ${hist.length ? `
            <div>
              <div class="sf-sec-head" style="margin-top:4px;">
                <h2 class="sf-sec-title">Pencarian Terakhir</h2>
                <button type="button" class="sf-muted" id="sf-sh-clear-all" style="font-size:12.5px;font-weight:700;">Bersihkan</button>
              </div>
              <div class="sf-scroll-x" style="flex-wrap:wrap;">
                ${hist.map((q) => `
                  <div class="sf-chip" style="display:inline-flex;align-items:center;gap:8px;padding:7px 10px 7px 14px;">
                    <button type="button" data-sh-run="${esc(q)}" style="font-weight:700;font-size:13px;">${esc(q)}</button>
                    <button type="button" data-sh-del="${esc(q)}" class="sf-muted" aria-label="Hapus">${SF.icons.close(14)}</button>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          <div>
            <div class="sf-sec-head" style="margin-top:4px;">
              <h2 class="sf-sec-title">Telusuri Suasana</h2>
            </div>
            <div class="sf-grid-2">
              ${MOODS.filter((m) => m.id).map((m, idx) => {
                const pal = SF.utils.getPalette(m.label + idx);
                return `
                  <button type="button" data-mood-search="${esc(m.label)}" style="height:82px;border-radius:20px;padding:14px 16px;text-align:left;color:#FFF;font-size:16px;font-weight:900;background:linear-gradient(135deg,${pal[0]},${pal[1]});display:flex;align-items:flex-end;box-shadow:var(--card-shadow);">
                    ${esc(m.label)}
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      `;
      const clearAll = body.querySelector('#sf-sh-clear-all');
      if (clearAll) clearAll.onclick = () => {
        st.searchHistory = [];
        SF.store.safeSet('sf_v4_search_history', []);
        renderSearchResults();
      };
      body.querySelectorAll('[data-sh-run]').forEach((b) => {
        b.onclick = () => {
          const q = b.getAttribute('data-sh-run');
          const inp = document.getElementById('sf-search-input');
          if (inp) inp.value = q;
          executeSearch(q);
        };
      });
      body.querySelectorAll('[data-sh-del]').forEach((b) => {
        b.onclick = () => {
          SF.store.removeSearchHistory(b.getAttribute('data-sh-del'));
          renderSearchResults();
        };
      });
      body.querySelectorAll('[data-mood-search]').forEach((b) => {
        b.onclick = () => {
          const q = b.getAttribute('data-mood-search');
          const inp = document.getElementById('sf-search-input');
          if (inp) inp.value = q;
          executeSearch(q);
        };
      });
      return;
    }

    if (searchLoading) {
      body.innerHTML = `
        <div class="sf-card" style="padding:26px;text-align:center;">
          <div style="font-weight:800;font-size:15px;">Mencari "${esc(searchQuery)}"...</div>
          <div class="sf-muted" style="font-size:12.5px;margin-top:4px;">Mengambil lagu, profil artis, album, dan playlist</div>
        </div>
      `;
      return;
    }

    const tracks = searchFilter === 'videos' ? (searchResults.videos || searchResults.tracks || []) : (searchResults.tracks || []);
    const artists = searchResults.artists || [];
    const albums = searchResults.albums || [];
    const playlists = searchResults.playlists || [];
    const hasAny = tracks.length || artists.length || albums.length || playlists.length;

    if (!hasAny) {
      body.innerHTML = `
        <div class="sf-card" style="padding:28px;text-align:center;">
          <div style="font-weight:800;font-size:16px;">Tidak ada hasil untuk "${esc(searchQuery)}"</div>
          <div class="sf-muted" style="font-size:13px;margin-top:6px;">Coba kata kunci lain atau ketuk Cari lagi.</div>
          <button type="button" class="sf-pill-btn accent" id="sf-search-retry" style="margin-top:14px;">Coba Lagi</button>
        </div>
      `;
      const rt = body.querySelector('#sf-search-retry');
      if (rt) rt.onclick = () => executeSearch(searchQuery);
      return;
    }

    const showArtists = (searchFilter === 'all' || searchFilter === 'artists') && artists.length > 0;
    const showTracks = (searchFilter === 'all' || searchFilter === 'tracks' || searchFilter === 'videos') && tracks.length > 0;
    const showAlbums = (searchFilter === 'all' || searchFilter === 'albums') && albums.length > 0;
    const showPlaylists = (searchFilter === 'all' || searchFilter === 'playlists') && playlists.length > 0;
    const topTrack = tracks[0] || null;
    const topArtist = artists[0] || null;

    body.innerHTML = `
      <div class="sf-stack" style="gap:16px;">
        ${searchFilter === 'all' && (topTrack || topArtist) ? `
          <div>
            <div class="sf-sec-head" style="margin-top:0;"><h2 class="sf-sec-title">Hasil Teratas</h2></div>
            <div class="sf-card" id="sf-top-result" style="padding:14px;display:flex;align-items:center;gap:14px;cursor:pointer;">
              ${topTrack
                ? renderArtHtml(topTrack, 64, 16, topTrack.title)
                : renderArtHtml(topArtist.picture, 64, 999, topArtist.name)}
              <div style="flex:1;min-width:0;">
                <div class="sf-trunc" style="font-size:16px;font-weight:900;">${esc(topTrack ? topTrack.title : topArtist.name)}</div>
                <div class="sf-trunc sf-muted" style="font-size:13px;margin-top:3px;">${esc(topTrack ? `Lagu • ${topTrack.artist}` : 'Artis')}</div>
              </div>
              <span class="sf-mini-play-btn">${SF.icons.play(18)}</span>
            </div>
          </div>
        ` : ''}

        ${showArtists ? `
          <div>
            <div class="sf-sec-head" style="margin-top:0;"><h2 class="sf-sec-title">Artis</h2></div>
            <div class="sf-scroll-x" id="sf-search-artists" style="gap:12px;">
              ${artists.slice(0, 12).map((a, i) => `
                <button type="button" data-aidx="${i}" style="width:94px;flex:0 0 auto;text-align:center;">
                  ${renderArtHtml(a.picture, 84, 999, a.name, 'margin:0 auto;box-shadow:var(--card-shadow);')}
                  <div class="sf-trunc" style="font-size:12.5px;font-weight:800;margin-top:7px;">${esc(a.name)}</div>
                  <div class="sf-muted" style="font-size:11px;">Artis</div>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${showTracks ? `
          <div>
            <div class="sf-sec-head" style="margin-top:0;">
              <h2 class="sf-sec-title">${searchFilter === 'videos' ? 'Video Musik' : 'Lagu'}</h2>
              <span class="sf-muted" style="font-size:12px;">${tracks.length} hasil</span>
            </div>
            <div class="sf-card" style="padding:6px;" id="sf-search-tracks">
              ${tracks.slice(0, 30).map((t, i) => renderTrackRow(t, i, 'search')).join('')}
            </div>
          </div>
        ` : ''}

        ${showAlbums ? `
          <div>
            <div class="sf-sec-head" style="margin-top:0;"><h2 class="sf-sec-title">Album</h2></div>
            <div class="sf-scroll-x" id="sf-search-albums" style="gap:12px;">
              ${albums.slice(0, 12).map((al, i) => `
                <button type="button" data-alidx="${i}" style="width:128px;flex:0 0 auto;text-align:left;">
                  ${renderArtHtml(al.cover, 128, 16, al.title, 'box-shadow:var(--card-shadow);')}
                  <div class="sf-trunc" style="font-size:13px;font-weight:800;margin-top:7px;">${esc(al.title)}</div>
                  <div class="sf-trunc sf-muted" style="font-size:11.5px;">${esc(al.artist)}</div>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${showPlaylists ? `
          <div>
            <div class="sf-sec-head" style="margin-top:0;"><h2 class="sf-sec-title">Playlist</h2></div>
            <div class="sf-scroll-x" id="sf-search-playlists" style="gap:12px;">
              ${playlists.slice(0, 12).map((pl, i) => `
                <button type="button" data-plidx="${i}" style="width:128px;flex:0 0 auto;text-align:left;">
                  ${renderArtHtml(pl.cover, 128, 16, pl.title, 'box-shadow:var(--card-shadow);')}
                  <div class="sf-trunc" style="font-size:13px;font-weight:800;margin-top:7px;">${esc(pl.title)}</div>
                  <div class="sf-trunc sf-muted" style="font-size:11.5px;">${esc(pl.creator || 'SpotyFlow')}</div>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    const topCard = body.querySelector('#sf-top-result');
    if (topCard) {
      topCard.onclick = () => {
        if (topTrack) SF.audio.playTrack(topTrack, tracks, 0, `Cari • ${searchQuery}`);
        else if (topArtist) views.openArtistProfile(topArtist.name, topArtist.id);
      };
    }

    body.querySelectorAll('#sf-search-artists [data-aidx]').forEach((b) => {
      b.onclick = () => {
        const a = artists[parseInt(b.getAttribute('data-aidx'), 10)];
        if (a) views.openArtistProfile(a.name, a.id);
      };
    });

    bindTrackList(body.querySelector('#sf-search-tracks'), tracks.slice(0, 30), `Cari • ${searchQuery}`);

    if (searchFilter === 'videos') {
      body.querySelectorAll('#sf-search-tracks .sf-track-row').forEach((row) => {
        row.addEventListener('click', () => {
          if (SF.store.state.prefs.autoPlayVideoFromVideoTab && SF.store.state.prefs.videoModeEnabled) {
            setTimeout(() => {
              SF.audio.setVideoMode(true);
              SF.player?.openFullscreen?.();
            }, 60);
          }
        });
      });
    }

    body.querySelectorAll('#sf-search-albums [data-alidx]').forEach((b) => {
      b.onclick = () => {
        const al = albums[parseInt(b.getAttribute('data-alidx'), 10)];
        if (al) views.openAlbumDetail(al);
      };
    });

    body.querySelectorAll('#sf-search-playlists [data-plidx]').forEach((b) => {
      b.onclick = () => {
        const pl = playlists[parseInt(b.getAttribute('data-plidx'), 10)];
        if (pl) views.openPublicPlaylist(pl);
      };
    });
  }

  // =========================================================================
  // 6. ARTIST PROFILE, ALBUM DETAIL & PLAYLIST SUBPAGES
  // =========================================================================
  async function openArtistProfile(artistName, artistId = '') {
    const cleanName = String(artistName || '').trim();
    if (!cleanName) return;
    openSubpage({
      id: 'artist-' + cleanName,
      title: cleanName,
      bodyHtml: `<div class="sf-card" style="padding:26px;text-align:center;"><b>Memuat profil ${esc(cleanName)}...</b></div>`,
    });

    const profile = await SF.api.getArtistProfile(cleanName, artistId);
    const artist = profile.artist || { id: artistId, name: cleanName, picture: '' };
    const topTracks = profile.topTracks || [];
    const albums = profile.albums || [];
    const related = profile.relatedArtists || [];
    const isFollowed = SF.store.isArtistFollowed(artist.name);

    replaceSubpage({
      id: 'artist-' + artist.name,
      title: artist.name,
      bodyHtml: `
        <div class="sf-stack" style="gap:16px;">
          <div class="sf-card" style="padding:18px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;">
            ${renderArtHtml(artist.picture, 112, 999, artist.name, 'box-shadow:var(--card-shadow);')}
            <div>
              <div style="font-size:22px;font-weight:900;">${esc(artist.name)}</div>
              <div class="sf-muted" style="font-size:13px;margin-top:3px;">
                ${artist.nb_fan ? Number(artist.nb_fan).toLocaleString('id-ID') + ' pengikut' : 'Profil Artis SpotyFlow'}
                ${albums.length ? ` • ${albums.length} album` : ''}
              </div>
            </div>
            <div class="sf-row-gap" style="justify-content:center;">
              <button type="button" class="sf-pill-btn accent" id="sf-art-play">${SF.icons.play(15)} Putar Populer</button>
              <button type="button" class="sf-pill-btn soft" id="sf-art-follow">${isFollowed ? 'Mengikuti' : 'Ikuti'}</button>
            </div>
          </div>

          ${topTracks.length ? `
            <div>
              <div class="sf-sec-head" style="margin-top:0;"><h2 class="sf-sec-title">Lagu Populer</h2></div>
              <div class="sf-card" style="padding:6px;" id="sf-art-tracks">
                ${topTracks.slice(0, 20).map((t, i) => renderTrackRow(t, i, 'artist')).join('')}
              </div>
            </div>
          ` : ''}

          ${albums.length ? `
            <div>
              <div class="sf-sec-head" style="margin-top:0;"><h2 class="sf-sec-title">Album & Single</h2></div>
              <div class="sf-scroll-x" id="sf-art-albums" style="gap:12px;">
                ${albums.slice(0, 14).map((al, i) => `
                  <button type="button" data-al="${i}" style="width:128px;flex:0 0 auto;text-align:left;">
                    ${renderArtHtml(al.cover, 128, 16, al.title)}
                    <div class="sf-trunc" style="font-size:13px;font-weight:800;margin-top:6px;">${esc(al.title)}</div>
                    <div class="sf-muted" style="font-size:11.5px;">${esc(al.release_date ? al.release_date.slice(0, 4) : 'Album')}</div>
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${related.length ? `
            <div>
              <div class="sf-sec-head" style="margin-top:0;"><h2 class="sf-sec-title">Artis Serupa</h2></div>
              <div class="sf-scroll-x" id="sf-art-related" style="gap:12px;">
                ${related.slice(0, 10).map((r, i) => `
                  <button type="button" data-rel="${i}" style="width:88px;flex:0 0 auto;text-align:center;">
                    ${renderArtHtml(r.picture, 78, 999, r.name, 'margin:0 auto;')}
                    <div class="sf-trunc" style="font-size:12px;font-weight:800;margin-top:6px;">${esc(r.name)}</div>
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `,
      onBind(body) {
        const playBtn = body.querySelector('#sf-art-play');
        if (playBtn) playBtn.onclick = () => {
          if (topTracks.length) SF.audio.playTrack(topTracks[0], topTracks, 0, artist.name);
        };
        const followBtn = body.querySelector('#sf-art-follow');
        if (followBtn) followBtn.onclick = () => {
          const f = SF.store.toggleFollowArtist(artist);
          followBtn.textContent = f ? 'Mengikuti' : 'Ikuti';
          toast(f ? `Mengikuti ${artist.name}` : `Berhenti mengikuti ${artist.name}`);
        };
        bindTrackList(body.querySelector('#sf-art-tracks'), topTracks.slice(0, 20), artist.name);
        body.querySelectorAll('#sf-art-albums [data-al]').forEach((b) => {
          b.onclick = () => {
            const al = albums[parseInt(b.getAttribute('data-al'), 10)];
            if (al) openAlbumDetail(al);
          };
        });
        body.querySelectorAll('#sf-art-related [data-rel]').forEach((b) => {
          b.onclick = () => {
            const r = related[parseInt(b.getAttribute('data-rel'), 10)];
            if (r) openArtistProfile(r.name, r.id);
          };
        });
      },
    });
  }

  async function openAlbumDetail(albumObj) {
    if (!albumObj) return;
    openSubpage({
      id: 'album-' + (albumObj.id || albumObj.title),
      title: albumObj.title || 'Album',
      bodyHtml: `<div class="sf-card" style="padding:26px;text-align:center;"><b>Memuat album ${esc(albumObj.title || '')}...</b></div>`,
    });

    const detail = await SF.api.getAlbumDetail(albumObj);
    const tracks = detail.tracks || [];
    const saved = SF.store.isAlbumSaved(detail.title);

    replaceSubpage({
      id: 'album-' + (detail.id || detail.title),
      title: detail.title,
      bodyHtml: `
        <div class="sf-stack" style="gap:16px;">
          <div class="sf-card" style="padding:18px;display:flex;gap:14px;align-items:center;">
            ${renderArtHtml(detail.cover, 96, 18, detail.title)}
            <div style="flex:1;min-width:0;">
              <div style="font-size:19px;font-weight:900;line-height:1.2;">${esc(detail.title)}</div>
              <button type="button" id="sf-al-artist" class="sf-muted" style="font-size:13.5px;font-weight:700;margin-top:4px;text-align:left;">${esc(detail.artist)}</button>
              <div class="sf-muted" style="font-size:12px;margin-top:3px;">${tracks.length} lagu</div>
              <div class="sf-row-gap" style="margin-top:10px;">
                <button type="button" class="sf-pill-btn accent" id="sf-al-play">${SF.icons.play(14)} Putar</button>
                <button type="button" class="sf-pill-btn soft" id="sf-al-save">${saved ? 'Tersimpan' : 'Simpan'}</button>
              </div>
            </div>
          </div>
          <div class="sf-card" style="padding:6px;" id="sf-al-tracks">
            ${tracks.length ? tracks.map((t, i) => renderTrackRow(t, i, 'album')).join('') : '<div class="sf-muted" style="padding:20px;text-align:center;">Daftar lagu album belum tersedia.</div>'}
          </div>
        </div>
      `,
      onBind(body) {
        const aBtn = body.querySelector('#sf-al-artist');
        if (aBtn) aBtn.onclick = () => openArtistProfile(detail.artist);
        const pBtn = body.querySelector('#sf-al-play');
        if (pBtn) pBtn.onclick = () => {
          if (tracks.length) SF.audio.playTrack(tracks[0], tracks, 0, detail.title);
        };
        const sBtn = body.querySelector('#sf-al-save');
        if (sBtn) sBtn.onclick = () => {
          const sv = SF.store.toggleSaveAlbum(detail);
          sBtn.textContent = sv ? 'Tersimpan' : 'Simpan';
          toast(sv ? 'Album disimpan ke Pustaka' : 'Album dihapus dari Pustaka');
        };
        bindTrackList(body.querySelector('#sf-al-tracks'), tracks, detail.title);
      },
    });
  }

  async function openPublicPlaylist(plObj) {
    if (!plObj) return;
    openSubpage({
      id: 'pubpl-' + (plObj.id || plObj.title),
      title: plObj.title || 'Playlist',
      bodyHtml: `<div class="sf-card" style="padding:26px;text-align:center;"><b>Memuat playlist...</b></div>`,
    });
    const detail = await SF.api.getPlaylistDetail(plObj);
    const tracks = detail.tracks || [];
    replaceSubpage({
      id: 'pubpl-' + (plObj.id || plObj.title),
      title: detail.title,
      bodyHtml: `
        <div class="sf-stack" style="gap:16px;">
          <div class="sf-card" style="padding:18px;display:flex;gap:14px;align-items:center;">
            ${renderArtHtml(detail.cover, 92, 18, detail.title)}
            <div style="flex:1;min-width:0;">
              <div style="font-size:19px;font-weight:900;">${esc(detail.title)}</div>
              <div class="sf-muted" style="font-size:13px;margin-top:3px;">${tracks.length} lagu</div>
              <div class="sf-row-gap" style="margin-top:10px;">
                <button type="button" class="sf-pill-btn accent" id="sf-ppl-play">${SF.icons.play(14)} Putar</button>
                <button type="button" class="sf-pill-btn soft" id="sf-ppl-clone">Salin ke Pustaka</button>
              </div>
            </div>
          </div>
          <div class="sf-card" style="padding:6px;" id="sf-ppl-tracks">
            ${tracks.map((t, i) => renderTrackRow(t, i, 'pubpl')).join('')}
          </div>
        </div>
      `,
      onBind(body) {
        const pBtn = body.querySelector('#sf-ppl-play');
        if (pBtn) pBtn.onclick = () => {
          if (tracks.length) SF.audio.playTrack(tracks[0], tracks, 0, detail.title);
        };
        const cBtn = body.querySelector('#sf-ppl-clone');
        if (cBtn) cBtn.onclick = () => {
          SF.store.createPlaylist(detail.title, tracks);
          toast('Playlist disalin ke Pustaka');
        };
        bindTrackList(body.querySelector('#sf-ppl-tracks'), tracks, detail.title);
      },
    });
  }

  // =========================================================================
  // 7. TAB 3 — PUSTAKA (6 REAL COLLECTIONS + USER PLAYLISTS + ARTISTS/ALBUMS)
  // =========================================================================
  function triggerLocalAudioUpload() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'audio/*';
    inp.multiple = true;
    inp.onchange = () => {
      const files = Array.from(inp.files || []);
      let added = 0;
      for (const f of files) {
        const url = URL.createObjectURL(f);
        const cleanTitle = f.name.replace(/\.[^.]+$/, '');
        SF.store.addUploadedTrack({
          id: 'upl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          title: cleanTitle,
          artist: 'Audio Lokal',
          streamUrl: url,
          isLocal: true,
          source: 'local',
        });
        added++;
      }
      if (added) {
        toast(`${added} file audio ditambahkan`);
        if (SF.store.state.activeTab === 'library') renderLibrary();
      }
    };
    inp.click();
  }

  function scanDeviceAudio() {
    const br = SF.utils.getBridge();
    if (br && typeof br.scanDeviceAudioFiles === 'function') {
      try {
        const raw = br.scanDeviceAudioFiles();
        const parsed = JSON.parse(raw || '[]');
        const list = (Array.isArray(parsed) ? parsed : []).map(SF.utils.normalizeTrack).filter(Boolean);
        SF.store.setDeviceTracks(list);
        toast(`Ditemukan ${list.length} file audio di perangkat`);
        return list;
      } catch {
        toast('Gagal memindai audio perangkat');
      }
    } else {
      triggerLocalAudioUpload();
    }
    return SF.store.state.deviceTracks || [];
  }

  function openCollectionSubpage(key) {
    const st = SF.store.state;
    let title = 'Koleksi';
    let tracks = [];
    let extraBtnHtml = '';

    if (key === 'liked') {
      title = 'Disukai';
      tracks = st.likedTracks || [];
      if (SF.utils.isNativeApk()) extraBtnHtml = '<button type="button" class="sf-pill-btn soft" id="sf-col-dl-all" style="padding:7px 12px;font-size:12px;">Unduh Semua</button>';
    } else if (key === 'downloaded') {
      title = 'Diunduh';
      tracks = SF.store.getOfflineTracksList();
    } else if (key === 'cached') {
      title = 'Tersimpan di cache';
      tracks = st.history || [];
    } else if (key === 'device') {
      title = 'Di perangkat';
      tracks = st.deviceTracks.length ? st.deviceTracks : scanDeviceAudio();
      extraBtnHtml = '<button type="button" class="sf-pill-btn soft" id="sf-col-scan" style="padding:7px 12px;font-size:12px;">Pindai</button>';
    } else if (key === 'top50') {
      title = 'Teratas saya 50';
      tracks = SF.store.getTop50Tracks();
    } else if (key === 'uploaded') {
      title = 'Diunggah';
      tracks = st.uploadedTracks || [];
      extraBtnHtml = '<button type="button" class="sf-pill-btn accent" id="sf-col-upload" style="padding:7px 12px;font-size:12px;">+ File</button>';
    }

    openSubpage({
      id: 'col-' + key,
      title,
      actionsHtml: extraBtnHtml,
      bodyHtml: `
        <div class="sf-stack" style="gap:14px;">
          <div class="sf-row-between">
            <div class="sf-muted" style="font-size:13px;font-weight:700;">${tracks.length} lagu</div>
            ${tracks.length ? `
              <div class="sf-row-gap">
                <button type="button" class="sf-pill-btn accent" id="sf-col-play">${SF.icons.play(14)} Putar</button>
                <button type="button" class="sf-pill-btn soft" id="sf-col-shuf">${SF.icons.shuffle(15)} Acak</button>
              </div>
            ` : ''}
          </div>
          <div class="sf-card" style="padding:6px;" id="sf-col-tracks">
            ${tracks.length
              ? tracks.map((t, i) => renderTrackRow(t, i, key)).join('')
              : `<div class="sf-muted" style="padding:26px;text-align:center;font-size:13.5px;">Belum ada lagu di ${esc(title)}.</div>`}
          </div>
        </div>
      `,
      onBind(body, root) {
        const pBtn = body.querySelector('#sf-col-play');
        if (pBtn) pBtn.onclick = () => SF.audio.playTrack(tracks[0], tracks, 0, title);
        const sBtn = body.querySelector('#sf-col-shuf');
        if (sBtn) sBtn.onclick = () => {
          const sh = tracks.slice().sort(() => Math.random() - 0.5);
          SF.audio.playTrack(sh[0], sh, 0, title);
        };
        const dlBtn = root.querySelector('#sf-col-dl-all');
        if (dlBtn) dlBtn.onclick = () => {
          tracks.forEach((t) => SF.store.requestOfflineDownload(t));
          toast(`Mengunduh ${tracks.length} lagu offline...`);
        };
        const scBtn = root.querySelector('#sf-col-scan');
        if (scBtn) scBtn.onclick = () => {
          scanDeviceAudio();
          closeSubpage();
          openCollectionSubpage('device');
        };
        const upBtn = root.querySelector('#sf-col-upload');
        if (upBtn) upBtn.onclick = () => triggerLocalAudioUpload();

        bindTrackList(body.querySelector('#sf-col-tracks'), tracks, title);
      },
    });
  }

  function openUserPlaylistSubpage(plId) {
    const pl = SF.store.state.playlists.find((p) => p.id === plId);
    if (!pl) return;
    const tracks = pl.tracks || [];
    openSubpage({
      id: 'upl-' + pl.id,
      title: pl.name,
      actionsHtml: `<button type="button" class="sf-icon-btn" id="sf-upl-del" aria-label="Hapus">${SF.icons.trash(18)}</button>`,
      bodyHtml: `
        <div class="sf-stack" style="gap:14px;">
          <div class="sf-row-between">
            <div class="sf-muted" style="font-size:13px;font-weight:700;">${tracks.length} lagu</div>
            ${tracks.length ? `<button type="button" class="sf-pill-btn accent" id="sf-upl-play">${SF.icons.play(14)} Putar Semua</button>` : ''}
          </div>
          <div class="sf-card" style="padding:6px;" id="sf-upl-tracks">
            ${tracks.length ? tracks.map((t, i) => renderTrackRow(t, i, 'upl')).join('') : '<div class="sf-muted" style="padding:26px;text-align:center;">Playlist masih kosong.</div>'}
          </div>
        </div>
      `,
      onBind(body, root) {
        const pBtn = body.querySelector('#sf-upl-play');
        if (pBtn) pBtn.onclick = () => SF.audio.playTrack(tracks[0], tracks, 0, pl.name);
        const dBtn = root.querySelector('#sf-upl-del');
        if (dBtn) dBtn.onclick = () => {
          SF.store.deletePlaylist(pl.id);
          closeSubpage();
          toast('Playlist dihapus');
          if (SF.store.state.activeTab === 'library') renderLibrary();
        };
        bindTrackList(body.querySelector('#sf-upl-tracks'), tracks, pl.name);
      },
    });
  }

  function openLibraryPlusMenu() {
    openModal(
      `
      <div class="sf-row-between" style="margin-bottom:10px;">
        <b style="font-size:17px;">Tambah ke Pustaka</b>
        <button type="button" class="sf-icon-btn" id="sf-lp-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-stack" style="gap:2px;">
        <button type="button" class="sf-list-row" id="sf-lp-new"><span class="sf-row-gap">${SF.icons.plus(19)} <b>Buat Playlist Baru</b></span></button>
        <button type="button" class="sf-list-row" id="sf-lp-import"><span class="sf-row-gap">${SF.icons.link(19)} <b>Impor Spotify / YouTube Music</b></span></button>
        <button type="button" class="sf-list-row" id="sf-lp-upload"><span class="sf-row-gap">${SF.icons.upload(19)} <b>Tambah File Audio Lokal</b></span></button>
      </div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-lp-close').onclick = closeModal;
        sheet.querySelector('#sf-lp-new').onclick = () => {
          closeModal();
          openModal(
            `
            <b style="font-size:17px;display:block;margin-bottom:10px;">Playlist Baru</b>
            <input id="sf-new-pl-inp" type="text" placeholder="Contoh: Santai Malam" style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:15px;outline:none;margin-bottom:12px;">
            <div class="sf-row-between">
              <button type="button" class="sf-pill-btn soft" id="sf-new-pl-cancel">Batal</button>
              <button type="button" class="sf-pill-btn accent" id="sf-new-pl-save">Simpan</button>
            </div>
            `,
            (s2) => {
              s2.querySelector('#sf-new-pl-cancel').onclick = closeModal;
              s2.querySelector('#sf-new-pl-save').onclick = () => {
                const name = (s2.querySelector('#sf-new-pl-inp').value || '').trim();
                if (!name) return toast('Nama tidak boleh kosong');
                SF.store.createPlaylist(name, []);
                closeModal();
                toast(`Playlist "${name}" dibuat`);
                if (SF.store.state.activeTab === 'library') renderLibrary();
              };
            }
          );
        };
        sheet.querySelector('#sf-lp-import').onclick = () => {
          closeModal();
          SF.settings?.openImportPlaylist?.();
        };
        sheet.querySelector('#sf-lp-upload').onclick = () => {
          closeModal();
          triggerLocalAudioUpload();
        };
      }
    );
  }

  function renderLibrary() {
    const root = document.getElementById('sf-view-root');
    if (!root) return;
    const st = SF.store.state;
    const prefs = st.prefs;

    const collections = [
      { key: 'liked', show: prefs.autoPlLiked !== false, name: 'Disukai', count: st.likedTracks.length, icon: SF.icons.heart(19, false) },
      { key: 'downloaded', show: prefs.autoPlDownloaded !== false, name: 'Diunduh', count: SF.store.getOfflineTracksList().length, icon: SF.icons.download(19) },
      { key: 'cached', show: prefs.autoPlCached !== false, name: 'Tersimpan di cache', count: st.history.length, icon: SF.icons.cloudCheck(19) },
      { key: 'device', show: prefs.autoPlDevice !== false, name: 'Di perangkat', count: st.deviceTracks.length, icon: SF.icons.folder(19) },
      { key: 'top50', show: prefs.autoPlTop50 !== false, name: 'Teratas saya 50', count: SF.store.getTop50Tracks().length, icon: SF.icons.trend(19) },
      { key: 'uploaded', show: prefs.autoPlUploaded !== false, name: 'Diunggah', count: st.uploadedTracks.length, icon: SF.icons.upload(19) },
    ].filter((c) => c.show);

    let playlists = (st.playlists || []).slice();
    if (libQuery) {
      const q = libQuery.toLowerCase();
      playlists = playlists.filter((p) => String(p.name || '').toLowerCase().includes(q));
    }
    playlists.sort((a, b) => {
      const diff = libSort === 'name'
        ? String(a.name || '').localeCompare(String(b.name || ''))
        : (Number(a.createdAt || 0) - Number(b.createdAt || 0));
      return libSortDir === 'asc' ? diff : -diff;
    });

    const subTabs = [
      { id: 'all', label: 'Semua' },
      { id: 'playlists', label: 'Playlist' },
      { id: 'tracks', label: 'Lagu' },
      { id: 'albums', label: 'Album' },
      { id: 'artists', label: 'Artis' },
      { id: 'podcasts', label: 'Podcast' },
    ];

    root.innerHTML = `
      <div class="sf-stack" style="gap:14px;">
        <div class="sf-row-between" style="padding-top:4px;">
          <h1 class="sf-page-title">Pustaka</h1>
          <button type="button" class="sf-pill-btn accent" id="sf-lib-plus" style="padding:9px 14px;">${SF.icons.plus(17)} Baru</button>
        </div>

        <div class="sf-subtabs" id="sf-lib-tabs">
          ${subTabs.map((t) => `<button type="button" class="sf-subtab ${libSubTab === t.id ? 'active' : ''}" data-lt="${t.id}">${t.label}</button>`).join('')}
        </div>

        <div class="sf-row-between">
          <div class="sf-row-gap">
            <button type="button" class="sf-chip" id="sf-lib-sort" style="padding:7px 12px;font-size:12.5px;">
              ${libSort === 'name' ? 'Nama A-Z' : 'Tanggal ditambahkan'} ${libSortDir === 'desc' ? '↓' : '↑'}
            </button>
          </div>
          <div class="sf-row-gap">
            <button type="button" class="sf-icon-btn" id="sf-lib-search-toggle" aria-label="Cari Pustaka">${SF.icons.search(18)}</button>
            <button type="button" class="sf-icon-btn" id="sf-lib-view-toggle" aria-label="Ubah Tampilan">${libGrid ? SF.icons.list(18) : SF.icons.grid(18)}</button>
          </div>
        </div>

        <div id="sf-lib-search-bar" style="display:${libQuery ? 'block' : 'none'};">
          <input id="sf-lib-search-inp" type="search" value="${esc(libQuery)}" placeholder="Saring di Pustaka..." style="width:100%;padding:10px 14px;border-radius:14px;border:1px solid var(--border);background:var(--surface);font-size:14px;outline:none;">
        </div>

        ${(libSubTab === 'all' || libSubTab === 'playlists') && collections.length ? `
          <div>
            <div class="sf-sec-eyebrow" style="margin-top:4px;">Koleksi</div>
            <div class="${libGrid ? 'sf-grid-2' : 'sf-card'}" style="${libGrid ? '' : 'overflow:hidden;'}">
              ${collections.map((c) => libGrid ? `
                <button type="button" class="sf-card" data-col="${c.key}" style="padding:14px;text-align:left;display:flex;flex-direction:column;gap:10px;">
                  <span class="sf-list-icon">${c.icon}</span>
                  <div>
                    <div style="font-size:14px;font-weight:800;">${esc(c.name)}</div>
                    <div class="sf-muted" style="font-size:12px;">${c.count} lagu</div>
                  </div>
                </button>
              ` : `
                <button type="button" class="sf-list-row" data-col="${c.key}">
                  <span class="sf-row-gap" style="gap:12px;">
                    <span class="sf-list-icon">${c.icon}</span>
                    <span>
                      <div style="font-size:14.5px;font-weight:800;">${esc(c.name)}</div>
                      <div class="sf-muted" style="font-size:12px;">${c.count} lagu</div>
                    </span>
                  </span>
                  <span class="sf-muted">${SF.icons.chevRight(18)}</span>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${(libSubTab === 'all' || libSubTab === 'playlists') ? `
          <div>
            <div class="sf-sec-eyebrow">Playlist Kamu (${playlists.length})</div>
            ${playlists.length ? `
              <div class="${libGrid ? 'sf-grid-2' : 'sf-card'}" style="${libGrid ? '' : 'overflow:hidden;'}">
                ${playlists.map((pl) => `
                  <button type="button" class="${libGrid ? 'sf-card' : 'sf-list-row'}" data-upl="${esc(pl.id)}" style="${libGrid ? 'padding:12px;text-align:left;' : ''}">
                    <span class="sf-row-gap" style="gap:12px;">
                      ${renderArtHtml(pl.tracks?.[0] || '', 46, 12, pl.name)}
                      <span style="min-width:0;">
                        <div class="sf-trunc" style="font-size:14.5px;font-weight:800;">${esc(pl.name)}</div>
                        <div class="sf-muted" style="font-size:12px;">${(pl.tracks || []).length} lagu</div>
                      </span>
                    </span>
                    ${libGrid ? '' : `<span class="sf-muted">${SF.icons.chevRight(18)}</span>`}
                  </button>
                `).join('')}
              </div>
            ` : `
              <div class="sf-card" style="padding:18px;text-align:center;">
                <div class="sf-muted" style="font-size:13px;">Belum ada playlist pribadi. Tekan tombol <b>+ Baru</b> untuk membuat atau mengimpor playlist.</div>
              </div>
            `}
          </div>
        ` : ''}

        ${libSubTab === 'tracks' ? `
          <div class="sf-card" style="padding:6px;" id="sf-lib-tracks">
            ${st.likedTracks.length
              ? st.likedTracks.map((t, i) => renderTrackRow(t, i, 'lib-liked')).join('')
              : '<div class="sf-muted" style="padding:24px;text-align:center;">Belum ada lagu yang disukai.</div>'}
          </div>
        ` : ''}

        ${libSubTab === 'albums' ? `
          ${st.savedAlbums.length ? `
            <div class="sf-grid-2" id="sf-lib-albums">
              ${st.savedAlbums.map((al, i) => `
                <button type="button" class="sf-card" data-sal="${i}" style="padding:12px;text-align:left;">
                  ${renderArtHtml(al.cover, 140, 14, al.title, 'width:100%;height:auto;aspect-ratio:1/1;')}
                  <div class="sf-trunc" style="font-size:13.5px;font-weight:800;margin-top:8px;">${esc(al.title)}</div>
                  <div class="sf-trunc sf-muted" style="font-size:12px;">${esc(al.artist)}</div>
                </button>
              `).join('')}
            </div>
          ` : '<div class="sf-card" style="padding:24px;text-align:center;"><span class="sf-muted">Belum ada album tersimpan. Buka album dari tab Cari lalu ketuk Simpan.</span></div>'}
        ` : ''}

        ${libSubTab === 'artists' ? `
          ${st.followedArtists.length ? `
            <div class="sf-card" style="overflow:hidden;" id="sf-lib-artists">
              ${st.followedArtists.map((a, i) => `
                <button type="button" class="sf-list-row" data-fa="${i}">
                  <span class="sf-row-gap" style="gap:12px;">
                    ${renderArtHtml(a.picture, 46, 999, a.name)}
                    <span style="font-size:14.5px;font-weight:800;">${esc(a.name)}</span>
                  </span>
                  <span class="sf-muted">${SF.icons.chevRight(18)}</span>
                </button>
              `).join('')}
            </div>
          ` : '<div class="sf-card" style="padding:24px;text-align:center;"><span class="sf-muted">Belum ada artis diikuti. Buka profil artis dari tab Cari lalu ketuk Ikuti.</span></div>'}
        ` : ''}

        ${libSubTab === 'podcasts' ? `
          <div class="sf-card" style="padding:22px;text-align:center;">
            <div style="font-weight:800;margin-bottom:6px;">Podcast & Audio Panjang</div>
            <div class="sf-muted" style="font-size:13px;margin-bottom:12px;">Cari podcast favoritmu langsung dari tab Cari.</div>
            <button type="button" class="sf-pill-btn accent" id="sf-lib-find-pod">Cari Podcast</button>
          </div>
        ` : ''}
      </div>
    `;

    root.querySelector('#sf-lib-plus').onclick = openLibraryPlusMenu;
    root.querySelectorAll('#sf-lib-tabs [data-lt]').forEach((b) => {
      b.onclick = () => {
        libSubTab = b.getAttribute('data-lt');
        renderLibrary();
      };
    });
    root.querySelector('#sf-lib-sort').onclick = () => {
      if (libSort === 'recent') libSort = 'name';
      else {
        libSort = 'recent';
        libSortDir = libSortDir === 'desc' ? 'asc' : 'desc';
      }
      renderLibrary();
    };
    root.querySelector('#sf-lib-view-toggle').onclick = () => {
      libGrid = !libGrid;
      renderLibrary();
    };
    root.querySelector('#sf-lib-search-toggle').onclick = () => {
      const bar = root.querySelector('#sf-lib-search-bar');
      bar.style.display = bar.style.display === 'none' ? 'block' : 'none';
      if (bar.style.display === 'block') root.querySelector('#sf-lib-search-inp').focus();
    };
    const lInp = root.querySelector('#sf-lib-search-inp');
    if (lInp) {
      lInp.oninput = () => {
        libQuery = lInp.value;
        renderLibrary();
      };
    }

    root.querySelectorAll('[data-col]').forEach((b) => {
      b.onclick = () => openCollectionSubpage(b.getAttribute('data-col'));
    });
    root.querySelectorAll('[data-upl]').forEach((b) => {
      b.onclick = () => openUserPlaylistSubpage(b.getAttribute('data-upl'));
    });
    bindTrackList(root.querySelector('#sf-lib-tracks'), st.likedTracks, 'Disukai');
    root.querySelectorAll('#sf-lib-albums [data-sal]').forEach((b) => {
      b.onclick = () => openAlbumDetail(st.savedAlbums[parseInt(b.getAttribute('data-sal'), 10)]);
    });
    root.querySelectorAll('#sf-lib-artists [data-fa]').forEach((b) => {
      b.onclick = () => {
        const a = st.followedArtists[parseInt(b.getAttribute('data-fa'), 10)];
        if (a) openArtistProfile(a.name, a.id);
      };
    });
    const fp = root.querySelector('#sf-lib-find-pod');
    if (fp) fp.onclick = () => {
      searchQuery = 'Podcast Indonesia';
      views.openTab('search');
      executeSearch('Podcast Indonesia');
    };
  }

  // =========================================================================
  // 8. TAB 4 — KAMU (PROFILE + STREAK + GROUPS + YTM/SPOTIFY + INSTALL APK)
  // =========================================================================
  function openHistorySubpage() {
    const hist = SF.store.state.history || [];
    openSubpage({
      id: 'history',
      title: 'Riwayat Pemutaran',
      actionsHtml: hist.length ? '<button type="button" class="sf-pill-btn soft" id="sf-hist-clear" style="padding:7px 12px;font-size:12px;">Hapus</button>' : '',
      bodyHtml: `
        <div class="sf-card" style="padding:6px;" id="sf-hist-list">
          ${hist.length ? hist.map((t, i) => renderTrackRow(t, i, 'history')).join('') : '<div class="sf-muted" style="padding:26px;text-align:center;">Belum ada riwayat pemutaran.</div>'}
        </div>
      `,
      onBind(body, root) {
        bindTrackList(body.querySelector('#sf-hist-list'), hist, 'Riwayat');
        const cBtn = root.querySelector('#sf-hist-clear');
        if (cBtn) cBtn.onclick = () => {
          SF.store.clearHistory();
          closeSubpage();
          toast('Riwayat pemutaran dibersihkan');
        };
      },
    });
  }

  function openEditProfileModal() {
    const prof = SF.store.state.profile || { name: 'Pendengar SpotyFlow', handle: '@spotyflow', bio: '' };
    openModal(
      `
      <div class="sf-row-between" style="margin-bottom:12px;">
        <b style="font-size:17px;">Edit Profil Kamu</b>
        <button type="button" class="sf-icon-btn" id="sf-ep-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-stack" style="gap:10px;">
        <label style="font-size:12px;font-weight:700;">Nama Tampilan
          <input id="sf-ep-name" type="text" value="${esc(prof.name)}" style="width:100%;margin-top:4px;padding:11px 13px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:14px;outline:none;">
        </label>
        <label style="font-size:12px;font-weight:700;">Username
          <input id="sf-ep-handle" type="text" value="${esc(prof.handle)}" style="width:100%;margin-top:4px;padding:11px 13px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:14px;outline:none;">
        </label>
        <label style="font-size:12px;font-weight:700;">Bio Singkat
          <input id="sf-ep-bio" type="text" value="${esc(prof.bio || '')}" style="width:100%;margin-top:4px;padding:11px 13px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:14px;outline:none;">
        </label>
        <button type="button" class="sf-pill-btn accent" id="sf-ep-save" style="margin-top:4px;">Simpan Profil</button>
      </div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-ep-close').onclick = closeModal;
        sheet.querySelector('#sf-ep-save').onclick = () => {
          SF.store.setProfile({
            name: sheet.querySelector('#sf-ep-name').value.trim() || 'Pendengar SpotyFlow',
            handle: sheet.querySelector('#sf-ep-handle').value.trim() || '@spotyflow',
            bio: sheet.querySelector('#sf-ep-bio').value.trim(),
          });
          closeModal();
          toast('Profil diperbarui');
          if (SF.store.state.activeTab === 'you') renderYou();
        };
      }
    );
  }

  function openApkInstallGuideModal() {
    openModal(
      `
      <div class="sf-row-between" style="margin-bottom:10px;">
        <b style="font-size:17px;">Panduan Install SpotyFlow APK v4.0.0</b>
        <button type="button" class="sf-icon-btn" id="sf-apk-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-stack" style="gap:10px;font-size:13.5px;line-height:1.45;">
        <div class="sf-card-soft" style="padding:12px;"><b>1. Unduh File APK</b><div class="sf-muted" style="margin-top:2px;">File <b>SpotyFlow.apk</b> sedang diunduh. Jika belum mulai, tekan tombol di bawah.</div></div>
        <div class="sf-card-soft" style="padding:12px;"><b>2. Izinkan Sumber Tidak Dikenal</b><div class="sf-muted" style="margin-top:2px;">Buka file APK di notifikasi/Downloads lalu aktifkan <i>Izinkan dari sumber ini</i> pada browser kamu.</div></div>
        <div class="sf-card-soft" style="padding:12px;"><b>3. Pasang & Nikmati Fitur Native</b><div class="sf-muted" style="margin-top:2px;">Dapatkan ExoPlayer Background, 5 Widget Layar Beranda, Origin Island, & Poster 3D AI Depth!</div></div>
        <a href="${esc(SF.api.buildUrl('/api/download-apk'))}" class="sf-pill-btn accent" style="text-decoration:none;text-align:center;">Unduh SpotyFlow.apk Sekarang</a>
      </div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-apk-close').onclick = closeModal;
      }
    );
  }

  function renderYou() {
    const root = document.getElementById('sf-view-root');
    if (!root) return;
    const st = SF.store.state;
    const prof = st.profile || { name: 'Pendengar SpotyFlow', handle: '@spotyflow' };
    const isNative = SF.utils.isNativeApk();

    root.innerHTML = `
      <div class="sf-stack" style="gap:14px;">
        <h1 class="sf-page-title" style="padding-top:4px;">Kamu</h1>

        <button type="button" class="sf-card sf-row-between" id="sf-you-profile" style="padding:14px 16px;text-align:left;width:100%;">
          <div class="sf-row-gap" style="gap:12px;">
            ${renderArtHtml(prof.avatar || '', 50, 999, prof.name)}
            <div style="min-width:0;">
              <div class="sf-trunc" style="font-size:16px;font-weight:900;">${esc(prof.name)}</div>
              <div class="sf-trunc sf-muted" style="font-size:12.5px;">${esc(prof.handle)} • ${st.likedTracks.length} disukai • ${st.playlists.length} playlist</div>
            </div>
          </div>
          <span class="sf-pill-btn soft" style="padding:7px 12px;font-size:12px;">Edit</span>
        </button>

        <button type="button" class="sf-streak-card" id="sf-you-streak">
          <div class="sf-row-gap" style="gap:14px;">
            <div class="sf-streak-orb">${SF.icons.flame(28)}</div>
            <div>
              <div style="display:flex;align-items:baseline;gap:6px;">
                <span class="sf-streak-num">${Number(st.streak?.count || 0)}</span>
                <span style="font-size:14px;font-weight:700;">hari berturut-turut</span>
              </div>
              <div class="sf-muted" style="font-size:12.5px;">Percikan • Rekor terbaik ${Number(st.streak?.best || 0)} hari</div>
            </div>
          </div>
          <span class="sf-muted">${SF.icons.chevRight(18)}</span>
        </button>

        <div class="sf-card" style="overflow:hidden;">
          <button type="button" class="sf-list-row" id="sf-you-history">
            <span class="sf-row-gap" style="gap:12px;"><span class="sf-list-icon">${SF.icons.history(19)}</span><b style="font-size:14.5px;">Riwayat</b></span>
            <span class="sf-muted">${SF.icons.chevRight(18)}</span>
          </button>
          <button type="button" class="sf-list-row" id="sf-you-stats">
            <span class="sf-row-gap" style="gap:12px;"><span class="sf-list-icon">${SF.icons.chart(19)}</span><b style="font-size:14.5px;">Statistik dan recap</b></span>
            <span class="sf-muted">${SF.icons.chevRight(18)}</span>
          </button>
        </div>

        <div class="sf-card" style="overflow:hidden;">
          <button type="button" class="sf-list-row" id="sf-you-jam">
            <span class="sf-row-gap" style="gap:12px;"><span class="sf-list-icon">${SF.icons.users(19)}</span><b style="font-size:14.5px;">Dengar bersama</b></span>
            <span class="sf-muted">${SF.icons.chevRight(18)}</span>
          </button>
          <button type="button" class="sf-list-row" id="sf-you-recognize">
            <span class="sf-row-gap" style="gap:12px;"><span class="sf-list-icon">${SF.icons.mic(19)}</span><b style="font-size:14.5px;">Kenali lagu</b></span>
            <span class="sf-muted">${SF.icons.chevRight(18)}</span>
          </button>
          <button type="button" class="sf-list-row" id="sf-you-eq">
            <span class="sf-row-gap" style="gap:12px;"><span class="sf-list-icon">${SF.icons.sliders(19)}</span><b style="font-size:14.5px;">Ekualiser</b></span>
            <span class="sf-muted">${SF.icons.chevRight(18)}</span>
          </button>
        </div>

        <div>
          <div class="sf-sec-eyebrow" style="margin-top:4px;">Akun</div>
          <div class="sf-grid-2">
            <div class="sf-card" style="padding:14px;background:linear-gradient(180deg, rgba(239,68,68,0.10), var(--surface) 60%);display:flex;flex-direction:column;justify-content:space-between;gap:12px;">
              <div>
                ${SF.icons.ytMusicLogo(28)}
                <div style="font-size:14.5px;font-weight:900;margin-top:10px;">YouTube Music</div>
                <div class="sf-muted" style="font-size:12px;margin-top:3px;line-height:1.35;">Sinkronkan pustaka dan playlist</div>
              </div>
              <button type="button" class="sf-pill-btn" id="sf-acc-ytm" style="width:100%;">Masuk</button>
            </div>
            <div class="sf-card" style="padding:14px;background:linear-gradient(180deg, rgba(29,185,84,0.11), var(--surface) 60%);display:flex;flex-direction:column;justify-content:space-between;gap:12px;">
              <div>
                ${SF.icons.spotifyLogo(28)}
                <div style="font-size:14.5px;font-weight:900;margin-top:10px;">Spotify</div>
                <div class="sf-muted" style="font-size:12px;margin-top:3px;line-height:1.35;">Playlist tampil di Pustaka</div>
              </div>
              <button type="button" class="sf-pill-btn" id="sf-acc-spotify" style="width:100%;">Hubungkan</button>
            </div>
          </div>
        </div>

        <div class="sf-card" style="overflow:hidden;">
          <button type="button" class="sf-list-row" id="sf-you-settings">
            <span class="sf-row-gap" style="gap:12px;"><span class="sf-list-icon">${SF.icons.settings(19)}</span><b style="font-size:14.5px;">Pengaturan</b></span>
            <span class="sf-muted">${SF.icons.chevRight(18)}</span>
          </button>
          <button type="button" class="sf-list-row" id="sf-you-about">
            <span class="sf-row-gap" style="gap:12px;"><span class="sf-list-icon">${SF.icons.info(19)}</span><b style="font-size:14.5px;">Tentang</b></span>
            <span class="sf-muted">${SF.icons.chevRight(18)}</span>
          </button>
        </div>

        ${!isNative ? `
          <div class="sf-card" style="padding:16px;background:linear-gradient(135deg, rgba(29,185,84,0.14), var(--surface) 65%);">
            <div class="sf-row-between">
              <div class="sf-row-gap" style="gap:12px;">
                <span class="sf-list-icon" style="background:var(--accent);color:#05130A;">${SF.icons.smartphone(20)}</span>
                <div>
                  <div style="font-size:14.5px;font-weight:900;">Install Aplikasi Android</div>
                  <div class="sf-muted" style="font-size:12px;">SpotyFlow.apk v4.0.0 • ExoPlayer & 5 Widget</div>
                </div>
              </div>
              <button type="button" class="sf-pill-btn accent" id="sf-you-dl-apk" style="padding:8px 13px;font-size:12.5px;">Download APK</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;

    root.querySelector('#sf-you-profile').onclick = openEditProfileModal;
    root.querySelector('#sf-you-streak').onclick = () => SF.settings?.openStats?.();
    root.querySelector('#sf-you-history').onclick = openHistorySubpage;
    root.querySelector('#sf-you-stats').onclick = () => SF.settings?.openStats?.();
    root.querySelector('#sf-you-jam').onclick = () => SF.settings?.openJam?.();
    root.querySelector('#sf-you-recognize').onclick = () => SF.settings?.openRecognize?.();
    root.querySelector('#sf-you-eq').onclick = () => SF.settings?.openEqualizer?.();
    root.querySelector('#sf-acc-ytm').onclick = () => SF.settings?.openImportPlaylist?.('ytm');
    root.querySelector('#sf-acc-spotify').onclick = () => SF.settings?.openImportPlaylist?.('spotify');
    root.querySelector('#sf-you-settings').onclick = () => SF.settings?.openMain?.();
    root.querySelector('#sf-you-about').onclick = () => SF.settings?.openCategory?.('about');

    const dlApk = root.querySelector('#sf-you-dl-apk');
    if (dlApk) {
      dlApk.onclick = () => {
        window.open(SF.api.buildUrl('/api/download-apk'), '_blank');
        openApkInstallGuideModal();
      };
    }
  }

  // =========================================================================
  // 9. VIEWS CONTROLLER (SF.views)
  // =========================================================================
  function bindHomeFabs() {
    const fabs = document.getElementById('sf-home-fabs');
    if (!fabs) return;
    fabs.innerHTML = `
      <button type="button" class="sf-fab sf-glass" id="sf-fab-mic" aria-label="Kenali Lagu">${SF.icons.mic(20)}</button>
      <button type="button" class="sf-fab sf-glass" id="sf-fab-shuffle" aria-label="Putar Acak">${SF.icons.shuffle(20)}</button>
    `;
    fabs.querySelector('#sf-fab-mic').onclick = () => SF.settings?.openRecognize?.();
    fabs.querySelector('#sf-fab-shuffle').onclick = () => {
      const st = SF.store.state;
      const pool = st.likedTracks.length ? st.likedTracks : (homeFeed.length ? homeFeed : st.history);
      if (!pool.length) return toast('Memuat koleksi lagu...');
      const shuf = pool.slice().sort(() => Math.random() - 0.5);
      SF.audio.playTrack(shuf[0], shuf, 0, 'Putar Acak');
      SF.utils.haptic(12);
    };
  }

  const views = {
    init() {
      bindHomeFabs();
      SF.bus.on('track:change', () => {
        if (SF.store.state.activeTab === 'home') renderHome();
        else if (SF.store.state.activeTab === 'search' && searchQuery) renderSearchResults();
      });
      SF.bus.on('playback:state', () => {
        if (SF.store.state.activeTab === 'home') renderHome();
      });
      SF.bus.on('like:change', () => {
        if (SF.store.state.activeTab === 'library') renderLibrary();
        else if (SF.store.state.activeTab === 'you') renderYou();
      });
      SF.bus.on('library:change', () => {
        if (SF.store.state.activeTab === 'library') renderLibrary();
        else if (SF.store.state.activeTab === 'you') renderYou();
      });
      SF.bus.on('streak:change', () => {
        if (SF.store.state.activeTab === 'home') renderHome();
        else if (SF.store.state.activeTab === 'you') renderYou();
      });
      SF.bus.on('pref:change', ({ key }) => {
        if (['showHomeStreak', 'gridSize', 'autoPlLiked', 'autoPlDownloaded', 'autoPlCached', 'autoPlDevice', 'autoPlTop50', 'autoPlUploaded'].includes(key)) {
          views.renderCurrent();
        }
      });
      SF.bus.on('audio:need-seed', async () => {
        if (homeFeed.length) {
          SF.audio.playTrack(homeFeed[0], homeFeed, 0, 'Andalanmu');
        } else {
          await loadHomeFeed('');
          if (homeFeed.length) SF.audio.playTrack(homeFeed[0], homeFeed, 0, 'Andalanmu');
        }
      });

      loadHomeFeed('', true);
    },

    openTab(tabId) {
      const valid = ['home', 'search', 'library', 'you'].includes(tabId) ? tabId : 'home';
      closeAllSubpages();
      SF.store.state.activeTab = valid;
      SF.dock?.setActive?.(valid);
      const scroller = document.getElementById('sf-main-scroll');
      if (scroller) scroller.scrollTop = 0;
      views.renderCurrent();
    },

    renderCurrent() {
      const t = SF.store.state.activeTab;
      if (t === 'home') renderHome();
      else if (t === 'search') renderSearch();
      else if (t === 'library') renderLibrary();
      else if (t === 'you') renderYou();
    },

    getHomeFeedCache() {
      return homeFeed.slice();
    },

    openArtistProfile,
    openAlbumDetail,
    openPublicPlaylist,
    openHistorySubpage,
    openApkInstallGuideModal,
    triggerLocalAudioUpload,
  };

  SF.ui = {
    renderArtHtml,
    toast,
    burstHeart,
    openModal,
    closeModal,
    openSubpage,
    replaceSubpage,
    closeSubpage,
    closeAllSubpages,
    openTrackMenu,
    renderTrackRow,
    bindTrackList,
  };
  SF.views = views;
})();
