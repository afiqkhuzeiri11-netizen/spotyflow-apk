(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});

  const state = {
    trackId: '',
    status: 'idle', // 'idle' | 'loading' | 'synced' | 'plain' | 'empty'
    lines: [],
    plainText: '',
    translated: [],
    romanized: [],
    showTranslation: false,
    showRomanization: false,
    activeIndex: -1,
    hasRetriedWithDur: false,
    source: '',
  };

  function pushToNativeIsland(text) {
    const br = SF.utils.getBridge();
    if (!br || typeof br.updateLyricLine !== 'function') return;
    const enabled = SF.store?.state?.prefs?.islandLyricsEnabled !== false;
    try {
      br.updateLyricLine(String(text || ''), Boolean(enabled));
    } catch {}
  }

  function hasNonLatin(lines) {
    const sample = lines.slice(0, 8).map((l) => l.text).join(' ');
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0e00-\u0e7f]/.test(sample);
  }

  async function loadForTrack(track, manualQuery = null) {
    if (!track && !manualQuery) return;
    const targetId = track?.id || '';
    state.trackId = targetId;
    state.status = 'loading';
    state.lines = [];
    state.plainText = '';
    state.translated = [];
    state.romanized = [];
    state.activeIndex = -1;
    state.source = '';
    if (!manualQuery) state.hasRetriedWithDur = false;

    pushToNativeIsland('');
    SF.bus.emit('lyrics:update', Object.assign({}, state));

    try {
      const dur = SF.store.state.duration || track?.duration || 0;
      const res = await SF.api.fetchLyrics(track, dur, manualQuery);
      if (targetId && SF.store.state.currentTrack?.id !== targetId) return;

      if (Array.isArray(res.synced) && res.synced.length) {
        state.lines = res.synced;
        state.plainText = res.plain || res.synced.map((l) => l.text).join('\n');
        state.status = 'synced';
        state.source = res.source || 'synced';
      } else if (res.plain) {
        state.plainText = res.plain;
        state.lines = res.plain.split(/\r?\n/).map((t) => ({ time: -1, text: t.trim() })).filter((l) => l.text);
        state.status = 'plain';
        state.source = res.source || 'plain';
      } else {
        state.status = 'empty';
      }

      if (state.lines.length) {
        if (SF.store.state.prefs.lyricsAutoRomanize && hasNonLatin(state.lines)) {
          state.showRomanization = true;
          SF.api.romanizeLyrics(state.lines).then((rom) => {
            if (state.trackId === targetId && rom.length) {
              state.romanized = rom;
              SF.bus.emit('lyrics:update', Object.assign({}, state));
            }
          });
        }
        if (SF.store.state.prefs.lyricsAutoTranslate) {
          state.showTranslation = true;
          SF.api.translateLyrics(state.lines, SF.store.state.prefs.lang || 'id').then((tr) => {
            if (state.trackId === targetId && tr.length) {
              state.translated = tr;
              SF.bus.emit('lyrics:update', Object.assign({}, state));
            }
          });
        }
      }

      SF.bus.emit('lyrics:update', Object.assign({}, state));
      syncTime(SF.store.state.currentTime || 0, SF.store.state.duration || 0);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (targetId && SF.store.state.currentTrack?.id !== targetId) return;
      state.status = 'empty';
      SF.bus.emit('lyrics:update', Object.assign({}, state));
    }
  }

  function syncTime(currentTime, duration) {
    // 1x automatic retry if duration arrived late (> 45s) and lyrics were empty
    if (
      state.status === 'empty' &&
      !state.hasRetriedWithDur &&
      duration > 45 &&
      SF.store.state.currentTrack &&
      state.trackId === SF.store.state.currentTrack.id
    ) {
      state.hasRetriedWithDur = true;
      loadForTrack(SF.store.state.currentTrack);
      return;
    }

    if (state.status !== 'synced' || !state.lines.length) return;
    const offset = Number(SF.store.state.prefs.lyricsOffsetSec || 0);
    const t = Math.max(0, Number(currentTime || 0) + offset);

    let nextIdx = -1;
    for (let i = 0; i < state.lines.length; i++) {
      if (state.lines[i].time <= t + 0.12) nextIdx = i;
      else break;
    }

    if (nextIdx !== state.activeIndex) {
      state.activeIndex = nextIdx;
      const lineObj = nextIdx >= 0 ? state.lines[nextIdx] : null;
      SF.bus.emit('lyrics:line', {
        index: nextIdx,
        line: lineObj,
        lines: state.lines,
        translated: state.translated,
        romanized: state.romanized,
      });
      pushToNativeIsland(lineObj ? lineObj.text : '');
    }
  }

  const lyrics = {
    state,
    init() {
      SF.bus.on('track:change', ({ track }) => {
        if (track) loadForTrack(track);
      });
      SF.bus.on('playback:time', ({ currentTime, duration }) => {
        syncTime(currentTime, duration);
      });
      if (SF.store.state.currentTrack) {
        loadForTrack(SF.store.state.currentTrack);
      }
    },
    hasNonLatin() {
      return hasNonLatin(state.lines);
    },
    seekToLine(index) {
      const line = state.lines[index];
      if (!line || line.time < 0) return;
      const offset = Number(SF.store.state.prefs.lyricsOffsetSec || 0);
      SF.audio.seekTo(Math.max(0, line.time - offset));
    },
    async searchManual(title, artist) {
      const t = SF.store.state.currentTrack;
      await loadForTrack(t, { title: String(title || '').trim(), artist: String(artist || '').trim() });
    },
    async toggleTranslation() {
      state.showTranslation = !state.showTranslation;
      if (state.showTranslation && !state.translated.length && state.lines.length) {
        state.translated = await SF.api.translateLyrics(state.lines, SF.store.state.prefs.lang || 'id');
      }
      SF.bus.emit('lyrics:update', Object.assign({}, state));
      return state.showTranslation;
    },
    async toggleRomanization() {
      state.showRomanization = !state.showRomanization;
      if (state.showRomanization && !state.romanized.length && state.lines.length) {
        state.romanized = await SF.api.romanizeLyrics(state.lines);
      }
      SF.bus.emit('lyrics:update', Object.assign({}, state));
      return state.showRomanization;
    },
    setOffset(deltaSec) {
      const cur = Number(SF.store.state.prefs.lyricsOffsetSec || 0);
      const next = Math.round(Math.max(-5, Math.min(5, cur + deltaSec)) * 10) / 10;
      SF.store.setPref('lyricsOffsetSec', next);
      syncTime(SF.store.state.currentTime || 0, SF.store.state.duration || 0);
      return next;
    },
  };

  SF.lyrics = lyrics;
})();
