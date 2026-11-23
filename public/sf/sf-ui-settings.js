(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});

  function esc(v) {
    return SF.utils.escapeHtml(v);
  }

  function swRow(key, title, sub = '') {
    const on = Boolean(SF.store.state.prefs[key]);
    return `
      <div class="sf-list-row">
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;">${esc(title)}</div>
          ${sub ? `<div class="sf-muted" style="font-size:12px;margin-top:2px;">${esc(sub)}</div>` : ''}
        </div>
        <button type="button" class="sf-switch ${on ? 'on' : ''}" data-pref-sw="${esc(key)}" aria-pressed="${on}"></button>
      </div>
    `;
  }

  function selRow(key, title, options, sub = '') {
    const cur = String(SF.store.state.prefs[key] ?? '');
    return `
      <div class="sf-list-row">
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;">${esc(title)}</div>
          ${sub ? `<div class="sf-muted" style="font-size:12px;margin-top:2px;">${esc(sub)}</div>` : ''}
        </div>
        <select data-pref-sel="${esc(key)}" style="padding:7px 10px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);font-size:12.5px;font-weight:700;outline:none;max-width:155px;">
          ${options.map(([val, lbl]) => `<option value="${esc(val)}" ${cur === String(val) ? 'selected' : ''}>${esc(lbl)}</option>`).join('')}
        </select>
      </div>
    `;
  }

  function sliderRow(key, title, min, max, step, suffix = '') {
    const val = Number(SF.store.state.prefs[key] ?? min);
    return `
      <div class="sf-list-row" style="flex-direction:column;align-items:stretch;gap:8px;">
        <div class="sf-row-between">
          <span style="font-size:14px;font-weight:700;">${esc(title)}</span>
          <span class="sf-muted" data-pref-sl-val="${esc(key)}" style="font-size:12.5px;font-weight:800;">${val}${esc(suffix)}</span>
        </div>
        <input type="range" class="sf-slider" data-pref-sl="${esc(key)}" data-suffix="${esc(suffix)}" min="${min}" max="${max}" step="${step}" value="${val}">
      </div>
    `;
  }

  function bindPrefControls(container) {
    if (!container) return;
    container.querySelectorAll('[data-pref-sw]').forEach((btn) => {
      btn.onclick = () => {
        const key = btn.getAttribute('data-pref-sw');
        const next = !SF.store.state.prefs[key];
        SF.store.setPref(key, next);
        btn.classList.toggle('on', next);
        btn.setAttribute('aria-pressed', String(next));
        SF.utils.haptic(8);
      };
    });
    container.querySelectorAll('[data-pref-sel]').forEach((sel) => {
      sel.onchange = () => {
        const key = sel.getAttribute('data-pref-sel');
        SF.store.setPref(key, sel.value);
        SF.ui.toast('Pengaturan disimpan');
      };
    });
    container.querySelectorAll('[data-pref-sl]').forEach((inp) => {
      const key = inp.getAttribute('data-pref-sl');
      const suffix = inp.getAttribute('data-suffix') || '';
      const lbl = container.querySelector(`[data-pref-sl-val="${key}"]`);
      inp.oninput = () => {
        const num = Number(inp.value);
        if (lbl) lbl.textContent = `${num}${suffix}`;
        SF.store.setPref(key, num);
      };
    });
  }

  // =========================================================================
  // 1. MAIN SETTINGS HUB (10 CATEGORIES IN 3 GROUPS — AURALYS LAYOUT)
  // =========================================================================
  function openMain() {
    const groups = [
      {
        label: 'Utama',
        items: [
          ['playback', 'Suara dan pemutaran', 'Audio, timer tidur, alarm, antrean', SF.icons.sliders(19)],
          ['appearance', 'Tampilan', 'Tema, Liquid Glass, Dynamic Island, Widget', SF.icons.layers(19)],
          ['language', 'Bahasa dan konten', 'Bahasa aplikasi, wilayah chart, eksplisit', SF.icons.globe(19)],
          ['lyrics', 'Lirik dan terjemahan', 'Penyedia, sinkronisasi, romanisasi', SF.icons.lyrics(19)],
          ['privacy', 'Privasi dan riwayat', 'Jeda riwayat dengar & pencarian', SF.icons.shield(19)],
        ],
      },
      {
        label: 'Data & Perangkat',
        items: [
          ['storage', 'Penyimpanan', 'Cache aman, offline & penggunaan', SF.icons.database(19)],
          ['backup', 'Cadangan dan impor', 'Ekspor/impor JSON, Spotify & YouTube', SF.icons.upload(19)],
          ['androidAuto', 'Android Auto', 'Integrasi media mobil & Bluetooth', SF.icons.car(19)],
          ['links', 'Tautan', 'Buka tautan musik di SpotyFlow', SF.icons.link(19)],
        ],
      },
      {
        label: 'Aplikasi',
        items: [
          ['about', 'Tentang SpotyFlow', 'v4.0.0 • Pembaruan & diagnostik APK', SF.icons.info(19)],
        ],
      },
    ];

    SF.ui.openSubpage({
      id: 'settings-main',
      title: 'Pengaturan',
      bodyHtml: `
        <div class="sf-stack" style="gap:10px;">
          ${groups.map((g) => `
            <div class="sf-sec-eyebrow">${esc(g.label)}</div>
            <div class="sf-card" style="overflow:hidden;">
              ${g.items.map(([id, title, sub, icon]) => `
                <button type="button" class="sf-list-row" data-cat="${id}">
                  <span class="sf-row-gap" style="gap:12px;">
                    <span class="sf-list-icon">${icon}</span>
                    <span>
                      <div style="font-size:14.5px;font-weight:800;">${esc(title)}</div>
                      <div class="sf-muted" style="font-size:12px;">${esc(sub)}</div>
                    </span>
                  </span>
                  <span class="sf-muted">${SF.icons.chevRight(18)}</span>
                </button>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `,
      onBind(body) {
        body.querySelectorAll('[data-cat]').forEach((b) => {
          b.onclick = () => openCategory(b.getAttribute('data-cat'));
        });
      },
    });
  }

  // =========================================================================
  // 2. ALL 10 SETTINGS CATEGORIES (100% REAL & WIRED)
  // =========================================================================
  function openAlarmModal(onSaved) {
    const pls = SF.store.state.playlists || [];
    SF.ui.openModal(
      `
      <div class="sf-row-between" style="margin-bottom:12px;">
        <b style="font-size:17px;">Tambah Alarm Musik</b>
        <button type="button" class="sf-icon-btn" id="sf-al-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-stack" style="gap:10px;">
        <label style="font-size:12px;font-weight:700;">Jam Alarm
          <input id="sf-al-time" type="time" value="06:30" style="width:100%;margin-top:4px;padding:12px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:16px;font-weight:800;outline:none;">
        </label>
        <label style="font-size:12px;font-weight:700;">Label
          <input id="sf-al-label" type="text" value="Bangun Pagi" style="width:100%;margin-top:4px;padding:11px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:14px;outline:none;">
        </label>
        <label style="font-size:12px;font-weight:700;">Playlist / Sumber
          <select id="sf-al-pl" style="width:100%;margin-top:4px;padding:11px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:14px;outline:none;">
            <option value="liked">Lagu Disukai</option>
            <option value="home">Andalanmu</option>
            ${pls.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="sf-pill-btn accent" id="sf-al-save">Simpan Alarm</button>
      </div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-al-close').onclick = SF.ui.closeModal;
        sheet.querySelector('#sf-al-save').onclick = () => {
          const time = sheet.querySelector('#sf-al-time').value || '06:30';
          const label = sheet.querySelector('#sf-al-label').value.trim() || 'Alarm Musik';
          const playlistId = sheet.querySelector('#sf-al-pl').value;
          SF.store.addAlarm({ time, label, playlistId, enabled: true });
          SF.ui.closeModal();
          SF.ui.toast(`Alarm ${time} ditambahkan`);
          if (typeof onSaved === 'function') onSaved();
        };
      }
    );
  }

  function openDynamicIslandSubpage() {
    const br = SF.utils.getBridge();
    let hasOverlay = false;
    try { hasOverlay = Boolean(br?.hasOverlayPermission?.()); } catch {}
    SF.ui.openSubpage({
      id: 'settings-island',
      title: 'Dynamic Island',
      bodyHtml: `
        <div class="sf-stack" style="gap:10px;">
          <div class="sf-sec-eyebrow">Sistem & Origin Island</div>
          <div class="sf-card" style="overflow:hidden;">
            ${swRow('islandLyricsEnabled', 'Lirik di Origin / Dynamic Island', 'Kirim baris lirik aktif ke bilah notifikasi & Origin Island')}
            ${swRow('floatingIslandEnabled', 'Kapsul Melayang Overlay', 'Tampilkan kapsul lirik mini di atas aplikasi lain (Android)')}
          </div>
          <div class="sf-card" style="padding:14px;">
            <div class="sf-row-between">
              <div>
                <div style="font-weight:800;font-size:14px;">Status Izin Overlay</div>
                <div class="sf-muted" style="font-size:12px;">${SF.utils.isNativeApk() ? (hasOverlay ? 'Diizinkan (Siap dipakai)' : 'Belum diizinkan') : 'Hanya tersedia di APK Android'}</div>
              </div>
              <button type="button" class="sf-pill-btn soft" id="sf-di-perm" style="padding:8px 12px;font-size:12px;">Buka Izin</button>
            </div>
          </div>
        </div>
      `,
      onBind(body) {
        bindPrefControls(body);
        const btn = body.querySelector('#sf-di-perm');
        if (btn) btn.onclick = () => {
          if (br && typeof br.openOverlayPermissionSettings === 'function') {
            try { br.openOverlayPermissionSettings(); } catch {}
          } else {
            SF.ui.toast('Buka pengaturan ini di SpotyFlow APK Android');
          }
        };
      },
    });
  }

  function openCategory(cat) {
    const br = SF.utils.getBridge();
    const st = SF.store.state;

    if (cat === 'playback') {
      const alarms = st.alarms || [];
      SF.ui.openSubpage({
        id: 'cat-playback',
        title: 'Suara dan pemutaran',
        bodyHtml: `
          <div class="sf-stack" style="gap:8px;">
            <div class="sf-sec-eyebrow">Pemutar</div>
            <div class="sf-card" style="overflow:hidden;">
              ${selRow('audioQuality', 'Kualitas audio', [['auto', 'Otomatis'], ['high', 'Tinggi (320kbps)'], ['medium', 'Normal (160kbps)'], ['low', 'Hemat (96kbps)']])}
              ${swRow('dataSaver', 'Mode hemat data', 'Prioritaskan bitrate ringan di jaringan seluler')}
              ${sliderRow('crossfadeSec', 'Crossfade antar lagu', 0, 12, 1, ' dtk')}
              ${sliderRow('historyThresholdSec', 'Durasi catat riwayat', 5, 60, 5, ' dtk')}
              ${swRow('skipSilence', 'Lewati keheningan')}
              ${swRow('skipSilenceInstant', 'Lewati keheningan seketika')}
              ${swRow('audioNormalization', 'Normalisasi audio', 'Samakan volume antar lagu')}
              ${sliderRow('loudnessLevel', 'Tingkat kelantangan', -6, 6, 1, ' dB')}
              ${swRow('audioOffload', 'Aktifkan audio offload', 'Hemat baterai saat layar mati (Android)')}
              ${swRow('varispeed', 'Aktifkan varispeed', 'Kecepatan ikut mengubah nada')}
              ${swRow('hardwareAudioProcessing', 'Gunakan pemrosesan audio perangkat keras')}
              ${swRow('progressiveSeek', 'Lompatan progresif')}
            </div>

            <div class="sf-sec-eyebrow">Timer tidur</div>
            <div class="sf-card" style="overflow:hidden;">
              ${swRow('autoSleepTimer', 'Aktifkan timer tidur otomatis')}
              ${swRow('sleepTimerRepeat', 'Ulangi timer tiap malam')}
              ${swRow('sleepTimerStopAtEnd', 'Berhenti di akhir lagu saat ini')}
              ${swRow('sleepTimerFadeOut', 'Memudar perlahan')}
            </div>

            <div class="sf-sec-eyebrow">Alarm</div>
            <div class="sf-card" style="overflow:hidden;">
              <button type="button" class="sf-list-row" id="sf-add-alarm-btn">
                <b style="color:var(--accent);font-size:14px;">+ Tambah alarm musik</b>
                ${SF.icons.plus(18)}
              </button>
              ${alarms.map((a) => `
                <div class="sf-list-row">
                  <div>
                    <div style="font-size:16px;font-weight:900;">${esc(a.time)} <span style="font-size:13px;font-weight:700;">• ${esc(a.label || 'Alarm')}</span></div>
                  </div>
                  <div class="sf-row-gap">
                    <button type="button" class="sf-switch ${a.enabled ? 'on' : ''}" data-al-tog="${esc(a.id)}"></button>
                    <button type="button" class="sf-icon-btn" data-al-del="${esc(a.id)}">${SF.icons.trash(16)}</button>
                  </div>
                </div>
              `).join('')}
              <button type="button" class="sf-list-row" id="sf-exact-alarm-btn">
                <span style="font-size:14px;font-weight:700;">Izinkan alarm tepat waktu</span>
                <span class="sf-muted">${SF.icons.chevRight(18)}</span>
              </button>
              <button type="button" class="sf-list-row" id="sf-battery-opt-btn">
                <span style="font-size:14px;font-weight:700;">Optimalisasi baterai</span>
                <span class="sf-muted">${SF.icons.chevRight(18)}</span>
              </button>
            </div>

            <div class="sf-sec-eyebrow">Antrean (13 Opsi)</div>
            <div class="sf-card" style="overflow:hidden;">
              ${swRow('persistentQueue', 'Antrean persisten')}
              ${swRow('autoLoadMore', 'Muat lagu lain otomatis')}
              ${swRow('autoRadioQueue', 'Antrean radio otomatis')}
              ${swRow('autoplay', 'Putar otomatis')}
              ${swRow('autoplayNoRepeat', 'Putar otomatis tanpa lagu berulang')}
              ${swRow('disableAutoLoadOnRepeatAll', 'Nonaktifkan muat otomatis saat ulangi semua')}
              ${swRow('autoDownloadLiked', 'Unduh otomatis saat disukai')}
              ${swRow('enableSimilarContent', 'Aktifkan konten serupa')}
              ${swRow('persistentShuffle', 'Acak persisten')}
              ${swRow('rememberShuffleRepeat', 'Ingat status acak dan ulang')}
              ${swRow('shufflePlaylistFirst', 'Acak playlist atau album terlebih dahulu')}
              ${swRow('preventQueueDuplicate', 'Cegah lagu yang sama di antrean')}
              ${swRow('autoSkipOnError', 'Lewati otomatis jika terjadi kesalahan')}
            </div>

            <div class="sf-sec-eyebrow">Lainnya (10 Opsi)</div>
            <div class="sf-card" style="overflow:hidden;">
              ${swRow('stopMusicOnAppClose', 'Hentikan musik saat aplikasi ditutup')}
              ${swRow('pauseOnMute', 'Jeda musik saat media dibisukan')}
              ${swRow('resumeOnBluetooth', 'Lanjutkan saat Bluetooth tersambung')}
              ${swRow('miniLyricsInPlayer', 'Lirik kecil di pemutar')}
              ${swRow('keepPlayingInGame', 'Tetap putar saat bermain game')}
              ${swRow('keepScreenOnPlayer', 'Jaga layar tetap menyala saat pemutar dibuka')}
              ${swRow('animatedCover', 'Sampul animasi')}
              ${swRow('animatedCoverSpotify', 'Sampul animasi dari Spotify')}
              ${swRow('videoModeEnabled', 'Mode video (Audio | Video)')}
              ${swRow('autoPlayVideoFromVideoTab', 'Putar video otomatis dari hasil Video')}
            </div>
          </div>
        `,
        onBind(body) {
          bindPrefControls(body);
          body.querySelector('#sf-add-alarm-btn').onclick = () => openAlarmModal(() => {
            SF.ui.closeSubpage();
            openCategory('playback');
          });
          body.querySelectorAll('[data-al-tog]').forEach((b) => {
            b.onclick = () => {
              SF.store.toggleAlarm(b.getAttribute('data-al-tog'));
              b.classList.toggle('on');
            };
          });
          body.querySelectorAll('[data-al-del]').forEach((b) => {
            b.onclick = () => {
              SF.store.removeAlarm(b.getAttribute('data-al-del'));
              SF.ui.closeSubpage();
              openCategory('playback');
            };
          });
          body.querySelector('#sf-exact-alarm-btn').onclick = () => {
            if (br?.openExactAlarmSettings) br.openExactAlarmSettings();
            else SF.ui.toast('Tersedia pada perangkat Android');
          };
          body.querySelector('#sf-battery-opt-btn').onclick = () => {
            if (br?.openBatterySettings) br.openBatterySettings();
            else SF.ui.toast('Tersedia pada perangkat Android');
          };
        },
      });
      return;
    }

    if (cat === 'appearance') {
      SF.ui.openSubpage({
        id: 'cat-appearance',
        title: 'Tampilan',
        bodyHtml: `
          <div class="sf-stack" style="gap:8px;">
            <div class="sf-sec-eyebrow">Tema & Gaya</div>
            <div class="sf-card" style="overflow:hidden;">
              ${selRow('theme', 'Tema', [['light', 'Terang'], ['dark', 'Gelap'], ['amoled', 'AMOLED Hitam'], ['system', 'Ikuti Sistem']])}
              ${selRow('uiStyle', 'Gaya tampilan', [['glass', 'Kaca (Liquid Glass)'], ['editorial', 'Editorial (Matte)']])}
              ${selRow('iconStyle', 'Gaya ikon', [['sharp', 'Monokrom Tajam'], ['rounded', 'Membulat']])}
              ${swRow('glassBlur', 'Efek kaca (blur)')}
              ${swRow('glassLensEffect', 'Efek lensa kaca prisma')}
              ${swRow('collapseNavOnScroll', 'Ciutkan bilah navigasi saat menggulir')}
              ${swRow('iosAnimations', 'Animasi ala iOS')}
              ${swRow('showHomeStreak', 'Streak Percikan di Beranda')}
              ${swRow('highRefreshRate', 'Aktifkan refresh rate tinggi (90-120Hz)')}
              ${swRow('landscapeScale', 'Skala landscape')}
              ${selRow('accentColor', 'Warna aksen', [['#1DB954', 'Hijau Spoty'], ['#3B82F6', 'Biru Laut'], ['#8B5CF6', 'Ungu'], ['#F97316', 'Oranye'], ['#EC4899', 'Merah Muda'], ['#EF4444', 'Merah']])}
              ${swRow('dynamicIconColor', 'Warna ikon dinamis')}
              ${selRow('appIconStyle', 'Gaya ikon aplikasi', [['default', 'Default'], ['mono', 'Monokrom'], ['glass', 'Kaca']])}
              <button type="button" class="sf-list-row" id="sf-open-island">
                <span style="font-size:14px;font-weight:800;">Dynamic Island</span>
                <span class="sf-muted">${SF.icons.chevRight(18)}</span>
              </button>
              <button type="button" class="sf-list-row" id="sf-open-widget">
                <span style="font-size:14px;font-weight:800;">Pengaturan widget (5 Widget Native)</span>
                <span class="sf-muted">${SF.icons.chevRight(18)}</span>
              </button>
            </div>

            <div class="sf-sec-eyebrow">Pemutar Mini & Pemutar Penuh</div>
            <div class="sf-card" style="overflow:hidden;">
              ${selRow('miniPlayerStyle', 'Gaya pemutar mini', [['capsule', 'Kapsul Melayang'], ['compact', 'Ringkas']])}
              ${swRow('playerGradientBg', 'Latar gradien adaptif sampul')}
              ${swRow('playerShowRemaining', 'Tampilkan sisa waktu (-0:37)')}
              ${swRow('playerShowVolume', 'Tampilkan slider volume')}
              ${swRow('playerShowSource', 'Tampilkan nama sumber/mix')}
              ${swRow('playerRoundCover', 'Sampul sudut membulat')}
              ${swRow('playerSwipeClose', 'Geser ke bawah untuk menutup')}
              ${swRow('playerHapticControls', 'Getaran halus pada kontrol')}
              ${swRow('playerShowCodecBadge', 'Tampilkan kualitas audio')}
              ${swRow('playerAmbientGlow', 'Pendar cahaya atas lembut')}
            </div>

            <div class="sf-sec-eyebrow">Lirik (8 Opsi)</div>
            <div class="sf-card" style="overflow:hidden;">
              ${swRow('blurOtherLyricLines', 'Buramkan baris lirik tidak aktif')}
              ${swRow('lyricsCenterAlign', 'Ratakan teks lirik di tengah')}
              ${sliderRow('lyricsFontSize', 'Ukuran huruf lirik', 18, 30, 1, 'px')}
              ${swRow('lyricsAutoScroll', 'Gulir otomatis mengikuti lagu')}
              ${swRow('lyricsTapToSeek', 'Ketuk baris lirik untuk loncat detik')}
              ${swRow('lyricsKeepScreenOn', 'Layar tetap menyala saat baca lirik')}
              ${swRow('lyricsShowTranslationSub', 'Tampilkan terjemahan di bawah baris')}
              ${swRow('lyricsBoldActive', 'Tebalkan baris lirik aktif')}
            </div>

            <div class="sf-sec-eyebrow">Lainnya (8 Opsi)</div>
            <div class="sf-card" style="overflow:hidden;">
              ${swRow('hideNavLabels', 'Sembunyikan label tab bawah')}
              ${selRow('gridSize', 'Ukuran grid Beranda', [['normal', '3 Kolom'], ['large', '2 Kolom Besar']])}
              ${selRow('defaultTab', 'Tab awal saat dibuka', [['home', 'Beranda'], ['search', 'Cari'], ['library', 'Pustaka'], ['you', 'Kamu']])}
              ${swRow('swipeTrackGestures', 'Gestur geser baris lagu')}
              ${swRow('immersiveStatusBar', 'Status bar imersif transparan')}
              ${swRow('compactTrackRows', 'Baris daftar lagu ringkas')}
              ${swRow('showQuickGrid', 'Tampilkan Grid Cepat Beranda')}
              ${swRow('reduceMotion', 'Kurangi animasi gerak')}
            </div>

            <div class="sf-sec-eyebrow">Playlist Otomatis di Pustaka (6 Sakelar)</div>
            <div class="sf-card" style="overflow:hidden;">
              ${swRow('autoPlLiked', 'Disukai')}
              ${swRow('autoPlDownloaded', 'Diunduh')}
              ${swRow('autoPlCached', 'Tersimpan di cache')}
              ${swRow('autoPlDevice', 'Di perangkat')}
              ${swRow('autoPlTop50', 'Teratas saya 50')}
              ${swRow('autoPlUploaded', 'Diunggah')}
            </div>
          </div>
        `,
        onBind(body) {
          bindPrefControls(body);
          body.querySelector('#sf-open-island').onclick = openDynamicIslandSubpage;
          body.querySelector('#sf-open-widget').onclick = openWidgetEditor;
        },
      });
      return;
    }

    if (cat === 'language') {
      SF.ui.openSubpage({
        id: 'cat-language',
        title: 'Bahasa dan konten',
        bodyHtml: `
          <div class="sf-card" style="overflow:hidden;">
            ${selRow('lang', 'Bahasa aplikasi', [['id', 'Bahasa Indonesia'], ['en', 'English'], ['ms', 'Bahasa Melayu']])}
            ${selRow('contentRegion', 'Wilayah rekomendasi & chart', [['ID', 'Indonesia'], ['US', 'Amerika Serikat'], ['JP', 'Jepang'], ['KR', 'Korea Selatan'], ['GB', 'Inggris']])}
            ${swRow('explicitContent', 'Izinkan konten eksplisit')}
            ${swRow('preferOfficialAudio', 'Prioritaskan audio resmi')}
          </div>
        `,
        onBind: bindPrefControls,
      });
      return;
    }

    if (cat === 'lyrics') {
      SF.ui.openSubpage({
        id: 'cat-lyrics',
        title: 'Lirik dan terjemahan',
        bodyHtml: `
          <div class="sf-card" style="overflow:hidden;">
            ${selRow('lyricsProvider', 'Penyedia lirik utama', [['auto', 'Otomatis (SpotyFlow + LRCLIB)'], ['lrclib', 'LRCLIB Sinkron']])}
            ${selRow('translateTargetLang', 'Bahasa terjemahan lirik', [['id', 'Indonesia'], ['en', 'English'], ['ja', 'Jepang'], ['ko', 'Korea']])}
            ${swRow('autoRomanize', 'Otomatis romanisasi aksara non-Latin')}
            ${sliderRow('lyricsOffsetSec', 'Sinkronisasi offset default', -5, 5, 0.5, ' dtk')}
            ${swRow('blurOtherLyricLines', 'Buramkan baris tidak aktif')}
          </div>
        `,
        onBind: bindPrefControls,
      });
      return;
    }

    if (cat === 'privacy') {
      SF.ui.openSubpage({
        id: 'cat-privacy',
        title: 'Privasi dan riwayat',
        bodyHtml: `
          <div class="sf-stack" style="gap:12px;">
            <div class="sf-card" style="overflow:hidden;">
              ${swRow('pausePlayHistory', 'Jeda riwayat pemutaran')}
              ${swRow('pauseSearchHistory', 'Jeda riwayat pencarian')}
            </div>
            <div class="sf-card" style="overflow:hidden;">
              <button type="button" class="sf-list-row" id="sf-pr-clr-hist"><b style="color:#EF4444;">Hapus Riwayat Pemutaran</b></button>
              <button type="button" class="sf-list-row" id="sf-pr-clr-search"><b style="color:#EF4444;">Hapus Riwayat Pencarian</b></button>
            </div>
          </div>
        `,
        onBind(body) {
          bindPrefControls(body);
          body.querySelector('#sf-pr-clr-hist').onclick = () => {
            SF.store.clearHistory();
            SF.ui.toast('Riwayat pemutaran dihapus');
          };
          body.querySelector('#sf-pr-clr-search').onclick = () => {
            SF.store.state.searchHistory = [];
            SF.store.safeSet('sf_v4_search_history', []);
            SF.ui.toast('Riwayat pencarian dihapus');
          };
        },
      });
      return;
    }

    if (cat === 'storage') {
      const cacheKb = (SF.store.getCacheUsageBytes() / 1024).toFixed(1);
      const offlineCount = SF.store.getOfflineTracksList().length;
      SF.ui.openSubpage({
        id: 'cat-storage',
        title: 'Penyimpanan',
        bodyHtml: `
          <div class="sf-stack" style="gap:12px;">
            <div class="sf-card" style="padding:16px;">
              <div class="sf-row-between" style="margin-bottom:8px;"><b>Cache Sementara (Lirik & Pencarian)</b><span>${cacheKb} KB</span></div>
              <div class="sf-row-between" style="margin-bottom:8px;"><b>Lagu Offline APK</b><span>${offlineCount} lagu</span></div>
              <div class="sf-row-between"><b>Data Dilindungi (Disukai, Playlist, Streak)</b><span style="color:var(--accent);font-weight:800;">Aman</span></div>
            </div>
            <button type="button" class="sf-pill-btn accent" id="sf-st-clean" style="width:100%;">Bersihkan Cache Aman</button>
            <div class="sf-muted" style="font-size:12px;text-align:center;line-height:1.4;">Membersihkan cache sementara tanpa pernah menghapus Disukai, Playlist, Streak, Pengaturan, atau Widget.</div>
          </div>
        `,
        onBind(body) {
          body.querySelector('#sf-st-clean').onclick = () => {
            const removed = SF.store.clearSafeCache();
            SF.ui.toast(`Cache aman dibersihkan (${removed} entri + HTTP cache)`);
            SF.ui.closeSubpage();
            openCategory('storage');
          };
        },
      });
      return;
    }

    if (cat === 'backup') {
      SF.ui.openSubpage({
        id: 'cat-backup',
        title: 'Cadangan dan impor',
        bodyHtml: `
          <div class="sf-stack" style="gap:12px;">
            <div class="sf-card" style="overflow:hidden;">
              <button type="button" class="sf-list-row" id="sf-bk-export">
                <div><b>Ekspor Cadangan (.json)</b><div class="sf-muted" style="font-size:12px;">Simpan Disukai, Playlist, Streak, Pengaturan, EQ & Widget</div></div>
                ${SF.icons.download(19)}
              </button>
              <button type="button" class="sf-list-row" id="sf-bk-import">
                <div><b>Impor Cadangan (.json)</b><div class="sf-muted" style="font-size:12px;">Pulihkan data SpotyFlow dari file cadangan</div></div>
                ${SF.icons.upload(19)}
              </button>
              <button type="button" class="sf-list-row" id="sf-bk-pl">
                <div><b>Impor Playlist Spotify / YouTube Music</b><div class="sf-muted" style="font-size:12px;">Tempel tautan playlist publik langsung ke Pustaka</div></div>
                ${SF.icons.link(19)}
              </button>
            </div>
          </div>
        `,
        onBind(body) {
          body.querySelector('#sf-bk-export').onclick = () => {
            const json = SF.store.exportBackupJson();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `spotyflow-backup-v4-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            SF.ui.toast('File cadangan .json diunduh');
          };
          body.querySelector('#sf-bk-import').onclick = () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = 'application/json,.json';
            inp.onchange = async () => {
              const f = inp.files?.[0];
              if (!f) return;
              try {
                const txt = await f.text();
                SF.store.importBackupJson(txt, 'merge');
                SF.ui.toast('Cadangan berhasil dipulihkan!');
              } catch {
                SF.ui.toast('File JSON tidak valid');
              }
            };
            inp.click();
          };
          body.querySelector('#sf-bk-pl').onclick = () => openImportPlaylist();
        },
      });
      return;
    }

    if (cat === 'androidAuto') {
      SF.ui.openSubpage({
        id: 'cat-aa',
        title: 'Android Auto',
        bodyHtml: `
          <div class="sf-card" style="overflow:hidden;">
            ${swRow('androidAutoEnabled', 'Aktifkan dukungan Android Auto', 'Ekspos MediaSession & antrean ke head unit mobil')}
            ${swRow('resumeOnBluetooth', 'Lanjutkan otomatis saat Bluetooth mobil tersambung')}
            ${swRow('keepScreenOnPlayer', 'Layar tetap menyala di mode berkendara')}
          </div>
        `,
        onBind: bindPrefControls,
      });
      return;
    }

    if (cat === 'links') {
      SF.ui.openSubpage({
        id: 'cat-links',
        title: 'Tautan',
        bodyHtml: `
          <div class="sf-card" style="overflow:hidden;">
            ${swRow('openLinksInApp', 'Buka tautan SpotyFlow langsung di aplikasi')}
            <button type="button" class="sf-list-row" id="sf-ln-copy">
              <div><b>Salin Tautan Web SpotyFlow</b><div class="sf-muted" style="font-size:12px;">https://spotyflow.vercel.app</div></div>
              ${SF.icons.share(18)}
            </button>
          </div>
        `,
        onBind(body) {
          bindPrefControls(body);
          body.querySelector('#sf-ln-copy').onclick = () => {
            navigator.clipboard?.writeText('https://spotyflow.vercel.app').then(() => SF.ui.toast('Tautan disalin'));
          };
        },
      });
      return;
    }

    if (cat === 'about') {
      let sysInfo = 'Web Browser Mode';
      if (SF.utils.isNativeApk() && br?.getSystemStatus) {
        try { sysInfo = br.getSystemStatus(); } catch { sysInfo = 'SpotyFlow Native Android APK'; }
      }
      SF.ui.openSubpage({
        id: 'cat-about',
        title: 'Tentang SpotyFlow',
        bodyHtml: `
          <div class="sf-stack" style="gap:14px;">
            <div class="sf-card" style="padding:20px;text-align:center;">
              <div style="width:64px;height:64px;border-radius:20px;margin:0 auto 12px;background:linear-gradient(135deg,#1DB954,#14B8A6);display:flex;align-items:center;justify-content:center;color:#FFF;">${SF.icons.music(30)}</div>
              <div style="font-size:21px;font-weight:900;">SpotyFlow v4.0.0</div>
              <div class="sf-muted" style="font-size:13px;margin-top:3px;">Build 400 • Clean Modular Architecture</div>
              <div class="sf-muted" style="font-size:12px;margin-top:10px;line-height:1.45;">10 Pengatur Mandiri • True Liquid Glass Auralys • ExoPlayer 4G • 5 Widget Native • ML Kit 3D Poster</div>
            </div>
            <div class="sf-card" style="padding:14px;">
              <div style="font-size:12px;font-weight:800;margin-bottom:6px;">Diagnostik Sistem</div>
              <div class="sf-muted" style="font-size:12px;word-break:break-word;">Engine aktif: <b>${esc(SF.audio.getEngine())}</b> • Mode: <b>${SF.utils.isNativeApk() ? 'APK Native' : 'Web'}</b> • ${esc(sysInfo)}</div>
            </div>
            <button type="button" class="sf-pill-btn accent" id="sf-ab-check" style="width:100%;">Cek Pembaruan Versi</button>
            ${!SF.utils.isNativeApk() ? `<button type="button" class="sf-pill-btn soft" id="sf-ab-dl" style="width:100%;">Download SpotyFlow.apk (v4.0.0)</button>` : ''}
          </div>
        `,
        onBind(body) {
          body.querySelector('#sf-ab-check').onclick = async () => {
            SF.ui.toast('Memeriksa pembaruan...');
            try {
              const v = await SF.api.checkAppVersion();
              SF.ui.toast(`Versi server: v${v.version || '4.0.0'} (Build ${v.versionCode || 400})`);
            } catch {
              SF.ui.toast('SpotyFlow v4.0.0 sudah versi terbaru');
            }
          };
          const dl = body.querySelector('#sf-ab-dl');
          if (dl) dl.onclick = () => {
            window.open(SF.api.buildUrl('/api/download-apk'), '_blank');
            SF.views.openApkInstallGuideModal();
          };
        },
      });
    }
  }

  // =========================================================================
  // 3. INTERACTIVE WIDGET EDITOR (LIVE 60 FPS PREVIEW + 5 NATIVE WIDGETS)
  // =========================================================================
  function openWidgetEditor() {
    let cfg = Object.assign({}, SF.store.state.widgetCfg);
    const accents = [
      ['cover', 'Dari cover', 'linear-gradient(135deg,#1DB954,#3B82F6)'],
      ['#1DB954', 'Hijau', '#1DB954'],
      ['#3B82F6', 'Biru', '#3B82F6'],
      ['#8B5CF6', 'Ungu', '#8B5CF6'],
      ['#F97316', 'Oranye', '#F97316'],
      ['#EC4899', 'Pink', '#EC4899'],
      ['#EF4444', 'Merah', '#EF4444'],
      ['#14B8A6', 'Teal', '#14B8A6'],
      ['#F59E0B', 'Emas', '#F59E0B'],
    ];

    function renderPreviewHtml() {
      const t = SF.store.state.currentTrack || { title: 'SpotyFlow Liquid Glass', artist: 'Auralys Edition', cover: '' };
      const pal = SF.utils.getPalette(t.title);
      const accentHex = cfg.accent === 'cover' ? pal[0] : cfg.accent;
      const rad = Number(cfg.cornerRadius ?? 24);
      const artRad = cfg.coverShape === 'circle' ? 999 : (cfg.coverShape === 'square' ? 4 : 14);
      const fontDelta = cfg.textSize === 'large' ? 2 : (cfg.textSize === 'small' ? -1.5 : 0);
      const darkStyle = cfg.style === 'dark' || cfg.style === 'cover';
      const bg =
        cfg.style === 'dark' ? 'rgba(16,18,24,0.92)'
        : cfg.style === 'light' ? 'rgba(255,255,255,0.95)'
        : cfg.style === 'cover' ? `linear-gradient(135deg, ${pal[0]}, ${pal[1]})`
        : cfg.style === 'clear' ? `rgba(255,255,255,${(0.18 + (cfg.glassThickness || 55) * 0.003).toFixed(2)})`
        : `rgba(255,255,255,${(0.55 + (cfg.glassThickness || 55) * 0.003).toFixed(2)})`;
      const fg = darkStyle ? '#FFFFFF' : '#111215';
      const muted = darkStyle ? 'rgba(255,255,255,0.72)' : 'rgba(17,18,21,0.62)';

      return `
        <div style="padding:18px;border-radius:24px;background:linear-gradient(135deg,${pal[0]},${pal[1]});">
          <div style="border-radius:${rad}px;padding:14px;background:${bg};color:${fg};border:1.5px solid rgba(255,255,255,${(0.25 + (cfg.glassShine || 65) * 0.006).toFixed(2)});box-shadow:0 16px 36px rgba(0,0,0,0.22);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);">
            <div class="sf-row-between" style="gap:10px;">
              <div class="sf-row-gap" style="flex:1;min-width:0;">
                ${cfg.showCover !== false ? SF.ui.renderArtHtml(t, 52, artRad, t.title) : ''}
                <div style="min-width:0;flex:1;">
                  <div class="sf-trunc" style="font-size:${14 + fontDelta}px;font-weight:900;">${esc(t.title)}</div>
                  ${cfg.showArtist !== false ? `<div class="sf-trunc" style="font-size:${11.5 + fontDelta}px;color:${muted};">${esc(t.artist)}</div>` : ''}
                </div>
              </div>
              ${cfg.showStreak !== false ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:999px;background:rgba(249,115,22,0.18);font-size:12px;font-weight:900;">${SF.icons.flame(15)} ${Number(SF.store.state.streak?.count || 0)}</span>` : ''}
            </div>
            ${cfg.showProgress !== false ? `
              <div style="margin-top:12px;">
                <div style="height:4px;border-radius:99px;background:rgba(128,128,128,0.28);overflow:hidden;">
                  <div style="width:42%;height:100%;background:${accentHex};border-radius:99px;"></div>
                </div>
                ${cfg.showTime !== false ? `<div class="sf-row-between" style="font-size:10.5px;color:${muted};margin-top:4px;font-weight:700;"><span>1:32</span><span>-2:14</span></div>` : ''}
              </div>
            ` : ''}
            <div class="sf-row-between" style="margin-top:10px;padding:0 6px;">
              ${cfg.showLike !== false ? `<span>${SF.icons.heart(18, false)}</span>` : '<span></span>'}
              <div class="sf-row-gap" style="gap:16px;">
                <span>${SF.icons.prev(19)}</span>
                <span style="${cfg.playButtonStyle === 'round' ? `width:38px;height:38px;border-radius:999px;background:${accentHex};color:#05130A;display:inline-flex;align-items:center;justify-content:center;` : ''}">${SF.icons.pause(18)}</span>
                <span>${SF.icons.next(19)}</span>
              </div>
              <span>${SF.icons.lyrics(17)}</span>
            </div>
          </div>
        </div>
      `;
    }

    SF.ui.openSubpage({
      id: 'widget-editor',
      title: 'Pengaturan Widget',
      actionsHtml: '<button type="button" class="sf-pill-btn accent" id="sf-wd-done" style="padding:7px 14px;font-size:12.5px;">Selesai</button>',
      bodyHtml: `
        <div class="sf-stack" style="gap:14px;">
          <div id="sf-wd-preview">${renderPreviewHtml()}</div>

          <div class="sf-card" style="padding:14px;">
            <div style="font-size:13px;font-weight:800;margin-bottom:8px;">Gaya Widget</div>
            <div class="sf-scroll-x" id="sf-wd-styles">
              ${[['glass', 'Kaca'], ['clear', 'Kaca bening'], ['dark', 'Gelap'], ['light', 'Terang'], ['cover', 'Warna cover']].map(([v, l]) => `
                <button type="button" class="sf-chip ${cfg.style === v ? 'active' : ''}" data-ws="${v}">${l}</button>
              `).join('')}
            </div>

            <div style="font-size:13px;font-weight:800;margin:14px 0 8px;">Warna Aksen</div>
            <div class="sf-scroll-x" id="sf-wd-accents">
              ${accents.map(([val, lbl, bg]) => `
                <button type="button" data-wa="${val}" title="${lbl}" style="width:32px;height:32px;border-radius:999px;background:${bg};flex:0 0 auto;border:2.5px solid ${cfg.accent === val ? 'var(--text)' : 'transparent'};"></button>
              `).join('')}
            </div>
          </div>

          <div class="sf-card" style="overflow:hidden;">
            <div class="sf-list-row" style="flex-direction:column;align-items:stretch;gap:6px;">
              <div class="sf-row-between"><b style="font-size:13.5px;">Kilau kaca</b><span id="sf-wd-shine-v">${cfg.glassShine}%</span></div>
              <input type="range" class="sf-slider" id="sf-wd-shine" min="0" max="100" value="${cfg.glassShine}">
            </div>
            <div class="sf-list-row" style="flex-direction:column;align-items:stretch;gap:6px;">
              <div class="sf-row-between"><b style="font-size:13.5px;">Ketebalan kaca</b><span id="sf-wd-thick-v">${cfg.glassThickness}%</span></div>
              <input type="range" class="sf-slider" id="sf-wd-thick" min="0" max="100" value="${cfg.glassThickness}">
            </div>
            <div class="sf-list-row" style="flex-direction:column;align-items:stretch;gap:6px;">
              <div class="sf-row-between"><b style="font-size:13.5px;">Kebulatan sudut</b><span id="sf-wd-rad-v">${cfg.cornerRadius}px</span></div>
              <input type="range" class="sf-slider" id="sf-wd-rad" min="8" max="32" value="${cfg.cornerRadius}">
            </div>
            <div class="sf-list-row">
              <b style="font-size:13.5px;">Bentuk cover</b>
              <select id="sf-wd-shape" style="padding:7px 10px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);font-weight:700;">
                <option value="rounded" ${cfg.coverShape === 'rounded' ? 'selected' : ''}>Membulat</option>
                <option value="circle" ${cfg.coverShape === 'circle' ? 'selected' : ''}>Lingkaran</option>
                <option value="square" ${cfg.coverShape === 'square' ? 'selected' : ''}>Kotak</option>
              </select>
            </div>
            <div class="sf-list-row">
              <b style="font-size:13.5px;">Ukuran teks</b>
              <select id="sf-wd-tsize" style="padding:7px 10px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);font-weight:700;">
                <option value="small" ${cfg.textSize === 'small' ? 'selected' : ''}>Kecil</option>
                <option value="medium" ${cfg.textSize === 'medium' ? 'selected' : ''}>Normal</option>
                <option value="large" ${cfg.textSize === 'large' ? 'selected' : ''}>Besar</option>
              </select>
            </div>
            <div class="sf-list-row">
              <b style="font-size:13.5px;">Tombol putar</b>
              <select id="sf-wd-pbtn" style="padding:7px 10px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);font-weight:700;">
                <option value="round" ${cfg.playButtonStyle === 'round' ? 'selected' : ''}>Bulat Solid</option>
                <option value="plain" ${cfg.playButtonStyle === 'plain' ? 'selected' : ''}>Polos</option>
              </select>
            </div>
          </div>

          <div class="sf-card" style="overflow:hidden;">
            ${[
              ['showCover', 'Tampilkan Sampul'],
              ['showArtist', 'Tampilkan Nama Artis'],
              ['showStreak', 'Tampilkan Streak Percikan'],
              ['showProgress', 'Tampilkan Bar Progres'],
              ['showTime', 'Tampilkan Waktu'],
              ['showLike', 'Tampilkan Tombol Suka'],
            ].map(([k, l]) => `
              <div class="sf-list-row">
                <b style="font-size:13.5px;">${l}</b>
                <button type="button" class="sf-switch ${cfg[k] !== false ? 'on' : ''}" data-wtog="${k}"></button>
              </div>
            `).join('')}
          </div>
        </div>
      `,
      onBind(body, root) {
        const refresh = () => {
          const pv = body.querySelector('#sf-wd-preview');
          if (pv) pv.innerHTML = renderPreviewHtml();
        };
        body.querySelectorAll('[data-ws]').forEach((b) => {
          b.onclick = () => {
            cfg.style = b.getAttribute('data-ws');
            body.querySelectorAll('[data-ws]').forEach((x) => x.classList.toggle('active', x === b));
            refresh();
          };
        });
        body.querySelectorAll('[data-wa]').forEach((b) => {
          b.onclick = () => {
            cfg.accent = b.getAttribute('data-wa');
            body.querySelectorAll('[data-wa]').forEach((x) => { x.style.borderColor = x === b ? 'var(--text)' : 'transparent'; });
            refresh();
          };
        });
        body.querySelector('#sf-wd-shine').oninput = (e) => { cfg.glassShine = Number(e.target.value); body.querySelector('#sf-wd-shine-v').textContent = cfg.glassShine + '%'; refresh(); };
        body.querySelector('#sf-wd-thick').oninput = (e) => { cfg.glassThickness = Number(e.target.value); body.querySelector('#sf-wd-thick-v').textContent = cfg.glassThickness + '%'; refresh(); };
        body.querySelector('#sf-wd-rad').oninput = (e) => { cfg.cornerRadius = Number(e.target.value); body.querySelector('#sf-wd-rad-v').textContent = cfg.cornerRadius + 'px'; refresh(); };
        body.querySelector('#sf-wd-shape').onchange = (e) => { cfg.coverShape = e.target.value; refresh(); };
        body.querySelector('#sf-wd-tsize').onchange = (e) => { cfg.textSize = e.target.value; refresh(); };
        body.querySelector('#sf-wd-pbtn').onchange = (e) => { cfg.playButtonStyle = e.target.value; refresh(); };
        body.querySelectorAll('[data-wtog]').forEach((b) => {
          b.onclick = () => {
            const k = b.getAttribute('data-wtog');
            cfg[k] = !(cfg[k] !== false);
            b.classList.toggle('on', cfg[k]);
            refresh();
          };
        });
        root.querySelector('#sf-wd-done').onclick = () => {
          SF.store.setWidgetCfg(cfg);
          SF.ui.toast('Pengaturan Widget disinkronkan ke 5 Widget Native!');
          SF.ui.closeSubpage();
        };
      },
    });
  }

  // =========================================================================
  // 4. 5-BAND HARDWARE EQUALIZER + SPEED/PITCH/VARISPEED
  // =========================================================================
  const EQ_PRESETS = {
    Flat: [0, 0, 0, 0, 0],
    'Bass Boost': [7, 5, 1, 0, 1],
    Pop: [-1, 3, 5, 3, -1],
    Rock: [5, 2, -1, 3, 5],
    Vokal: [-2, 1, 5, 4, 1],
    Akustik: [3, 2, 1, 3, 2],
    EDM: [6, 4, 0, 3, 6],
    Malam: [2, 1, 0, -2, -3],
  };

  function openEqualizer() {
    const eq = Object.assign({ enabled: false, preset: 'Flat', bands: [0, 0, 0, 0, 0], speed: 1.0, pitch: 1.0 }, SF.store.state.eq);
    const freqs = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'];

    SF.ui.openSubpage({
      id: 'tool-eq',
      title: 'Ekualiser & Audio DSP',
      bodyHtml: `
        <div class="sf-stack" style="gap:14px;">
          <div class="sf-card sf-list-row">
            <div><b style="font-size:15px;">Aktifkan Ekualiser 5-Band</b><div class="sf-muted" style="font-size:12px;">Hardware DSP di APK & WebAudio di Browser</div></div>
            <button type="button" class="sf-switch ${eq.enabled ? 'on' : ''}" id="sf-eq-on"></button>
          </div>

          <div class="sf-scroll-x" id="sf-eq-presets">
            ${Object.keys(EQ_PRESETS).map((p) => `<button type="button" class="sf-chip ${eq.preset === p ? 'active' : ''}" data-ep="${esc(p)}">${esc(p)}</button>`).join('')}
          </div>

          <div class="sf-card" style="padding:18px 12px;">
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;text-align:center;">
              ${freqs.map((f, i) => `
                <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
                  <span id="sf-eq-v-${i}" style="font-size:11.5px;font-weight:800;">${eq.bands[i] > 0 ? '+' : ''}${eq.bands[i]}dB</span>
                  <div style="height:130px;display:flex;align-items:center;justify-content:center;">
                    <input type="range" class="sf-slider" data-eb="${i}" min="-12" max="12" step="1" value="${eq.bands[i]}" style="width:120px;transform:rotate(-90deg);">
                  </div>
                  <span class="sf-muted" style="font-size:11px;font-weight:700;">${f}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="sf-card" style="overflow:hidden;">
            <div class="sf-list-row" style="flex-direction:column;align-items:stretch;gap:8px;">
              <div class="sf-row-between"><b>Kecepatan Pemutaran</b><span id="sf-eq-spd-v" style="font-weight:800;">${Number(eq.speed).toFixed(2)}x</span></div>
              <input type="range" class="sf-slider" id="sf-eq-spd" min="0.5" max="2.0" step="0.05" value="${eq.speed}">
            </div>
            <div class="sf-list-row" style="flex-direction:column;align-items:stretch;gap:8px;">
              <div class="sf-row-between"><b>Nada / Varispeed (Pitch)</b><span id="sf-eq-pit-v" style="font-weight:800;">${Number(eq.pitch).toFixed(2)}x</span></div>
              <input type="range" class="sf-slider" id="sf-eq-pit" min="0.7" max="1.4" step="0.05" value="${eq.pitch}">
            </div>
          </div>
          <button type="button" class="sf-pill-btn soft" id="sf-eq-reset" style="width:100%;">Reset ke Flat (1.0x)</button>
        </div>
      `,
      onBind(body) {
        const commit = () => {
          SF.store.setEq(eq);
          SF.audio.applyAudioPrefs();
        };
        body.querySelector('#sf-eq-on').onclick = (e) => {
          eq.enabled = !eq.enabled;
          e.currentTarget.classList.toggle('on', eq.enabled);
          commit();
        };
        body.querySelectorAll('[data-ep]').forEach((b) => {
          b.onclick = () => {
            const name = b.getAttribute('data-ep');
            eq.preset = name;
            eq.enabled = true;
            eq.bands = EQ_PRESETS[name].slice();
            body.querySelector('#sf-eq-on').classList.add('on');
            body.querySelectorAll('[data-ep]').forEach((x) => x.classList.toggle('active', x === b));
            eq.bands.forEach((v, i) => {
              const inp = body.querySelector(`[data-eb="${i}"]`);
              const lbl = body.querySelector(`#sf-eq-v-${i}`);
              if (inp) inp.value = v;
              if (lbl) lbl.textContent = `${v > 0 ? '+' : ''}${v}dB`;
            });
            commit();
          };
        });
        body.querySelectorAll('[data-eb]').forEach((inp) => {
          inp.oninput = () => {
            const i = parseInt(inp.getAttribute('data-eb'), 10);
            const v = Number(inp.value);
            eq.bands[i] = v;
            eq.preset = 'Custom';
            eq.enabled = true;
            body.querySelector('#sf-eq-on').classList.add('on');
            const lbl = body.querySelector(`#sf-eq-v-${i}`);
            if (lbl) lbl.textContent = `${v > 0 ? '+' : ''}${v}dB`;
            commit();
          };
        });
        body.querySelector('#sf-eq-spd').oninput = (e) => {
          eq.speed = Number(e.target.value);
          body.querySelector('#sf-eq-spd-v').textContent = eq.speed.toFixed(2) + 'x';
          commit();
        };
        body.querySelector('#sf-eq-pit').oninput = (e) => {
          eq.pitch = Number(e.target.value);
          body.querySelector('#sf-eq-pit-v').textContent = eq.pitch.toFixed(2) + 'x';
          commit();
        };
        body.querySelector('#sf-eq-reset').onclick = () => {
          eq.enabled = false;
          eq.preset = 'Flat';
          eq.bands = [0, 0, 0, 0, 0];
          eq.speed = 1.0;
          eq.pitch = 1.0;
          commit();
          SF.ui.closeSubpage();
          openEqualizer();
        };
      },
    });
  }

  // =========================================================================
  // 5. KENALI LAGU (RADAR + SPEECH RECOGNITION + LYRIC SNIPPET FALLBACK)
  // =========================================================================
  function openRecognize() {
    let recognition = null;
    let listening = false;

    SF.ui.openSubpage({
      id: 'tool-recognize',
      title: 'Kenali Lagu',
      bodyHtml: `
        <div class="sf-stack" style="gap:16px;align-items:center;text-align:center;padding-top:14px;">
          <div style="position:relative;width:140px;height:140px;display:flex;align-items:center;justify-content:center;">
            <span class="sf-radar-ring" id="sf-rec-r1" style="display:none;"></span>
            <span class="sf-radar-ring" id="sf-rec-r2" style="display:none;animation-delay:0.8s;"></span>
            <button type="button" id="sf-rec-mic" style="position:relative;z-index:2;width:92px;height:92px;border-radius:999px;background:var(--accent);color:#05130A;display:flex;align-items:center;justify-content:center;box-shadow:0 16px 36px rgba(29,185,84,0.34);">
              ${SF.icons.mic(34)}
            </button>
          </div>
          <div>
            <div id="sf-rec-status" style="font-size:17px;font-weight:900;">Ketuk mikrofon untuk mendengarkan</div>
            <div id="sf-rec-transcript" class="sf-muted" style="font-size:13px;margin-top:4px;">Nyanyikan atau dekatkan ke sumber lagu / lirik</div>
          </div>

          <div class="sf-card" style="width:100%;padding:14px;text-align:left;">
            <div style="font-size:12.5px;font-weight:800;margin-bottom:8px;">Atau ketik potongan lirik yang diingat</div>
            <div class="sf-row-gap">
              <input id="sf-rec-input" type="text" placeholder="Contoh: ku kira kita akan bersama..." style="flex:1;padding:11px 13px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:14px;outline:none;">
              <button type="button" class="sf-pill-btn accent" id="sf-rec-search">Cari</button>
            </div>
          </div>

          <div id="sf-rec-results" style="width:100%;text-align:left;"></div>
        </div>
      `,
      onBind(body) {
        const statusEl = body.querySelector('#sf-rec-status');
        const transEl = body.querySelector('#sf-rec-transcript');
        const resEl = body.querySelector('#sf-rec-results');
        const r1 = body.querySelector('#sf-rec-r1');
        const r2 = body.querySelector('#sf-rec-r2');

        async function findByText(q) {
          const clean = String(q || '').trim();
          if (!clean) return;
          statusEl.textContent = `Mencocokkan "${clean}"...`;
          resEl.innerHTML = `<div class="sf-card" style="padding:18px;text-align:center;">Mencari lagu yang cocok...</div>`;
          const data = await SF.api.searchAll(clean, 'tracks');
          const tracks = data.tracks || [];
          statusEl.textContent = tracks.length ? `Ditemukan ${tracks.length} kecocokan` : 'Belum ketemu, coba potongan lain';
          resEl.innerHTML = tracks.length
            ? `<div class="sf-card" style="padding:6px;">${tracks.slice(0, 8).map((t, i) => SF.ui.renderTrackRow(t, i, 'rec')).join('')}</div>`
            : '';
          SF.ui.bindTrackList(resEl, tracks.slice(0, 8), 'Kenali Lagu');
        }

        function setListening(on) {
          listening = on;
          r1.style.display = on ? 'block' : 'none';
          r2.style.display = on ? 'block' : 'none';
        }

        body.querySelector('#sf-rec-mic').onclick = () => {
          const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (!SR) {
            statusEl.textContent = 'Mikrofon suara tidak didukung di perangkat ini';
            transEl.textContent = 'Silakan ketik potongan lirik di kolom bawah.';
            return;
          }
          if (listening && recognition) {
            try { recognition.stop(); } catch {}
            setListening(false);
            statusEl.textContent = 'Ketuk mikrofon untuk mendengarkan';
            return;
          }
          recognition = new SR();
          recognition.lang = SF.store.state.prefs.lang === 'en' ? 'en-US' : 'id-ID';
          recognition.interimResults = true;
          recognition.maxAlternatives = 1;
          setListening(true);
          statusEl.textContent = 'Mendengarkan...';
          transEl.textContent = 'Dekatkan mikrofon ke musik atau ucapkan liriknya';

          recognition.onresult = (ev) => {
            const text = Array.from(ev.results).map((r) => r[0].transcript).join(' ').trim();
            transEl.textContent = `"${text}"`;
            if (ev.results[ev.results.length - 1].isFinal && text) {
              setListening(false);
              body.querySelector('#sf-rec-input').value = text;
              findByText(text);
            }
          };
          recognition.onerror = () => {
            setListening(false);
            statusEl.textContent = 'Suara belum jelas — coba lagi atau ketik lirik';
          };
          recognition.onend = () => setListening(false);
          try { recognition.start(); } catch { setListening(false); }
        };

        body.querySelector('#sf-rec-search').onclick = () => findByText(body.querySelector('#sf-rec-input').value);
        body.querySelector('#sf-rec-input').onkeydown = (e) => {
          if (e.key === 'Enter') findByText(e.target.value);
        };
      },
      onClose() {
        if (recognition) {
          try { recognition.stop(); } catch {}
          recognition = null;
        }
      },
    });
  }

  // =========================================================================
  // 6. DENGAR BERSAMA (JAM ROOM VIA SF.api.jam*)
  // =========================================================================
  let jamPollTimer = null;
  let activeJamCode = '';
  let activeJamRole = '';

  function openJam() {
    SF.ui.openSubpage({
      id: 'tool-jam',
      title: 'Dengar Bersama (Jam)',
      bodyHtml: `
        <div class="sf-stack" style="gap:14px;">
          <div class="sf-card" style="padding:18px;">
            <div style="font-size:17px;font-weight:900;">Sinkronkan Musik Real-Time</div>
            <div class="sf-muted" style="font-size:13px;margin-top:4px;line-height:1.4;">Buat ruangan lalu bagikan kode 6 karakter ke teman agar memutar lagu yang sama secara serentak.</div>
            <div id="sf-jam-active" style="margin-top:14px;"></div>
            <div class="sf-row-gap" style="margin-top:14px;">
              <button type="button" class="sf-pill-btn accent" id="sf-jam-create" style="flex:1;">Buat Ruangan</button>
            </div>
          </div>

          <div class="sf-card" style="padding:18px;">
            <div style="font-size:14.5px;font-weight:800;margin-bottom:8px;">Gabung Ruangan Teman</div>
            <div class="sf-row-gap">
              <input id="sf-jam-code-inp" type="text" maxlength="8" placeholder="Kode 6 karakter..." style="flex:1;padding:11px 13px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:15px;font-weight:800;text-transform:uppercase;outline:none;">
              <button type="button" class="sf-pill-btn" id="sf-jam-join">Gabung</button>
            </div>
          </div>
        </div>
      `,
      onBind(body) {
        const box = body.querySelector('#sf-jam-active');
        function renderStatus() {
          if (!activeJamCode) {
            box.innerHTML = '';
            return;
          }
          box.innerHTML = `
            <div class="sf-card-soft" style="padding:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div>
                <div style="font-size:11.5px;font-weight:800;color:var(--accent);">${activeJamRole === 'host' ? 'HOST AKTIF' : 'TERHUBUNG'}</div>
                <div style="font-size:20px;font-weight:900;letter-spacing:0.12em;">${esc(activeJamCode)}</div>
              </div>
              <div class="sf-row-gap">
                <button type="button" class="sf-pill-btn soft" id="sf-jam-copy" style="padding:7px 12px;font-size:12px;">Salin</button>
                <button type="button" class="sf-pill-btn soft" id="sf-jam-leave" style="padding:7px 12px;font-size:12px;">Keluar</button>
              </div>
            </div>
          `;
          box.querySelector('#sf-jam-copy').onclick = () => {
            navigator.clipboard?.writeText(`Gabung Jam SpotyFlow kode: ${activeJamCode}\nhttps://spotyflow.vercel.app/?jam=${activeJamCode}`).then(() => SF.ui.toast('Kode & tautan Jam disalin'));
          };
          box.querySelector('#sf-jam-leave').onclick = () => {
            if (jamPollTimer) clearInterval(jamPollTimer);
            jamPollTimer = null;
            activeJamCode = '';
            activeJamRole = '';
            renderStatus();
            SF.ui.toast('Keluar dari ruangan Jam');
          };
        }

        renderStatus();

        body.querySelector('#sf-jam-create').onclick = async () => {
          try {
            const st = SF.store.state;
            const res = await SF.api.jamCreate(st.profile?.name || 'Host', {
              track: st.currentTrack,
              isPlaying: st.isPlaying,
              currentTime: st.currentTime,
            });
            activeJamCode = String(res?.code || res?.roomCode || Math.random().toString(36).slice(2, 8).toUpperCase());
            activeJamRole = 'host';
            renderStatus();
            if (jamPollTimer) clearInterval(jamPollTimer);
            jamPollTimer = setInterval(() => {
              if (!activeJamCode || activeJamRole !== 'host') return;
              const s = SF.store.state;
              SF.api.jamUpdate(activeJamCode, {
                track: s.currentTrack,
                isPlaying: s.isPlaying,
                currentTime: s.currentTime,
                updatedAt: Date.now(),
              }).catch(() => {});
            }, 3500);
            SF.ui.toast(`Ruangan ${activeJamCode} dibuat!`);
          } catch {
            SF.ui.toast('Gagal membuat ruangan Jam');
          }
        };

        body.querySelector('#sf-jam-join').onclick = async () => {
          const code = (body.querySelector('#sf-jam-code-inp').value || '').trim().toUpperCase();
          if (code.length < 4) return SF.ui.toast('Masukkan kode ruangan yang valid');
          try {
            const data = await SF.api.jamGetState(code);
            activeJamCode = code;
            activeJamRole = 'guest';
            renderStatus();
            const applyRemote = (rem) => {
              const s = rem?.state || rem;
              if (s?.track && s.track.id !== SF.store.state.currentTrack?.id) {
                SF.audio.playTrack(s.track, [s.track], 0, `Jam • ${code}`, Number(s.currentTime || 0));
              }
            };
            applyRemote(data);
            if (jamPollTimer) clearInterval(jamPollTimer);
            jamPollTimer = setInterval(async () => {
              if (!activeJamCode || activeJamRole !== 'guest') return;
              try { applyRemote(await SF.api.jamGetState(activeJamCode)); } catch {}
            }, 4000);
            SF.ui.toast(`Bergabung ke ruangan ${code}`);
          } catch {
            SF.ui.toast('Ruangan tidak ditemukan');
          }
        };
      },
    });
  }

  // =========================================================================
  // 7. STATISTIK & RECAP (5-SLIDE SHAREABLE PNG)
  // =========================================================================
  function openStats() {
    const st = SF.store.state;
    const totalMin = Math.round((st.stats?.totalListenSec || 0) / 60);
    const totalPlays = Number(st.stats?.totalPlays || 0);
    const topTracks = SF.store.getTop50Tracks().slice(0, 5);
    const artistCount = new Map();
    for (const t of st.history) {
      if (!t?.artist) continue;
      artistCount.set(t.artist, (artistCount.get(t.artist) || 0) + 1);
    }
    const topArtists = Array.from(artistCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

    SF.ui.openSubpage({
      id: 'tool-stats',
      title: 'Statistik dan Recap',
      actionsHtml: '<button type="button" class="sf-pill-btn accent" id="sf-st-recap-btn" style="padding:7px 12px;font-size:12px;">Recap 5-Slide</button>',
      bodyHtml: `
        <div class="sf-stack" style="gap:14px;">
          <div class="sf-grid-2">
            <div class="sf-card" style="padding:16px;">
              <div class="sf-muted" style="font-size:12px;font-weight:700;">Total Menit Dengar</div>
              <div style="font-size:28px;font-weight:900;margin-top:4px;">${totalMin}</div>
            </div>
            <div class="sf-card" style="padding:16px;">
              <div class="sf-muted" style="font-size:12px;font-weight:700;">Total Pemutaran</div>
              <div style="font-size:28px;font-weight:900;margin-top:4px;">${totalPlays}</div>
            </div>
          </div>

          <div class="sf-streak-card">
            <div class="sf-row-gap" style="gap:14px;">
              <div class="sf-streak-orb">${SF.icons.flame(28)}</div>
              <div>
                <div style="font-size:20px;font-weight:900;">${Number(st.streak?.count || 0)} hari berturut-turut</div>
                <div class="sf-muted" style="font-size:12.5px;">Rekor terbaik: ${Number(st.streak?.best || 0)} hari • Hari ini: ${Math.round(st.streak?.minutesToday || 0)} menit</div>
              </div>
            </div>
          </div>

          ${topTracks.length ? `
            <div>
              <div class="sf-sec-head" style="margin-top:0;"><h2 class="sf-sec-title">Lagu Teratas</h2></div>
              <div class="sf-card" style="padding:6px;" id="sf-stats-tracks">
                ${topTracks.map((t, i) => SF.ui.renderTrackRow(t, i, 'stats')).join('')}
              </div>
            </div>
          ` : ''}

          ${topArtists.length ? `
            <div>
              <div class="sf-sec-head" style="margin-top:0;"><h2 class="sf-sec-title">Artis Teratas</h2></div>
              <div class="sf-card" style="overflow:hidden;">
                ${topArtists.map(([name, cnt], idx) => `
                  <button type="button" class="sf-list-row" data-sa="${esc(name)}">
                    <span class="sf-row-gap"><b style="width:20px;color:var(--accent);">#${idx + 1}</b><b>${esc(name)}</b></span>
                    <span class="sf-muted" style="font-size:12.5px;">${cnt}x diputar</span>
                  </button>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `,
      onBind(body, root) {
        SF.ui.bindTrackList(body.querySelector('#sf-stats-tracks'), topTracks, 'Lagu Teratas');
        body.querySelectorAll('[data-sa]').forEach((b) => {
          b.onclick = () => SF.views.openArtistProfile(b.getAttribute('data-sa'));
        });
        root.querySelector('#sf-st-recap-btn').onclick = () => openRecapSlidesModal({ totalMin, totalPlays, topTracks, topArtists });
      },
    });
  }

  function openRecapSlidesModal(data) {
    const slides = [
      { bg: ['#1DB954', '#0EA5E9'], k: 'SPOTYFLOW RECAP', big: `${data.totalMin} Menit`, sub: `Kamu telah memutar ${data.totalPlays} lagu di SpotyFlow!` },
      { bg: ['#F97316', '#EC4899'], k: 'STREAK PERCIKAN', big: `${Number(SF.store.state.streak?.count || 0)} Hari`, sub: `Rekor terbaikmu mencapai ${Number(SF.store.state.streak?.best || 0)} hari berturut-turut.` },
      { bg: ['#6366F1', '#A855F7'], k: 'LAGU #1 KAMU', big: data.topTracks[0]?.title || 'Belum ada', sub: data.topTracks[0]?.artist || 'Putar lagu favoritmu untuk mengisi Recap' },
      { bg: ['#0EA5E9', '#14B8A6'], k: 'ARTIS #1 KAMU', big: data.topArtists[0]?.[0] || 'SpotyFlow', sub: data.topArtists[0] ? `Diputar ${data.topArtists[0][1]} kali` : 'Terus eksplorasi musik baru!' },
      { bg: ['#111215', '#374151'], k: 'SPOTYFLOW v4.0.0', big: SF.store.state.profile?.name || 'Pendengar', sub: `${SF.store.state.likedTracks.length} lagu disukai • ${SF.store.state.playlists.length} playlist` },
    ];
    let idx = 0;

    function renderSlide() {
      const s = slides[idx];
      return `
        <div style="border-radius:22px;padding:28px 20px;min-height:290px;color:#FFF;background:linear-gradient(135deg,${s.bg[0]},${s.bg[1]});display:flex;flex-direction:column;justify-content:space-between;">
          <div style="display:flex;gap:4px;">${slides.map((_, i) => `<span style="flex:1;height:3px;border-radius:99px;background:${i <= idx ? '#FFF' : 'rgba(255,255,255,0.3)'};"></span>`).join('')}</div>
          <div style="margin:24px 0;">
            <div style="font-size:11px;font-weight:800;letter-spacing:0.14em;opacity:0.85;">${esc(s.k)}</div>
            <div style="font-size:30px;font-weight:900;line-height:1.14;margin-top:8px;">${esc(s.big)}</div>
            <div style="font-size:14px;opacity:0.88;margin-top:8px;line-height:1.4;">${esc(s.sub)}</div>
          </div>
          <div style="font-size:11px;opacity:0.75;font-weight:700;">SpotyFlow • Slide ${idx + 1}/5</div>
        </div>
      `;
    }

    SF.ui.openModal(
      `
      <div id="sf-rc-stage">${renderSlide()}</div>
      <div class="sf-row-between" style="margin-top:12px;">
        <button type="button" class="sf-pill-btn soft" id="sf-rc-prev">Sebelumnya</button>
        <button type="button" class="sf-pill-btn accent" id="sf-rc-png">Simpan PNG</button>
        <button type="button" class="sf-pill-btn soft" id="sf-rc-next">Lanjut</button>
      </div>
      `,
      (sheet) => {
        const update = () => { sheet.querySelector('#sf-rc-stage').innerHTML = renderSlide(); };
        sheet.querySelector('#sf-rc-prev').onclick = () => { idx = (idx - 1 + slides.length) % slides.length; update(); };
        sheet.querySelector('#sf-rc-next').onclick = () => { idx = (idx + 1) % slides.length; update(); };
        sheet.querySelector('#sf-rc-png').onclick = () => {
          const s = slides[idx];
          const c = document.createElement('canvas');
          c.width = 1080;
          c.height = 1350;
          const ctx = c.getContext('2d');
          const g = ctx.createLinearGradient(0, 0, 1080, 1350);
          g.addColorStop(0, s.bg[0]);
          g.addColorStop(1, s.bg[1]);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 1080, 1350);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 34px sans-serif';
          ctx.fillText(s.k, 80, 180);
          ctx.font = '900 84px sans-serif';
          ctx.fillText(String(s.big).slice(0, 22), 80, 560);
          ctx.font = '600 40px sans-serif';
          ctx.fillText(String(s.sub).slice(0, 44), 80, 650);
          ctx.font = 'bold 32px sans-serif';
          ctx.fillText('SpotyFlow v4.0.0', 80, 1240);
          const dataUrl = c.toDataURL('image/png');
          const br = SF.utils.getBridge();
          if (br?.savePosterToGallery) {
            br.savePosterToGallery(dataUrl.split(',')[1], `SpotyFlow_Recap_${Date.now()}.png`);
            SF.ui.toast('Recap disimpan ke Galeri HP!');
          } else {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `spotyflow-recap-${idx + 1}.png`;
            a.click();
            SF.ui.toast('PNG Recap diunduh');
          }
        };
      }
    );
  }

  // =========================================================================
  // 8. IMPOR PLAYLIST (SPOTIFY / YOUTUBE MUSIC)
  // =========================================================================
  function openImportPlaylist(source = 'spotify') {
    const label = source === 'ytm' ? 'YouTube Music' : 'Spotify';
    SF.ui.openModal(
      `
      <div class="sf-row-between" style="margin-bottom:10px;">
        <b style="font-size:17px;">Impor Playlist ${esc(label)}</b>
        <button type="button" class="sf-icon-btn" id="sf-imp-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-muted" style="font-size:13px;margin-bottom:12px;line-height:1.4;">Tempel tautan playlist publik dari Spotify atau YouTube Music. Daftar lagu akan langsung masuk ke tab Pustaka.</div>
      <input id="sf-imp-url" type="url" placeholder="https://open.spotify.com/playlist/... atau youtube.com/playlist?list=..." style="width:100%;padding:12px 14px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:13.5px;outline:none;margin-bottom:12px;">
      <button type="button" class="sf-pill-btn accent" id="sf-imp-go" style="width:100%;">Impor Sekarang</button>
      `,
      (sheet) => {
        sheet.querySelector('#sf-imp-close').onclick = SF.ui.closeModal;
        sheet.querySelector('#sf-imp-go').onclick = async () => {
          const url = sheet.querySelector('#sf-imp-url').value.trim();
          if (!url) return SF.ui.toast('Tempel tautan playlist terlebih dahulu');
          const btn = sheet.querySelector('#sf-imp-go');
          btn.textContent = 'Mengimpor...';
          btn.disabled = true;
          try {
            const res = await SF.api.importExternalPlaylist(url);
            if (!res.tracks.length) throw new Error('Kosong');
            SF.store.createPlaylist(res.name, res.tracks);
            SF.ui.closeModal();
            SF.ui.toast(`Berhasil impor "${res.name}" (${res.tracks.length} lagu)`);
            SF.views.openTab('library');
          } catch {
            btn.textContent = 'Impor Sekarang';
            btn.disabled = false;
            SF.ui.toast('Gagal mengimpor. Pastikan playlist bersifat publik.');
          }
        };
      }
    );
  }

  SF.settings = {
    init() {},
    openMain,
    openCategory,
    openWidgetEditor,
    openEqualizer,
    openRecognize,
    openJam,
    openStats,
    openImportPlaylist,
  };
})();
