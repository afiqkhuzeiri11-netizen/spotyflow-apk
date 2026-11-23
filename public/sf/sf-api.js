(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});
  const controllers = new Map();
  const homeCache = new Map();
  const searchCache = new Map();

  function getApiBase() {
    try {
      if (SF.utils?.isNativeApk?.()) return 'https://spotyflow.vercel.app';
      const proto = String(window.location?.protocol || '');
      const host = String(window.location?.hostname || '');
      if (proto === 'capacitor:' || proto === 'file:' || (host === 'localhost' && window.location?.port === '')) {
        return 'https://spotyflow.vercel.app';
      }
      return '';
    } catch {
      return 'https://spotyflow.vercel.app';
    }
  }

  function buildUrl(pathStr) {
    const p = String(pathStr || '');
    if (/^https?:\/\//i.test(p)) return p;
    return getApiBase() + (p.startsWith('/') ? p : '/' + p);
  }

  async function fetchJson(pathStr, opts = {}) {
    const { channel = null, timeoutMs = 11000, method = 'GET', body = null, headers = {} } = opts;
    if (channel && controllers.has(channel)) {
      try { controllers.get(channel).abort(); } catch {}
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (channel && ctrl) controllers.set(channel, ctrl);
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const init = {
        method,
        headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers),
        signal: ctrl ? ctrl.signal : undefined,
      };
      if (body !== null) init.body = typeof body === 'string' ? body : JSON.stringify(body);
      const resp = await fetch(buildUrl(pathStr), init);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      if (timer) clearTimeout(timer);
      if (channel && controllers.get(channel) === ctrl) controllers.delete(channel);
    }
  }

  function titleSimilarity(a, b) {
    const tok = (s) =>
      String(s || '')
        .toLowerCase()
        .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 1);
    const ta = new Set(tok(a));
    const tb = new Set(tok(b));
    if (!ta.size || !tb.size) return 0;
    let hits = 0;
    for (const w of ta) if (tb.has(w)) hits++;
    return hits / Math.max(ta.size, tb.size);
  }

  function parseLrc(raw) {
    const lines = [];
    const textLines = String(raw || '').split(/\r?\n/);
    const timeTagRe = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
    for (const row of textLines) {
      const tags = [];
      let m;
      timeTagRe.lastIndex = 0;
      while ((m = timeTagRe.exec(row))) {
        const min = parseInt(m[1], 10);
        const sec = parseInt(m[2], 10);
        const msStr = (m[3] || '0').padEnd(3, '0').slice(0, 3);
        tags.push(min * 60 + sec + parseInt(msStr, 10) / 1000);
      }
      const clean = row.replace(timeTagRe, '').trim();
      if (!tags.length || !clean) continue;
      for (const time of tags) {
        lines.push({ time, text: clean, agent: 'v1' });
      }
    }
    lines.sort((a, b) => a.time - b.time);
    return lines;
  }

  const MOOD_QUERIES = {
    senang: 'lagu pop ceria happy hits Indonesia',
    bersantai: 'indie chill akustik santai Indonesia',
    perjalanan: 'road trip upbeat driving songs',
    energi: 'workout high energy dance pop hits',
    fokus: 'lofi beats instrumental study focus',
    malam: 'lagu malam acoustic galau slow hits',
  };

  const api = {
    getApiBase,
    buildUrl,
    fetchJson,
    parseLrc,

    proxyCoverUrl(url) {
      const u = String(url || '').trim();
      if (!u) return '';
      if (u.startsWith('data:') || u.startsWith('blob:')) return u;
      return buildUrl(`/api/proxy-image?url=${encodeURIComponent(u)}`);
    },

    async searchAll(query, type = 'all') {
      const q = String(query || '').trim();
      if (!q) return { tracks: [], artists: [], albums: [], playlists: [], videos: [] };
      const cacheKey = `${q.toLowerCase()}::${type}`;
      const hit = searchCache.get(cacheKey);
      if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.data;

      const suffix = type === 'video' ? ' official music video' : '';
      try {
        const json = await fetchJson(`/api/search/all?q=${encodeURIComponent(q + suffix)}&limit=30`, {
          channel: 'search',
          timeoutMs: 12000,
        });
        const norm = SF.utils.normalizeTrack;
        const tracks = (Array.isArray(json?.tracks) ? json.tracks : []).map(norm).filter(Boolean);
        const data = {
          tracks,
          videos: tracks.filter((t) => Boolean(t.videoId)),
          artists: Array.isArray(json?.artists) ? json.artists : [],
          albums: Array.isArray(json?.albums) ? json.albums : [],
          playlists: Array.isArray(json?.playlists) ? json.playlists : [],
        };
        if (data.tracks.length || data.artists.length || data.albums.length) {
          searchCache.set(cacheKey, { at: Date.now(), data });
          return data;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
      }

      // Fallback to YTM endpoint
      const ytm = await fetchJson(`/api/ytm?action=search&q=${encodeURIComponent(q)}`, {
        channel: 'search',
        timeoutMs: 10000,
      });
      const tracks = (Array.isArray(ytm?.tracks) ? ytm.tracks : []).map(SF.utils.normalizeTrack).filter(Boolean);
      const data = { tracks, videos: tracks, artists: [], albums: [], playlists: [] };
      if (tracks.length) searchCache.set(cacheKey, { at: Date.now(), data });
      return data;
    },

    async searchSuggest(query) {
      const q = String(query || '').trim();
      if (q.length < 2) return [];
      try {
        const data = await fetchJson(`/api/search/suggest?q=${encodeURIComponent(q)}`, {
          channel: 'suggest',
          timeoutMs: 4500,
        });
        const out = [];
        const seen = new Set();
        for (const a of (data?.artists || []).slice(0, 3)) {
          if (a?.name && !seen.has(a.name.toLowerCase())) {
            seen.add(a.name.toLowerCase());
            out.push({ type: 'Artis', label: a.name, query: a.name });
          }
        }
        for (const t of (data?.tracks || []).slice(0, 4)) {
          if (t?.title && !seen.has(t.title.toLowerCase())) {
            seen.add(t.title.toLowerCase());
            out.push({ type: 'Lagu', label: `${t.title}${t.artist?.name ? ' — ' + t.artist.name : ''}`, query: t.title });
          }
        }
        return out;
      } catch {
        return [];
      }
    },

    async getHomeFeed(mood = '') {
      const key = String(mood || 'default').toLowerCase();
      const cached = homeCache.get(key);
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;

      let tracks = [];
      let artists = [];
      if (mood && MOOD_QUERIES[mood]) {
        const res = await api.searchAll(MOOD_QUERIES[mood], 'all');
        tracks = res.tracks || [];
        artists = res.artists || [];
      } else {
        const region = SF.store?.state?.prefs?.region || 'ID';
        try {
          const ch = await fetchJson(`/api/charts/country/${encodeURIComponent(region)}`, {
            channel: 'home',
            timeoutMs: 9000,
          });
          tracks = (Array.isArray(ch?.tracks) ? ch.tracks : []).map(SF.utils.normalizeTrack).filter(Boolean);
        } catch {}
        if (tracks.length < 6) {
          const res = await api.searchAll('top hits Indonesia pop viral', 'all');
          tracks = res.tracks || [];
          artists = res.artists || [];
        }
      }
      if (!artists.length && tracks.length) {
        const seen = new Set();
        for (const t of tracks) {
          const nm = String(t.artist || '').trim();
          if (!nm || seen.has(nm.toLowerCase())) continue;
          seen.add(nm.toLowerCase());
          artists.push({ id: t.artistId || '', name: nm, picture_medium: t.cover || '' });
          if (artists.length >= 10) break;
        }
      }
      const data = { tracks, artists };
      if (tracks.length) homeCache.set(key, { at: Date.now(), data });
      return data;
    },

    async getArtistProfile(name, id = '') {
      const json = await fetchJson(
        `/api/artist/full-profile?name=${encodeURIComponent(name || '')}&id=${encodeURIComponent(id || '')}`,
        { channel: 'artist', timeoutMs: 11000 }
      );
      return {
        artist: json?.artist || { name, id },
        topTracks: (Array.isArray(json?.topTracks) ? json.topTracks : []).map(SF.utils.normalizeTrack).filter(Boolean),
        albums: Array.isArray(json?.albums) ? json.albums : [],
        relatedArtists: Array.isArray(json?.relatedArtists) ? json.relatedArtists : [],
      };
    },

    async getAlbumDetail(albumObj) {
      const id = String(albumObj?.id || '').trim();
      const title = String(albumObj?.title || '').trim();
      const artist = typeof albumObj?.artist === 'string' ? albumObj.artist : String(albumObj?.artist?.name || '');
      let raw = null;
      try {
        if (id && /^itunes_/i.test(id)) {
          raw = await fetchJson(`/api/album/itunes/${encodeURIComponent(id.replace(/^itunes_/i, ''))}`, { channel: 'album' });
        } else if (id && /^\d+$/.test(id)) {
          raw = await fetchJson(`/api/catalog/album/${encodeURIComponent(id)}`, { channel: 'album' });
        }
      } catch {}
      const merged = Object.assign({}, albumObj, raw || {});
      const listRaw = Array.isArray(raw?.tracks?.data) ? raw.tracks.data : (Array.isArray(raw?.tracks) ? raw.tracks : []);
      let tracks = listRaw.map((tr) => SF.utils.normalizeTrack(Object.assign({
        album: { id: merged.id, title: merged.title, cover_medium: merged.cover_medium || merged.cover_xl || merged.cover },
        artist: tr.artist || merged.artist || artist,
      }, tr))).filter(Boolean);
      if (!tracks.length && title) {
        const fb = await api.searchAll(`${title} ${artist}`.trim(), 'all');
        tracks = fb.tracks || [];
      }
      return { album: merged, tracks };
    },

    async getPlaylistDetail(plObj) {
      const id = String(plObj?.id || '').trim();
      let tracks = [];
      try {
        if (id && /^\d+$/.test(id)) {
          const data = await fetchJson(`/api/catalog/playlist/${encodeURIComponent(id)}`, { channel: 'playlist' });
          const arr = Array.isArray(data?.tracks?.data) ? data.tracks.data : (Array.isArray(data?.tracks) ? data.tracks : []);
          tracks = arr.map(SF.utils.normalizeTrack).filter(Boolean);
        }
      } catch {}
      if (!tracks.length && plObj?.title) {
        const fb = await api.searchAll(plObj.title, 'all');
        tracks = fb.tracks || [];
      }
      return { playlist: plObj, tracks };
    },

    async getSimilarTracks(track) {
      if (!track) return [];
      try {
        const res = await fetchJson('/api/recommendations/smart', {
          method: 'POST',
          channel: 'recommend',
          timeoutMs: 9000,
          body: {
            seedTrack: { id: track.id, title: track.title, artist: track.artist },
            recentTracks: (SF.store?.state?.history || []).slice(0, 8).map((t) => ({ title: t.title, artist: t.artist })),
          },
        });
        const arr = (Array.isArray(res?.tracks) ? res.tracks : (Array.isArray(res?.data) ? res.data : []))
          .map(SF.utils.normalizeTrack)
          .filter((t) => t && t.id !== track.id);
        if (arr.length) return arr;
      } catch {}
      try {
        const fb = await api.searchAll(`${track.artist} ${track.title}`, 'all');
        return (fb.tracks || []).filter((t) => t.id !== track.id).slice(0, 12);
      } catch {
        return [];
      }
    },

    async fetchLyrics(track, durationSec = 0, manualQuery = null) {
      if (!track && !manualQuery) return { synced: [], plain: '', source: 'none' };
      const title = String(manualQuery?.title || track?.title || '').trim();
      const artist = String(manualQuery?.artist || track?.artist || '').trim();
      const dur = Math.round(Number(durationSec || track?.duration || 0));
      const cacheKey = `sf_lyrics_v4_${track?.id || (title + '_' + artist).toLowerCase()}`;

      if (!manualQuery) {
        const cached = SF.store?.safeGetJson?.(cacheKey, null);
        if (cached && ((Array.isArray(cached.synced) && cached.synced.length) || cached.plain)) {
          return cached;
        }
      }

      // 1. Primary SpotyFlow Server Lyrics Engine
      try {
        const qs = new URLSearchParams({
          title,
          artist,
          duration: String(dur || 0),
          videoId: String(track?.videoId || ''),
        });
        const data = await fetchJson(`/api/lyrics?${qs.toString()}`, { channel: 'lyrics', timeoutMs: 10000 });
        const syncedRaw = data?.syncedLyrics || (Array.isArray(data?.lines) ? data.lines : '');
        const synced = Array.isArray(syncedRaw)
          ? syncedRaw.map((l) => ({ time: Number(l.time || l.startTimeSec || 0), text: String(l.text || l.words || '').trim(), agent: 'v1' })).filter((l) => l.text)
          : parseLrc(syncedRaw);
        const plain = String(data?.plainLyrics || data?.lyrics || '').trim();
        if (synced.length || plain) {
          const result = { synced, plain, source: data?.source || 'spotyflow' };
          if (!manualQuery) SF.store?.safeSet?.(cacheKey, result);
          return result;
        }
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
      }

      // 2. Direct LRCLIB Strict Validation Fallback (Title >= 0.55 & Duration delta <= 22s, reject DJ/Remix mismatch)
      try {
        const q = `${artist} ${title}`.trim();
        const resp = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
        if (resp.ok) {
          const items = await resp.json();
          const wantRemix = /dj|remix|slowed|reverb|sped/i.test(title);
          let best = null;
          let bestScore = -1;
          for (const it of (Array.isArray(items) ? items : [])) {
            const candTitle = String(it.trackName || it.name || '');
            if (!wantRemix && /dj|remix|slowed|reverb/i.test(candTitle)) continue;
            const sim = titleSimilarity(title, candTitle);
            if (sim < 0.55) continue;
            const cDur = Number(it.duration || 0);
            if (dur > 30 && cDur > 30 && Math.abs(cDur - dur) > 22) continue;
            const score = sim * 100 + (it.syncedLyrics ? 30 : 0) - (dur > 30 && cDur > 30 ? Math.abs(cDur - dur) : 0);
            if (score > bestScore) {
              bestScore = score;
              best = it;
            }
          }
          if (best) {
            const synced = parseLrc(best.syncedLyrics || '');
            const plain = String(best.plainLyrics || '').trim();
            if (synced.length || plain) {
              const result = { synced, plain, source: 'lrclib' };
              if (!manualQuery) SF.store?.safeSet?.(cacheKey, result);
              return result;
            }
          }
        }
      } catch {}

      return { synced: [], plain: '', source: 'none' };
    },

    async translateLyrics(lines, targetLang = 'id') {
      try {
        const cleanLines = (Array.isArray(lines) ? lines : []).map((l) => (typeof l === 'string' ? l : l.text));
        const res = await fetchJson('/api/lyrics/translate', {
          method: 'POST',
          timeoutMs: 12000,
          body: { lines: cleanLines, targetLang },
        });
        return Array.isArray(res?.translated) ? res.translated : (Array.isArray(res?.lines) ? res.lines : []);
      } catch {
        return [];
      }
    },

    async romanizeLyrics(lines) {
      try {
        const cleanLines = (Array.isArray(lines) ? lines : []).map((l) => (typeof l === 'string' ? l : l.text));
        const res = await fetchJson('/api/lyrics/romanize', {
          method: 'POST',
          timeoutMs: 12000,
          body: { lines: cleanLines },
        });
        return Array.isArray(res?.romanized) ? res.romanized : (Array.isArray(res?.lines) ? res.lines : []);
      } catch {
        return [];
      }
    },

    async importExternalPlaylist(url) {
      const res = await fetchJson('/api/playlist/import', {
        method: 'POST',
        channel: 'import',
        timeoutMs: 15000,
        body: { url: String(url || '').trim() },
      });
      const tracks = (Array.isArray(res?.tracks) ? res.tracks : []).map(SF.utils.normalizeTrack).filter(Boolean);
      return { name: String(res?.name || res?.title || 'Playlist Impor'), tracks };
    },

    async jamCreate(hostName, jamState) {
      return await fetchJson('/api/jam/create', {
        method: 'POST',
        timeoutMs: 8000,
        body: { hostName: hostName || 'Host', state: jamState || {} },
      });
    },

    async jamUpdate(code, jamState) {
      return await fetchJson('/api/jam/update', {
        method: 'POST',
        timeoutMs: 8000,
        body: { code, state: jamState || {} },
      });
    },

    async jamGetState(code) {
      return await fetchJson(`/api/jam/state?code=${encodeURIComponent(code || '')}`, { timeoutMs: 8000 });
    },

    async checkAppVersion() {
      return await fetchJson('/api/app/version', { timeoutMs: 7000 });
    },
  };

  SF.api = api;
})();
