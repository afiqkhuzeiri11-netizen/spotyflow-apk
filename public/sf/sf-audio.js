(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});

  let activeEngine = 'none'; // 'exo' | 'yt' | 'html5'
  let playSeq = 0;
  let prefetchTimer = null;
  let tickerTimer = null;
  let listenedAccumSec = 0;
  let lastRecordedTrackId = '';

  // Native ExoPlayer 60 FPS local interpolation anchor (synced every 2000ms from Java)
  const exoAnchor = { baseSec: 0, anchorPerfMs: 0, rate: 1.0, playing: false };

  // YouTube IFrame API (zero-reparent #sf-yt-host)
  let ytPlayer = null;
  let ytReady = false;
  let ytReadyWaiters = [];
  let ytApiRequested = false;

  // HTML5 <audio> + Web Audio 5-Band EQ + Compressor
  let htmlAudio = null;
  let audioCtx = null;
  let eqFilters = [];
  let compressorNode = null;
  let mediaSrcNode = null;

  // Sleep timer
  let sleepState = { endAtMs: 0, stopAtTrackEnd: false, fadeOut: true };

  function ensureHtmlAudio() {
    if (htmlAudio) return htmlAudio;
    htmlAudio = document.createElement('audio');
    htmlAudio.id = 'sf-html5-audio';
    htmlAudio.preload = 'auto';
    htmlAudio.crossOrigin = 'anonymous';
    htmlAudio.addEventListener('playing', () => {
      if (activeEngine !== 'html5') return;
      SF.store.state.isPlaying = true;
      SF.store.state.isBuffering = false;
      SF.store.state.duration = Number.isFinite(htmlAudio.duration) ? htmlAudio.duration : SF.store.state.duration;
      syncNativeMetadata(true);
      emitPlaybackState();
    });
    htmlAudio.addEventListener('pause', () => {
      if (activeEngine !== 'html5') return;
      SF.store.state.isPlaying = false;
      syncNativeMetadata(true);
      emitPlaybackState();
    });
    htmlAudio.addEventListener('waiting', () => {
      if (activeEngine !== 'html5') return;
      SF.store.state.isBuffering = true;
      emitPlaybackState();
    });
    htmlAudio.addEventListener('ended', () => {
      if (activeEngine !== 'html5') return;
      handleTrackEnded();
    });
    htmlAudio.addEventListener('error', () => {
      if (activeEngine !== 'html5') return;
      SF.store.state.isBuffering = false;
      SF.store.state.isPlaying = false;
      emitPlaybackState();
      if (SF.store.state.prefs.autoSkipOnError) audio.next(true);
    });
    document.body.appendChild(htmlAudio);
    return htmlAudio;
  }

  function ensureWebAudioGraph() {
    if (audioCtx || !htmlAudio) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      mediaSrcNode = audioCtx.createMediaElementSource(htmlAudio);
      const freqs = [60, 230, 910, 3600, 14000];
      eqFilters = freqs.map((f, idx) => {
        const biq = audioCtx.createBiquadFilter();
        biq.type = idx === 0 ? 'lowshelf' : (idx === freqs.length - 1 ? 'highshelf' : 'peaking');
        biq.frequency.value = f;
        biq.Q.value = 1.1;
        biq.gain.value = 0;
        return biq;
      });
      compressorNode = audioCtx.createDynamicsCompressor();
      compressorNode.threshold.value = -18;
      compressorNode.ratio.value = 4;

      let prev = mediaSrcNode;
      for (const flt of eqFilters) {
        prev.connect(flt);
        prev = flt;
      }
      prev.connect(compressorNode);
      compressorNode.connect(audioCtx.destination);
    } catch {}
  }

  function loadYouTubeIframeApi() {
    if (ytReady && ytPlayer) return Promise.resolve(ytPlayer);
    return new Promise((resolve) => {
      ytReadyWaiters.push(resolve);
      if (ytApiRequested) return;
      ytApiRequested = true;

      const initPlayer = () => {
        const host = document.getElementById('sf-yt-host');
        if (!host) return;
        let inner = document.getElementById('sf-yt-iframe-target');
        if (!inner) {
          inner = document.createElement('div');
          inner.id = 'sf-yt-iframe-target';
          host.appendChild(inner);
        }
        try {
          ytPlayer = new window.YT.Player('sf-yt-iframe-target', {
            width: '100%',
            height: '100%',
            playerVars: {
              autoplay: 1,
              controls: 0,
              rel: 0,
              modestbranding: 1,
              playsinline: 1,
              enablejsapi: 1,
              origin: window.location.origin,
            },
            events: {
              onReady() {
                ytReady = true;
                const list = ytReadyWaiters.splice(0);
                list.forEach((fn) => fn(ytPlayer));
              },
              onStateChange(ev) {
                if (activeEngine !== 'yt') return;
                const st = ev.data;
                if (st === 1) {
                  SF.store.state.isPlaying = true;
                  SF.store.state.isBuffering = false;
                  const d = Number(ytPlayer.getDuration?.() || 0);
                  if (d > 1) SF.store.state.duration = d;
                  if (!SF.store.state.videoMode) {
                    try { ytPlayer.setPlaybackQuality('tiny'); } catch {}
                  }
                  syncNativeMetadata(true);
                  emitPlaybackState();
                  scheduleDelayedPrefetch();
                } else if (st === 2) {
                  SF.store.state.isPlaying = false;
                  SF.store.state.isBuffering = false;
                  syncNativeMetadata(true);
                  emitPlaybackState();
                } else if (st === 3) {
                  SF.store.state.isBuffering = true;
                  emitPlaybackState();
                } else if (st === 0) {
                  handleTrackEnded();
                }
              },
              onError() {
                if (activeEngine !== 'yt') return;
                SF.store.state.isBuffering = false;
                SF.store.state.isPlaying = false;
                emitPlaybackState();
                if (SF.store.state.prefs.autoSkipOnError) {
                  setTimeout(() => audio.next(true), 600);
                }
              },
            },
          });
        } catch {
          const list = ytReadyWaiters.splice(0);
          list.forEach((fn) => fn(null));
        }
      };

      if (window.YT && window.YT.Player) {
        initPlayer();
        return;
      }
      const prevCb = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prevCb === 'function') prevCb();
        initPlayer();
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    });
  }

  function positionYtHost() {
    const host = document.getElementById('sf-yt-host');
    if (!host) return;
    const slot = document.getElementById('sf-stage-media-slot');
    const fsOpen = document.getElementById('sf-fullscreen-player')?.classList.contains('open');
    if (activeEngine === 'yt' && SF.store.state.videoMode && fsOpen && slot) {
      const r = slot.getBoundingClientRect();
      host.style.top = `${Math.round(r.top)}px`;
      host.style.left = `${Math.round(r.left)}px`;
      host.style.width = `${Math.round(r.width)}px`;
      host.style.height = `${Math.round(r.height)}px`;
      host.style.opacity = '1';
      host.style.pointerEvents = 'none';
      host.style.zIndex = '112';
      try { ytPlayer?.setPlaybackQuality?.('hd720'); } catch {}
    } else {
      host.style.top = '-9999px';
      host.style.left = '-9999px';
      host.style.width = '240px';
      host.style.height = '135px';
      host.style.opacity = '0.001';
      host.style.pointerEvents = 'none';
      host.style.zIndex = '-1';
    }
  }

  function stopAllEngines() {
    const br = SF.utils.getBridge();
    if (activeEngine === 'exo' && br && typeof br.nativeControl === 'function') {
      try { br.nativeControl('stop', 0); } catch {}
    }
    if (ytPlayer && ytReady) {
      try { ytPlayer.pauseVideo(); } catch {}
    }
    if (htmlAudio) {
      try { htmlAudio.pause(); } catch {}
    }
    exoAnchor.playing = false;
    activeEngine = 'none';
    positionYtHost();
  }

  function emitPlaybackState() {
    const st = SF.store.state;
    SF.bus.emit('playback:state', {
      track: st.currentTrack,
      isPlaying: st.isPlaying,
      isBuffering: st.isBuffering,
      videoMode: st.videoMode,
      shuffle: st.shuffle,
      repeat: st.repeat,
      engine: activeEngine,
    });
  }

  function getAccurateCurrentTime() {
    if (activeEngine === 'exo') {
      if (!exoAnchor.playing) return exoAnchor.baseSec;
      const dt = (performance.now() - exoAnchor.anchorPerfMs) / 1000;
      const est = exoAnchor.baseSec + dt * (exoAnchor.rate || 1);
      return SF.store.state.duration > 0 ? Math.min(SF.store.state.duration, Math.max(0, est)) : Math.max(0, est);
    }
    if (activeEngine === 'yt' && ytPlayer && ytReady) {
      try { return Math.max(0, Number(ytPlayer.getCurrentTime?.() || 0)); } catch { return SF.store.state.currentTime; }
    }
    if (activeEngine === 'html5' && htmlAudio) {
      return Math.max(0, Number(htmlAudio.currentTime || 0));
    }
    return SF.store.state.currentTime || 0;
  }

  function syncNativeMetadata(force = false) {
    if (!force) return;
    const br = SF.utils.getBridge();
    const t = SF.store.state.currentTrack;
    if (!br || typeof br.updateState !== 'function' || !t) return;
    try {
      const payload = {
        trackId: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album || 'SpotyFlow',
        coverUrl: t.cover || 'https://spotyflow.vercel.app/icon-512.png',
        isPlaying: Boolean(SF.store.state.isPlaying),
        durationMs: Math.max(1000, Math.round((SF.store.state.duration || t.duration || 210) * 1000)),
        positionMs: Math.max(0, Math.round(getAccurateCurrentTime() * 1000)),
        playbackRate: Number(SF.store.state.eq?.speed || 1.0),
        isLiked: SF.store.isLiked(t.id),
        streakDays: Math.max(1, Number(SF.store.state.streak?.count || 1)),
      };
      br.updateState(JSON.stringify(payload));
    } catch {}
  }

  function updateMediaSessionMetadata(t) {
    if (!('mediaSession' in navigator) || !t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        album: t.album || 'SpotyFlow',
        artwork: t.cover ? [{ src: t.cover, sizes: '512x512', type: 'image/jpeg' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () => audio.play());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => audio.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => audio.next(true));
      navigator.mediaSession.setActionHandler('seekto', (d) => { if (d && Number.isFinite(d.seekTime)) audio.seekTo(d.seekTime); });
    } catch {}
  }

  function scheduleDelayedPrefetch() {
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      const st = SF.store.state;
      if (!st.isPlaying || !st.queue.length) return;
      const nextTrack = st.queue[st.queueIndex + 1];
      if (!nextTrack) return;
      const br = SF.utils.getBridge();
      if (br && typeof br.prefetchTrackMeta === 'function') {
        try {
          br.prefetchTrackMeta(nextTrack.id, nextTrack.videoId || '', nextTrack.title, nextTrack.artist, Boolean(st.prefs.dataSaver));
        } catch {}
      }
    }, 4000);
  }

  async function resolveVideoIdForTrack(track) {
    if (SF.utils.isValidVideoId(track.videoId)) return track.videoId;
    try {
      const res = await SF.api.searchAll(`${track.artist} ${track.title}`, 'all');
      const hit = (res.tracks || []).find((x) => SF.utils.isValidVideoId(x.videoId));
      if (hit) {
        track.videoId = hit.videoId;
        if (!track.cover && hit.cover) track.cover = hit.cover;
        return hit.videoId;
      }
    } catch {}
    return '';
  }

  async function startTrackOnEngine(track, startSec, seq, forceYt = false) {
    const st = SF.store.state;
    const br = SF.utils.getBridge();
    const useNativeExo = !forceYt && SF.utils.isNativeApk() && br && typeof br.playNativeTrack === 'function' && !st.videoMode;

    // 1. Local file on Web (blob:) or direct audio URL
    if (track.isLocal && track.streamUrl.startsWith('blob:')) {
      activeEngine = 'html5';
      const el = ensureHtmlAudio();
      ensureWebAudioGraph();
      el.src = track.streamUrl;
      el.currentTime = Math.max(0, startSec || 0);
      el.playbackRate = Number(st.eq?.speed || 1.0);
      el.volume = st.volume;
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      await el.play().catch(() => {});
      return;
    }

    // 2. Native Android ExoPlayer (0ms direct launch — supports both YouTube & local content:// URIs!)
    if (useNativeExo) {
      activeEngine = 'exo';
      exoAnchor.baseSec = Math.max(0, startSec || 0);
      exoAnchor.anchorPerfMs = performance.now();
      exoAnchor.rate = Number(st.eq?.speed || 1.0);
      exoAnchor.playing = false;
      try {
        br.playNativeTrack(JSON.stringify({
          trackId: track.id,
          videoId: track.videoId || '',
          title: track.title,
          artist: track.artist,
          album: track.album || 'SpotyFlow',
          coverUrl: track.cover || 'https://spotyflow.vercel.app/icon-512.png',
          startSec: Math.max(0, startSec || 0),
          dataSaver: Boolean(st.prefs.dataSaver || st.prefs.audioQuality === 'saver'),
          localUri: track.isLocal ? track.streamUrl : '',
          isLiked: SF.store.isLiked(track.id),
          streakDays: Math.max(1, Number(st.streak?.count || 1)),
        }));
      } catch {
        return startTrackOnEngine(track, startSec, seq, true);
      }
      return;
    }

    // 3. YouTube IFrame Engine (Web Browser, Video Mode, or APK Fallback — NEVER 30s previews!)
    const vid = await resolveVideoIdForTrack(track);
    if (seq !== playSeq) return;
    if (!vid) {
      st.isBuffering = false;
      st.isPlaying = false;
      emitPlaybackState();
      SF.bus.emit('toast', { message: `Stream penuh "${track.title}" tidak ditemukan`, type: 'error' });
      if (st.prefs.autoSkipOnError) setTimeout(() => audio.next(true), 800);
      return;
    }

    activeEngine = 'yt';
    const player = await loadYouTubeIframeApi();
    if (seq !== playSeq || !player) return;
    try {
      player.setVolume(Math.round((st.volume ?? 0.85) * 100));
      player.setPlaybackRate(Number(st.eq?.speed || 1.0));
      player.loadVideoById({ videoId: vid, startSeconds: Math.max(0, startSec || 0) });
      positionYtHost();
    } catch {}
  }

  async function handleTrackEnded() {
    const st = SF.store.state;
    st.isPlaying = false;
    emitPlaybackState();
    if (sleepState.stopAtTrackEnd) {
      audio.cancelSleepTimer();
      SF.bus.emit('toast', { message: 'Timer tidur selesai di akhir lagu' });
      return;
    }
    if (st.repeat === 'one' && st.currentTrack) {
      await audio.playTrack(st.currentTrack, st.queue, st.queueIndex, st.sourceLabel, 0);
      return;
    }
    await audio.next(true);
  }

  function startTicker() {
    if (tickerTimer) clearInterval(tickerTimer);
    tickerTimer = setInterval(() => {
      const st = SF.store.state;
      if (!st.isPlaying || !st.currentTrack) return;

      const cur = getAccurateCurrentTime();
      st.currentTime = cur;
      const dur = st.duration || st.currentTrack.duration || 0;

      // Track listen duration & Streak Percikan
      listenedAccumSec += 0.25;
      if (listenedAccumSec >= 1) {
        const whole = Math.floor(listenedAccumSec);
        listenedAccumSec -= whole;
        const threshold = Math.max(5, Number(st.prefs.historyThresholdSec || 30));
        if (st.currentTrack.id !== lastRecordedTrackId && cur >= threshold) {
          lastRecordedTrackId = st.currentTrack.id;
          SF.store.recordPlay(st.currentTrack, threshold);
        } else {
          SF.store.recordPlay(st.currentTrack, whole);
        }
      }

      // Sleep timer countdown & fade-out
      if (sleepState.endAtMs > 0) {
        const remMs = sleepState.endAtMs - Date.now();
        if (remMs <= 0) {
          audio.cancelSleepTimer();
          audio.pause();
          SF.bus.emit('toast', { message: 'Timer tidur selesai — musik dijeda' });
        } else if (sleepState.fadeOut && remMs < 6000) {
          const factor = Math.max(0.05, remMs / 6000);
          if (activeEngine === 'yt' && ytPlayer) try { ytPlayer.setVolume(Math.round(st.volume * 100 * factor)); } catch {}
          if (activeEngine === 'html5' && htmlAudio) htmlAudio.volume = st.volume * factor;
        }
      }

      if (!document.hidden) {
        SF.bus.emit('playback:time', { currentTime: cur, duration: dur });
      }
    }, 250);
  }

  const audio = {
    init() {
      // Wire native Android ExoPlayer callbacks
      window.__sfOnNativeAudioEvent = function (type, payload) {
        const st = SF.store.state;
        const p = payload && typeof payload === 'object' ? payload : {};
        if (type === 'buffering') {
          st.isBuffering = true;
          emitPlaybackState();
        } else if (type === 'ready') {
          st.isBuffering = false;
          if (p.resolvedVideoId && st.currentTrack && !st.currentTrack.videoId) {
            st.currentTrack.videoId = p.resolvedVideoId;
          }
          if (p.durationMs > 1000) st.duration = p.durationMs / 1000;
          exoAnchor.baseSec = Math.max(0, Number(p.positionMs || 0) / 1000);
          exoAnchor.anchorPerfMs = performance.now();
          exoAnchor.rate = Number(p.playbackRate || 1.0);
          exoAnchor.playing = Boolean(p.playing || p.isPlaying);
          st.isPlaying = exoAnchor.playing;
          emitPlaybackState();
          SF.bus.emit('playback:time', { currentTime: exoAnchor.baseSec, duration: st.duration });
          scheduleDelayedPrefetch();
        } else if (type === 'playing' || type === 'paused' || type === 'time' || type === 'seeked') {
          if (p.durationMs > 1000) st.duration = p.durationMs / 1000;
          exoAnchor.baseSec = Math.max(0, Number(p.positionMs || 0) / 1000);
          exoAnchor.anchorPerfMs = performance.now();
          exoAnchor.rate = Number(p.playbackRate || st.eq?.speed || 1.0);
          exoAnchor.playing = type === 'paused' ? false : Boolean(p.playing ?? p.isPlaying ?? true);
          st.isPlaying = exoAnchor.playing;
          st.isBuffering = false;
          st.currentTime = exoAnchor.baseSec;
          if (type !== 'time') emitPlaybackState();
          SF.bus.emit('playback:time', { currentTime: exoAnchor.baseSec, duration: st.duration });
        } else if (type === 'ended') {
          exoAnchor.playing = false;
          handleTrackEnded();
        } else if (type === 'error') {
          exoAnchor.playing = false;
          if (st.currentTrack && !st.currentTrack.isLocal) {
            startTrackOnEngine(st.currentTrack, st.currentTime || 0, playSeq, true);
          } else if (st.prefs.autoSkipOnError) {
            audio.next(true);
          }
        }
      };

      // Wire native Android MediaSession, Lockscreen, Origin Island & 5 Widgets actions
      window.__sfOnNativeMediaAction = function (action, positionMs) {
        if (action === 'play') audio.play();
        else if (action === 'pause' || action === 'noisy') audio.pause();
        else if (action === 'next') audio.next(true);
        else if (action === 'prev') audio.prev();
        else if (action === 'like') {
          SF.store.toggleLike(SF.store.state.currentTrack);
          syncNativeMetadata(true);
        } else if (action === 'seek' && Number.isFinite(Number(positionMs))) {
          audio.seekTo(Math.max(0, Number(positionMs) / 1000));
        }
      };
      window.__sfHandleNativeMediaAction = window.__sfOnNativeMediaAction;

      SF.bus.on('pref:change', () => audio.applyAudioPrefs());
      SF.bus.on('eq:change', () => audio.applyAudioPrefs());
      SF.bus.on('like:change', () => syncNativeMetadata(true));
      SF.bus.on('stage:layout', () => positionYtHost());
      window.addEventListener('resize', positionYtHost);

      audio.applyAudioPrefs();
      startTicker();
    },

    getEngine() {
      return activeEngine;
    },

    getSleepState() {
      return Object.assign({}, sleepState);
    },

    async playTrack(rawTrack, queueList = null, startIndex = 0, sourceLabel = null, startSec = 0) {
      const track = SF.utils.normalizeTrack(rawTrack);
      if (!track) return;
      const st = SF.store.state;
      playSeq++;
      const seq = playSeq;
      if (prefetchTimer) clearTimeout(prefetchTimer);

      if (Array.isArray(queueList) && queueList.length) {
        SF.store.setQueue(queueList, startIndex, sourceLabel || st.sourceLabel || 'SpotyFlow');
      } else if (!st.queue.length || st.queue[st.queueIndex]?.id !== track.id) {
        const idx = st.queue.findIndex((x) => x.id === track.id);
        if (idx >= 0) st.queueIndex = idx;
        else SF.store.setQueue([track], 0, sourceLabel || st.sourceLabel || 'SpotyFlow');
      }

      stopAllEngines();

      // Optimistic 0ms UI update
      st.currentTrack = track;
      st.currentTime = Math.max(0, startSec || 0);
      st.duration = track.duration || 0;
      st.isBuffering = true;
      st.isPlaying = true;
      listenedAccumSec = 0;
      lastRecordedTrackId = '';

      const palette = SF.utils.getPalette(track.title);
      document.documentElement.style.setProperty('--cover-rgb', palette[2]);

      SF.store.persistQueue();
      updateMediaSessionMetadata(track);
      syncNativeMetadata(true);
      SF.bus.emit('track:change', { track, sourceLabel: st.sourceLabel });
      emitPlaybackState();
      SF.bus.emit('playback:time', { currentTime: st.currentTime, duration: st.duration });

      await startTrackOnEngine(track, startSec, seq, false);
    },

    togglePlay() {
      const st = SF.store.state;
      if (!st.currentTrack) {
        const fallback = st.queue[0] || st.likedTracks[0] || st.history[0];
        if (fallback) {
          audio.playTrack(fallback, st.queue.length ? st.queue : [fallback], 0);
        } else {
          SF.bus.emit('audio:need-seed');
        }
        return;
      }
      if (st.isPlaying) audio.pause();
      else audio.play();
    },

    play() {
      const st = SF.store.state;
      if (!st.currentTrack) return;
      if (activeEngine === 'none') {
        audio.playTrack(st.currentTrack, st.queue, st.queueIndex, st.sourceLabel, st.currentTime || 0);
        return;
      }
      if (activeEngine === 'exo') {
        const br = SF.utils.getBridge();
        try { br?.nativeControl?.('play', 0); } catch {}
        exoAnchor.playing = true;
        exoAnchor.anchorPerfMs = performance.now();
      } else if (activeEngine === 'yt' && ytPlayer) {
        try { ytPlayer.playVideo(); } catch {}
      } else if (activeEngine === 'html5' && htmlAudio) {
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        htmlAudio.play().catch(() => {});
      }
      st.isPlaying = true;
      syncNativeMetadata(true);
      emitPlaybackState();
    },

    pause() {
      const st = SF.store.state;
      if (activeEngine === 'exo') {
        const br = SF.utils.getBridge();
        exoAnchor.baseSec = getAccurateCurrentTime();
        exoAnchor.playing = false;
        try { br?.nativeControl?.('pause', 0); } catch {}
      } else if (activeEngine === 'yt' && ytPlayer) {
        try { ytPlayer.pauseVideo(); } catch {}
      } else if (activeEngine === 'html5' && htmlAudio) {
        try { htmlAudio.pause(); } catch {}
      }
      st.isPlaying = false;
      st.isBuffering = false;
      syncNativeMetadata(true);
      emitPlaybackState();
    },

    seekTo(sec) {
      const st = SF.store.state;
      const target = Math.max(0, Math.min(st.duration || 9999, Number(sec) || 0));
      st.currentTime = target;
      if (activeEngine === 'exo') {
        exoAnchor.baseSec = target;
        exoAnchor.anchorPerfMs = performance.now();
        try { SF.utils.getBridge()?.nativeControl?.('seek', Math.round(target * 1000)); } catch {}
      } else if (activeEngine === 'yt' && ytPlayer) {
        try { ytPlayer.seekTo(target, true); } catch {}
      } else if (activeEngine === 'html5' && htmlAudio) {
        htmlAudio.currentTime = target;
      }
      syncNativeMetadata(true);
      SF.bus.emit('playback:time', { currentTime: target, duration: st.duration });
    },

    async next(auto = false) {
      const st = SF.store.state;
      if (!st.queue.length) return;
      let nextIdx = st.queueIndex + 1;

      if (st.shuffle && st.queue.length > 2) {
        let tries = 0;
        do {
          nextIdx = Math.floor(Math.random() * st.queue.length);
          tries++;
        } while (nextIdx === st.queueIndex && tries < 6);
      } else if (nextIdx >= st.queue.length) {
        if (st.repeat === 'all') {
          nextIdx = 0;
        } else if (st.prefs.autoLoadMore || st.prefs.autoRadioQueue) {
          const similar = await SF.api.getSimilarTracks(st.currentTrack);
          if (similar.length) {
            similar.forEach((t) => SF.store.addToQueue(t, false));
            nextIdx = st.queueIndex + 1;
          } else if (auto) {
            st.isPlaying = false;
            emitPlaybackState();
            return;
          } else {
            nextIdx = 0;
          }
        } else {
          if (auto) {
            st.isPlaying = false;
            emitPlaybackState();
            return;
          }
          nextIdx = 0;
        }
      }

      if (st.queue[nextIdx]) {
        await audio.playTrack(st.queue[nextIdx], st.queue, nextIdx, st.sourceLabel, 0);
      }
    },

    async prev() {
      const st = SF.store.state;
      if (getAccurateCurrentTime() > 4) {
        audio.seekTo(0);
        return;
      }
      if (!st.queue.length) return;
      const prevIdx = st.queueIndex > 0 ? st.queueIndex - 1 : st.queue.length - 1;
      if (st.queue[prevIdx]) {
        await audio.playTrack(st.queue[prevIdx], st.queue, prevIdx, st.sourceLabel, 0);
      }
    },

    toggleShuffle() {
      SF.store.state.shuffle = !SF.store.state.shuffle;
      SF.store.persistQueue();
      emitPlaybackState();
      return SF.store.state.shuffle;
    },

    cycleRepeat() {
      const order = ['off', 'all', 'one'];
      const cur = order.indexOf(SF.store.state.repeat);
      SF.store.state.repeat = order[(cur + 1) % order.length];
      SF.store.persistQueue();
      emitPlaybackState();
      return SF.store.state.repeat;
    },

    setVolume(val01) {
      const v = Math.max(0, Math.min(1, Number(val01)));
      SF.store.state.volume = v;
      const br = SF.utils.getBridge();
      if (br && typeof br.setSystemVolume === 'function') {
        try { br.setSystemVolume(Math.round(v * 100)); } catch {}
      }
      if (activeEngine === 'yt' && ytPlayer) try { ytPlayer.setVolume(Math.round(v * 100)); } catch {}
      if (htmlAudio) htmlAudio.volume = v;
      SF.bus.emit('volume:change', v);
    },

    async setVideoMode(enabled) {
      const st = SF.store.state;
      const want = Boolean(enabled) && Boolean(st.prefs.videoModeEnabled);
      if (st.videoMode === want) {
        positionYtHost();
        return;
      }
      const pos = getAccurateCurrentTime();
      st.videoMode = want;
      emitPlaybackState();
      if (st.currentTrack && !st.currentTrack.isLocal) {
        await startTrackOnEngine(st.currentTrack, pos, ++playSeq, want);
      }
      positionYtHost();
    },

    applyAudioPrefs() {
      const p = SF.store.state.prefs;
      const eq = SF.store.state.eq || {};
      const br = SF.utils.getBridge();

      // Apply Web Audio EQ + Speed when playing HTML5/YT
      const speed = Math.max(0.5, Math.min(2.0, Number(eq.speed || 1.0)));
      if (htmlAudio) htmlAudio.playbackRate = speed;
      if (ytPlayer && ytReady) try { ytPlayer.setPlaybackRate(speed); } catch {}
      if (eqFilters.length === 5) {
        const bands = Array.isArray(eq.bands) ? eq.bands : [0, 0, 0, 0, 0];
        eqFilters.forEach((f, i) => { f.gain.value = eq.enabled ? (Number(bands[i]) || 0) : 0; });
      }

      if (br) {
        if (typeof br.applyAudioSettings === 'function') {
          try {
            br.applyAudioSettings(JSON.stringify({
              skipSilence: Boolean(p.skipSilence),
              normalizeAudio: Boolean(p.normalizeAudio),
              loudnessLevel: Number(p.loudnessLevel || 0),
              audioOffload: Boolean(p.audioOffload),
              varispeed: Boolean(p.varispeed),
              speed,
              pitch: Number(eq.pitch || 1.0),
              keepPlayingInGames: Boolean(p.keepPlayingInGames),
              stopOnTaskRemoved: Boolean(p.stopOnTaskRemoved),
              pauseOnMute: Boolean(p.pauseOnMute),
              resumeOnBluetooth: Boolean(p.resumeOnBluetooth),
            }));
          } catch {}
        }
        if (typeof br.applyEqualizer === 'function') {
          try {
            br.applyEqualizer(JSON.stringify({
              enabled: Boolean(eq.enabled),
              bands: Array.isArray(eq.bands) ? eq.bands : [0, 0, 0, 0, 0],
            }));
          } catch {}
        }
      }
    },

    startSleepTimer(opts = {}) {
      const mins = Number(opts.minutes || 0);
      sleepState = {
        endAtMs: mins > 0 ? Date.now() + mins * 60000 : 0,
        stopAtTrackEnd: Boolean(opts.stopAtTrackEnd),
        fadeOut: opts.fadeOut !== false,
      };
      SF.bus.emit('sleep:change', sleepState);
    },

    cancelSleepTimer() {
      sleepState = { endAtMs: 0, stopAtTrackEnd: false, fadeOut: true };
      SF.bus.emit('sleep:change', sleepState);
    },

    positionYtHost,
  };

  SF.audio = audio;
})();
