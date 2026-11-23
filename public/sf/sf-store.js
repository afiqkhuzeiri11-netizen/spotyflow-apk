(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});

  // =========================================================================
  // 1. EVENT BUS (Isolated, Error-Safe Pub/Sub)
  // =========================================================================
  const listeners = new Map();
  const bus = {
    on(event, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => bus.off(event, fn);
    },
    off(event, fn) {
      const set = listeners.get(event);
      if (set) set.delete(fn);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set || !set.size) return;
      for (const fn of Array.from(set)) {
        try {
          fn(payload);
        } catch (err) {
          console.warn('[SF.bus]', event, err);
        }
      }
    },
  };

  // =========================================================================
  // 2. SAFE UTILITIES (Zero Null Crashes, Zero Placeholder Dots)
  // =========================================================================
  const ART_GRADIENTS = [
    ['#6366F1', '#A855F7', '99, 102, 241'],
    ['#0EA5E9', '#14B8A6', '14, 165, 233'],
    ['#F97316', '#EC4899', '249, 115, 22'],
    ['#10B981', '#059669', '16, 185, 129'],
    ['#8B5CF6', '#EC4899', '139, 92, 246'],
    ['#3B82F6', '#6366F1', '59, 130, 246'],
  ];

  function hashSeed(str) {
    const s = String(str || 'SpotyFlow');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    return h % ART_GRADIENTS.length;
  }

  const utils = {
    escapeHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
    formatTime(sec) {
      const s = Math.max(0, Math.floor(Number(sec) || 0));
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${m}:${r < 10 ? '0' : ''}${r}`;
    },
    formatRemaining(cur, dur) {
      const rem = Math.max(0, Math.floor((Number(dur) || 0) - (Number(cur) || 0)));
      return '-' + utils.formatTime(rem);
    },
    isValidVideoId(id) {
      return typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id.trim());
    },
    getPalette(seed) {
      return ART_GRADIENTS[hashSeed(seed)];
    },
    getCoverUrl(track) {
      if (!track) return '';
      const cand =
        track.cover ||
        track.coverUrl ||
        track.album?.cover_xl ||
        track.album?.cover_big ||
        track.album?.cover_medium ||
        track.album?.cover ||
        track.thumbnail ||
        '';
      const s = String(cand || '').trim();
      if (!s || s.includes('icon-512.png') || s.includes('icon-192.png')) return '';
      return s;
    },
    normalizeTrack(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const title = String(raw.title || raw.name || '').trim();
      if (!title) return null;
      const artistName =
        typeof raw.artist === 'string'
          ? raw.artist.trim()
          : String(raw.artist?.name || raw.channelTitle || raw.uploader || 'Artis').trim();
      const artistId = typeof raw.artist === 'object' ? String(raw.artist?.id || '') : '';
      const albumTitle =
        typeof raw.album === 'string'
          ? raw.album.trim()
          : String(raw.album?.title || '').trim();
      const albumId = typeof raw.album === 'object' ? String(raw.album?.id || '') : '';
      const rawVid = String(raw.videoId || raw.ytId || '').trim();
      const videoId = utils.isValidVideoId(rawVid) ? rawVid : '';
      const cover = utils.getCoverUrl(raw);
      const dur = Math.max(0, Math.round(Number(raw.duration || raw.durationSec || 0)));
      const streamUrl = String(raw.localUri || raw.objectUrl || raw.streamUrl || '').trim();
      const isLocal = Boolean(
        raw.isLocal ||
        raw.isLocalDevice ||
        streamUrl.startsWith('blob:') ||
        streamUrl.startsWith('content://') ||
        streamUrl.startsWith('file://')
      );
      const id = String(
        raw.id ||
        (videoId ? 'yt_' + videoId : '') ||
        ('tr_' + (title + '_' + artistName).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 42))
      );
      return {
        id,
        videoId,
        title,
        artist: artistName || 'Artis',
        artistId,
        album: albumTitle,
        albumId,
        cover,
        duration: dur,
        streamUrl,
        isLocal,
        source: String(raw.source || (isLocal ? 'local' : (videoId ? 'youtube' : 'catalog'))),
      };
    },
    isNativeApk() {
      try {
        if (window.SpotyFlowMediaBridge) return true;
        if (window.Capacitor?.isNativePlatform?.()) return true;
        if (String(navigator.userAgent || '').includes('SpotyFlowApp/')) return true;
        const proto = String(window.location?.protocol || '');
        if (proto === 'capacitor:') return true;
        return false;
      } catch {
        return false;
      }
    },
    getBridge() {
      try {
        return window.SpotyFlowMediaBridge || null;
      } catch {
        return null;
      }
    },
    haptic(ms = 10) {
      try {
        if (navigator.vibrate) navigator.vibrate(ms);
      } catch {}
    },
    debounce(fn, wait = 250) {
      let timer = null;
      return function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
      };
    },
    todayIso() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    formatFans(n) {
      const num = Number(n || 0);
      if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + ' jt pengikut';
      if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + ' rb pengikut';
      return num > 0 ? num + ' pengikut' : 'Artis Terverifikasi';
    },
  };

  // =========================================================================
  // 3. SAFE PERSISTENCE & PROTECTED WHITELIST
  // =========================================================================
  const PROTECTED_KEYS = new Set([
    'sf_v4_prefs',
    'sf_v4_liked',
    'sf_v4_playlists',
    'sf_v4_history',
    'sf_v4_stats',
    'sf_v4_streak',
    'sf_v4_queue',
    'sf_v4_alarms',
    'sf_v4_widget_cfg',
    'sf_v4_offline_meta',
    'sf_v4_uploaded',
    'sf_v4_search_history',
    'sf_v4_eq',
    'sf_v4_profile',
    'sf_v4_followed_artists',
    'sf_v4_saved_albums',
    'sf_custom_stickers_v1',
    'sf_v4_seen_welcome',
  ]);

  const SAFE_CACHE_PREFIXES = ['sf_lyrics_', 'sf_cache_', 'sf_search_cache_', 'sf_ai_lyrics_', 'sf_romanize_'];

  function safeGetJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed !== null && parsed !== undefined ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function evictOldestCacheEntries(count = 12) {
    try {
      const removable = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !PROTECTED_KEYS.has(k) && SAFE_CACHE_PREFIXES.some((p) => k.startsWith(p))) {
          removable.push(k);
        }
      }
      removable.slice(0, count).forEach((k) => localStorage.removeItem(k));
    } catch {}
  }

  function safeSet(key, val) {
    const serialized = typeof val === 'string' ? val : JSON.stringify(val);
    try {
      localStorage.setItem(key, serialized);
      return true;
    } catch {
      evictOldestCacheEntries(20);
      try {
        localStorage.setItem(key, serialized);
        return true;
      } catch {
        return false;
      }
    }
  }

  // =========================================================================
  // 4. DEFAULT PREFS, WIDGET CONFIG, EQ & STATE
  // =========================================================================
  const DEFAULT_PREFS = {
    // Suara & Pemutaran
    audioQuality: 'high', // auto | high | saver
    dataSaver: false,
    crossfadeSec: 0,
    historyThresholdSec: 30,
    skipSilence: false,
    skipSilenceInstant: false,
    normalizeAudio: false,
    loudnessLevel: 0,
    audioOffload: false,
    varispeed: false,
    hardwareAudioProcessing: true,
    progressiveSeek: false,
    // Timer Tidur
    sleepAutoEnabled: false,
    sleepRepeat: false,
    sleepStopAtEnd: false,
    sleepFadeOut: true,
    // Antrean (13 sakelar)
    persistentQueue: true,
    autoLoadMore: true,
    autoRadioQueue: true,
    autoplay: true,
    autoplayNoRepeat: true,
    disableAutoLoadOnRepeatAll: false,
    autoDownloadLiked: false,
    enableSimilarContent: true,
    persistentShuffle: false,
    rememberShuffleRepeat: true,
    shufflePlaylistFirst: false,
    preventQueueDuplicate: true,
    autoSkipOnError: true,
    // Pemutaran Lainnya (10 sakelar)
    stopOnTaskRemoved: false,
    pauseOnMute: false,
    resumeOnBluetooth: false,
    miniLyricsInPlayer: true,
    keepPlayingInGames: false,
    keepScreenOnPlayer: false,
    animatedCover: true,
    animatedCoverSpotify: false,
    videoModeEnabled: true,
    autoPlayVideoFromVideoTab: false,
    // Tampilan
    uiStyle: 'glass', // glass | editorial
    iconStyle: 'rounded', // rounded | sharp
    blurEnabled: true,
    glassLens: true,
    collapseNavOnScroll: true,
    iosAnimations: true,
    showHomeStreak: true,
    highRefreshRate: true,
    landscapeScale: 100,
    accentColor: '#1DB954',
    dynamicIconColor: true,
    appIconStyle: 'default',
    theme: 'light', // light | dark | amoled | system
    // Dynamic Island
    islandLyricsEnabled: true,
    islandOverlayEnabled: false,
    islandVerticalOffsetDp: 12,
    islandPillWidthDp: 215,
    // Pemutar Mini & Pemutar & Lirik & Lainnya
    swipeMiniPlayer: true,
    miniPlayerSensitivity: 50,
    miniShowProgress: true,
    hideNavLabels: false,
    gridSize: 'standard', // standard | large
    defaultTab: 'home', // home | search | library | you
    swipeTrackRow: true,
    showQueueNumbers: true,
    playerBgAdaptive: true,
    playerShowRemaining: true,
    playerShowVolumeBar: true,
    playerShowSourceMix: true,
    playerHapticFeedback: true,
    playerDoubleTapSeek: true,
    playerCompactControls: false,
    playerShowBitrate: false,
    playerAutoOpenOnPlay: false,
    blurOtherLyricLines: true,
    lyricsAutoTranslate: false,
    lyricsAutoRomanize: true,
    lyricsFontSize: 'medium', // small | medium | large
    lyricsAlign: 'left', // left | center
    lyricsOffsetSec: 0,
    lyricsKeepScreenOn: true,
    lyricsTapToSeek: true,
    lyricsShowTimestamps: false,
    // Bahasa & Konten & Privasi
    lang: 'id',
    region: 'ID',
    hideExplicit: false,
    pausePlayHistory: false,
    pauseSearchHistory: false,
    privateSession: false,
    // 6 Playlist Otomatis di Pustaka
    autoPlLiked: true,
    autoPlDownloaded: true,
    autoPlCached: true,
    autoPlDevice: true,
    autoPlTop50: true,
    autoPlUploaded: true,
    // Android Auto
    carAutoResume: true,
    carQueueView: true,
    carSteeringControls: true,
  };

  const DEFAULT_WIDGET_CFG = {
    style: 'glass',
    accentMode: 'cover',
    accentColorHex: '#7C3AED',
    glassShine: 70,
    glassThickness: 60,
    cornerRadiusPct: 66,
    coverShape: 'rounded',
    textSize: 'medium',
    playBtnStyle: 'round',
    showCover: true,
    showProgress: true,
    showTime: true,
    showLike: true,
    showPrevNext: true,
    showStreak: true,
  };

  const DEFAULT_EQ = {
    enabled: false,
    preset: 'Datar',
    bands: [0, 0, 0, 0, 0],
    speed: 1.0,
    pitch: 1.0,
  };

  const state = {
    currentTrack: null,
    sourceLabel: 'Andalanmu',
    queue: [],
    queueIndex: -1,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    volume: 0.85,
    playbackRate: 1.0,
    shuffle: false,
    repeat: 'off',
    videoMode: false,
    activeTab: 'home',
    likedTracks: [],
    playlists: [],
    history: [],
    playCounts: {},
    stats: { totalListenSec: 0, artistPlays: {} },
    offlineTracks: {},
    uploadedTracks: [],
    deviceTracks: [],
    searchHistory: [],
    followedArtists: [],
    savedAlbums: [],
    profile: { name: 'Pendengar SpotyFlow', bio: 'Penikmat musik di SpotyFlow', avatar: '', handle: '@spotyflow' },
    streak: { count: 1, lastDate: '', minutesToday: 0, todaySec: 0, best: 1 },
    alarms: [],
    eq: Object.assign({}, DEFAULT_EQ),
    widgetCfg: Object.assign({}, DEFAULT_WIDGET_CFG),
    prefs: Object.assign({}, DEFAULT_PREFS),
  };

  function migrateLegacyIfEmpty(v4Key, legacyKey, fallback) {
    const cur = safeGetJson(v4Key, null);
    if (cur !== null) return cur;
    const old = safeGetJson(legacyKey, null);
    if (old !== null) {
      safeSet(v4Key, old);
      return old;
    }
    return fallback;
  }

  function applyThemeToDocument() {
    const p = state.prefs;
    let effTheme = p.theme || 'light';
    if (effTheme === 'system') {
      try {
        effTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch {
        effTheme = 'light';
      }
    }
    if (!['light', 'dark', 'amoled'].includes(effTheme)) effTheme = 'light';
    const html = document.documentElement;
    html.setAttribute('data-theme', effTheme);
    html.setAttribute('data-style', p.uiStyle === 'editorial' ? 'editorial' : 'glass');
    html.setAttribute('data-blur', p.blurEnabled ? '1' : '0');
    html.setAttribute('data-lens', p.glassLens ? '1' : '0');
    html.setAttribute('data-hide-labels', p.hideNavLabels ? '1' : '0');
    if (p.accentColor) html.style.setProperty('--accent', p.accentColor);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', effTheme === 'light' ? '#F4F5F7' : (effTheme === 'amoled' ? '#000000' : '#0D0E12'));
    }

    const br = utils.getBridge();
    if (br && typeof br.setSystemBarTheme === 'function') {
      try { br.setSystemBarTheme(effTheme === 'light'); } catch {}
    }
    if (br && typeof br.setHighRefreshRate === 'function') {
      try { br.setHighRefreshRate(Boolean(p.highRefreshRate)); } catch {}
    }
    if (br && typeof br.setFloatingIslandConfig === 'function') {
      try {
        br.setFloatingIslandConfig(JSON.stringify({
          enabled: Boolean(p.islandOverlayEnabled),
          showLyrics: Boolean(p.islandLyricsEnabled),
          verticalOffsetDp: Number(p.islandVerticalOffsetDp || 12),
          pillWidthDp: Number(p.islandPillWidthDp || 215),
        }));
      } catch {}
    }
  }

  const store = {
    PROTECTED_KEYS,
    DEFAULT_PREFS,
    DEFAULT_WIDGET_CFG,
    state,
    safeSet,
    safeGetJson,
    applyThemeToDocument,
    init() {
      const loadedPrefs = safeGetJson('sf_v4_prefs', {});
      state.prefs = Object.assign({}, DEFAULT_PREFS, loadedPrefs);
      const rawLiked = migrateLegacyIfEmpty('sf_v4_liked', 'sf_liked_tracks', []);
      state.likedTracks = (Array.isArray(rawLiked) ? rawLiked : []).map(utils.normalizeTrack).filter(Boolean);
      const rawPls = migrateLegacyIfEmpty('sf_v4_playlists', 'sf_user_playlists', []);
      state.playlists = Array.isArray(rawPls) ? rawPls : [];
      const rawHist = migrateLegacyIfEmpty('sf_v4_history', 'sf_recent_tracks', []);
      state.history = (Array.isArray(rawHist) ? rawHist : []).map(utils.normalizeTrack).filter(Boolean);
      state.stats = Object.assign({ totalListenSec: 0, artistPlays: {} }, safeGetJson('sf_v4_stats', {}));
      const oldCounts = safeGetJson('sf_play_counts', {});
      state.playCounts = Object.assign({}, oldCounts, state.stats.playCounts || {});
      state.streak = Object.assign({ count: 1, lastDate: '', minutesToday: 0, todaySec: 0, best: 1 }, safeGetJson('sf_v4_streak', {}));
      state.alarms = safeGetJson('sf_v4_alarms', []);
      if (!Array.isArray(state.alarms)) state.alarms = [];
      state.eq = Object.assign({}, DEFAULT_EQ, safeGetJson('sf_v4_eq', {}));
      state.widgetCfg = Object.assign({}, DEFAULT_WIDGET_CFG, migrateLegacyIfEmpty('sf_v4_widget_cfg', 'sf_v3_widget_cfg', {}));
      state.offlineTracks = migrateLegacyIfEmpty('sf_v4_offline_meta', 'sf_offline_meta_v2', {});
      state.uploadedTracks = safeGetJson('sf_v4_uploaded', []);
      if (!Array.isArray(state.uploadedTracks)) state.uploadedTracks = [];
      state.searchHistory = migrateLegacyIfEmpty('sf_v4_search_history', 'sf_v3_search_history', []);
      if (!Array.isArray(state.searchHistory)) state.searchHistory = [];
      state.followedArtists = migrateLegacyIfEmpty('sf_v4_followed_artists', 'sf_followed_artists', []);
      if (!Array.isArray(state.followedArtists)) state.followedArtists = [];
      state.savedAlbums = migrateLegacyIfEmpty('sf_v4_saved_albums', 'sf_saved_albums', []);
      if (!Array.isArray(state.savedAlbums)) state.savedAlbums = [];
      state.profile = Object.assign(
        { name: 'Pendengar SpotyFlow', bio: 'Penikmat musik di SpotyFlow', avatar: '', handle: '@spotyflow' },
        migrateLegacyIfEmpty('sf_v4_profile', 'sf_user_profile', {})
      );

      if (state.prefs.persistentQueue) {
        const qData = safeGetJson('sf_v4_queue', null);
        if (qData && Array.isArray(qData.queue) && qData.queue.length) {
          state.queue = qData.queue.map(utils.normalizeTrack).filter(Boolean);
          state.queueIndex = Math.max(0, Math.min(state.queue.length - 1, Number(qData.queueIndex || 0)));
          state.currentTrack = state.queue[state.queueIndex] || null;
          if (state.prefs.rememberShuffleRepeat) {
            state.shuffle = Boolean(qData.shuffle);
            state.repeat = ['off', 'all', 'one'].includes(qData.repeat) ? qData.repeat : 'off';
          }
        }
      }
      if (state.prefs.persistentShuffle) state.shuffle = true;

      const br = utils.getBridge();
      if (br && typeof br.getWidgetConfig === 'function') {
        try {
          const nCfg = JSON.parse(br.getWidgetConfig() || '{}');
          if (nCfg && nCfg.style) state.widgetCfg = Object.assign({}, state.widgetCfg, nCfg);
        } catch {}
      }

      applyThemeToDocument();
      try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          if (state.prefs.theme === 'system') applyThemeToDocument();
        });
      } catch {}
      bus.emit('store:ready', state);
    },

    isLiked(trackId) {
      if (!trackId) return false;
      return state.likedTracks.some((t) => t.id === String(trackId));
    },

    toggleLike(rawTrack) {
      const t = utils.normalizeTrack(rawTrack || state.currentTrack);
      if (!t) return false;
      const idx = state.likedTracks.findIndex((x) => x.id === t.id);
      let liked = false;
      if (idx >= 0) {
        state.likedTracks.splice(idx, 1);
      } else {
        state.likedTracks.unshift(t);
        liked = true;
        if (state.prefs.autoDownloadLiked && utils.isNativeApk() && t.videoId) {
          const br = utils.getBridge();
          if (br && typeof br.downloadOfflineTrack === 'function') {
            try {
              state.offlineTracks[t.id] = t;
              safeSet('sf_v4_offline_meta', state.offlineTracks);
              br.downloadOfflineTrack(t.id, t.videoId);
            } catch {}
          }
        }
      }
      safeSet('sf_v4_liked', state.likedTracks);
      bus.emit('like:change', { track: t, liked });
      return liked;
    },

    recordPlay(rawTrack, listenedSec = 0) {
      const t = utils.normalizeTrack(rawTrack);
      if (!t || state.prefs.pausePlayHistory || state.prefs.privateSession) return;
      const sec = Math.max(0, Number(listenedSec) || 0);
      const threshold = Math.max(5, Number(state.prefs.historyThresholdSec || 30));

      state.stats.totalListenSec = (state.stats.totalListenSec || 0) + sec;
      const today = utils.todayIso();
      if (state.streak.lastDate !== today) {
        state.streak.todaySec = (state.streak.todaySec || 0) + sec;
        state.streak.minutesToday = Math.floor(state.streak.todaySec / 60);
        if (state.streak.todaySec >= threshold) {
          const prev = state.streak.lastDate ? new Date(state.streak.lastDate + 'T00:00:00') : null;
          const nowD = new Date(today + 'T00:00:00');
          const diff = prev ? Math.round((nowD - prev) / 86400000) : 0;
          if (diff === 1) state.streak.count = (state.streak.count || 1) + 1;
          else if (diff > 1 || !state.streak.lastDate) state.streak.count = Math.max(1, state.streak.count || 1);
          state.streak.best = Math.max(state.streak.best || 1, state.streak.count);
          state.streak.lastDate = today;
          bus.emit('streak:change', state.streak);
        }
      } else {
        state.streak.todaySec = (state.streak.todaySec || 0) + sec;
        state.streak.minutesToday = Math.floor(state.streak.todaySec / 60);
      }

      if (sec >= threshold || listenedSec === -1) {
        const existingIdx = state.history.findIndex((x) => x.id === t.id);
        if (existingIdx >= 0) state.history.splice(existingIdx, 1);
        state.history.unshift(Object.assign({}, t, { playedAt: Date.now() }));
        if (state.history.length > 200) state.history.length = 200;
        state.playCounts[t.id] = (Number(state.playCounts[t.id]) || 0) + 1;
        state.stats.playCounts = state.playCounts;
        state.stats.artistPlays = state.stats.artistPlays || {};
        state.stats.artistPlays[t.artist] = (Number(state.stats.artistPlays[t.artist]) || 0) + 1;
        safeSet('sf_v4_history', state.history);
        bus.emit('history:change', { track: t });
      }
      safeSet('sf_v4_stats', state.stats);
      safeSet('sf_v4_streak', state.streak);
    },

    persistQueue() {
      if (!state.prefs.persistentQueue) return;
      safeSet('sf_v4_queue', {
        queue: state.queue.slice(0, 120),
        queueIndex: state.queueIndex,
        shuffle: state.shuffle,
        repeat: state.repeat,
      });
    },

    setQueue(rawTracks, startIndex = 0, sourceLabel = 'SpotyFlow') {
      let list = (Array.isArray(rawTracks) ? rawTracks : [rawTracks]).map(utils.normalizeTrack).filter(Boolean);
      if (!list.length) return;
      if (state.prefs.preventQueueDuplicate) {
        const seen = new Set();
        list = list.filter((t) => {
          if (seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        });
      }
      let idx = Math.max(0, Math.min(list.length - 1, Number(startIndex) || 0));
      if (state.prefs.shufflePlaylistFirst && list.length > 2 && startIndex === 0) {
        const first = list[idx];
        const rest = list.filter((_, i) => i !== idx);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        list = [first, ...rest];
        idx = 0;
      }
      state.queue = list;
      state.queueIndex = idx;
      state.sourceLabel = sourceLabel || 'SpotyFlow';
      store.persistQueue();
      bus.emit('queue:change', { queue: state.queue, queueIndex: state.queueIndex });
    },

    addToQueue(rawTrack, playNext = false) {
      const t = utils.normalizeTrack(rawTrack);
      if (!t) return false;
      if (state.prefs.preventQueueDuplicate && state.queue.some((x) => x.id === t.id)) {
        return false;
      }
      if (!state.queue.length) {
        state.queue = [t];
        state.queueIndex = 0;
      } else if (playNext) {
        const insertAt = Math.min(state.queue.length, Math.max(0, state.queueIndex + 1));
        state.queue.splice(insertAt, 0, t);
      } else {
        state.queue.push(t);
      }
      store.persistQueue();
      bus.emit('queue:change', { queue: state.queue, queueIndex: state.queueIndex });
      return true;
    },

    removeFromQueue(index) {
      if (index < 0 || index >= state.queue.length) return;
      state.queue.splice(index, 1);
      if (index < state.queueIndex) state.queueIndex--;
      else if (state.queueIndex >= state.queue.length) state.queueIndex = state.queue.length - 1;
      store.persistQueue();
      bus.emit('queue:change', { queue: state.queue, queueIndex: state.queueIndex });
    },

    clearQueue() {
      const cur = state.currentTrack;
      state.queue = cur ? [cur] : [];
      state.queueIndex = cur ? 0 : -1;
      store.persistQueue();
      bus.emit('queue:change', { queue: state.queue, queueIndex: state.queueIndex });
    },

    setPref(key, value) {
      state.prefs[key] = value;
      if (key === 'audioQuality') state.prefs.dataSaver = value === 'saver';
      if (key === 'dataSaver' && value) state.prefs.audioQuality = 'saver';
      safeSet('sf_v4_prefs', state.prefs);
      applyThemeToDocument();
      bus.emit('pref:change', { key, value, prefs: state.prefs });
    },

    setEq(patch) {
      state.eq = Object.assign({}, state.eq, patch);
      safeSet('sf_v4_eq', state.eq);
      bus.emit('eq:change', state.eq);
    },

    setWidgetCfg(patch) {
      state.widgetCfg = Object.assign({}, state.widgetCfg, patch);
      safeSet('sf_v4_widget_cfg', state.widgetCfg);
      const br = utils.getBridge();
      if (br && typeof br.saveWidgetConfig === 'function') {
        try { br.saveWidgetConfig(JSON.stringify(state.widgetCfg)); } catch {}
      }
      bus.emit('widget:change', state.widgetCfg);
    },

    saveProfile(patch) {
      state.profile = Object.assign({}, state.profile, patch);
      safeSet('sf_v4_profile', state.profile);
      bus.emit('profile:change', state.profile);
    },

    addSearchHistory(q) {
      const clean = String(q || '').trim();
      if (!clean || state.prefs.pauseSearchHistory || state.prefs.privateSession) return;
      state.searchHistory = [clean, ...state.searchHistory.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 14);
      safeSet('sf_v4_search_history', state.searchHistory);
    },

    removeSearchHistory(q) {
      state.searchHistory = state.searchHistory.filter((x) => x !== q);
      safeSet('sf_v4_search_history', state.searchHistory);
    },

    clearSearchHistory() {
      state.searchHistory = [];
      safeSet('sf_v4_search_history', []);
    },

    createPlaylist(name, tracks = []) {
      const clean = String(name || '').trim();
      if (!clean) return null;
      const pl = {
        id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name: clean,
        tracks: tracks.map(utils.normalizeTrack).filter(Boolean),
        createdAt: Date.now(),
      };
      state.playlists.unshift(pl);
      safeSet('sf_v4_playlists', state.playlists);
      bus.emit('playlists:change', state.playlists);
      return pl;
    },

    addTrackToPlaylist(plId, rawTrack) {
      const pl = state.playlists.find((p) => p.id === plId);
      const t = utils.normalizeTrack(rawTrack);
      if (!pl || !t) return false;
      pl.tracks = Array.isArray(pl.tracks) ? pl.tracks : [];
      if (!pl.tracks.some((x) => x.id === t.id)) {
        pl.tracks.push(t);
        safeSet('sf_v4_playlists', state.playlists);
        bus.emit('playlists:change', state.playlists);
        return true;
      }
      return false;
    },

    toggleFollowArtist(artistObj) {
      if (!artistObj || !artistObj.name) return false;
      const key = String(artistObj.name).trim().toLowerCase();
      const idx = state.followedArtists.findIndex((a) => String(a.name || '').toLowerCase() === key);
      let followed = false;
      if (idx >= 0) {
        state.followedArtists.splice(idx, 1);
      } else {
        state.followedArtists.unshift({
          id: String(artistObj.id || ''),
          name: String(artistObj.name),
          picture: String(artistObj.picture_medium || artistObj.picture_xl || artistObj.picture || ''),
          nb_fan: Number(artistObj.nb_fan || 0),
        });
        followed = true;
      }
      safeSet('sf_v4_followed_artists', state.followedArtists);
      bus.emit('library:change');
      return followed;
    },

    isArtistFollowed(name) {
      const key = String(name || '').trim().toLowerCase();
      return state.followedArtists.some((a) => String(a.name || '').toLowerCase() === key);
    },

    toggleSaveAlbum(albumObj) {
      if (!albumObj || !albumObj.title) return false;
      const key = String(albumObj.title).trim().toLowerCase();
      const idx = state.savedAlbums.findIndex((al) => String(al.title || '').toLowerCase() === key);
      let saved = false;
      if (idx >= 0) {
        state.savedAlbums.splice(idx, 1);
      } else {
        state.savedAlbums.unshift({
          id: String(albumObj.id || ''),
          title: String(albumObj.title),
          artist: typeof albumObj.artist === 'string' ? albumObj.artist : String(albumObj.artist?.name || 'Artis'),
          cover: String(albumObj.cover_medium || albumObj.cover_xl || albumObj.cover || ''),
          nb_tracks: Number(albumObj.nb_tracks || 0),
        });
        saved = true;
      }
      safeSet('sf_v4_saved_albums', state.savedAlbums);
      bus.emit('library:change');
      return saved;
    },

    isAlbumSaved(title) {
      const key = String(title || '').trim().toLowerCase();
      return state.savedAlbums.some((al) => String(al.title || '').toLowerCase() === key);
    },

    getTop50Tracks() {
      const map = new Map();
      for (const t of [...state.history, ...state.likedTracks]) {
        if (t && !map.has(t.id)) map.set(t.id, t);
      }
      return Array.from(map.values())
        .sort((a, b) => (Number(state.playCounts[b.id]) || 0) - (Number(state.playCounts[a.id]) || 0))
        .slice(0, 50);
    },

    getOfflineTracksList() {
      const br = utils.getBridge();
      let ids = Object.keys(state.offlineTracks || {});
      if (br && typeof br.getOfflineTracksJson === 'function') {
        try {
          const parsed = JSON.parse(br.getOfflineTracksJson() || '[]');
          if (Array.isArray(parsed) && parsed.length) ids = parsed;
        } catch {}
      }
      return ids.map((id) => {
        const meta = state.offlineTracks[id];
        return meta ? utils.normalizeTrack(meta) : utils.normalizeTrack({ id, title: 'Lagu Offline ' + id, artist: 'Tersimpan di APK' });
      }).filter(Boolean);
    },

    getCacheUsageBytes() {
      let bytes = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && !PROTECTED_KEYS.has(k) && SAFE_CACHE_PREFIXES.some((p) => k.startsWith(p))) {
            bytes += (localStorage.getItem(k) || '').length * 2;
          }
        }
      } catch {}
      return bytes;
    },

    clearSafeCache() {
      let removed = 0;
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && !PROTECTED_KEYS.has(k) && SAFE_CACHE_PREFIXES.some((p) => k.startsWith(p))) {
            keys.push(k);
          }
        }
        keys.forEach((k) => {
          localStorage.removeItem(k);
          removed++;
        });
      } catch {}
      const br = utils.getBridge();
      if (br && typeof br.clearHttpCache === 'function') {
        try { br.clearHttpCache(); } catch {}
      }
      return removed;
    },

    exportBackupJson() {
      return JSON.stringify({
        app: 'SpotyFlow',
        version: '4.0.0',
        exportedAt: new Date().toISOString(),
        prefs: state.prefs,
        likedTracks: state.likedTracks,
        playlists: state.playlists,
        history: state.history,
        stats: state.stats,
        streak: state.streak,
        alarms: state.alarms,
        eq: state.eq,
        widgetCfg: state.widgetCfg,
        profile: state.profile,
        followedArtists: state.followedArtists,
        savedAlbums: state.savedAlbums,
      }, null, 2);
    },

    importBackupJson(jsonStr, mode = 'merge') {
      const data = JSON.parse(String(jsonStr || '{}'));
      if (!data || typeof data !== 'object') throw new Error('Format JSON tidak valid');
      if (data.prefs) state.prefs = Object.assign({}, DEFAULT_PREFS, data.prefs);
      if (Array.isArray(data.likedTracks)) {
        const incoming = data.likedTracks.map(utils.normalizeTrack).filter(Boolean);
        if (mode === 'replace') state.likedTracks = incoming;
        else {
          const ids = new Set(state.likedTracks.map((x) => x.id));
          incoming.forEach((t) => { if (!ids.has(t.id)) state.likedTracks.push(t); });
        }
      }
      if (Array.isArray(data.playlists)) {
        state.playlists = mode === 'replace' ? data.playlists : [...data.playlists, ...state.playlists];
      }
      if (Array.isArray(data.history)) state.history = data.history.map(utils.normalizeTrack).filter(Boolean);
      if (data.streak) state.streak = Object.assign({}, state.streak, data.streak);
      if (Array.isArray(data.alarms)) state.alarms = data.alarms;
      if (data.eq) state.eq = Object.assign({}, DEFAULT_EQ, data.eq);
      if (data.widgetCfg) store.setWidgetCfg(data.widgetCfg);
      if (data.profile) state.profile = Object.assign({}, state.profile, data.profile);
      if (Array.isArray(data.followedArtists)) state.followedArtists = data.followedArtists;
      if (Array.isArray(data.savedAlbums)) state.savedAlbums = data.savedAlbums;

      safeSet('sf_v4_prefs', state.prefs);
      safeSet('sf_v4_liked', state.likedTracks);
      safeSet('sf_v4_playlists', state.playlists);
      safeSet('sf_v4_history', state.history);
      safeSet('sf_v4_streak', state.streak);
      safeSet('sf_v4_alarms', state.alarms);
      safeSet('sf_v4_eq', state.eq);
      safeSet('sf_v4_profile', state.profile);
      safeSet('sf_v4_followed_artists', state.followedArtists);
      safeSet('sf_v4_saved_albums', state.savedAlbums);
      applyThemeToDocument();
      bus.emit('store:imported', state);
      return true;
    },
  };

  SF.bus = bus;
  SF.utils = utils;
  SF.store = store;
})();
