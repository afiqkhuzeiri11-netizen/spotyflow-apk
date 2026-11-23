'use strict';
/**
 * SpotyFlow Serverless Backend (v8.0.0)
 * 100% Vercel-Native Stateless Serverless:
 * - Tanpa Socket.IO, tanpa Baileys WhatsApp, tanpa penulisan disk lokal
 * - Verifikasi Google OAuth ketat (tokeninfo + aud + email_verified) & Email OTP Stateless HMAC/JWT (Resend + MX DNS)
 * - Fast-Race Audio Resolver (Promise.any 3200ms) + Strict Match Scorer + Redirect 302 (anti-limit 4.5MB Vercel)
 * - Super Search Multi-Sumber (Deezer, iTunes, YouTube Piped/Invidious, Audius) + Smart Artwork Enrichment
 * - Multi-Source Lyrics Waterfall (LRCLIB -> NetEase / Lyrist / Lyrics.ovh -> YouTube Captions)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns');
const zlib = require('node:zlib');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

function loadEnvIfLocal(filePath) {
  if (process.env.VERCEL) return;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // Abaikan jika .env tidak ada
  }
}

loadEnvIfLocal(path.join(__dirname, '.env'));

const VERSION = '2.0.2';
const NATIVE_APK_VERSION_CODE = 202;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const IS_PROD = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');

const JWT_SECRET = (() => {
  const explicit = String(process.env.JWT_SECRET || process.env.SESSION_SECRET || '').trim();
  if (explicit.length >= 24) return explicit;
  const highEntropySeed = String(
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.RESEND_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ''
  ).trim();
  if (highEntropySeed) {
    if (IS_PROD) {
      console.warn('[SpotyFlow Security] JWT_SECRET belum disetel eksplisit; menggunakan derivasi HMAC dari secret server.');
    }
    return crypto.createHmac('sha256', highEntropySeed).update('spotyflow-jwt-signing-v2').digest('hex');
  }
  console.warn('[SpotyFlow Security] Menggunakan ephemeral random JWT_SECRET (setel JWT_SECRET di environment produksi).');
  return crypto.randomBytes(32).toString('hex');
})();

const ACCESS_COOKIE = 'sf_access_token';
const REFRESH_COOKIE = 'sf_refresh_token';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Hanya host Piped cadangan yang sehat (host mati/500/CORS-error telah dibersihkan)
const PIPED_INSTANCES = [
  'https://pipedapi.r4fo.com',
  'https://pipedapi.darkness.services',
  'https://pipedapi.drgns.space',
];

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.jing.rocks',
  'https://inv.tux.pizza',
];

const GEMINI_MODELS = Array.from(
  new Set(
    [
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      String(process.env.GEMINI_MODEL || '').trim(),
      'gemini-flash-lite-latest',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
    ].filter(Boolean)
  )
);

const FALLBACK_ICON_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const APP_BUILD_ID = (() => {
  try {
    const htmlPath = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
      ? path.join(PUBLIC_DIR, 'index.html')
      : path.join(__dirname, 'spotyflow.html');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(htmlPath)).digest('hex').slice(0, 12);
    return `${VERSION}-${hash}`;
  } catch {
    return `${VERSION}-${process.env.VERCEL_DEPLOYMENT_ID || 'serverless'}`;
  }
})();

// =========================================================================
// 1. UTILITAS KEAMANAN, HTTP TIMEOUT, & NORMALISASI TEKS
// =========================================================================

function isTrustedSpotyFlowHost(rawHost) {
  const host = String(rawHost || '').split(',')[0].trim().toLowerCase();
  if (!host || /[\s/\\@?#]/.test(host)) return false;
  if (host === 'spotyflow.vercel.app') return true;
  if (/^spotyflow(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(host)) return true;
  const vercelUrlHost = String(process.env.VERCEL_URL || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (vercelUrlHost && host === vercelUrlHost) return true;
  if (!process.env.VERCEL && /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/i.test(host)) return true;
  return false;
}

function getSelfBaseUrl(req) {
  const explicitBase = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (explicitBase && isSafePublicUrl(explicitBase, true)) return explicitBase;
  const rawHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (isTrustedSpotyFlowHost(rawHost)) {
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(rawHost);
    return `${isLocal ? 'http' : 'https'}://${rawHost}`;
  }
  const vercelUrl = String(process.env.VERCEL_URL || '').trim().replace(/^https?:\/\//, '').split('/')[0];
  if (vercelUrl && /^[a-z0-9.-]+\.vercel\.app$/i.test(vercelUrl)) {
    return `https://${vercelUrl}`;
  }
  return 'https://spotyflow.vercel.app';
}

function isSafePublicUrl(rawUrl, requireHttps = false) {
  try {
    const u = new URL(String(rawUrl || ''));
    if (requireHttps ? u.protocol !== 'https:' : (u.protocol !== 'https:' && u.protocol !== 'http:')) return false;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !host ||
      host === 'localhost' ||
      host === '::1' ||
      host === '0:0:0:0:0:0:0:1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80:') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.localhost')
    ) {
      return false;
    }
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      return false;
    }
    if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url, timeoutMs = 4000, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function fetchText(url, timeoutMs = 4000, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': UA,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

function normalizeStr(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return normalizeStr(text)
    .split(' ')
    .filter((w) => w.length >= 2);
}

function upgradeItunesArt(url, size = 600) {
  const s = String(url || '');
  if (!s) return '';
  return s.replace(/\d+x\d+bb\.(jpg|jpeg|png|webp)/i, `${size}x${size}bb.$1`);
}

function deezerCoverFromMd5(md5, size = 500) {
  if (!md5 || !/^[a-f0-9]{16,}$/i.test(String(md5))) return '';
  return `https://e-cdns-images.dzcdn.net/images/cover/${md5}/${size}x${size}-000000-80-0-0.jpg`;
}

function resolveDeezerTrackCover(t) {
  const md5 = t?.md5_image || t?.album?.md5_image || '';
  const xl = t?.album?.cover_xl || t?.album?.cover_big || deezerCoverFromMd5(md5, 1000) || deezerCoverFromMd5(md5, 500);
  const med = t?.album?.cover_medium || deezerCoverFromMd5(md5, 500) || xl;
  return { cover_xl: xl || med || '/icon-192.png', cover_medium: med || xl || '/icon-192.png' };
}

function resolveDeezerAlbumCover(a) {
  const md5 = a?.md5_image || '';
  const xl = a?.cover_xl || a?.cover_big || deezerCoverFromMd5(md5, 1000) || deezerCoverFromMd5(md5, 500);
  const med = a?.cover_medium || deezerCoverFromMd5(md5, 500) || xl;
  return { cover_xl: xl || med || '/icon-192.png', cover_medium: med || xl || '/icon-192.png' };
}

function resolveDeezerArtistPic(a) {
  const xl = a?.picture_xl || a?.picture_big || a?.picture_medium || a?.picture || '/icon-192.png';
  const med = a?.picture_medium || a?.picture_big || a?.picture_xl || a?.picture || '/icon-192.png';
  return { picture_xl: xl, picture_medium: med };
}

function isValidVideoId(id) {
  return /^[a-zA-Z0-9_-]{11}$/.test(String(id || ''));
}

// =========================================================================
// 1B. LIGHTWEIGHT IN-MEMORY CIRCUIT BREAKER (hostHealthMap — 5m Cooldown)
// =========================================================================

const CIRCUIT_FAIL_THRESHOLD = 2;
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 menit cooldown
const hostHealthMap = new Map();

function getHostHealthEntry(hostKey) {
  const key = String(hostKey || '').trim().toLowerCase();
  if (!key) return null;
  let entry = hostHealthMap.get(key);
  if (!entry) {
    entry = { fails: 0, cooldownUntil: 0, lastLatencyMs: 0, successes: 0 };
    if (hostHealthMap.size > 120) {
      const oldest = hostHealthMap.keys().next().value;
      if (oldest) hostHealthMap.delete(oldest);
    }
    hostHealthMap.set(key, entry);
  }
  return entry;
}

function isHostHealthy(hostKey) {
  const entry = getHostHealthEntry(hostKey);
  if (!entry) return true;
  if (entry.cooldownUntil && Date.now() < entry.cooldownUntil) {
    return false;
  }
  if (entry.cooldownUntil && Date.now() >= entry.cooldownUntil) {
    entry.cooldownUntil = 0;
    entry.fails = 0;
  }
  return true;
}

function recordHostSuccess(hostKey, latencyMs = 0) {
  const entry = getHostHealthEntry(hostKey);
  if (!entry) return;
  entry.fails = 0;
  entry.cooldownUntil = 0;
  entry.successes += 1;
  if (latencyMs > 0) {
    entry.lastLatencyMs = entry.lastLatencyMs > 0
      ? Math.round(entry.lastLatencyMs * 0.65 + latencyMs * 0.35)
      : Math.round(latencyMs);
  }
}

function recordHostFailure(hostKey) {
  const entry = getHostHealthEntry(hostKey);
  if (!entry) return;
  entry.fails += 1;
  if (entry.fails >= CIRCUIT_FAIL_THRESHOLD) {
    entry.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  }
}

function getHealthyHostsSorted(hosts) {
  const list = Array.isArray(hosts) ? hosts.filter(Boolean) : [];
  if (!list.length) return [];
  const healthy = list.filter((h) => isHostHealthy(h));
  const pool = healthy.length ? healthy : list;
  return [...pool].sort((a, b) => {
    const ea = hostHealthMap.get(String(a).toLowerCase());
    const eb = hostHealthMap.get(String(b).toLowerCase());
    const la = ea?.lastLatencyMs > 0 ? ea.lastLatencyMs : 9999;
    const lb = eb?.lastLatencyMs > 0 ? eb.lastLatencyMs : 9999;
    if (la !== lb) return la - lb;
    return (eb?.successes || 0) - (ea?.successes || 0);
  });
}

function getCircuitBreakerSnapshot() {
  const now = Date.now();
  const coolingDown = [];
  for (const [host, st] of hostHealthMap.entries()) {
    if (st.cooldownUntil && now < st.cooldownUntil) {
      coolingDown.push({ host, retryInSec: Math.ceil((st.cooldownUntil - now) / 1000) });
    }
  }
  return { trackedHosts: hostHealthMap.size, coolingDown };
}

// Helper Internal Hybrid Bridge ke Python Serverless Function (/api/ytm)
async function callYtmPython(req, params = {}, timeoutMs = 3500) {
  const cbKey = params?.action === 'stream' ? 'ytm-python:stream' : 'ytm-python';
  if (!isHostHealthy(cbKey)) return null;
  const startedAt = Date.now();
  try {
    const customBase = String(process.env.YTM_PYTHON_BASE_URL || '').trim().replace(/\/+$/, '');
    let baseUrl = customBase && isSafePublicUrl(customBase, true) ? customBase : '';
    if (!baseUrl) {
      if (!process.env.VERCEL) return null;
      baseUrl = getSelfBaseUrl(req);
    }
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        qs.set(k, String(v).trim());
      }
    }
    const res = await fetch(`${baseUrl}/api/ytm?${qs.toString()}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      recordHostFailure(cbKey);
      return null;
    }
    const data = await res.json();
    if (data && typeof data === 'object') {
      if (data.ok === false && params?.action === 'stream') {
        recordHostFailure(cbKey);
      } else {
        recordHostSuccess(cbKey, Date.now() - startedAt);
      }
      return data;
    }
    recordHostFailure(cbKey);
    return null;
  } catch {
    recordHostFailure(cbKey);
    return null;
  }
}

async function fetchDirectStreamFromYtmPython(req, videoId, timeoutMs = 3200, quality = 'high') {
  if (!isValidVideoId(videoId)) throw new Error('Invalid videoId');
  if (!isHostHealthy('ytm-python:stream')) throw new Error('ytm-python stream in cooldown');
  const qMode = String(quality || '').toLowerCase() === 'low' ? 'low' : 'high';
  const data = await callYtmPython(req, { action: 'stream', videoId, quality: qMode }, timeoutMs);
  if (!data || !data.ok || !data.url || !isSafePublicUrl(data.url)) {
    throw new Error(data?.error || 'No Python yt-dlp stream');
  }
  const abr = Number(data.abr || (qMode === 'low' ? 64 : 128));
  const ext = String(data.ext || 'm4a').toLowerCase();
  return {
    url: data.url,
    mimeType: ext === 'webm' ? 'audio/webm' : 'audio/mp4',
    bitrate: abr,
    quality: qMode === 'low' ? `${ext.toUpperCase()} ${abr}k (Hemat)` : `${ext.toUpperCase()} ${abr}k`,
    videoId,
    title: '',
    author: '',
    duration: Number(data.duration || 0),
    provider: 'YouTube Music (yt-dlp)',
  };
}

// =========================================================================
// 2. AUTENTIKASI STATELESS (GOOGLE OAUTH KETAT + EMAIL OTP HMAC + TAMU)
// =========================================================================

const DEFAULT_GOOGLE_CLIENT_ID = '602927550377-v1dicdufnh5t2l3baq74jlbtg4gold37.apps.googleusercontent.com';

function getGoogleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID).trim();
}

function isEmailOtpReady() {
  return Boolean(String(process.env.RESEND_API_KEY || '').trim());
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      name: user.displayName,
      email: user.email || null,
      avatar: user.avatarUrl || null,
      provider: user.provider || 'guest',
      isGuest: Boolean(user.isGuest),
      type: 'access',
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      name: user.displayName,
      email: user.email || null,
      avatar: user.avatarUrl || null,
      provider: user.provider || 'guest',
      isGuest: Boolean(user.isGuest),
      type: 'refresh',
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '30d' }
  );
}

function setAuthCookies(res, accessToken, refreshToken) {
  const baseOpts = {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    path: '/',
  };
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseOpts, maxAge: 7 * 24 * 3600 * 1000 });
  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, { ...baseOpts, maxAge: 30 * 24 * 3600 * 1000 });
  }
}

function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/', httpOnly: true, secure: IS_PROD, sameSite: 'lax' });
  res.clearCookie(REFRESH_COOKIE, { path: '/', httpOnly: true, secure: IS_PROD, sameSite: 'lax' });
}

function extractUserFromReq(req) {
  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token = bearer || req.cookies?.[ACCESS_COOKIE] || '';
  if (!token || token.length > 2048) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded || decoded.type !== 'access' || !decoded.sub) return null;
    return {
      id: String(decoded.sub),
      displayName: String(decoded.name || 'Pengguna SpotyFlow').slice(0, 48),
      email: decoded.email || null,
      avatarUrl: decoded.avatar || null,
      provider: decoded.provider || 'guest',
      isGuest: Boolean(decoded.isGuest),
    };
  } catch {
    return null;
  }
}

function optionalAuth(req, _res, next) {
  req.user = extractUserFromReq(req);
  next();
}

function hashOtp(email, otp) {
  return crypto.createHmac('sha256', JWT_SECRET).update(`${email.toLowerCase()}:${otp}`).digest('hex');
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '***';
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}

async function hasValidMxRecord(domain) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3500);
    dns.resolveMx(domain, (err, addresses) => {
      clearTimeout(timer);
      if (err || !Array.isArray(addresses) || addresses.length === 0) return resolve(false);
      resolve(addresses.some((a) => a && a.exchange));
    });
  });
}

// =========================================================================
// 3. AUDIUS DISCOVERY & PIPED / INVIDIOUS FAST-RACE ENGINE
// =========================================================================

let cachedAudiusNode = { host: '', hosts: [], expiresAt: 0 };

async function getAudiusDiscoveryHost() {
  if (cachedAudiusNode.host && Date.now() < cachedAudiusNode.expiresAt && isHostHealthy(cachedAudiusNode.host)) {
    return cachedAudiusNode.host;
  }
  if (Array.isArray(cachedAudiusNode.hosts) && cachedAudiusNode.hosts.length && Date.now() < cachedAudiusNode.expiresAt) {
    const healthyCached = getHealthyHostsSorted(cachedAudiusNode.hosts);
    if (healthyCached.length) {
      cachedAudiusNode.host = healthyCached[0];
      return cachedAudiusNode.host;
    }
  }
  try {
    const data = await fetchJson('https://api.audius.co', 2800);
    const list = Array.isArray(data?.data)
      ? data.data.filter((h) => /^https:\/\//i.test(h)).map((h) => h.replace(/\/+$/, ''))
      : [];
    if (list.length) {
      const sorted = getHealthyHostsSorted(list.slice(0, 8));
      const picked = sorted[0] || list[0];
      cachedAudiusNode = { host: picked, hosts: list.slice(0, 8), expiresAt: Date.now() + 10 * 60 * 1000 };
      return cachedAudiusNode.host;
    }
  } catch {
    // fallback host default
  }
  return 'https://discoveryprovider.audius.co';
}

function pickBestAudioOnlyStream(streams) {
  if (!Array.isArray(streams) || !streams.length) return null;
  const valid = streams
    .filter((s) => s && s.url && isSafePublicUrl(s.url))
    .map((s) => {
      const mime = String(s.mimeType || s.type || '').toLowerCase();
      const bitrate = Number(s.bitrate || s.audioBitrate || 0);
      const kbps = bitrate > 1000 ? Math.round(bitrate / 1000) : bitrate;
      const isM4a = mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac');
      const isOpus = mime.includes('opus') || mime.includes('webm');
      let score = 0;
      if (isM4a) score += 35; // Kompatibel penuh iOS Safari + Android + Desktop
      else if (isOpus) score += 25;
      if (kbps >= 96 && kbps <= 165) score += 40; // Sweet spot ringan & cepat buffer di HP
      else if (kbps > 165 && kbps <= 260) score += 25;
      else if (kbps >= 64) score += 15;
      return {
        url: s.url,
        mimeType: mime || (isM4a ? 'audio/mp4' : 'audio/webm'),
        bitrate: kbps || 128,
        quality: isM4a ? `AAC ${kbps || 128}k` : `Opus ${kbps || 128}k`,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
  return valid[0] || null;
}

async function fetchDirectStreamFromPiped(baseUrl, videoId, timeoutMs = 2400) {
  if (!isHostHealthy(baseUrl)) throw new Error('Piped host in cooldown');
  const startedAt = Date.now();
  try {
    const data = await fetchJson(`${baseUrl}/streams/${encodeURIComponent(videoId)}`, timeoutMs);
    const picked = pickBestAudioOnlyStream(data?.audioStreams);
    if (!picked) throw new Error('No audio stream on Piped');
    recordHostSuccess(baseUrl, Date.now() - startedAt);
    return {
      ...picked,
      videoId,
      title: data.title || '',
      author: data.uploader || '',
      duration: Number(data.duration || 0),
      provider: 'Piped',
      subtitles: Array.isArray(data.subtitles) ? data.subtitles : [],
    };
  } catch (err) {
    recordHostFailure(baseUrl);
    throw err;
  }
}

async function fetchDirectStreamFromInvidious(baseUrl, videoId, timeoutMs = 2400) {
  if (!isHostHealthy(baseUrl)) throw new Error('Invidious host in cooldown');
  const startedAt = Date.now();
  try {
    const data = await fetchJson(`${baseUrl}/api/v1/videos/${encodeURIComponent(videoId)}`, timeoutMs);
    const adaptive = Array.isArray(data?.adaptiveFormats)
      ? data.adaptiveFormats.filter((f) => String(f.type || '').toLowerCase().startsWith('audio/'))
      : [];
    const picked = pickBestAudioOnlyStream(adaptive);
    if (!picked) throw new Error('No audio stream on Invidious');
    recordHostSuccess(baseUrl, Date.now() - startedAt);
    return {
      ...picked,
      videoId,
      title: data.title || '',
      author: data.author || '',
      duration: Number(data.lengthSeconds || 0),
      provider: 'Invidious',
      captions: Array.isArray(data.captions) ? data.captions : [],
      baseUrl,
    };
  } catch (err) {
    recordHostFailure(baseUrl);
    throw err;
  }
}

const UA_IOS = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';
const WEB_CLIENT_VERSION = '2.20250312.04.00';
const MAX_VERCEL_RANGE_CHUNK = 1800000; // 1.8 MB per HTTP 206 Range chunk (aman di bawah limit 4.5MB Vercel)

let cachedYtVisitorData = '';
let cachedYtVisitorExp = 0;
const iosStreamMetaCache = new Map();

function decodeVideoIdParam(raw) {
  const s = String(raw || '').replace(/^(u_sf_|ytm_|yt_|direct_|ytfull_|client_piped_)/, '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  if (s.startsWith('sf_')) {
    try {
      const dec = Buffer.from(s.slice(3), 'base64url').toString('utf8');
      if (/^[a-zA-Z0-9_-]{11}$/.test(dec)) return dec;
    } catch {}
  }
  return '';
}

async function getYtVisitorData(timeoutMs = 2400) {
  if (cachedYtVisitorData && Date.now() < cachedYtVisitorExp) {
    return cachedYtVisitorData;
  }
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: WEB_CLIENT_VERSION,
          },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const j = await res.json();
      const vd = String(j?.responseContext?.visitorData || '').trim();
      if (vd) {
        cachedYtVisitorData = vd;
        cachedYtVisitorExp = Date.now() + 45 * 60 * 1000;
        return vd;
      }
    }
  } catch {}
  return cachedYtVisitorData || '';
}

async function fetchDirectStreamFromIosInnertube(videoId, timeoutMs = 2800, forceRefresh = false, quality = 'high') {
  if (!isValidVideoId(videoId)) throw new Error('Invalid videoId');
  const isLow = String(quality || '').toLowerCase() === 'low';
  const cacheKey = isLow ? `${videoId}:low` : videoId;
  if (!forceRefresh) {
    const cached = iosStreamMetaCache.get(cacheKey);
    if (cached && Date.now() < cached.exp) return cached;
  } else {
    iosStreamMetaCache.delete(cacheKey);
  }

  const visitorData = await getYtVisitorData(Math.min(1800, timeoutMs));
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': UA_IOS,
    ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
  };
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'IOS',
          clientVersion: '20.10.4',
          deviceMake: 'Apple',
          deviceModel: 'iPhone16,2',
          osName: 'iPhone',
          osVersion: '18.3.2.22D82',
          hl: 'en',
          gl: 'ID',
          visitorData,
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`IOS Innertube HTTP ${res.status}`);
  const data = await res.json();
  const formats = [
    ...(Array.isArray(data?.streamingData?.adaptiveFormats) ? data.streamingData.adaptiveFormats : []),
    ...(Array.isArray(data?.streamingData?.formats) ? data.streamingData.formats : []),
  ];
  const audioFormats = formats.filter(
    (f) => f && f.url && isSafePublicUrl(f.url) && String(f.mimeType || '').toLowerCase().startsWith('audio/')
  );
  if (!audioFormats.length) throw new Error('No IOS audio formats');

  if (isLow) {
    // Data Saver: utamakan audio hemat kuota 48-96 kbps (itag 139 AAC 48k / Opus 64k-70k)
    audioFormats.sort((a, b) => {
      const aK = (Number(a.bitrate) || 128000) / 1000;
      const bK = (Number(b.bitrate) || 128000) / 1000;
      const aInBand = aK >= 44 && aK <= 98 ? 1 : 0;
      const bInBand = bK >= 44 && bK <= 98 ? 1 : 0;
      if (aInBand !== bInBand) return bInBand - aInBand;
      const aMp4 = String(a.mimeType || '').includes('audio/mp4') ? 1 : 0;
      const bMp4 = String(b.mimeType || '').includes('audio/mp4') ? 1 : 0;
      if (aMp4 !== bMp4) return bMp4 - aMp4;
      return Math.abs(aK - 64) - Math.abs(bK - 64);
    });
  } else {
    audioFormats.sort((a, b) => {
      const aItag140 = Number(a.itag) === 140 ? 1 : 0;
      const bItag140 = Number(b.itag) === 140 ? 1 : 0;
      if (aItag140 !== bItag140) return bItag140 - aItag140;
      const aMp4 = String(a.mimeType || '').includes('audio/mp4') ? 1 : 0;
      const bMp4 = String(b.mimeType || '').includes('audio/mp4') ? 1 : 0;
      if (aMp4 !== bMp4) return bMp4 - aMp4;
      return (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
    });
  }

  const best = audioFormats[0];
  let contentLength = Number(best.contentLength) || 0;
  if (!contentLength) {
    try {
      const probe = await fetch(best.url, {
        headers: { 'User-Agent': UA_IOS, Range: 'bytes=0-1' },
        signal: AbortSignal.timeout(1800),
      });
      const cr = String(probe.headers.get('content-range') || '');
      const m = cr.match(/\/(\d+)$/);
      if (m) contentLength = Number(m[1]);
      if (probe.body) probe.body.cancel().catch(() => {});
    } catch {}
  }

  const durSec =
    Math.round(Number(best.approxDurationMs || 0) / 1000) ||
    Number(data?.videoDetails?.lengthSeconds || 0) ||
    210;
  const kbps = Math.round((Number(best.bitrate) || 128000) / 1000);
  const info = {
    url: best.url,
    mimeType: String(best.mimeType || 'audio/mp4').split(';')[0] || 'audio/mp4',
    bitrate: kbps,
    quality: `AAC ${kbps}k`,
    contentLength,
    videoId,
    title: String(data?.videoDetails?.title || '').trim(),
    author: String(data?.videoDetails?.author || '').trim(),
    duration: durSec,
    provider: 'IosInnertube',
    ua: UA_IOS,
    exp: Date.now() + 90 * 60 * 1000,
  };
  if (iosStreamMetaCache.size > 400) {
    const firstKey = iosStreamMetaCache.keys().next().value;
    if (firstKey) iosStreamMetaCache.delete(firstKey);
  }
  iosStreamMetaCache.set(cacheKey, info);
  return info;
}

async function raceDirectAudioByVideoId(videoId, timeoutMs = 2600, quality = 'high') {
  if (!isValidVideoId(videoId)) return null;
  if (isHostHealthy('ios-innertube')) {
    const startedAt = Date.now();
    try {
      const info = await fetchDirectStreamFromIosInnertube(videoId, timeoutMs, false, quality);
      recordHostSuccess('ios-innertube', Date.now() - startedAt);
      return info;
    } catch {
      recordHostFailure('ios-innertube');
    }
  }
  const healthyPiped = getHealthyHostsSorted(PIPED_INSTANCES);
  const healthyInvidious = getHealthyHostsSorted(INVIDIOUS_INSTANCES);
  const tasks = [
    ...healthyPiped.map((host) => fetchDirectStreamFromPiped(host, videoId, timeoutMs)),
    ...healthyInvidious.map((host) => fetchDirectStreamFromInvidious(host, videoId, timeoutMs)),
  ];
  try {
    return await Promise.any(tasks);
  } catch {
    return null;
  }
}

async function searchPipedHost(baseUrl, query) {
  if (!isHostHealthy(baseUrl)) throw new Error('Piped host in cooldown');
  const startedAt = Date.now();
  try {
    const data = await fetchJson(`${baseUrl}/search?q=${encodeURIComponent(query)}&filter=videos`, 2600);
    const items = Array.isArray(data?.items) ? data.items : [];
    const mapped = items
      .map((it) => {
        const m = String(it.url || '').match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        const videoId = m ? m[1] : '';
        if (!videoId) return null;
        return {
          videoId,
          title: String(it.title || '').trim(),
          author: String(it.uploaderName || '').trim(),
          duration: Number(it.duration || 0),
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        };
      })
      .filter(Boolean);
    if (!mapped.length) throw new Error('Empty Piped search');
    recordHostSuccess(baseUrl, Date.now() - startedAt);
    return mapped;
  } catch (err) {
    recordHostFailure(baseUrl);
    throw err;
  }
}

async function searchInvidiousHost(baseUrl, query) {
  if (!isHostHealthy(baseUrl)) throw new Error('Invidious host in cooldown');
  const startedAt = Date.now();
  try {
    const data = await fetchJson(
      `${baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
      2600
    );
    const items = Array.isArray(data) ? data : [];
    const mapped = items
      .filter((it) => it && isValidVideoId(it.videoId))
      .map((it) => ({
        videoId: it.videoId,
        title: String(it.title || '').trim(),
        author: String(it.author || '').trim(),
        duration: Number(it.lengthSeconds || 0),
        thumbnail: `https://i.ytimg.com/vi/${it.videoId}/hqdefault.jpg`,
      }));
    if (!mapped.length) throw new Error('Empty Invidious search');
    recordHostSuccess(baseUrl, Date.now() - startedAt);
    return mapped;
  } catch (err) {
    recordHostFailure(baseUrl);
    throw err;
  }
}

function parseDurationTextToSec(text) {
  const parts = String(text || '')
    .trim()
    .split(':')
    .map((n) => Number(n));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function extractVideoRenderersFromYtTree(root, maxItems = 18) {
  const out = [];
  const seen = new Set();
  (function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 45 || out.length >= maxItems) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, depth + 1);
        if (out.length >= maxItems) break;
      }
      return;
    }
    const vr = node.videoRenderer;
    if (vr && isValidVideoId(vr.videoId) && !seen.has(vr.videoId)) {
      const title = vr.title?.runs?.map((r) => r.text).join('') || vr.title?.simpleText || '';
      const author =
        vr.ownerText?.runs?.[0]?.text ||
        vr.longBylineText?.runs?.[0]?.text ||
        vr.shortBylineText?.runs?.[0]?.text ||
        '';
      const dur = parseDurationTextToSec(vr.lengthText?.simpleText || '');
      if (dur > 0 && title) {
        seen.add(vr.videoId);
        out.push({
          videoId: vr.videoId,
          title: title.trim(),
          author: author.trim(),
          duration: dur,
          thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
        });
      }
      return;
    }
    for (const k of Object.keys(node)) {
      const val = node[k];
      if (val && typeof val === 'object') walk(val, depth + 1);
      if (out.length >= maxItems) break;
    }
  })(root, 0);
  return out;
}

async function searchYouTubeInnertube(query, timeoutMs = 2800) {
  const res = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: 'https://www.youtube.com',
      'X-YouTube-Client-Name': '1',
      'X-YouTube-Client-Version': WEB_CLIENT_VERSION,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: WEB_CLIENT_VERSION,
          hl: 'en',
          gl: 'ID',
        },
      },
      query,
      params: 'EgIQAQ%3D%3D',
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Innertube search HTTP ${res.status}`);
  const json = await res.json();
  const out = extractVideoRenderersFromYtTree(json, 18);
  if (!out.length) throw new Error('Empty Innertube search');
  return out;
}

async function searchYouTubeHtmlLightweight(query) {
  const html = await fetchText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D&hl=en&gl=ID`,
    3000,
    { headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+cb; SOCS=CAI' } }
  );
  const match = html.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});<\/script>/);
  if (!match) throw new Error('No ytInitialData');
  const json = JSON.parse(match[1]);
  const out = extractVideoRenderersFromYtTree(json, 18);
  if (!out.length) throw new Error('Empty YT HTML results');
  return out;
}

async function raceYouTubeCandidates(query) {
  const qBase = String(query || '').trim();
  if (!qBase) return [];
  const qLyric = /\b(lirik|lyrics?)\b/i.test(qBase)
    ? qBase
    : `${qBase.replace(/\b(official\s*)?audio\b/gi, '').trim()} lirik`.trim();

  // Jalankan Innertube Search + HTML Search (audio & lirik) secara paralel dan gabungkan kandidat unik
  const settled = await Promise.allSettled([
    searchYouTubeInnertube(qBase, 2600),
    searchYouTubeHtmlLightweight(qBase),
    qLyric !== qBase ? searchYouTubeInnertube(qLyric, 2600) : Promise.resolve([]),
  ]);

  const merged = [];
  const seen = new Set();
  for (const r of settled) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      for (const item of r.value) {
        if (item && isValidVideoId(item.videoId) && !seen.has(item.videoId)) {
          seen.add(item.videoId);
          merged.push(item);
        }
      }
    }
  }
  if (merged.length) return merged;

  // Fallback ke Piped/Invidious sehat (Circuit Breaker) hanya jika YouTube direct gagal
  const healthyPiped = getHealthyHostsSorted(PIPED_INSTANCES);
  const healthyInvidious = getHealthyHostsSorted(INVIDIOUS_INSTANCES);
  const fallbackTasks = [
    ...healthyPiped.map((h) => searchPipedHost(h, qBase)),
    ...healthyInvidious.map((h) => searchInvidiousHost(h, qBase)),
  ];
  try {
    return await Promise.any(fallbackTasks);
  } catch {
    return [];
  }
}

async function searchAudiusTracks(query, limit = 8) {
  const host = await getAudiusDiscoveryHost();
  if (!isHostHealthy(host)) return [];
  const startedAt = Date.now();
  try {
    const data = await fetchJson(
      `${host}/v1/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&app_name=SpotyFlow`,
      3200
    );
    recordHostSuccess(host, Date.now() - startedAt);
    const rows = Array.isArray(data?.data) ? data.data : [];
    return rows
      .filter((r) => r && r.id && r.title)
      .map((r) => {
        const art = r.artwork?.['1000x1000'] || r.artwork?.['480x480'] || r.artwork?.['150x150'] || '/icon-192.png';
        return {
          id: `audius_${r.id}`,
          audiusId: String(r.id),
          title: String(r.title || '').trim(),
          author: String(r.user?.name || r.user?.handle || 'Audius Artist').trim(),
          duration: Number(r.duration || 0),
          cover_xl: art,
          cover_medium: r.artwork?.['480x480'] || art,
          streamUrl: `${host}/v1/tracks/${encodeURIComponent(r.id)}/stream?app_name=SpotyFlow`,
        };
      });
  } catch (err) {
    recordHostFailure(host);
    throw err;
  }
}

let cachedScClientId = 'glXhJxvYKPM87la70dG2G1bJ03AdA3hN';
let cachedScClientExp = 0;
const scAudioBufferCache = new Map();

async function getSoundCloudClientId() {
  if (cachedScClientId && Date.now() < cachedScClientExp) return cachedScClientId;
  try {
    const html = await fetchText('https://soundcloud.com', 2600);
    const scripts = [...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[a-zA-Z0-9_-]+\.js/g)].map((m) => m[0]);
    for (const sUrl of scripts.slice(-3)) {
      const js = await fetchText(sUrl, 2400);
      const m = js.match(/client_id:"([a-zA-Z0-9]{32})"/);
      if (m && m[1]) {
        cachedScClientId = m[1];
        cachedScClientExp = Date.now() + 2 * 3600 * 1000;
        return cachedScClientId;
      }
    }
  } catch {}
  cachedScClientExp = Date.now() + 15 * 60 * 1000;
  return cachedScClientId;
}

async function searchSoundCloudTracks(query, limit = 20) {
  try {
    const clientId = await getSoundCloudClientId();
    if (!clientId) return [];
    const data = await fetchJson(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&client_id=${encodeURIComponent(clientId)}&limit=${limit}`,
      3000
    );
    const rows = Array.isArray(data?.collection) ? data.collection : [];
    return rows
      .filter((t) => t && t.id && t.title && Number(t.duration) >= 60000 && Array.isArray(t.media?.transcodings) && t.media.transcodings.length > 0)
      .map((t) => ({
        id: `sc_${t.id}`,
        scId: String(t.id),
        title: String(t.title || '').trim(),
        author: String(t.user?.username || t.publisher_metadata?.artist || '').trim(),
        duration: Math.round(Number(t.duration || 0) / 1000),
        streamUrl: `/api/audio/stream?scId=${encodeURIComponent(t.id)}`,
      }));
  } catch {
    return [];
  }
}

async function searchSaavnTracks(query, limit = 6) {
  try {
    const data = await fetchJson(
      `https://saavn.sumit.co/api/search/songs?query=${encodeURIComponent(query)}&limit=${limit}`,
      2800
    );
    const rows = Array.isArray(data?.data?.results) ? data.data.results : [];
    return rows
      .map((r) => {
        const downloads = Array.isArray(r?.downloadUrl) ? r.downloadUrl.filter((d) => d?.url && isSafePublicUrl(d.url)) : [];
        const bestDl =
          downloads.find((d) => /320/i.test(d.quality || '')) ||
          downloads.find((d) => /160/i.test(d.quality || '')) ||
          downloads[downloads.length - 1];
        if (!bestDl?.url) return null;
        const primaryArtists = Array.isArray(r?.artists?.primary)
          ? r.artists.primary.map((a) => a?.name).filter(Boolean).join(', ')
          : '';
        return {
          id: `saavn_${r.id}`,
          title: String(r.name || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim(),
          author: String(primaryArtists || r.label || '').trim(),
          duration: Number(r.duration || 0),
          quality: bestDl.quality ? `AAC ${bestDl.quality}` : 'AAC 320k',
          streamUrl: bestDl.url,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// =========================================================================
// 4. STRICT MATCH SCORER (ANTI SALAH LAGU / COVER / KARAOKE / REMIX)
// =========================================================================

const BLOCKED_VARIANT_WORDS = [
  'cover',
  'karaoke',
  'instrumental',
  'sped up',
  'slowed',
  'remix',
  'live',
  'reaction',
  '8d',
  'tutorial',
  'piano',
  'koplo',
  'dangdut',
  'jandhut',
  'jedag jedug',
  'parodi',
  'parody',
  'chipmunk',
  'bootleg',
  'mashup',
  'pop punk',
  'metal',
  'reggae',
  'amapiano',
  'funkot',
  'rocksteady',
  'afro soul',
  'band version',
  'solo version',
  'jersey club',
  'edit',
];

function scoreAudioCandidate(candidate, targetArtist, targetTitle, targetDurationSec) {
  const candTitleRaw = String(candidate.title || '');
  const candAuthorRaw = String(candidate.author || '');
  const candCombined = normalizeStr(`${candTitleRaw} ${candAuthorRaw}`);
  const normTargetTitle = normalizeStr(targetTitle);
  const normTargetArtist = normalizeStr(targetArtist);
  const cleanTargetTitle = normalizeStr(
    String(targetTitle || '')
      .replace(/\s*[\(\[][^)\]]*[\)\]]/g, ' ')
      .replace(/\b(feat|ft|featuring)\.?\s+.*/i, '')
  );

  // 1. Blokir kata terlarang KECUALI memang ada di judul lagu yang diminta
  for (const banned of BLOCKED_VARIANT_WORDS) {
    const rx = new RegExp(`\\b${banned.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (rx.test(candTitleRaw) && !rx.test(String(targetTitle || ''))) {
      return -1000;
    }
  }

  // 1b. Deteksi pola cover tidak berlabel: "PenyanyiLain - Judul (ArtisAsli)"
  const dashSplit = candTitleRaw.match(/^([^-–—]+?)\s+[-–—]\s+(.+?)\s*\(([^)]+)\)\s*$/);
  if (dashSplit && normTargetArtist) {
    const prefixNorm = normalizeStr(dashSplit[1]);
    const parenNorm = normalizeStr(dashSplit[3]);
    const aToks = tokenize(normTargetArtist).filter((t) => !['the', 'and', 'feat', 'official'].includes(t));
    const tToks = tokenize(cleanTargetTitle || normTargetTitle);
    if (
      aToks.length &&
      aToks.some((t) => parenNorm.includes(t)) &&
      !aToks.some((t) => prefixNorm.includes(t)) &&
      !tToks.some((t) => prefixNorm.includes(t))
    ) {
      return -950;
    }
  }

  // 2. Nama artis target WAJIB cocok di judul atau channel kandidat
  const artistTokens = tokenize(normTargetArtist).filter((t) => !['the', 'and', 'feat', 'official'].includes(t));
  if (artistTokens.length > 0) {
    const matchedArtistTokens = artistTokens.filter((tok) => candCombined.includes(tok));
    const artistRatio = matchedArtistTokens.length / artistTokens.length;
    if (matchedArtistTokens.length === 0 || (artistTokens.length >= 2 && artistRatio < 0.5)) {
      return -900;
    }
  }

  // 3. Jika durasi katalog > 30 detik, selisih durasi maksimal ±28 detik (toleransi intro/outro lyric video resmi)
  const candDur = Number(candidate.duration || 0);
  const targetDur = Number(targetDurationSec || 0);
  if (targetDur > 30 && candDur > 0) {
    const diff = Math.abs(candDur - targetDur);
    if (diff > 28) return -800;
  } else if (candDur > 0 && (candDur < 45 || candDur > 900)) {
    return -800;
  }

  // 4. Hitung kecocokan judul
  const titleTokens = tokenize(cleanTargetTitle || normTargetTitle);
  let titleScore = 0;
  if (titleTokens.length > 0) {
    const hits = titleTokens.filter((tok) => normalizeStr(candTitleRaw).includes(tok)).length;
    const ratio = hits / titleTokens.length;
    if (ratio < 0.5) return -700;
    titleScore = Math.round(ratio * 50);
  }

  let score = 50 + titleScore;

  // Prioritas seimbang untuk Official Lyric Video / Audio / Lirik (100% embeddable + full-length) & "- Topic"
  if (/official\s*(lyric|audio)/i.test(candTitleRaw)) score += 38;
  else if (/\b(lyrics?|lirik)\b/i.test(candTitleRaw)) score += 34;
  else if (/\baudio\b/i.test(candTitleRaw)) score += 32;
  else if (/official\s*(music\s*)?video/i.test(candTitleRaw)) score += 24;
  if (/-\s*topic$/i.test(candAuthorRaw)) score += 30;

  if (normTargetArtist && normalizeStr(candAuthorRaw).includes(normTargetArtist)) {
    score += 20;
  }

  // Bonus selisih durasi terkecil
  if (targetDur > 30 && candDur > 0) {
    const diff = Math.abs(candDur - targetDur);
    score += Math.max(0, 22 - diff);
  } else if (candDur >= 90 && candDur <= 420) {
    score += 10;
  }

  return score;
}

async function fetchEmergencyOfficialPreviews(artist, title) {
  const q = `${artist} ${title}`.trim();
  const [itRes, dzRes] = await Promise.allSettled([
    fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=5`, 3000),
    fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=5`, 3000),
  ]);

  const fallbacks = [];
  if (itRes.status === 'fulfilled' && Array.isArray(itRes.value?.results)) {
    for (const r of itRes.value.results) {
      if (!r?.previewUrl) continue;
      const sc = scoreAudioCandidate(
        { title: r.trackName, author: r.artistName, duration: 0 },
        artist,
        title,
        0
      );
      if (sc > 0) {
        fallbacks.push({
          sid: `itunes_prev_${r.trackId}`,
          label: 'Cadangan Resmi iTunes (Preview 30d)',
          edition: `${r.trackName} - ${r.artistName}`,
          duration: 30,
          quality: 'AAC Preview',
          streamUrl: r.previewUrl,
          supportsCors: true,
          isPreview: true,
          isPreviewFallback: true,
          score: sc,
        });
        break;
      }
    }
  }
  if (dzRes.status === 'fulfilled' && Array.isArray(dzRes.value?.data)) {
    for (const r of dzRes.value.data) {
      if (!r?.preview) continue;
      const sc = scoreAudioCandidate(
        { title: r.title, author: r.artist?.name || '', duration: 0 },
        artist,
        title,
        0
      );
      if (sc > 0) {
        fallbacks.push({
          sid: `dz_prev_${r.id}`,
          label: 'Cadangan Resmi Deezer (Preview 30d)',
          edition: `${r.title} - ${r.artist?.name || ''}`,
          duration: 30,
          quality: 'MP3 Preview',
          streamUrl: r.preview,
          supportsCors: false,
          isPreview: true,
          isPreviewFallback: true,
          score: sc,
        });
        break;
      }
    }
  }
  return fallbacks;
}

// =========================================================================
// 5. MULTI-SOURCE LYRICS WATERFALL (CLEANER + LRCLIB + NETEASE/LYRIST/OVH + YT CAPTIONS)
// =========================================================================

function stripEmojis(str) {
  return String(str || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '');
}

function stripLyricsNoise(text) {
  let s = stripEmojis(String(text || '').trim());
  const noisePatterns = [
    /\s*[\(\[【][^)\]】]*[\)\]】]/g,
    /\b(sped\s*up|slowed(\s*\+?\s*reverb)?|reverb|tiktok|viral|full\s*bass|bass\s*boosted|lirik(\s*lagu)?|lyrics?|lyric\s*video|terjemahan|sub\s*indo|subtitle|official\s*(music\s*)?(video|audio|mv|lyric)?|music\s*video|mv|audio|hd|4k|hq|remaster(ed)?(\s*\d{4})?|explicit|clean\s*version|visualizer)\b/gi,
    /\b(feat|ft|featuring)\.?\s+[^,&\-|]+/gi,
  ];
  for (const rx of noisePatterns) {
    s = s.replace(rx, ' ');
  }
  return s
    .replace(/[|•·~_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanLyricsMeta(rawArtist, rawTitle) {
  let artist = stripEmojis(String(rawArtist || '').trim())
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/\b(official(\s+channel|\s+music)?|vevo|music|records|entertainment|channel|tv|production|musikindo|studios)\b/gi, ' ')
    .replace(/\s+(feat\.?|ft\.?|featuring|x|&|,)\s+.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  let title = stripLyricsNoise(rawTitle);
  const rawTitleCleaned = title;
  let altArtist = '';
  let altTitle = '';

  const sepMatch = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (sepMatch) {
    const left = sepMatch[1].replace(/\s+/g, ' ').trim();
    const right = sepMatch[2].replace(/\s+/g, ' ').trim();
    if (left.length >= 2 && right.length >= 2 && left.length <= 65 && right.length <= 85) {
      const normRawArt = normalizeStr(artist);
      const normLeft = normalizeStr(left);
      const normRight = normalizeStr(right);
      if (normRawArt && normRight && (normRight.includes(normRawArt) || normRawArt.includes(normRight))) {
        // Format: "Judul Lagu - Nama Artis"
        artist = right;
        title = left;
        altArtist = left;
        altTitle = right;
      } else {
        // Format default: "Nama Artis - Judul Lagu", sekaligus simpan kebalikannya sebagai kandidat
        artist = left;
        title = right;
        altArtist = right;
        altTitle = left;
      }
    }
  }

  title = title
    .replace(/\s+-\s*$/g, '')
    .replace(/^\s*-\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    artist: artist || String(rawArtist || '').trim(),
    title: title || rawTitleCleaned || String(rawTitle || '').trim(),
    rawTitleCleaned: rawTitleCleaned || title,
    altArtist,
    altTitle,
  };
}

function autoSyncPlainLyrics(plainLyrics, durationSec = 210) {
  const rawLines = String(plainLyrics || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[?(intro|verse|chorus|reff|bridge|outro|musik|instrumental).*?\]?$/i.test(l));
  if (rawLines.length < 3) return [];
  const totalDur = Math.max(90, Math.min(600, Number(durationSec) > 35 ? Number(durationSec) : 210));
  const startSec = 8;
  const usableDur = Math.max(45, totalDur - startSec - 12);
  const step = usableDur / rawLines.length;
  return rawLines.map((text, idx) => ({
    time: Number((startSec + idx * step).toFixed(2)),
    text,
  }));
}

function parseLrc(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return [];
  const lines = [];
  for (const rawLine of lrcText.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (!matches.length) continue;
    const text = rawLine.replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (!text) continue;
    for (const m of matches) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0;
      const time = Number((min * 60 + sec + frac).toFixed(2));
      if (Number.isFinite(time)) lines.push({ time, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

function parseVttOrSrtToSyncedLines(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const lines = [];
  const blocks = raw.replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const rows = block.split('\n').map((r) => r.trim()).filter(Boolean);
    const timeIdx = rows.findIndex((r) => r.includes('-->'));
    if (timeIdx < 0) continue;
    const m = rows[timeIdx].match(/(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/);
    if (!m) continue;
    const hrs = Number(m[1] || 0);
    const mins = Number(m[2] || 0);
    const secs = Number(m[3] || 0);
    const ms = Number(m[4] || 0);
    const time = Number((hrs * 3600 + mins * 60 + secs + ms / 1000).toFixed(2));
    const text = rows
      .slice(timeIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && !/^\[?(music|applause|musik)\]?$/i.test(text)) {
      lines.push({ time, text });
    }
  }
  return lines;
}

function formatLyricsResult(syncedLines, plainLyrics, source, durationSec = 210) {
  if (Array.isArray(syncedLines) && syncedLines.length >= 2) {
    return {
      mode: 'synced',
      source,
      syncedLines,
      plainLyrics: plainLyrics || syncedLines.map((l) => l.text).join('\n'),
    };
  }
  const cleanPlain = String(plainLyrics || '').trim();
  if (cleanPlain.length >= 20) {
    const estSynced = autoSyncPlainLyrics(cleanPlain, durationSec);
    return {
      mode: estSynced.length >= 3 ? 'synced' : 'plain',
      source,
      syncedLines: estSynced,
      plainLyrics: cleanPlain,
    };
  }
  return null;
}

const REMIX_INSTRUMENTAL_LYRICS_RE = /\b(dj|remix|mashup|nonstop|jedag\s*jedug|full\s*bass|breakbeat|medley|instrumental|karaoke)\b/i;

function isRemixOrLongTrack(rawTitle = '', durationSec = 0) {
  return REMIX_INSTRUMENTAL_LYRICS_RE.test(String(rawTitle || '')) || Number(durationSec || 0) > 480;
}

function pickBestLrclibItem(list, artist, durationSec, titleHint = '', rawTitleHint = '') {
  if (!Array.isArray(list) || !list.length) return null;
  const artistTokens = tokenize(artist);
  const titleTokens = tokenize(titleHint);
  const combinedHint = normalizeStr(`${artist} ${titleHint} ${rawTitleHint}`);
  const scored = list
    .filter((it) => it && (it.syncedLyrics || it.plainLyrics))
    .map((it) => {
      const candArtist = normalizeStr(it.artistName || '');
      const candTitle = normalizeStr(it.trackName || '');
      const candDuration = Number(it.duration) || 0;

      // DISKUALIFIKASI 1: selisih durasi > 20 detik (jika kedua durasi valid)
      if (durationSec > 30 && candDuration > 0 && Math.abs(candDuration - durationSec) > 20) {
        return { it, score: -999 };
      }

      // Hitung rasio kemiripan kata judul (titleRatio)
      let titleRatio = 1;
      if (titleTokens.length) {
        const tHits = titleTokens.filter((tok) => candTitle.includes(tok)).length;
        titleRatio = tHits / titleTokens.length;
        if (titleRatio < 0.55) {
          return { it, score: -999 };
        }
      }

      // Hitung rasio kemiripan kata artis (artistRatio)
      let artistRatio = 0;
      let artistMatchedInCombined = false;
      if (artistTokens.length) {
        const aHits = artistTokens.filter((tok) => candArtist.includes(tok)).length;
        artistRatio = aHits / artistTokens.length;
        if (artistRatio === 0) {
          const candArtistTokens = tokenize(candArtist);
          artistMatchedInCombined = Boolean(
            (candArtist && combinedHint.includes(candArtist)) ||
            (candArtistTokens.length > 0 && candArtistTokens.every((tok) => combinedHint.includes(tok)))
          );
        }
      }

      let score = it.syncedLyrics ? 35 : 20;
      score += Math.round(titleRatio * 45);

      if (artistTokens.length) {
        if (artistRatio > 0) {
          score += Math.round(artistRatio * 45);
        } else if (artistMatchedInCombined) {
          score += 35;
        } else {
          // Penalti berat -60 jika nama artis diketahui tetapi nol token artis cocok
          score -= 60;
        }
      }

      if (durationSec > 30 && candDuration > 0) {
        const diff = Math.abs(candDuration - durationSec);
        score += Math.max(0, 20 - diff);
      }
      return { it, score };
    })
    .filter((x) => x.score > 35)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.it || null;
}

async function fetchLyricsFromLrclib(artist, title, durationSec, rawTitleCleaned = '', altArtist = '', altTitle = '', exactOnly = false) {
  // 1a. Exact /api/get
  if (artist && title) {
    try {
      const qs = new URLSearchParams({
        artist_name: artist,
        track_name: title,
        ...(durationSec > 30 ? { duration: String(Math.round(durationSec)) } : {}),
      });
      const exact = await fetchJson(`https://lrclib.net/api/get?${qs.toString()}`, 2800);
      const parsed = formatLyricsResult(parseLrc(exact?.syncedLyrics), exact?.plainLyrics, 'LRCLIB', durationSec);
      if (parsed) return parsed;
    } catch {}
  }

  // 1b. Exact /api/get dengan pasangan terbalik (jika format YouTube "Judul - Artis")
  if (altArtist && altTitle) {
    try {
      const qs = new URLSearchParams({
        artist_name: altArtist,
        track_name: altTitle,
      });
      const exactAlt = await fetchJson(`https://lrclib.net/api/get?${qs.toString()}`, 2500);
      const parsed = formatLyricsResult(parseLrc(exactAlt?.syncedLyrics), exactAlt?.plainLyrics, 'LRCLIB', durationSec);
      if (parsed) return parsed;
    } catch {}
  }

  if (exactOnly) return null;

  // 1c. Full-text search /api/search?q= (dengan validasi ketat pickBestLrclibItem)
  const qCandidates = Array.from(
    new Set(
      [
        rawTitleCleaned && rawTitleCleaned.includes('-') ? rawTitleCleaned : '',
        artist && title ? `${artist} ${title}` : '',
        rawTitleCleaned || '',
        title || '',
      ]
        .map((s) => String(s || '').trim())
        .filter((s) => s.length >= 2)
    )
  );

  for (const qStr of qCandidates.slice(0, 3)) {
    try {
      const list = await fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(qStr)}`, 2800);
      const best = pickBestLrclibItem(list, artist, durationSec, title, rawTitleCleaned);
      if (best) {
        const parsed = formatLyricsResult(parseLrc(best.syncedLyrics), best.plainLyrics, 'LRCLIB', durationSec);
        if (parsed) return parsed;
      }
    } catch {}
  }

  // 1d. Search track_name saja
  if (title) {
    try {
      const qs = new URLSearchParams({ track_name: title });
      const list = await fetchJson(`https://lrclib.net/api/search?${qs.toString()}`, 2800);
      const best = pickBestLrclibItem(list, artist, durationSec, title, rawTitleCleaned);
      if (best) {
        const parsed = formatLyricsResult(parseLrc(best.syncedLyrics), best.plainLyrics, 'LRCLIB', durationSec);
        if (parsed) return parsed;
      }
    } catch {}
  }
  return null;
}

async function resolveCanonicalTrackMeta(artist, title, rawTitleCleaned) {
  if (isRemixOrLongTrack(rawTitleCleaned || title, 0)) return null;
  const q = (rawTitleCleaned && rawTitleCleaned.includes('-') ? rawTitleCleaned : `${artist} ${title}`).trim();
  if (q.length < 3) return null;
  const origTitleTokens = tokenize(title || rawTitleCleaned);
  if (!origTitleTokens.length) return null;
  try {
    const dz = await fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=3`, 2600);
    const items = Array.isArray(dz?.data) ? dz.data : [];
    for (const hit of items) {
      if (!hit || !hit.title || !hit.artist?.name) continue;
      const candTitle = normalizeStr(hit.title_short || hit.title);
      const tHits = origTitleTokens.filter((tok) => candTitle.includes(tok)).length;
      const titleSim = tHits / origTitleTokens.length;
      if (titleSim >= 0.6) {
        return {
          artist: String(hit.artist.name).trim(),
          title: String(hit.title_short || hit.title).trim(),
          duration: Number(hit.duration) || 0,
        };
      }
    }
  } catch {}
  return null;
}

async function fetchLyricsFromNetEase(artist, title) {
  const q = `${artist} ${title}`.trim();
  const searchData = await fetchJson(
    `https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=5`,
    3000,
    { headers: { Referer: 'https://music.163.com/' } }
  );
  const songs = Array.isArray(searchData?.result?.songs) ? searchData.result.songs : [];
  if (!songs.length) throw new Error('No NetEase songs');
  const artistTokens = tokenize(artist);
  const titleTokens = tokenize(title);
  const bestSong = songs.find((s) => {
    const names = (s.artists || []).map((a) => normalizeStr(a.name)).join(' ');
    const candTitle = normalizeStr(s.name || '');
    const titleOk = !titleTokens.length || (titleTokens.filter((tok) => candTitle.includes(tok)).length / titleTokens.length) >= 0.55;
    const artistOk = !artistTokens.length || artistTokens.some((tok) => names.includes(tok));
    return titleOk && artistOk;
  });
  if (!bestSong) throw new Error('No exact NetEase match');
  const lyrData = await fetchJson(
    `https://music.163.com/api/song/lyric?id=${encodeURIComponent(bestSong.id)}&lv=1&tv=-1`,
    3000,
    { headers: { Referer: 'https://music.163.com/' } }
  );
  const lrc = lyrData?.lrc?.lyric || '';
  const parsed = formatLyricsResult(parseLrc(lrc), lrc.replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '').trim(), 'NetEase');
  if (!parsed) throw new Error('Empty NetEase lyric');
  return parsed;
}

async function fetchLyricsFromLyrist(artist, title) {
  const pathUrl = artist
    ? `https://lyrist.vercel.app/api/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`
    : `https://lyrist.vercel.app/api/${encodeURIComponent(title)}`;
  const data = await fetchJson(pathUrl, 3000);
  const parsed = formatLyricsResult([], data?.lyrics || '', 'Lyrist');
  if (!parsed) throw new Error('Empty Lyrist');
  return parsed;
}

async function fetchLyricsFromOvh(artist, title) {
  if (!artist || !title) throw new Error('Need artist & title');
  const data = await fetchJson(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
    3000
  );
  const parsed = formatLyricsResult([], data?.lyrics || '', 'Lyrics.ovh');
  if (!parsed) throw new Error('Empty Lyrics.ovh');
  return parsed;
}

async function fetchLyricsFromYouTubeCaptions(videoId) {
  if (!isValidVideoId(videoId)) return null;
  const info = await raceDirectAudioByVideoId(videoId);
  if (!info) return null;

  const subs = [];
  if (Array.isArray(info.subtitles)) {
    for (const s of info.subtitles) {
      if (s?.url && isSafePublicUrl(s.url)) {
        subs.push({ code: String(s.code || '').toLowerCase(), url: s.url });
      }
    }
  }
  if (Array.isArray(info.captions) && info.baseUrl) {
    for (const c of info.captions) {
      if (c?.url) {
        const fullUrl = c.url.startsWith('http') ? c.url : `${info.baseUrl}${c.url}`;
        if (isSafePublicUrl(fullUrl)) {
          subs.push({ code: String(c.language_code || '').toLowerCase(), url: fullUrl });
        }
      }
    }
  }
  if (!subs.length) return null;

  const picked =
    subs.find((s) => s.code.startsWith('id')) ||
    subs.find((s) => s.code.startsWith('en')) ||
    subs[0];
  try {
    const raw = await fetchText(picked.url, 3000);
    const synced = parseVttOrSrtToSyncedLines(raw);
    return formatLyricsResult(synced, '', 'YouTube Captions');
  } catch {
    return null;
  }
}

// =========================================================================
// 6. HELPER GEMINI AI (KOMPATIBEL AQ. KEY + VERTEX EXPRESS FALLBACK)
// =========================================================================

async function callGeminiPayload(bodyPayload, timeoutMs = 18000, preferredModels = null) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!apiKey) return null;
  const safeTimeout = Math.max(3000, Math.min(26000, Number(timeoutMs) || 18000));
  const payloadJson = JSON.stringify(bodyPayload);
  const modelList = Array.isArray(preferredModels) && preferredModels.length ? preferredModels : GEMINI_MODELS;

  const tryEndpoint = async (url, perTryMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perTryMs);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: payloadJson,
      });
      if (!resp.ok) return null;
      const data = await resp.json().catch(() => null);
      const parts = data?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        const nonThought = parts.filter((p) => typeof p?.text === 'string' && !p.thought);
        const chosen = nonThought.length ? nonThought : parts;
        const text = chosen.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
        if (text) return text;
      }
    } catch {
      // Coba endpoint / model berikutnya
    } finally {
      clearTimeout(timer);
    }
    return null;
  };

  // 1. Coba Generative Language API terlebih dahulu untuk setiap model aktif
  for (const model of modelList) {
    const out = await tryEndpoint(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      safeTimeout
    );
    if (out) return out;
  }

  // 2. Fallback otomatis ke Vertex AI Express Mode jika key AQ. terikat ke Vertex
  for (const model of modelList.slice(0, 2)) {
    const out = await tryEndpoint(
      `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`,
      Math.min(safeTimeout, 10000)
    );
    if (out) return out;
  }

  return null;
}

async function callGeminiText(prompt, timeoutMs = 7000) {
  return callGeminiPayload(
    {
      contents: [{ parts: [{ text: String(prompt || '') }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 700 },
    },
    timeoutMs
  );
}

// =========================================================================
// 7. INISIALISASI EXPRESS APP & MIDDLEWARE KEAMANAN
// =========================================================================

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const ALLOWED_NATIVE_ORIGINS = new Set([
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
  'https://spotyflow.vercel.app',
]);

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_NATIVE_ORIGINS.has(origin)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/i.test(origin)) return true;
  if (/^https:\/\/spotyflow(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin)) return true;
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    exposedHeaders: ['Content-Length', 'Content-Type', 'X-Audio-Duration', 'X-Audio-Bitrate'],
  })
);

const SPOTYFLOW_HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://accounts.google.com https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: blob: data:",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://accounts.google.com",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

app.use((_req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

function getTrustedClientIp(req) {
  const vercelIp = String(req.headers['x-vercel-forwarded-for'] || '').split(',')[0].trim();
  if (vercelIp) return vercelIp;
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  if (realIp) return realIp;
  const fwd = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fwd.length) return process.env.VERCEL ? fwd[fwd.length - 1] : fwd[0];
  return String(req.ip || req.socket?.remoteAddress || '127.0.0.1').trim();
}

// Unified Lightweight Per-IP Rate Limiter Registry (Auto-cleanup every 5 minutes)
const rateLimiterStores = [];
function createIpRateLimiter({ maxReq = 20, windowMs = 60 * 1000, label = 'API', keyFn = null } = {}) {
  const store = new Map();
  rateLimiterStores.push({ store, windowMs });
  return function ipRateLimiter(req, res, next) {
    const baseIp = getTrustedClientIp(req);
    const key = typeof keyFn === 'function' ? String(keyFn(req, baseIp) || baseIp) : baseIp;
    const now = Date.now();
    if (store.size > 3000) {
      for (const [k, v] of store.entries()) {
        if (now - v.windowStart > windowMs) store.delete(k);
      }
    }
    let entry = store.get(key);
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { count: 0, windowStart: now };
    }
    entry.count += 1;
    store.set(key, entry);

    res.setHeader('X-RateLimit-Limit', String(maxReq));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxReq - entry.count)));

    if (entry.count > maxReq) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000))));
      return res.status(429).json({
        ok: false,
        error: `Terlalu banyak permintaan ${label}. Silakan tunggu sebentar.`,
      });
    }
    next();
  };
}

const _rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const { store, windowMs } of rateLimiterStores) {
    for (const [k, v] of store.entries()) {
      if (now - v.windowStart > windowMs) store.delete(k);
    }
  }
}, 5 * 60 * 1000);
if (typeof _rateLimitCleanupTimer.unref === 'function') _rateLimitCleanupTimer.unref();

const globalApiRateLimiter = createIpRateLimiter({ maxReq: 180, windowMs: 60 * 1000, label: 'API SpotyFlow' });
const authRateLimiterMiddleware = createIpRateLimiter({ maxReq: 25, windowMs: 5 * 60 * 1000, label: 'Autentikasi' });
const otpRequestRateLimiter = createIpRateLimiter({
  maxReq: 5,
  windowMs: 10 * 60 * 1000,
  label: 'Permintaan OTP',
  keyFn: (req, ip) => `${ip}:${String(req.body?.email || '').trim().toLowerCase().slice(0, 80)}`,
});
const otpVerifyRateLimiter = createIpRateLimiter({ maxReq: 8, windowMs: 10 * 60 * 1000, label: 'Verifikasi OTP' });
const aiRateLimiterMiddleware = createIpRateLimiter({ maxReq: 15, windowMs: 60 * 1000, label: 'AI' });
const importRateLimiterMiddleware = createIpRateLimiter({ maxReq: 12, windowMs: 60 * 1000, label: 'Impor Playlist' });
const romanizeRateLimiterMiddleware = createIpRateLimiter({ maxReq: 20, windowMs: 60 * 1000, label: 'Romanisasi Lirik' });
const transcribeRateLimiter = createIpRateLimiter({ maxReq: 10, windowMs: 60 * 1000, label: 'Transkripsi Lirik AI' });
const jamRateLimiterMiddleware = createIpRateLimiter({ maxReq: 60, windowMs: 60 * 1000, label: 'Dengar Bareng (Jam)' });

app.use('/api', globalApiRateLimiter);
app.use('/api/ai', aiRateLimiterMiddleware);
app.use('/api/search/by-lyrics', aiRateLimiterMiddleware);
app.use('/api/playlist/import', importRateLimiterMiddleware);
app.use('/api/lyrics/romanize', romanizeRateLimiterMiddleware);
app.use('/api/jam', jamRateLimiterMiddleware);
app.use('/api/v1/jam', jamRateLimiterMiddleware);
app.use('/api/auth/google', authRateLimiterMiddleware);
app.use('/api/auth/guest', authRateLimiterMiddleware);
app.use('/api/auth/refresh', authRateLimiterMiddleware);
app.use('/api/auth/apk-bridge', authRateLimiterMiddleware);

app.use(cookieParser());
const defaultJsonParser = express.json({ limit: '2mb' });
const transcribeJsonParser = express.json({ limit: '5.5mb' });
app.use((req, res, next) => {
  if (req.path === '/api/lyrics/transcribe' || req.path === '/api/lyrics/transcribe-stream') {
    return transcribeJsonParser(req, res, next);
  }
  return defaultJsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(optionalAuth);

// =========================================================================
// 8. HEALTH, APP VERSION & AUTENTIKASI KETAT
// =========================================================================

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    version: VERSION,
    buildId: APP_BUILD_ID,
    serverless: Boolean(process.env.VERCEL),
    googleConfigured: Boolean(getGoogleClientId()),
    emailOtpReady: isEmailOtpReady(),
  });
});

app.get('/api/download-apk', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const apkUrl =
    String(process.env.LATEST_APK_URL || '').trim() ||
    'https://github.com/afiqkhuzeiri11-netizen/spotyflow-apk/releases/latest/download/SpotyFlow.apk';
  return res.redirect(302, apkUrl);
});

app.get(['/api/app-version', '/api/app/version'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    ok: true,
    version: VERSION,
    webVersion: VERSION,
    versionCode: NATIVE_APK_VERSION_CODE,
    buildId: APP_BUILD_ID,
    latestNativeVersionCode: NATIVE_APK_VERSION_CODE,
    minNativeVersionCode: 1,
    apkUrl: 'https://spotyflow.vercel.app/api/download-apk',
    otaEnabled: true,
    releaseNotes: [
      'SpotyFlow v2.0.2 — Zero-Stutter 4G Audio + 3D Depth Effect Poster Studio (ML Kit)',
      'Jalur Play Instan < 0.7 Detik via Direct InnerTube ANDROID_VR + Native videoId Search tanpa muter Vercel + Auto-Retry 2-Lapis ke NewPipeExtractor',
      'Rombak Total GUI: Living Multi-Orb Mesh Liquid Glass (iOS 26 / Auralys) & True Editorial Serif Matte (60–120 FPS)',
      'Poster Maker Studio 4 Tab Layar Penuh: Pilih Lagu Dulu, Upload Foto Galeri Sendiri, 5 Template HD & Simpan Langsung ke Galeri HP (Pictures/SpotyFlow)',
      'Prefetch Cerdas 2 Lagu Berikutnya + Indikator Kecepatan Audio Opsional + Lirik Live Dynamic Island & 3 Widget Android',
    ],
    updatedAt: new Date().toISOString(),
  });
});

app.get('/api/auth/config', (_req, res) => {
  const clientId = getGoogleClientId();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    serverless: Boolean(process.env.VERCEL),
    googleClientId: clientId,
    googleEnabled: Boolean(clientId),
    emailOtpReady: isEmailOtpReady(),
  });
});

// Login Google OAuth 2.0 Ketat (verifikasi tokeninfo + aud + email_verified + exp)
app.post('/api/auth/google', async (req, res) => {
  const credential = String(req.body?.credential || req.body?.idToken || '').trim();
  const expectedClientId = getGoogleClientId();

  if (!expectedClientId) {
    return res.status(503).json({ error: 'GOOGLE_CLIENT_ID belum dikonfigurasi di server Vercel.' });
  }
  if (!credential || credential.length < 20) {
    return res.status(401).json({ error: 'Token kredensial Google tidak valid atau kosong.' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    let infoResp;
    try {
      infoResp = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
        { signal: controller.signal, headers: { Accept: 'application/json' } }
      );
    } finally {
      clearTimeout(timer);
    }

    const info = await infoResp.json().catch(() => ({}));
    if (!infoResp.ok) {
      const desc = String(info?.error_description || info?.error || '').toLowerCase();
      if (desc.includes('expired') || desc.includes('exp')) {
        return res.status(401).json({ error: 'Token Login Google sudah kedaluwarsa. Silakan login ulang.' });
      }
      return res.status(401).json({
        error: `Verifikasi token Google ditolak (${info?.error_description || `HTTP ${infoResp.status}`}). Silakan coba login ulang.`,
      });
    }

    const aud = String(info?.aud || '').trim();
    const email = String(info?.email || '').trim().toLowerCase();
    const emailVerified = String(info?.email_verified || '').toLowerCase() === 'true';
    const expSec = Number(info?.exp || 0);

    if (aud !== expectedClientId) {
      return res.status(401).json({
        error: 'Verifikasi Google gagal: Client ID (aud) tidak cocok dengan konfigurasi server SpotyFlow.',
      });
    }
    if (!emailVerified) {
      return res.status(401).json({ error: 'Akun Google ditolak karena email belum terverifikasi.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(401).json({ error: 'Alamat email pada token Google tidak valid.' });
    }
    if (expSec && Date.now() / 1000 > expSec) {
      return res.status(401).json({ error: 'Token Login Google sudah kedaluwarsa. Silakan login ulang.' });
    }

    const user = {
      id: `google_${info.sub || crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)}`,
      displayName: String(info.name || email.split('@')[0]).trim(),
      email,
      avatarUrl: isSafePublicUrl(info.picture) ? info.picture : null,
      provider: 'google',
      isGuest: false,
    };

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken);

    return res.status(200).json({ ok: true, user, accessToken, refreshToken });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return res.status(504).json({ error: 'Waktu verifikasi ke server Google habis. Silakan coba lagi.' });
    }
    return res.status(401).json({ error: 'Token Google tidak valid atau gagal diverifikasi oleh Google.' });
  }
});

// =========================================================================
// 2B. APK NATIVE GOOGLE AUTH HANDOFF BRIDGE (Chrome System Browser -> Deep Link)
//     Menghindari blokir 403 disallowed_useragent WebView Google secara resmi
// =========================================================================
const APK_AUTH_TTL_MS = 5 * 60 * 1000;
const apkAuthMemStore = new Map();
let apkAuthTableReady = false;

async function ensureApkAuthTable(pool) {
  if (!pool || apkAuthTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS apk_auth_sessions (
      nonce TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  apkAuthTableReady = true;
}

function pruneApkAuthMem() {
  const now = Date.now();
  for (const [k, v] of apkAuthMemStore.entries()) {
    if (!v || v.expiresAt <= now) apkAuthMemStore.delete(k);
  }
}

app.post('/api/auth/apk-bridge/start', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  pruneApkAuthMem();
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + APK_AUTH_TTL_MS;
  apkAuthMemStore.set(nonce, { status: 'pending', payload: null, expiresAt });

  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureApkAuthTable(pool);
      await pool.query('DELETE FROM apk_auth_sessions WHERE expires_at < NOW()').catch(() => {});
      await pool.query(
        `INSERT INTO apk_auth_sessions (nonce, status, payload, expires_at)
         VALUES ($1, 'pending', NULL, to_timestamp($2 / 1000.0))`,
        [nonce, expiresAt]
      );
    } catch {
      // fallback memory store
    }
  }

  return res.status(200).json({
    ok: true,
    nonce,
    loginUrl: `https://spotyflow.vercel.app/?apk_auth=${nonce}`,
    expiresInSec: Math.round(APK_AUTH_TTL_MS / 1000),
  });
});

app.post('/api/auth/apk-bridge/complete', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const nonce = String(req.body?.nonce || '').trim();
  if (!/^[a-f0-9]{32}$/.test(nonce)) {
    return res.status(400).json({ error: 'Kode sesi APK tidak valid.' });
  }

  const credential = String(req.body?.credential || req.body?.idToken || '').trim();
  let verifiedUser = null;

  // Jalur 1: Verifikasi langsung Google ID Token baru dari Chrome
  if (credential && credential.length >= 20) {
    const expectedClientId = getGoogleClientId();
    try {
      const infoResp = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
        { signal: AbortSignal.timeout(6500), headers: { Accept: 'application/json' } }
      );
      const info = await infoResp.json().catch(() => ({}));
      const aud = String(info?.aud || '').trim();
      const email = String(info?.email || '').trim().toLowerCase();
      const emailVerified = String(info?.email_verified || '').toLowerCase() === 'true';
      if (infoResp.ok && aud === expectedClientId && emailVerified && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        verifiedUser = {
          id: `google_${info.sub || crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)}`,
          displayName: String(info.name || email.split('@')[0]).trim(),
          email,
          avatarUrl: isSafePublicUrl(info.picture) ? info.picture : null,
          provider: 'google',
          isGuest: false,
        };
      }
    } catch {
      // fall through to Bearer check
    }
  }

  // Jalur 2: Pengguna sudah login Google / akun terverifikasi di Chrome
  if (!verifiedUser) {
    const reqUser = extractUserFromReq(req);
    if (reqUser && !reqUser.isGuest) {
      verifiedUser = reqUser;
    }
  }

  if (!verifiedUser) {
    return res.status(401).json({ error: 'Silakan login akun Google terlebih dahulu di browser Chrome.' });
  }

  const accessToken = signAccessToken(verifiedUser);
  const refreshToken = signRefreshToken(verifiedUser);
  const payload = { ok: true, user: verifiedUser, accessToken, refreshToken };
  const expiresAt = Date.now() + APK_AUTH_TTL_MS;

  apkAuthMemStore.set(nonce, { status: 'ready', payload, expiresAt });

  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureApkAuthTable(pool);
      await pool.query(
        `INSERT INTO apk_auth_sessions (nonce, status, payload, expires_at)
         VALUES ($1, 'ready', $2::jsonb, to_timestamp($3 / 1000.0))
         ON CONFLICT (nonce) DO UPDATE SET status = 'ready', payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
        [nonce, JSON.stringify(payload), expiresAt]
      );
    } catch {
      // memory store already updated
    }
  }

  return res.status(200).json({
    ok: true,
    user: verifiedUser,
    deepLink: `spotyflow://auth-done?nonce=${nonce}`,
  });
});

app.get('/api/auth/apk-bridge/poll', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  pruneApkAuthMem();
  const nonce = String(req.query?.nonce || '').trim();
  if (!/^[a-f0-9]{32}$/.test(nonce)) {
    return res.status(400).json({ ok: false, status: 'invalid' });
  }

  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureApkAuthTable(pool);
      const r = await pool.query(
        'SELECT status, payload, expires_at FROM apk_auth_sessions WHERE nonce = $1 LIMIT 1',
        [nonce]
      );
      const row = r.rows?.[0];
      if (row) {
        const expMs = new Date(row.expires_at).getTime();
        if (expMs <= Date.now()) {
          await pool.query('DELETE FROM apk_auth_sessions WHERE nonce = $1', [nonce]).catch(() => {});
          apkAuthMemStore.delete(nonce);
          return res.status(200).json({ ok: false, status: 'expired' });
        }
        if (row.status === 'ready' && row.payload) {
          await pool.query('DELETE FROM apk_auth_sessions WHERE nonce = $1', [nonce]).catch(() => {});
          apkAuthMemStore.delete(nonce);
          return res.status(200).json({ ok: true, status: 'ready', ...row.payload });
        }
        return res.status(200).json({ ok: true, status: 'pending' });
      }
    } catch {
      // fall through to memory store
    }
  }

  const mem = apkAuthMemStore.get(nonce);
  if (!mem || mem.expiresAt <= Date.now()) {
    apkAuthMemStore.delete(nonce);
    return res.status(200).json({ ok: false, status: 'expired' });
  }
  if (mem.status === 'ready' && mem.payload) {
    apkAuthMemStore.delete(nonce);
    return res.status(200).json({ ok: true, status: 'ready', ...mem.payload });
  }
  return res.status(200).json({ ok: true, status: 'pending' });
});

// Email OTP Anti-Brute-Force (Single-Use JTI + Max 5 Attempts + Rate Limit + MX DNS)
const OTP_MAX_ATTEMPTS = 5;
const otpChallengesMem = new Map();
let otpChallengesTableReady = false;

async function ensureOtpChallengesTable(pool) {
  if (!pool || otpChallengesTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_challenges (
      jti TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  otpChallengesTableReady = true;
}

async function registerOtpChallenge(jti, expiresAtMs) {
  if (otpChallengesMem.size > 2000) {
    const now = Date.now();
    for (const [k, v] of otpChallengesMem.entries()) {
      if (!v || v.expiresAt <= now) otpChallengesMem.delete(k);
    }
  }
  otpChallengesMem.set(jti, { attempts: 0, used: false, expiresAt: expiresAtMs });
  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureOtpChallengesTable(pool);
      await pool.query('DELETE FROM otp_challenges WHERE expires_at < NOW()').catch(() => {});
      await pool.query(
        'INSERT INTO otp_challenges (jti, attempts, used, expires_at) VALUES ($1, 0, FALSE, to_timestamp($2 / 1000.0)) ON CONFLICT (jti) DO NOTHING',
        [jti, expiresAtMs]
      );
    } catch {}
  }
}

async function checkAndIncrementOtpAttempt(jti, markUsed = false) {
  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureOtpChallengesTable(pool);
      const r = await pool.query('SELECT attempts, used, expires_at FROM otp_challenges WHERE jti = $1 LIMIT 1', [jti]);
      const row = r.rows?.[0];
      if (row) {
        if (row.used || new Date(row.expires_at).getTime() <= Date.now()) return { blocked: true, reason: 'used_or_expired' };
        if (Number(row.attempts || 0) >= OTP_MAX_ATTEMPTS) return { blocked: true, reason: 'max_attempts' };
        if (markUsed) {
          await pool.query('UPDATE otp_challenges SET used = TRUE WHERE jti = $1', [jti]);
        } else {
          await pool.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE jti = $1', [jti]);
        }
        return { blocked: false };
      }
    } catch {}
  }
  const mem = otpChallengesMem.get(jti);
  if (mem) {
    if (mem.used || mem.expiresAt <= Date.now()) return { blocked: true, reason: 'used_or_expired' };
    if (mem.attempts >= OTP_MAX_ATTEMPTS) return { blocked: true, reason: 'max_attempts' };
    if (markUsed) mem.used = true;
    else mem.attempts += 1;
    return { blocked: false };
  }
  otpChallengesMem.set(jti, { attempts: markUsed ? 0 : 1, used: markUsed, expiresAt: Date.now() + 5 * 60 * 1000 });
  return { blocked: false };
}

app.post('/api/auth/email/request-otp', otpRequestRateLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Format alamat email tidak valid.' });
  }

  const domain = email.split('@')[1];
  const validMx = await hasValidMxRecord(domain);
  if (!validMx) {
    return res.status(400).json({ error: `Domain email "${domain}" tidak memiliki server email (MX) aktif.` });
  }

  const resendKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!resendKey) {
    return res.status(503).json({
      error: 'Layanan Email OTP belum aktif (RESEND_API_KEY belum diset di server). Gunakan Login Google atau Mode Tamu.',
    });
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  const jti = crypto.randomBytes(12).toString('hex');
  await registerOtpChallenge(jti, Date.now() + 5 * 60 * 1000);
  const challengeToken = jwt.sign(
    {
      purpose: 'email_otp',
      jti,
      email,
      otpHash: hashOtp(email, otp),
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '5m' }
  );

  try {
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'SpotyFlow <onboarding@resend.dev>';
    const mailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: `Kode Verifikasi SpotyFlow: ${otp}`,
        html: `<div style="font-family:sans-serif;padding:24px;background:#090909;color:#fff;border-radius:12px;">
          <h2 style="color:#1ED760;margin:0 0 12px;">SpotyFlow Verifikasi Login</h2>
          <p>Masukkan kode OTP 6 digit berikut (berlaku 5 menit):</p>
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#1ED760;margin:16px 0;">${otp}</div>
          <p style="font-size:12px;color:#b3b3b3;">Abaikan email ini jika Anda tidak merasa meminta kode login.</p>
        </div>`,
      }),
      signal: AbortSignal.timeout(6500),
    });

    if (!mailRes.ok) {
      return res.status(502).json({ error: 'Gagal mengirim email OTP melalui layanan Resend.' });
    }

    return res.status(200).json({
      ok: true,
      challengeToken,
      maskedEmail: maskEmail(email),
      expiresInSeconds: 300,
      message: `Kode OTP 6 digit telah dikirim ke ${maskEmail(email)}.`,
    });
  } catch {
    return res.status(504).json({ error: 'Timeout saat mengirim email OTP. Silakan coba lagi.' });
  }
});

app.post('/api/auth/email/verify-otp', otpVerifyRateLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const otp = String(req.body?.otp || '').replace(/\D+/g, '');
  const challengeToken = String(req.body?.challengeToken || '').trim();

  if (!email || otp.length !== 6 || !challengeToken) {
    return res.status(400).json({ error: 'Email, kode OTP 6 digit, dan token verifikasi wajib diisi.' });
  }

  try {
    const payload = jwt.verify(challengeToken, JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.purpose !== 'email_otp' || payload.email !== email || !payload.jti) {
      return res.status(401).json({ error: 'Token tantangan OTP tidak cocok dengan email.' });
    }

    const expectedBuf = Buffer.from(String(payload.otpHash || ''), 'hex');
    const actualBuf = Buffer.from(hashOtp(email, otp), 'hex');
    const matches = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);
    const attemptState = await checkAndIncrementOtpAttempt(String(payload.jti), matches);
    if (attemptState.blocked) {
      const msg =
        attemptState.reason === 'max_attempts'
          ? 'Batas percobaan OTP tercapai. Silakan minta kode OTP baru.'
          : 'Kode OTP sudah digunakan atau kedaluwarsa. Minta kode baru.';
      return res.status(attemptState.reason === 'max_attempts' ? 429 : 401).json({ error: msg });
    }
    if (!matches) {
      return res.status(401).json({ error: 'Kode OTP salah. Periksa kembali kotak masuk email Anda.' });
    }

    const user = {
      id: `email_${crypto.createHash('sha256').update(email).digest('hex').slice(0, 16)}`,
      displayName: String(req.body?.displayName || email.split('@')[0]).trim().slice(0, 40),
      email,
      avatarUrl: null,
      provider: 'email_otp',
      isGuest: false,
    };

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken);

    return res.status(200).json({ ok: true, user, accessToken, refreshToken });
  } catch {
    return res.status(401).json({ error: 'Kode OTP sudah kedaluwarsa atau tidak valid. Minta kode baru.' });
  }
});

// Mode Tamu Eksplisit (Stateless)
app.post('/api/auth/guest', (req, res) => {
  const displayName = String(req.body?.displayName || 'Tamu SpotyFlow').trim().slice(0, 40) || 'Tamu SpotyFlow';
  const user = {
    id: `guest_${crypto.randomBytes(6).toString('hex')}`,
    displayName,
    email: null,
    avatarUrl: null,
    provider: 'guest',
    isGuest: true,
  };
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  setAuthCookies(res, accessToken, refreshToken);
  res.status(200).json({ ok: true, user, accessToken, refreshToken });
});

// Blokir permanen seluruh jalur login email/username palsu tanpa verifikasi
app.post(['/api/auth/quick-login', '/api/v1/auth/login', '/api/v1/auth/register'], (_req, res) => {
  res.status(410).json({
    error: 'Login langsung tanpa verifikasi telah dinonaktifkan demi keamanan. Gunakan Login Google, Email OTP, atau Mode Tamu.',
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.status(200).json({ ok: false, authenticated: false, user: null });
  }
  return res.status(200).json({ ok: true, authenticated: true, user: req.user });
});

app.post('/api/auth/refresh', (req, res) => {
  const token = String(req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE] || '').trim();
  if (!token) return res.status(401).json({ error: 'Refresh token tidak ditemukan.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.type !== 'refresh') throw new Error('Invalid token type');
    const user = {
      id: decoded.sub,
      displayName: decoded.name || 'Pengguna SpotyFlow',
      email: decoded.email || null,
      avatarUrl: decoded.avatar || null,
      provider: decoded.provider || 'guest',
      isGuest: Boolean(decoded.isGuest),
    };
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    setAuthCookies(res, accessToken, refreshToken);
    return res.status(200).json({ ok: true, user, accessToken, refreshToken });
  } catch {
    return res.status(401).json({ error: 'Sesi telah kedaluwarsa. Silakan login kembali.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookies(res);
  res.status(200).json({ ok: true });
});

app.patch('/api/auth/profile', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
  const updated = {
    ...req.user,
    displayName: String(req.body?.displayName || req.user.displayName).trim().slice(0, 40) || req.user.displayName,
    avatarUrl: isSafePublicUrl(req.body?.avatarUrl) ? req.body.avatarUrl : req.user.avatarUrl,
  };
  const accessToken = signAccessToken(updated);
  setAuthCookies(res, accessToken, null);
  res.status(200).json({ ok: true, user: updated, accessToken });
});

// =========================================================================
// 9. MESIN AUDIO SUPER CEPAT (FAST RACE + DIRECT VIDEOID + REDIRECT 302)
// =========================================================================

async function streamIosInnertubeBoundedRange(req, res, videoId, quality = 'high') {
  let streamInfo = await fetchDirectStreamFromIosInnertube(videoId, 3200, false, quality);
  let totalLen = Number(streamInfo?.contentLength) || 0;

  let start = 0;
  let requestedEnd = totalLen > 0 ? totalLen - 1 : MAX_VERCEL_RANGE_CHUNK - 1;
  const rangeHeader = String(req.headers.range || '');

  if (rangeHeader && /^bytes=/i.test(rangeHeader)) {
    const parts = rangeHeader.replace(/^bytes=/i, '').split('-');
    const pStart = parseInt(parts[0], 10);
    const pEnd = parts[1] ? parseInt(parts[1], 10) : NaN;
    if (!Number.isNaN(pStart) && pStart >= 0 && (totalLen === 0 || pStart < totalLen)) {
      start = pStart;
    }
    if (!Number.isNaN(pEnd) && pEnd >= start) {
      requestedEnd = totalLen > 0 ? Math.min(pEnd, totalLen - 1) : pEnd;
    }
  }

  // Batasi ukuran maksimum per respons Range agar selalu <= 1.8 MB (aman dari limit 4.5MB Vercel & super cepat <400ms)
  let targetEnd = Math.min(requestedEnd, start + MAX_VERCEL_RANGE_CHUNK - 1);
  if (totalLen > 0 && targetEnd >= totalLen) {
    targetEnd = totalLen - 1;
  }

  let upstreamRes = await fetch(streamInfo.url, {
    headers: {
      'User-Agent': streamInfo.ua || UA_IOS,
      Range: `bytes=${start}-${targetEnd}`,
    },
    signal: AbortSignal.timeout(6500),
  });

  if (upstreamRes.status === 403 || upstreamRes.status === 410) {
    streamInfo = await fetchDirectStreamFromIosInnertube(videoId, 3200, true);
    if (Number(streamInfo?.contentLength) > 0) {
      totalLen = Number(streamInfo.contentLength);
      targetEnd = Math.min(requestedEnd, start + MAX_VERCEL_RANGE_CHUNK - 1, totalLen - 1);
    }
    upstreamRes = await fetch(streamInfo.url, {
      headers: {
        'User-Agent': streamInfo.ua || UA_IOS,
        Range: `bytes=${start}-${targetEnd}`,
      },
      signal: AbortSignal.timeout(6500),
    });
  }

  if (!upstreamRes.ok && upstreamRes.status !== 206) {
    iosStreamMetaCache.delete(videoId);
    throw new Error(`Upstream audio HTTP ${upstreamRes.status}`);
  }

  const crHeader = String(upstreamRes.headers.get('content-range') || '');
  const crMatch = crHeader.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
  const actualStart = crMatch ? Number(crMatch[1]) : start;
  const actualEnd = crMatch ? Number(crMatch[2]) : targetEnd;
  const actualTotal = crMatch ? Number(crMatch[3]) : totalLen;

  const buf = Buffer.from(await upstreamRes.arrayBuffer());
  const finalEnd = actualStart + Math.max(0, buf.length - 1);
  const finalTotal = actualTotal > finalEnd ? actualTotal : finalEnd + 1;

  res.status(206);
  res.setHeader('Content-Type', streamInfo.mimeType || 'audio/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Range', `bytes ${actualStart}-${finalEnd}/${finalTotal}`);
  res.setHeader('Content-Length', String(buf.length));
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, X-Audio-Duration');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Audio-Duration', String(streamInfo.duration || 0));
  return res.end(buf);
}

async function assembleSoundCloudFmp4Buffer(scId) {
  const cached = scAudioBufferCache.get(scId);
  if (cached && Date.now() < cached.exp) return cached;

  const clientId = await getSoundCloudClientId();
  const trk = await fetchJson(
    `https://api-v2.soundcloud.com/tracks/${encodeURIComponent(scId)}?client_id=${encodeURIComponent(clientId)}`,
    3200
  );
  const transcodings = Array.isArray(trk?.media?.transcodings) ? trk.media.transcodings : [];

  // 1. Cek jika ada progressive direct stream (MP3/M4A langsung)
  const prog = transcodings.find((t) => t?.format?.protocol === 'progressive' && t?.url);
  if (prog) {
    const u = new URL(prog.url);
    u.searchParams.set('client_id', clientId);
    const sj = await fetchJson(u.toString(), 2500);
    if (sj?.url && isSafePublicUrl(sj.url)) {
      return { redirectUrl: sj.url, duration: Math.round(Number(trk.duration || 0) / 1000) };
    }
  }

  // 2. Pilih HLS fMP4 (utamakan aac_96k agar seluruh lagu 4-5 menit berukuran ~2.3-2.9 MB, di bawah limit 4.5MB Vercel)
  const fmp4Trans =
    transcodings.find((t) => t?.format?.protocol === 'hls' && /mp4/i.test(t?.format?.mime_type || '') && /96k/i.test(t?.preset || t?.url || '')) ||
    transcodings.find((t) => t?.format?.protocol === 'hls' && /mp4/i.test(t?.format?.mime_type || '')) ||
    transcodings[0];
  if (!fmp4Trans?.url) throw new Error('No SoundCloud fMP4 transcoding');

  const u = new URL(fmp4Trans.url);
  u.searchParams.set('client_id', clientId);
  const sj = await fetchJson(u.toString(), 2800);
  if (!sj?.url) throw new Error('No SoundCloud m3u8 URL');

  const m3u8 = await fetchText(sj.url, 3000);
  const mapMatch = m3u8.match(/#EXT-X-MAP:URI="([^"]+)"/);
  const segUrls = m3u8
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l));
  const allUrls = [mapMatch ? mapMatch[1] : null, ...segUrls].filter(Boolean);
  if (!allUrls.length) throw new Error('Empty SoundCloud fMP4 playlist');

  const bufs = await Promise.all(
    allUrls.map(async (segUrl) => {
      const r = await fetch(segUrl, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(5500),
      });
      if (!r.ok) throw new Error(`SC segment HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    })
  );

  // Jaga ukuran rakitan <= 3.85 MB pada batas segmen utuh agar bebas 100% dari limit 4.5MB Vercel
  const MAX_SAFE_BODY = 3850000;
  const kept = [];
  let accBytes = 0;
  for (const b of bufs) {
    if (accBytes + b.length > MAX_SAFE_BODY && kept.length > 4) break;
    kept.push(b);
    accBytes += b.length;
  }
  const fullBuf = Buffer.concat(kept);
  const entry = {
    buf: fullBuf,
    mimeType: 'audio/mp4',
    duration: Math.round(Number(trk.duration || 0) / 1000) || 210,
    exp: Date.now() + 30 * 60 * 1000,
  };
  if (scAudioBufferCache.size >= 18) {
    const oldest = scAudioBufferCache.keys().next().value;
    if (oldest) scAudioBufferCache.delete(oldest);
  }
  scAudioBufferCache.set(scId, entry);
  return entry;
}

async function streamSoundCloudTrack(req, res, scId) {
  const assembled = await assembleSoundCloudFmp4Buffer(String(scId));
  if (assembled?.redirectUrl) {
    return res.redirect(302, assembled.redirectUrl);
  }
  const buf = assembled.buf;
  const totalLen = buf.length;
  const rangeHeader = String(req.headers.range || '');

  res.setHeader('Content-Type', assembled.mimeType || 'audio/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, X-Audio-Duration');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600');
  res.setHeader('X-Audio-Duration', String(assembled.duration || 0));

  if (rangeHeader && /^bytes=/i.test(rangeHeader)) {
    const parts = rangeHeader.replace(/^bytes=/i, '').split('-');
    const pStart = parseInt(parts[0], 10);
    const pEnd = parts[1] ? parseInt(parts[1], 10) : totalLen - 1;
    const start = !Number.isNaN(pStart) && pStart >= 0 && pStart < totalLen ? pStart : 0;
    const end = !Number.isNaN(pEnd) && pEnd >= start && pEnd < totalLen ? pEnd : totalLen - 1;
    const slice = buf.subarray(start, end + 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLen}`);
    res.setHeader('Content-Length', String(slice.length));
    return res.end(slice);
  }

  res.status(200);
  res.setHeader('Content-Length', String(totalLen));
  return res.end(buf);
}

async function raceDirectAudioWithPython(req, videoId, timeoutMs = 2600, quality = 'high') {
  if (!isValidVideoId(videoId)) return null;
  const tasks = [
    fetchDirectStreamFromYtmPython(req, videoId, Math.min(3500, timeoutMs + 600), quality),
    raceDirectAudioByVideoId(videoId, timeoutMs, quality).then((res) => {
      if (!res?.url) throw new Error('No direct Node audio stream');
      return res;
    }),
  ];
  try {
    return await Promise.any(tasks);
  } catch {
    return null;
  }
}

app.get('/api/audio/resolve', async (req, res) => {
  const videoIdParam = decodeVideoIdParam(req.query.videoId || req.query.ytId || req.query.sid || '');
  const artist = String(req.query.artist || '').trim();
  const title = String(req.query.title || '').trim();
  const durationSec = Math.max(0, Number(req.query.duration) || 0);
  const qualityMode = String(req.query.quality || '').trim().toLowerCase() === 'low' ? 'low' : 'high';
  const qualityQs = qualityMode === 'low' ? '&quality=low' : '';

  if (!videoIdParam && !title && !artist) {
    return res.status(400).json({ error: 'Parameter videoId atau artist/title wajib diisi.' });
  }

  try {
    // JALUR 1: Direct videoId YouTube -> Fast Race stream (Python yt-dlp + iOS Innertube + Piped/Invidious) + kandidat cadangan paralel
    if (isValidVideoId(videoIdParam)) {
      const searchQ = `${artist} ${title}`.trim();
      const [directStream, extraYtCands, audiusTracks, fallbackPreviews] = await Promise.all([
        raceDirectAudioWithPython(req, videoIdParam, 2600, qualityMode),
        searchQ.length >= 3 ? raceYouTubeCandidates(searchQ).catch(() => []) : Promise.resolve([]),
        searchQ.length >= 3 ? searchAudiusTracks(searchQ, 6).catch(() => []) : Promise.resolve([]),
        title || artist ? fetchEmergencyOfficialPreviews(artist, title) : Promise.resolve([]),
      ]);

      const sources = [];
      if (directStream?.url) {
        const isIos = directStream.provider === 'IosInnertube';
        sources.push({
          sid: `direct_${videoIdParam}`,
          label: qualityMode === 'low'
            ? 'YouTube Hemat Kuota (64-96k)'
            : (isIos ? 'YouTube Master Penuh (Hi-Fi AAC)' : `YouTube Master (${directStream.provider})`),
          edition: directStream.title || title || videoIdParam,
          duration: directStream.duration || durationSec || 210,
          quality: qualityMode === 'low' ? `${directStream.quality || 'AAC 64k'} (Hemat)` : (directStream.quality || 'AAC 128k'),
          streamUrl: isIos ? `/api/audio/stream?videoId=${encodeURIComponent(videoIdParam)}${qualityQs}` : directStream.url,
          supportsCors: isIos,
          isYoutubeDirect: true,
          isPreview: false,
          isPreviewFallback: false,
        });
      }

      const ytCandidates = [
        {
          videoId: videoIdParam,
          title: directStream?.title || title || '',
          author: directStream?.author || artist || '',
          duration: directStream?.duration || durationSec || 0,
        },
      ];
      for (const c of extraYtCands) {
        if (c && isValidVideoId(c.videoId) && c.videoId !== videoIdParam) {
          const sc = (artist || title) ? scoreAudioCandidate(c, artist, title, durationSec) : 50;
          if (sc > 0) {
            ytCandidates.push({
              videoId: c.videoId,
              title: c.title,
              author: c.author,
              duration: c.duration,
              score: sc,
            });
          }
        }
        if (ytCandidates.length >= 6) break;
      }

      if (directStream?.url && directStream.provider === 'IosInnertube' && ytCandidates.length > 1) {
        const altVid = ytCandidates[1].videoId;
        sources.push({
          sid: `yt_${altVid}`,
          label: 'YouTube Alternatif #2',
          edition: ytCandidates[1].title || title || altVid,
          duration: ytCandidates[1].duration || durationSec || 210,
          quality: 'AAC 128k',
          streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(altVid)}`,
          supportsCors: true,
          isYoutubeDirect: true,
          isPreview: false,
          isPreviewFallback: false,
        });
      }

      if (artist || title) {
        const scoredAu = audiusTracks
          .map((c) => ({ ...c, score: scoreAudioCandidate(c, artist, title, durationSec) }))
          .filter((c) => c.score > 20 && Number(c.duration || 0) >= 60)
          .sort((a, b) => b.score - a.score);
        for (const a of scoredAu.slice(0, 1)) {
          sources.push({
            sid: a.id,
            label: 'Cadangan Audius Hi-Fi',
            edition: `${a.title} - ${a.author}`,
            duration: a.duration || durationSec || 210,
            quality: 'MP3 320k',
            streamUrl: a.streamUrl,
            supportsCors: true,
            isPreview: false,
            isPreviewFallback: false,
          });
        }
      }

      sources.push(...fallbackPreviews);

      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
      return res.json({
        ok: true,
        sources,
        ytCandidates,
      });
    }

    // JALUR 2: Pencarian teks artist + title (Python ytmusicapi Songs + YouTube Innertube + Cadangan Audius/Saavn)
    const searchQuery = `${artist} ${title} official audio`.trim();
    const audiusQuery = `${artist} ${title}`.trim();

    const [ytmSearchRes, ytRawRes, audiusRes, saavnRes, previewRes] = await Promise.allSettled([
      callYtmPython(req, { action: 'search', q: audiusQuery, limit: '8' }, 3000),
      raceYouTubeCandidates(searchQuery),
      searchAudiusTracks(audiusQuery, 10),
      searchSaavnTracks(audiusQuery, 5),
      fetchEmergencyOfficialPreviews(artist, title),
    ]);

    const ytmTracksRaw =
      ytmSearchRes.status === 'fulfilled' && Array.isArray(ytmSearchRes.value?.tracks)
        ? ytmSearchRes.value.tracks.map((t) => ({
            videoId: t.videoId,
            title: t.title,
            author: `${t.artist || ''} - Topic`.trim(),
            duration: Number(t.duration || 0),
            thumbnail: t.cover || `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg`,
            isYtmOfficial: true,
          }))
        : [];
    const ytNodeRaw = ytRawRes.status === 'fulfilled' ? ytRawRes.value : [];
    const seenYtIds = new Set();
    const ytRaw = [];
    for (const cand of [...ytmTracksRaw, ...ytNodeRaw]) {
      if (cand && isValidVideoId(cand.videoId) && !seenYtIds.has(cand.videoId)) {
        seenYtIds.add(cand.videoId);
        ytRaw.push(cand);
      }
    }

    const audiusRaw = audiusRes.status === 'fulfilled' ? audiusRes.value : [];
    const saavnRaw = saavnRes.status === 'fulfilled' ? saavnRes.value : [];
    const previewFallbacks = previewRes.status === 'fulfilled' ? previewRes.value : [];

    // Strict Match Scorer pada kandidat YouTube (bonus ekstra untuk lagu resmi ytmusicapi)
    let scoredYt = ytRaw
      .map((cand) => ({
        ...cand,
        score: scoreAudioCandidate(cand, artist, title, durationSec) + (cand.isYtmOfficial ? 18 : 0),
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    // Jika filter ketat terlalu sempit untuk track non-standar, pakai skor longgar tapi tetap blokir karaoke/reaction
    if (!scoredYt.length && ytRaw.length) {
      scoredYt = ytRaw
        .filter((c) => !/\b(karaoke|reaction|tutorial|8d)\b/i.test(c.title || '') && Number(c.duration || 0) >= 45)
        .slice(0, 6)
        .map((c, idx) => ({ ...c, score: 45 - idx * 5 }));
    }

    // Strict Match Scorer pada kandidat cadangan Audius & Saavn
    const scoredAudius = audiusRaw
      .map((cand) => ({
        ...cand,
        score: scoreAudioCandidate(cand, artist, title, durationSec),
      }))
      .filter((c) => c.score > 20 && Number(c.duration || 0) >= 60)
      .sort((a, b) => b.score - a.score);

    const scoredSaavn = saavnRaw
      .map((cand) => ({
        ...cand,
        score: scoreAudioCandidate(cand, artist, title, durationSec),
      }))
      .filter((c) => c.score >= 68 && Number(c.duration || 0) >= 60)
      .sort((a, b) => b.score - a.score);

    const sources = [];

    // 1. Fast Race direct audio-only stream YouTube (Python yt-dlp + iOS Innertube + Piped/Invidious)
    if (scoredYt.length) {
      const primaryVid = scoredYt[0].videoId;
      const topStream = await raceDirectAudioWithPython(req, primaryVid, 2400, qualityMode);
      if (topStream?.url) {
        const isIos = topStream.provider === 'IosInnertube';
        sources.push({
          sid: `yt_${primaryVid}`,
          label: qualityMode === 'low'
            ? 'YouTube Hemat Kuota (64-96k)'
            : (isIos ? 'YouTube Master Penuh (Hi-Fi AAC)' : `YouTube Master (${topStream.provider})`),
          edition: scoredYt[0].title || topStream.title,
          duration: topStream.duration || scoredYt[0].duration || durationSec || 210,
          quality: qualityMode === 'low' ? `${topStream.quality || 'AAC 64k'} (Hemat)` : (topStream.quality || 'AAC 128k'),
          streamUrl: isIos ? `/api/audio/stream?videoId=${encodeURIComponent(primaryVid)}${qualityQs}` : topStream.url,
          supportsCors: isIos,
          isYoutubeDirect: true,
          isPreview: false,
          isPreviewFallback: false,
        });
        if (isIos && scoredYt.length > 1) {
          const altCand = scoredYt[1];
          sources.push({
            sid: `yt_${altCand.videoId}`,
            label: 'YouTube Alternatif #2',
            edition: altCand.title,
            duration: altCand.duration || durationSec || 210,
            quality: qualityMode === 'low' ? 'AAC 64k (Hemat)' : 'AAC 128k',
            streamUrl: `/api/audio/stream?videoId=${encodeURIComponent(altCand.videoId)}${qualityQs}`,
            supportsCors: true,
            isYoutubeDirect: true,
            isPreview: false,
            isPreviewFallback: false,
          });
        }
      }
    }

    // 2. Cadangan penuh Saavn 320k & Audius Hi-Fi (dipakai jika semua kandidat YouTube gagal)
    for (const s of scoredSaavn.slice(0, 1)) {
      sources.push({
        sid: s.id,
        label: 'Cadangan Studio 320k',
        edition: `${s.title} - ${s.author}`,
        duration: s.duration || durationSec || 210,
        quality: s.quality || 'AAC 320k',
        streamUrl: s.streamUrl,
        supportsCors: true,
        isPreview: false,
        isPreviewFallback: false,
      });
    }

    for (const a of scoredAudius.slice(0, 1)) {
      sources.push({
        sid: a.id,
        label: 'Cadangan Audius Hi-Fi',
        edition: `${a.title} - ${a.author}`,
        duration: a.duration || durationSec || 210,
        quality: 'MP3 320k',
        streamUrl: a.streamUrl,
        supportsCors: true,
        isPreview: false,
        isPreviewFallback: false,
      });
    }

    // 3. Fallback darurat terakhir: Preview resmi iTunes/Deezer
    sources.push(...previewFallbacks);

    const ytCandidates = scoredYt.slice(0, 6).map((c) => ({
      videoId: c.videoId,
      title: c.title,
      author: c.author,
      duration: c.duration,
      score: c.score,
    }));

    if (!sources.length && !ytCandidates.length) {
      return res.status(404).json({ error: 'Sumber audio yang cocok tidak ditemukan.' });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.json({ ok: true, sources, ytCandidates });
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'Gagal menyelesaikan sumber audio.' });
  }
});

// Allowlist domain CDN audio resmi (Anti-Open-Redirect pada /api/audio/stream & /api/audio/proxy)
const ALLOWED_AUDIO_STREAM_DOMAINS = [
  'googlevideo.com',
  'youtube.com',
  'ytimg.com',
  'dzcdn.net',
  'mzstatic.com',
  'apple.com',
  'audius.co',
  'sndcdn.com',
  'soundcloud.com',
  'saavncdn.com',
  'jiosaavn.com',
  'r4fo.com',
  'darkness.services',
  'drgns.space',
  'nadeko.net',
  'nerdvpn.de',
  'yewtu.be',
  'jing.rocks',
  'tux.pizza',
  'spotyflow.vercel.app',
];

function isAllowedAudioStreamDomain(rawUrl) {
  if (!isSafePublicUrl(rawUrl, true)) return false;
  try {
    const u = new URL(String(rawUrl));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_AUDIO_STREAM_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

// STREAMING FULL-DURATION: Redirect 302 tervalidasi (Anti-Open-Redirect), SoundCloud fMP4 (scId), atau Bounded HTTP 206 Range (videoId)
app.get('/api/audio/stream', async (req, res) => {
  const directUrl = String(req.query.url || '').trim();
  if (directUrl) {
    if (!isAllowedAudioStreamDomain(directUrl)) {
      return res.status(403).json({ error: 'Domain URL audio tidak termasuk dalam daftar putih resmi.' });
    }
    return res.redirect(302, directUrl);
  }

  const scId = String(req.query.scId || '').replace(/^sc_/, '').trim();
  if (/^\d{5,15}$/.test(scId)) {
    try {
      return await streamSoundCloudTrack(req, res, scId);
    } catch (err) {
      return res.status(502).json({ error: err?.message || 'Gagal memuat stream Cloud Hi-Fi.' });
    }
  }

  const videoId = decodeVideoIdParam(req.query.videoId || req.query.sid || '');
  const qualityMode = String(req.query.quality || '').trim().toLowerCase() === 'low' ? 'low' : 'high';
  if (isValidVideoId(videoId)) {
    try {
      return await streamIosInnertubeBoundedRange(req, res, videoId, qualityMode);
    } catch {
      const stream = await raceDirectAudioByVideoId(videoId, 2600, qualityMode);
      if (stream?.url && isSafePublicUrl(stream.url, true)) {
        return res.redirect(302, stream.url);
      }
    }
  }

  return res.status(404).json({ error: 'URL stream audio tidak ditemukan.' });
});

app.get('/api/audio/proxy', (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!isAllowedAudioStreamDomain(targetUrl)) {
    return res.status(403).json({ error: 'Domain audio tidak diizinkan (Anti-Open-Redirect).' });
  }
  return res.redirect(302, targetUrl);
});

app.get('/api/audio/prefetch', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, stateless: true });
});

app.get('/api/audio/hls/status', (_req, res) => {
  res.json({ ok: true, enabled: false, mode: 'direct-serverless' });
});

app.get('/api/audio/video-id', async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  const title = String(req.query.title || '').trim();
  if (!artist && !title) return res.status(400).json({ error: 'Artist atau title wajib diisi.' });
  const cands = await raceYouTubeCandidates(`${artist} ${title} official music video`.trim());
  const best = cands[0];
  if (!best) return res.status(404).json({ error: 'Video musik tidak ditemukan.' });
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  return res.json({ ok: true, videoId: best.videoId, title: best.title, author: best.author });
});

// =========================================================================
// 10. SUPER SEARCH MULTI-SUMBER, SMART ARTWORK ENRICHMENT & PROFIL LENGKAP
// =========================================================================

async function runMultiSourceSearch(q, source = 'all', limit = 20, offset = 0, req = null) {
  const src = String(source || 'all').toLowerCase();
  const wantDz = src === 'all' || src === 'deezer';
  const wantIt = src === 'all' || src === 'itunes';
  const wantYt = src === 'all' || src === 'youtube';
  const wantAu = src === 'all' || src === 'audius';

  const [
    dzTracksRes,
    dzAlbumsRes,
    dzArtistsRes,
    dzPlaylistsRes,
    itSongsRes,
    itAlbumsRes,
    itPodcastsRes,
    ytmPyRes,
    ytRes,
    auRes,
  ] = await Promise.allSettled([
    wantDz
      ? fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&index=${offset}&limit=${limit}`, 4000)
      : Promise.resolve(null),
    wantDz
      ? fetchJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&index=${offset}&limit=12`, 4000)
      : Promise.resolve(null),
    wantDz
      ? fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&index=${offset}&limit=10`, 4000)
      : Promise.resolve(null),
    wantDz
      ? fetchJson(`https://api.deezer.com/search/playlist?q=${encodeURIComponent(q)}&index=${offset}&limit=10`, 4000)
      : Promise.resolve(null),
    wantIt
      ? fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`, 4000)
      : Promise.resolve(null),
    wantIt
      ? fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=album&limit=12`, 4000)
      : Promise.resolve(null),
    wantIt
      ? fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=podcast&entity=podcast&limit=10`, 4000)
      : Promise.resolve(null),
    wantYt && offset === 0 ? callYtmPython(req, { action: 'search', q, limit: String(Math.min(limit, 20)) }, 3400) : Promise.resolve(null),
    wantYt ? raceYouTubeCandidates(q) : Promise.resolve([]),
    wantAu ? searchAudiusTracks(q, 12) : Promise.resolve([]),
  ]);

  const tracks = [];
  const albums = [];
  const artists = [];
  const playlists = [];
  const podcasts = [];

  // Map untuk Smart Artwork & Artist Profile Enrichment (YouTube mewarisi sampul HD, album & ID profil artis dari Deezer/iTunes)
  const officialArtworkMap = new Map();
  const officialArtistMap = new Map();
  const registerOfficialMeta = (artistObj, trackTitle, albumObj) => {
    const artistName = String(artistObj?.name || '').trim();
    const normArt = normalizeStr(artistName);
    if (normArt && artistObj?.id && !officialArtistMap.has(normArt)) {
      officialArtistMap.set(normArt, artistObj);
    }
    const keyFull = `${normArt}|${normalizeStr(trackTitle)}`;
    const keyTitle = normalizeStr(trackTitle.replace(/\s*[\(\[][^)\]]*[\)\]]/g, ''));
    if (albumObj?.cover_xl && !officialArtworkMap.has(keyFull)) {
      officialArtworkMap.set(keyFull, { album: albumObj, artist: artistObj });
    }
    if (albumObj?.cover_xl && keyTitle.length >= 4 && !officialArtworkMap.has(`t:${keyTitle}`)) {
      officialArtworkMap.set(`t:${keyTitle}`, { artistName: normArt, album: albumObj, artist: artistObj });
    }
  };

  // Kumpulkan metadata resmi Deezer & iTunes lebih dulu untuk memperkaya hasil YouTube
  const dzTracksList = [];
  const dzTrackRows = dzTracksRes.status === 'fulfilled' && Array.isArray(dzTracksRes.value?.data) ? dzTracksRes.value.data : [];
  for (const t of dzTrackRows) {
    const covers = resolveDeezerTrackCover(t);
    const albumObj = {
      id: t.album?.id || '',
      title: t.album?.title || 'Single',
      cover_xl: covers.cover_xl,
      cover_medium: covers.cover_medium,
    };
    const artistObj = {
      id: t.artist?.id || '',
      name: t.artist?.name || 'Artis',
      picture_medium: t.artist?.picture_medium || covers.cover_medium,
    };
    registerOfficialMeta(artistObj, t.title || '', albumObj);
    dzTracksList.push({
      id: String(t.id),
      title: t.title || '',
      duration: Number(t.duration || 0),
      preview: t.preview || '',
      explicit_lyrics: Boolean(t.explicit_lyrics),
      artist: artistObj,
      album: albumObj,
      source: 'deezer',
      isYtThumb: false,
    });
  }

  const itTracksList = [];
  const itSongRows = itSongsRes.status === 'fulfilled' && Array.isArray(itSongsRes.value?.results) ? itSongsRes.value.results : [];
  for (const r of itSongRows) {
    const art600 = upgradeItunesArt(r.artworkUrl100 || r.artworkUrl60, 600) || '/icon-192.png';
    const art300 = upgradeItunesArt(r.artworkUrl100 || r.artworkUrl60, 300) || art600;
    const albumObj = {
      id: String(r.collectionId || ''),
      collectionId: r.collectionId || null,
      isItunes: true,
      title: r.collectionName || 'Single',
      cover_xl: art600,
      cover_medium: art300,
    };
    const artistObj = {
      id: `itunes_artist_${r.artistId || ''}`,
      name: r.artistName || 'Artis',
      picture_medium: art300,
    };
    registerOfficialMeta(artistObj, r.trackName || '', albumObj);
    itTracksList.push({
      id: `itunes_${r.trackId}`,
      title: r.trackName || '',
      duration: Math.round(Number(r.trackTimeMillis || 0) / 1000),
      preview: r.previewUrl || '',
      isItunes: true,
      collectionId: r.collectionId || null,
      artist: artistObj,
      album: albumObj,
      source: 'itunes',
      isYtThumb: false,
    });
  }

  // 1A. PRIORITAS UTAMA LAGU RESMI: Python YouTube Music API (ytmusicapi filter="songs", HD square cover)
  const ytmPyRows =
    ytmPyRes.status === 'fulfilled' && Array.isArray(ytmPyRes.value?.tracks) ? ytmPyRes.value.tracks : [];
  for (const ym of ytmPyRows) {
    if (!ym || !isValidVideoId(ym.videoId)) continue;
    const artistName = String(ym.artist || 'YouTube Music').trim();
    const trackTitle = String(ym.title || '').trim();
    if (!trackTitle) continue;
    const keyFull = `${normalizeStr(artistName)}|${normalizeStr(trackTitle)}`;
    const matchedMeta = officialArtworkMap.get(keyFull) || null;
    const matchedArtist = matchedMeta?.artist || officialArtistMap.get(normalizeStr(artistName)) || null;
    const ytmCover = ym.cover || `https://i.ytimg.com/vi/${ym.videoId}/hqdefault.jpg`;
    const albumObj = matchedMeta?.album || {
      id: `ytm_${ym.videoId}`,
      title: String(ym.album || 'YouTube Music').trim() || 'YouTube Music',
      cover_xl: ytmCover,
      cover_medium: ytmCover,
    };

    tracks.push({
      id: ym.id || `ytm_${ym.videoId}`,
      ytId: ym.videoId,
      videoId: ym.videoId,
      title: trackTitle,
      duration: Number(ym.duration || 0),
      preview: '',
      artist: matchedArtist || {
        id: `yt_creator_${encodeURIComponent(artistName)}`,
        name: artistName,
        picture_medium: albumObj.cover_medium || ytmCover,
      },
      album: albumObj,
      source: 'youtube',
      isYtThumb: false,
    });
  }

  // 1B. CADANGAN YOUTUBE: YouTube Innertube / HTML / Piped + Smart Artwork & Artist Profile Enrichment
  const ytRows = ytRes.status === 'fulfilled' && Array.isArray(ytRes.value) ? ytRes.value : [];
  for (const y of ytRows) {
    if (Number(y.duration || 0) > 1200) continue; // Lewati kompilasi > 20 menit agar hasil rapi
    const cleaned = cleanLyricsMeta(y.author, y.title);
    let parsedArtist = cleaned.artist;
    let parsedTitle = cleaned.title;

    // Deteksi format YouTube terbalik "Judul Lagu - Nama Artis" (mis. "Satu Bulan - Bernadya | Lirik Lagu")
    const normA = normalizeStr(parsedArtist);
    const normAltA = normalizeStr(cleaned.altArtist);
    if (normAltA && officialArtistMap.has(normAltA) && !officialArtistMap.has(normA)) {
      parsedArtist = cleaned.altArtist;
      parsedTitle = cleaned.altTitle;
    }

    const keyFull = `${normalizeStr(parsedArtist)}|${normalizeStr(parsedTitle)}`;
    const keyAlt = cleaned.altArtist && cleaned.altTitle ? `${normalizeStr(cleaned.altArtist)}|${normalizeStr(cleaned.altTitle)}` : '';
    const titleOnlyKey = `t:${normalizeStr(parsedTitle)}`;
    const altTitleOnlyKey = cleaned.altTitle ? `t:${normalizeStr(cleaned.altTitle)}` : '';
    let matchedMeta = officialArtworkMap.get(keyFull) || null;
    if (!matchedMeta && keyAlt && officialArtworkMap.has(keyAlt)) {
      matchedMeta = officialArtworkMap.get(keyAlt);
      parsedArtist = cleaned.altArtist;
      parsedTitle = cleaned.altTitle;
    }
    if (!matchedMeta && officialArtworkMap.has(titleOnlyKey)) {
      const candidate = officialArtworkMap.get(titleOnlyKey);
      if (normalizeStr(`${y.title} ${y.author}`).includes(candidate.artistName)) {
        matchedMeta = candidate;
      }
    }
    if (!matchedMeta && altTitleOnlyKey && officialArtworkMap.has(altTitleOnlyKey)) {
      const candidate = officialArtworkMap.get(altTitleOnlyKey);
      if (normalizeStr(`${y.title} ${y.author}`).includes(candidate.artistName)) {
        matchedMeta = candidate;
        parsedArtist = cleaned.altArtist;
        parsedTitle = cleaned.altTitle;
      }
    }
    const enrichedAlbum = matchedMeta?.album || null;
    const matchedArtist = matchedMeta?.artist || officialArtistMap.get(normalizeStr(parsedArtist)) || null;
    const displayArtistName = matchedArtist?.name || parsedArtist || y.author || 'YouTube Music';
    const displayTitle = parsedTitle && parsedTitle.length >= 2 ? parsedTitle : y.title;

    tracks.push({
      id: `yt_${y.videoId}`,
      ytId: y.videoId,
      videoId: y.videoId,
      title: displayTitle,
      rawYoutubeTitle: y.title,
      duration: y.duration || 0,
      preview: '',
      artist: matchedArtist || {
        id: `yt_creator_${encodeURIComponent(displayArtistName)}`,
        name: displayArtistName,
        picture_medium: enrichedAlbum?.cover_medium || y.thumbnail,
      },
      album: enrichedAlbum || {
        id: `yt_${y.videoId}`,
        title: 'YouTube Music',
        cover_xl: y.thumbnail,
        cover_medium: y.thumbnail,
      },
      source: 'youtube',
      isYtThumb: !enrichedAlbum,
    });
  }

  // 2. Lengkapi katalog dari Deezer & iTunes (tetap memutar audio penuh dari YouTube saat diklik)
  tracks.push(...dzTracksList);
  tracks.push(...itTracksList);

  // 3. Audius Tracks + Smart Artwork Enrichment
  const auRows = auRes.status === 'fulfilled' && Array.isArray(auRes.value) ? auRes.value : [];
  for (const a of auRows) {
    const keyFull = `${normalizeStr(a.author)}|${normalizeStr(a.title)}`;
    const enrichedAlbum = officialArtworkMap.get(keyFull)?.album || null;
    tracks.push({
      id: a.id,
      title: a.title,
      duration: a.duration || 0,
      preview: '',
      isAudiusNative: true,
      fullStreamUrl: a.streamUrl,
      artist: {
        id: `audius_artist_${encodeURIComponent(a.author)}`,
        name: a.author,
        picture_medium: enrichedAlbum?.cover_medium || a.cover_medium,
      },
      album: enrichedAlbum || {
        id: a.id,
        title: 'Audius Indie',
        cover_xl: a.cover_xl,
        cover_medium: a.cover_medium,
      },
      source: 'audius',
      isYtThumb: false,
    });
  }

  // Deduplikasi track berdasarkan artis + judul (YouTube menang duluan karena berada di posisi awal)
  const seenTracks = new Set();
  const dedupedTracks = [];
  for (const t of tracks) {
    const sig = `${normalizeStr(t.artist?.name)}|${normalizeStr(t.title.replace(/\s*[\(\[][^)\]]*[\)\]]/g, ''))}`;
    if (seenTracks.has(sig)) continue;
    seenTracks.add(sig);
    dedupedTracks.push(t);
  }

  // Albums (Deezer + iTunes)
  const seenAlbums = new Set();
  const dzAlbumRows = dzAlbumsRes.status === 'fulfilled' && Array.isArray(dzAlbumsRes.value?.data) ? dzAlbumsRes.value.data : [];
  for (const a of dzAlbumRows) {
    const covers = resolveDeezerAlbumCover(a);
    const sig = `${normalizeStr(a.artist?.name)}|${normalizeStr(a.title)}`;
    if (seenAlbums.has(sig)) continue;
    seenAlbums.add(sig);
    albums.push({
      id: String(a.id),
      title: a.title || '',
      cover_xl: covers.cover_xl,
      cover_medium: covers.cover_medium,
      nb_tracks: a.nb_tracks || 0,
      artist: { id: a.artist?.id || '', name: a.artist?.name || 'Artis' },
      source: 'deezer',
      isItunes: false,
    });
  }

  const itAlbumRows = itAlbumsRes.status === 'fulfilled' && Array.isArray(itAlbumsRes.value?.results) ? itAlbumsRes.value.results : [];
  for (const a of itAlbumRows) {
    const sig = `${normalizeStr(a.artistName)}|${normalizeStr(a.collectionName)}`;
    if (seenAlbums.has(sig)) continue;
    seenAlbums.add(sig);
    const art600 = upgradeItunesArt(a.artworkUrl100, 600) || '/icon-192.png';
    const art300 = upgradeItunesArt(a.artworkUrl100, 300) || art600;
    albums.push({
      id: `itunes_${a.collectionId}`,
      collectionId: a.collectionId,
      isItunes: true,
      title: a.collectionName || '',
      cover_xl: art600,
      cover_medium: art300,
      nb_tracks: a.trackCount || 0,
      release_date: a.releaseDate ? String(a.releaseDate).slice(0, 10) : '',
      artist: { id: `itunes_artist_${a.artistId || ''}`, name: a.artistName || 'Artis' },
      source: 'itunes',
    });
  }

  // Artists / Profil (Deezer + iTunes + YouTube Channels)
  const seenArtists = new Set();
  const dzArtistRows = dzArtistsRes.status === 'fulfilled' && Array.isArray(dzArtistsRes.value?.data) ? dzArtistsRes.value.data : [];
  for (const ar of dzArtistRows) {
    const normName = normalizeStr(ar.name || '');
    if (!normName || seenArtists.has(normName)) continue;
    seenArtists.add(normName);
    const pics = resolveDeezerArtistPic(ar);
    artists.push({
      id: String(ar.id),
      name: ar.name || '',
      nb_fan: ar.nb_fan || 0,
      nb_album: ar.nb_album || 0,
      picture_xl: pics.picture_xl,
      picture_medium: pics.picture_medium,
      source: 'deezer',
    });
  }

  for (const r of itSongRows) {
    const aName = String(r.artistName || '').trim();
    const normName = normalizeStr(aName);
    if (!normName || seenArtists.has(normName) || artists.length >= 14) continue;
    seenArtists.add(normName);
    const art = upgradeItunesArt(r.artworkUrl100 || r.artworkUrl60, 400) || '/icon-192.png';
    artists.push({
      id: `itunes_artist_${r.artistId || encodeURIComponent(aName)}`,
      name: aName,
      nb_fan: 0,
      nb_album: 0,
      picture_xl: art,
      picture_medium: art,
      source: 'itunes',
    });
  }

  for (const y of ytRows) {
    const rawAuthor = String(y.author || '').replace(/\s*-\s*Topic$/i, '').trim();
    const normName = normalizeStr(rawAuthor);
    if (!normName || seenArtists.has(normName) || /\b(lirik|lyrics?|7clouds|indolirik|karaoke|records)\b/i.test(rawAuthor)) continue;
    if (artists.length >= 16) break;
    seenArtists.add(normName);
    artists.push({
      id: `yt_creator_${encodeURIComponent(rawAuthor)}`,
      name: rawAuthor,
      nb_fan: 0,
      nb_album: 0,
      picture_xl: y.thumbnail || '/icon-192.png',
      picture_medium: y.thumbnail || '/icon-192.png',
      source: 'youtube',
    });
  }

  // Playlists (Deezer)
  const dzPlRows = dzPlaylistsRes.status === 'fulfilled' && Array.isArray(dzPlaylistsRes.value?.data) ? dzPlaylistsRes.value.data : [];
  for (const pl of dzPlRows) {
    playlists.push({
      id: String(pl.id),
      title: pl.title || '',
      nb_tracks: pl.nb_tracks || 0,
      picture_xl: pl.picture_xl || pl.picture_big || pl.picture_medium || '/icon-192.png',
      picture_medium: pl.picture_medium || pl.picture_big || '/icon-192.png',
      user: { name: pl.user?.name || 'SpotyFlow' },
      source: 'deezer',
    });
  }

  // Podcasts (iTunes)
  const itPodRows = itPodcastsRes.status === 'fulfilled' && Array.isArray(itPodcastsRes.value?.results) ? itPodcastsRes.value.results : [];
  for (const p of itPodRows) {
    const art600 = upgradeItunesArt(p.artworkUrl600 || p.artworkUrl100, 600) || '/icon-192.png';
    podcasts.push({
      id: `pod_${p.collectionId}`,
      collectionId: p.collectionId,
      title: p.collectionName || p.trackName || '',
      author: p.artistName || 'Podcaster',
      cover_xl: art600,
      cover_medium: upgradeItunesArt(p.artworkUrl100, 300) || art600,
      genre: p.primaryGenreName || 'Podcast',
      feedUrl: p.feedUrl || '',
      source: 'itunes',
      isItunes: true,
    });
  }

  return {
    query: q,
    source: src,
    tracks: dedupedTracks,
    albums,
    artists,
    playlists,
    podcasts,
  };
}

app.get('/api/search/all', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const source = String(req.query.source || 'all').trim().toLowerCase();
  const limit = Math.min(40, Math.max(5, Number(req.query.limit) || 25));
  if (!q) return res.status(400).json({ error: 'Kata kunci pencarian (q) wajib diisi.' });

  const data = await runMultiSourceSearch(q, source, limit, 0, req);
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
  return res.json(data);
});

app.get('/api/search/more', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const type = String(req.query.type || 'tracks').toLowerCase();
  const source = String(req.query.source || 'all').toLowerCase();
  const offset = Math.max(0, Number(req.query.offset ?? req.query.index) || 0);
  const limit = Math.min(35, Math.max(5, Number(req.query.limit) || 20));
  if (!q) return res.status(400).json({ error: 'Kata kunci pencarian (q) wajib diisi.' });

  const data = await runMultiSourceSearch(q, source, limit, offset, req);
  const items = data[type] || data.tracks || [];
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
  return res.json({
    ok: true,
    type,
    offset,
    nextIndex: offset + limit,
    items,
    tracks: data.tracks || [],
    hasMore: items.length >= Math.min(limit, 8),
  });
});

app.get('/api/search/suggest', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ tracks: [], artists: [], albums: [] });

  const [ytT, dzT, dzA, dzAl] = await Promise.allSettled([
    searchYouTubeInnertube(q, 2400),
    fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=5`, 2400),
    fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(q)}&limit=3`, 2400),
    fetchJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=3`, 2400),
  ]);

  const dzTracks = (dzT.status === 'fulfilled' && Array.isArray(dzT.value?.data) ? dzT.value.data : []).map((t) => ({
    id: String(t.id),
    title: t.title,
    artist: { id: t.artist?.id || '', name: t.artist?.name || '' },
    album: { id: t.album?.id || '', title: t.album?.title || '', ...resolveDeezerTrackCover(t) },
    duration: t.duration || 0,
    preview: t.preview || '',
    source: 'deezer',
  }));
  const ytTracks = (ytT.status === 'fulfilled' && Array.isArray(ytT.value) ? ytT.value : [])
    .filter((y) => Number(y.duration || 0) <= 900)
    .slice(0, 5)
    .map((y) => {
      const cleaned = cleanLyricsMeta(y.author, y.title);
      return {
        id: `yt_${y.videoId}`,
        ytId: y.videoId,
        videoId: y.videoId,
        title: cleaned.title || y.title,
        artist: { id: `yt_creator_${encodeURIComponent(cleaned.artist || y.author || 'YouTube')}`, name: cleaned.artist || y.author || 'YouTube' },
        album: { id: `yt_${y.videoId}`, title: 'YouTube Music', cover_xl: y.thumbnail, cover_medium: y.thumbnail },
        duration: y.duration || 0,
        preview: '',
        source: 'youtube',
      };
    });

  const tracks = [...ytTracks, ...dzTracks].slice(0, 8);
  const artists = (dzA.status === 'fulfilled' && Array.isArray(dzA.value?.data) ? dzA.value.data : []).map((a) => ({
    id: String(a.id),
    name: a.name,
    ...resolveDeezerArtistPic(a),
    source: 'deezer',
  }));
  const albums = (dzAl.status === 'fulfilled' && Array.isArray(dzAl.value?.data) ? dzAl.value.data : []).map((al) => ({
    id: String(al.id),
    title: al.title,
    artist: { id: al.artist?.id || '', name: al.artist?.name || '' },
    ...resolveDeezerAlbumCover(al),
    source: 'deezer',
  }));

  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
  return res.json({ tracks, artists, albums });
});

// Proxy Gambar Anti-SSRF Ketat (Hanya HTTPS + Strict Domain Whitelist Sampul Musik + Anti-SVG-XSS + Cap 5 MB)
const ALLOWED_IMAGE_PROXY_DOMAINS = [
  'i.ytimg.com',
  'ytimg.com',
  'lh3.googleusercontent.com',
  'yt3.googleusercontent.com',
  'googleusercontent.com',
  'e-cdns-images.dzcdn.net',
  'dzcdn.net',
  'i.scdn.co',
  'scdn.co',
  'is1-ssl.mzstatic.com',
  'mzstatic.com',
  'audius.co',
  'theaudiodb.com',
  'wikimedia.org',
  'sndcdn.com',
  'saavncdn.com',
  'jiosaavn.com',
  'spotyflow.vercel.app',
];

const SAFE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);
const MAX_PROXY_IMAGE_BYTES = 5 * 1024 * 1024;

function isAllowedProxyImageDomain(rawUrl) {
  if (!isSafePublicUrl(rawUrl, true)) return false;
  try {
    const u = new URL(String(rawUrl));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_IMAGE_PROXY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

app.get('/api/proxy-image', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url || !isSafePublicUrl(url, true)) {
    return res.status(400).json({ error: 'URL gambar tidak valid (hanya HTTPS publik yang diizinkan).' });
  }
  if (!isAllowedProxyImageDomain(url)) {
    return res.status(403).json({
      error: 'Domain gambar tidak termasuk dalam daftar putih resmi (Anti-SSRF).',
    });
  }
  try {
    let currentUrl = url;
    let upstream = null;
    for (let hop = 0; hop <= 2; hop += 1) {
      upstream = await fetch(currentUrl, {
        headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8' },
        redirect: 'manual',
        signal: AbortSignal.timeout(4500),
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        const loc = upstream.headers.get('location');
        if (upstream.body) upstream.body.cancel().catch(() => {});
        if (!loc || hop === 2) {
          return res.status(403).json({ error: 'Redirect gambar ditolak.' });
        }
        const resolved = new URL(loc, currentUrl).toString();
        if (!isAllowedProxyImageDomain(resolved)) {
          return res.status(403).json({ error: 'Redirect gambar mengarah ke domain tidak diizinkan.' });
        }
        currentUrl = resolved;
        continue;
      }
      break;
    }
    if (!upstream || !upstream.ok) return res.status(upstream?.status || 502).end();
    const rawCt = String(upstream.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (!SAFE_IMAGE_MIME_TYPES.has(rawCt)) {
      if (upstream.body) upstream.body.cancel().catch(() => {});
      return res.status(415).json({ error: 'Format gambar tidak didukung atau tidak aman.' });
    }
    const declaredLen = Number(upstream.headers.get('content-length') || 0);
    if (declaredLen > MAX_PROXY_IMAGE_BYTES) {
      if (upstream.body) upstream.body.cancel().catch(() => {});
      return res.status(413).json({ error: 'Ukuran file gambar melebihi batas maksimal 5 MB.' });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_PROXY_IMAGE_BYTES) {
      return res.status(413).json({ error: 'Ukuran file gambar melebihi batas maksimal 5 MB.' });
    }
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', rawCt);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).send(buf);
  } catch {
    return res.status(502).end();
  }
});

// Pencarian Lagu "Lupa Judul" via Potongan Lirik (GET /api/search/by-lyrics?q=...)
app.get('/api/search/by-lyrics', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Masukkan minimal 2 karakter potongan lirik.' });
  }

  try {
    const [lrcRes, aiRes] = await Promise.allSettled([
      fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, 4000),
      process.env.GEMINI_API_KEY
        ? callGeminiText(
            `Identifikasi hingga 3 lagu terkenal yang memiliki potongan lirik: "${q}". Balas HANYA JSON array seperti [{"title":"Judul","artist":"Artis"}].`,
            4000
          )
        : Promise.resolve(null),
    ]);

    const candidates = [];
    const seenSig = new Set();
    const addCandidate = (title, artist, snippet = '', duration = 0) => {
      const cleanT = String(title || '').trim();
      const cleanA = String(artist || '').trim();
      if (!cleanT) return;
      const sig = `${normalizeStr(cleanA)}|${normalizeStr(cleanT)}`;
      if (seenSig.has(sig)) return;
      seenSig.add(sig);
      candidates.push({ title: cleanT, artist: cleanA, snippet, duration: Number(duration) || 0 });
    };

    if (aiRes.status === 'fulfilled' && aiRes.value) {
      try {
        const m = String(aiRes.value).match(/\[[\s\S]*\]/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (Array.isArray(parsed)) {
            for (const item of parsed.slice(0, 3)) {
              addCandidate(item?.title, item?.artist, q, 0);
            }
          }
        }
      } catch {
        // lanjut ke hasil LRCLIB
      }
    }

    const lrcList = lrcRes.status === 'fulfilled' && Array.isArray(lrcRes.value) ? lrcRes.value : [];
    for (const row of lrcList.slice(0, 12)) {
      const plain = String(row?.plainLyrics || row?.syncedLyrics || '')
        .replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const lowerPlain = plain.toLowerCase();
      const idx = lowerPlain.indexOf(q.toLowerCase());
      const snippet =
        idx >= 0
          ? plain.slice(Math.max(0, idx - 30), Math.min(plain.length, idx + q.length + 60)).trim()
          : plain.slice(0, 100);
      addCandidate(row?.trackName || row?.name, row?.artistName, snippet, row?.duration);
      if (candidates.length >= 10) break;
    }

    // Perkaya kandidat dengan sampul HD & objek lagu siap putar dari Deezer / iTunes (timeout 3500ms)
    const enriched = await Promise.all(
      candidates.slice(0, 8).map(async (cand, idx) => {
        const pairQuery = `${cand.artist} ${cand.title}`.trim();
        try {
          const [dzData, itData] = await Promise.allSettled([
            fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(pairQuery)}&limit=2`, 3500),
            fetchJson(
              `https://itunes.apple.com/search?term=${encodeURIComponent(pairQuery)}&media=music&entity=song&limit=2`,
              3500
            ),
          ]);
          const dzTrack = dzData.status === 'fulfilled' ? dzData.value?.data?.[0] : null;
          if (dzTrack && dzTrack.id) {
            const covers = resolveDeezerTrackCover(dzTrack);
            return {
              id: String(dzTrack.id),
              title: dzTrack.title || cand.title,
              duration: Number(dzTrack.duration || cand.duration || 210),
              preview: dzTrack.preview || '',
              lyricSnippet: cand.snippet || q,
              artist: {
                id: dzTrack.artist?.id || '',
                name: dzTrack.artist?.name || cand.artist || 'Artis',
                picture_medium: dzTrack.artist?.picture_medium || covers.cover_medium,
              },
              album: {
                id: dzTrack.album?.id || '',
                title: dzTrack.album?.title || 'Single',
                cover_xl: covers.cover_xl,
                cover_medium: covers.cover_medium,
              },
              source: 'deezer',
            };
          }
          const itTrack = itData.status === 'fulfilled' ? itData.value?.results?.[0] : null;
          if (itTrack && itTrack.trackId) {
            const art600 = upgradeItunesArt(itTrack.artworkUrl100, 600) || '/icon-192.png';
            const art300 = upgradeItunesArt(itTrack.artworkUrl100, 300) || art600;
            return {
              id: `itunes_${itTrack.trackId}`,
              title: itTrack.trackName || cand.title,
              duration: Math.round(Number(itTrack.trackTimeMillis || 0) / 1000) || cand.duration || 210,
              preview: itTrack.previewUrl || '',
              isItunes: true,
              lyricSnippet: cand.snippet || q,
              artist: {
                id: `itunes_artist_${itTrack.artistId || ''}`,
                name: itTrack.artistName || cand.artist || 'Artis',
                picture_medium: art300,
              },
              album: {
                id: String(itTrack.collectionId || ''),
                collectionId: itTrack.collectionId || null,
                isItunes: true,
                title: itTrack.collectionName || 'Single',
                cover_xl: art600,
                cover_medium: art300,
              },
              source: 'itunes',
            };
          }
        } catch {
          // fallback objek dasar
        }
        return {
          id: `lyric_${idx}_${Date.now()}`,
          title: cand.title,
          duration: cand.duration || 210,
          preview: '',
          lyricSnippet: cand.snippet || q,
          artist: { id: '', name: cand.artist || 'Artis', picture_medium: '/icon-192.png' },
          album: { id: '', title: 'Hasil Pencarian Lirik', cover_xl: '/icon-192.png', cover_medium: '/icon-192.png' },
          source: 'lrclib',
        };
      })
    );

    // Jika LRCLIB kosong, fallback ke pencarian multi-sumber
    let finalTracks = enriched.filter(Boolean);
    if (!finalTracks.length) {
      const multi = await runMultiSourceSearch(q, 'all', 10, 0);
      finalTracks = multi.tracks.slice(0, 10);
    }

    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=120');
    return res.json({
      ok: true,
      query: q,
      tracks: finalTracks,
    });
  } catch {
    return res.status(502).json({ error: 'Gagal mencari lagu berdasarkan potongan lirik.' });
  }
});

// Lookup Album iTunes Penuh + Daftar Lagu (cache 12 jam)
app.get('/api/album/itunes/:collectionId', async (req, res) => {
  const collectionId = String(req.params.collectionId || '').replace(/\D+/g, '');
  if (!collectionId) return res.status(400).json({ error: 'collectionId iTunes tidak valid.' });

  try {
    const data = await fetchJson(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(collectionId)}&entity=song`,
      4500
    );
    const results = Array.isArray(data?.results) ? data.results : [];
    const albumInfo = results.find((r) => r.wrapperType === 'collection');
    if (!albumInfo) return res.status(404).json({ error: 'Album iTunes tidak ditemukan.' });

    const art600 = upgradeItunesArt(albumInfo.artworkUrl100, 600) || '/icon-192.png';
    const art300 = upgradeItunesArt(albumInfo.artworkUrl100, 300) || art600;

    const tracks = results
      .filter((r) => r.wrapperType === 'track')
      .map((t) => ({
        id: `itunes_${t.trackId}`,
        title: t.trackName || '',
        duration: Math.round(Number(t.trackTimeMillis || 0) / 1000),
        preview: t.previewUrl || '',
        track_position: t.trackNumber || 0,
        isItunes: true,
        collectionId: Number(collectionId),
        artist: { id: `itunes_artist_${t.artistId || ''}`, name: t.artistName || albumInfo.artistName || 'Artis' },
        album: {
          id: `itunes_${collectionId}`,
          collectionId: Number(collectionId),
          isItunes: true,
          title: albumInfo.collectionName || '',
          cover_xl: art600,
          cover_medium: art300,
        },
        source: 'itunes',
      }));

    res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=3600');
    return res.json({
      id: `itunes_${collectionId}`,
      collectionId: Number(collectionId),
      isItunes: true,
      title: albumInfo.collectionName || '',
      cover_xl: art600,
      cover_medium: art300,
      release_date: albumInfo.releaseDate ? String(albumInfo.releaseDate).slice(0, 10) : '',
      genre: albumInfo.primaryGenreName || '',
      copyright: albumInfo.copyright || '',
      nb_tracks: tracks.length || albumInfo.trackCount || 0,
      artist: { id: `itunes_artist_${albumInfo.artistId || ''}`, name: albumInfo.artistName || 'Artis' },
      tracks: { data: tracks },
    });
  } catch {
    return res.status(502).json({ error: 'Gagal memuat detail album iTunes.' });
  }
});

// Profil Artis Lengkap (Deezer + TheAudioDB + Wikipedia ID/EN + MusicBrainz + Fallback YouTube/iTunes)
app.get('/api/artist/full-profile', async (req, res) => {
  const rawId = String(req.query.id || '').trim();
  let artistName = String(req.query.name || '').trim();
  const lang = String(req.query.lang || 'id').toLowerCase().startsWith('en') ? 'en' : 'id';
  let dzId = /^\d+$/.test(rawId) ? rawId : '';

  try {
    if (!dzId && artistName) {
      try {
        const s = await fetchJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=3`, 3000);
        const found = (s?.data || []).find((a) => normalizeStr(a.name) === normalizeStr(artistName)) || s?.data?.[0];
        if (found?.id) {
          dzId = String(found.id);
          artistName = found.name || artistName;
        }
      } catch {
        // Fallback kreator non-Deezer
      }
    }

    const [dzArtistRes, dzTopRes, dzAlbRes, dzRelRes] = await Promise.allSettled([
      dzId ? fetchJson(`https://api.deezer.com/artist/${dzId}`, 3500) : Promise.resolve(null),
      dzId ? fetchJson(`https://api.deezer.com/artist/${dzId}/top?limit=25`, 3500) : Promise.resolve(null),
      dzId ? fetchJson(`https://api.deezer.com/artist/${dzId}/albums?limit=30`, 3500) : Promise.resolve(null),
      dzId ? fetchJson(`https://api.deezer.com/artist/${dzId}/related?limit=12`, 3500) : Promise.resolve(null),
    ]);

    const dzArtist = dzArtistRes.status === 'fulfilled' ? dzArtistRes.value : null;
    if (dzArtist?.name) artistName = dzArtist.name;
    if (!artistName) return res.status(404).json({ error: 'Artis tidak ditemukan.' });

    const wikiPrimary = lang === 'en' ? 'en' : 'id';
    const wikiSecondary = lang === 'en' ? 'id' : 'en';

    const [adbRes, wiki1Res, wiki2Res, mbRes, itFallbackRes] = await Promise.allSettled([
      fetchJson(`https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(artistName)}`, 3500),
      fetchJson(`https://${wikiPrimary}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`, 3000),
      fetchJson(`https://${wikiSecondary}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(artistName)}`, 3000),
      fetchJson(
        `https://musicbrainz.org/ws/2/artist?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=1`,
        3000,
        { headers: { 'User-Agent': 'SpotyFlow/8.0 (https://spotyflow.vercel.app)' } }
      ),
      !dzId
        ? runMultiSourceSearch(artistName, 'all', 20, 0)
        : Promise.resolve(null),
    ]);

    const adb = adbRes.status === 'fulfilled' ? adbRes.value?.artists?.[0] : null;
    const wiki1 = wiki1Res.status === 'fulfilled' && wiki1Res.value?.type !== 'disambiguation' ? wiki1Res.value : null;
    const wiki2 = wiki2Res.status === 'fulfilled' && wiki2Res.value?.type !== 'disambiguation' ? wiki2Res.value : null;
    const mb = mbRes.status === 'fulfilled' ? mbRes.value?.artists?.[0] : null;
    const fallbackSearch = itFallbackRes.status === 'fulfilled' ? itFallbackRes.value : null;

    const topTracks = dzId
      ? (dzTopRes.status === 'fulfilled' && Array.isArray(dzTopRes.value?.data) ? dzTopRes.value.data : []).map((t) => ({
          id: String(t.id),
          title: t.title,
          duration: t.duration || 0,
          preview: t.preview || '',
          artist: { id: dzId, name: artistName },
          album: { id: t.album?.id || '', title: t.album?.title || '', ...resolveDeezerTrackCover(t) },
          source: 'deezer',
        }))
      : fallbackSearch?.tracks || [];

    const albums = dzId
      ? (dzAlbRes.status === 'fulfilled' && Array.isArray(dzAlbRes.value?.data) ? dzAlbRes.value.data : []).map((a) => ({
          id: String(a.id),
          title: a.title,
          release_date: a.release_date || '',
          record_type: a.record_type || 'album',
          ...resolveDeezerAlbumCover(a),
          artist: { id: dzId, name: artistName },
          source: 'deezer',
        }))
      : fallbackSearch?.albums || [];

    const relatedArtists =
      dzRelRes.status === 'fulfilled' && Array.isArray(dzRelRes.value?.data)
        ? dzRelRes.value.data.map((r) => ({
            id: String(r.id),
            name: r.name,
            nb_fan: r.nb_fan || 0,
            ...resolveDeezerArtistPic(r),
            source: 'deezer',
          }))
        : [];

    const bio =
      (wiki1?.extract && wiki1.extract.length > 40 ? wiki1.extract : '') ||
      (wiki2?.extract && wiki2.extract.length > 40 ? wiki2.extract : '') ||
      (lang === 'en' ? adb?.strBiographyEN : adb?.strBiographyID || adb?.strBiographyEN) ||
      '';

    const avatar =
      dzArtist?.picture_xl ||
      adb?.strArtistThumb ||
      topTracks[0]?.album?.cover_xl ||
      '/icon-192.png';
    const banner = adb?.strArtistFanart || adb?.strArtistBanner || avatar;

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
    return res.json({
      ok: true,
      artist: {
        id: dzId || rawId || `creator_${encodeURIComponent(artistName)}`,
        name: artistName,
        picture_xl: avatar,
        picture_medium: dzArtist?.picture_medium || avatar,
        banner,
        nb_fan: dzArtist?.nb_fan || 0,
        nb_album: dzArtist?.nb_album || albums.length,
        country: adb?.strCountry || mb?.area?.name || mb?.country || '',
        formedYear: adb?.intFormedYear || mb?.['life-span']?.begin?.slice(0, 4) || '',
        genre: adb?.strGenre || adb?.strStyle || '',
        bio,
      },
      topTracks,
      albums,
      relatedArtists,
    });
  } catch {
    return res.status(502).json({ error: 'Gagal memuat profil artis.' });
  }
});

// Profil Lagu Lengkap (Deezer + iTunes + Lagu Serupa, cache 12 jam)
app.get('/api/track/full-profile', async (req, res) => {
  const id = String(req.query.id || '').trim();
  const title = String(req.query.title || '').trim();
  const artist = String(req.query.artist || '').trim();
  const numericId = /^\d+$/.test(id) ? id : '';

  try {
    const q = `${artist} ${title}`.trim();
    const [dzTrackRes, itRes, dzRelatedRes] = await Promise.allSettled([
      numericId ? fetchJson(`https://api.deezer.com/track/${numericId}`, 3500) : Promise.resolve(null),
      q ? fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=5`, 3500) : Promise.resolve(null),
      q ? fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(artist || title)}&limit=12`, 3500) : Promise.resolve(null),
    ]);

    const dz = dzTrackRes.status === 'fulfilled' && dzTrackRes.value?.id ? dzTrackRes.value : null;
    const it = itRes.status === 'fulfilled' ? itRes.value?.results?.[0] : null;
    const relatedRaw = dzRelatedRes.status === 'fulfilled' && Array.isArray(dzRelatedRes.value?.data) ? dzRelatedRes.value.data : [];

    const related = relatedRaw
      .filter((r) => String(r.id) !== numericId)
      .slice(0, 10)
      .map((t) => ({
        id: String(t.id),
        title: t.title,
        duration: t.duration || 0,
        preview: t.preview || '',
        artist: { id: t.artist?.id || '', name: t.artist?.name || '' },
        album: { id: t.album?.id || '', title: t.album?.title || '', ...resolveDeezerTrackCover(t) },
        source: 'deezer',
      }));

    const cover =
      (dz ? resolveDeezerTrackCover(dz).cover_xl : '') ||
      (it ? upgradeItunesArt(it.artworkUrl100, 600) : '') ||
      '/icon-192.png';

    res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=3600');
    return res.json({
      ok: true,
      track: {
        id: dz ? String(dz.id) : id,
        title: dz?.title || it?.trackName || title,
        duration: dz?.duration || Math.round(Number(it?.trackTimeMillis || 0) / 1000),
        releaseDate: dz?.release_date || (it?.releaseDate ? String(it.releaseDate).slice(0, 10) : ''),
        bpm: dz?.bpm || 0,
        rank: dz?.rank || 0,
        genre: it?.primaryGenreName || '',
        explicit: Boolean(dz?.explicit_lyrics || it?.trackExplicitness === 'explicit'),
        artist: {
          id: dz?.artist?.id ? String(dz.artist.id) : `itunes_artist_${it?.artistId || ''}`,
          name: dz?.artist?.name || it?.artistName || artist,
        },
        album: {
          id: dz?.album?.id ? String(dz.album.id) : `itunes_${it?.collectionId || ''}`,
          collectionId: it?.collectionId || null,
          isItunes: !dz && Boolean(it?.collectionId),
          title: dz?.album?.title || it?.collectionName || 'Single',
          cover_xl: cover,
          cover_medium: cover,
        },
      },
      related,
    });
  } catch {
    return res.status(502).json({ error: 'Gagal memuat profil lagu.' });
  }
});

// Charts Negara (Apple iTunes Country RSS + Deezer Global Chart fallback, cache 15 menit)
app.get('/api/charts/country/:code', async (req, res) => {
  const code = String(req.params.code || 'ID').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'ID';
  const iso = code === 'GLOBAL' ? 'us' : code.slice(0, 2).toLowerCase();

  try {
    let tracks = [];
    if (code === 'GLOBAL') {
      const dz = await fetchJson('https://api.deezer.com/chart/0/tracks?limit=30', 4000);
      tracks = (Array.isArray(dz?.data) ? dz.data : []).map((t) => ({
        id: String(t.id),
        title: t.title,
        duration: t.duration || 0,
        preview: t.preview || '',
        artist: { id: t.artist?.id || '', name: t.artist?.name || 'Artis' },
        album: { id: t.album?.id || '', title: t.album?.title || '', ...resolveDeezerTrackCover(t) },
        source: 'deezer',
      }));
    } else {
      try {
        const rss = await fetchJson(`https://itunes.apple.com/${iso}/rss/topsongs/limit=30/json`, 4000);
        const entries = Array.isArray(rss?.feed?.entry) ? rss.feed.entry : [];
        tracks = entries.map((e, idx) => {
          const rawImg = Array.isArray(e['im:image']) ? e['im:image'][e['im:image'].length - 1]?.label || '' : '';
          const art600 = upgradeItunesArt(rawImg, 600) || rawImg || '/icon-192.png';
          const art300 = upgradeItunesArt(rawImg, 300) || art600;
          const linkArr = Array.isArray(e.link) ? e.link : [];
          const audioLink = linkArr.find((l) => String(l?.attributes?.type || '').startsWith('audio/'));
          const trackId = e?.id?.attributes?.['im:id'] || `${iso}_${idx + 1}`;
          const durMs = Number(audioLink?.['im:duration']?.label || 0);
          return {
            id: `itunes_${trackId}`,
            title: e?.['im:name']?.label || e?.title?.label || '',
            duration: durMs > 1000 ? Math.round(durMs / 1000) : 210,
            preview: audioLink?.attributes?.href || '',
            isItunes: true,
            artist: {
              id: `itunes_artist_${encodeURIComponent(e?.['im:artist']?.label || '')}`,
              name: e?.['im:artist']?.label || 'Artis',
            },
            album: {
              id: `itunes_alb_${trackId}`,
              title: e?.['im:collection']?.['im:name']?.label || 'Top Chart',
              cover_xl: art600,
              cover_medium: art300,
              isItunes: true,
            },
            source: 'itunes',
          };
        });
      } catch {
        tracks = [];
      }
    }

    if (!tracks.length) {
      const dz = await fetchJson('https://api.deezer.com/chart/0/tracks?limit=30', 4000);
      tracks = (Array.isArray(dz?.data) ? dz.data : []).map((t) => ({
        id: String(t.id),
        title: t.title,
        duration: t.duration || 0,
        preview: t.preview || '',
        artist: { id: t.artist?.id || '', name: t.artist?.name || 'Artis' },
        album: { id: t.album?.id || '', title: t.album?.title || '', ...resolveDeezerTrackCover(t) },
        source: 'deezer',
      }));
    }

    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=120');
    return res.json({ ok: true, country: code, tracks });
  } catch {
    return res.status(502).json({ error: `Gagal memuat tangga lagu untuk kode ${code}.` });
  }
});

// Katalog Deezer Stateless (Beranda, Artist, Album, Playlist, Chart)
app.get('/api/catalog/*', async (req, res) => {
  const subPath = req.path.slice('/api/catalog'.length) || '/chart';
  if (!/^\/[a-zA-Z0-9/_\-]+$/.test(subPath)) {
    return res.status(400).json({ error: 'Path katalog tidak valid.' });
  }
  const qs = new URLSearchParams(req.query);
  qs.delete('token');
  const queryStr = qs.toString();
  try {
    const data = await fetchJson(`https://api.deezer.com${subPath}${queryStr ? `?${queryStr}` : ''}`, 4500);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.json(data);
  } catch {
    return res.status(502).json({ error: 'Layanan katalog sedang sibuk.' });
  }
});

// Track Radio & Related Tracks (untuk Autoplay & Radio Lagu)
app.get(['/api/radio/track', '/api/track/related'], async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  const title = String(req.query.title || '').trim();
  const q = artist || title || 'top hits';
  try {
    const data = await fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=20`, 4000);
    const tracks = (Array.isArray(data?.data) ? data.data : []).map((t) => ({
      id: String(t.id),
      title: t.title,
      duration: t.duration || 0,
      preview: t.preview || '',
      artist: { id: t.artist?.id || '', name: t.artist?.name || 'Artis' },
      album: { id: t.album?.id || '', title: t.album?.title || '', ...resolveDeezerTrackCover(t) },
      source: 'deezer',
    }));
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.json({ ok: true, tracks });
  } catch {
    return res.json({ ok: true, tracks: [] });
  }
});

// Podcasts (iTunes + Audius Full-Length Audio)
app.get(['/api/podcasts', '/api/v1/podcasts'], async (req, res) => {
  const q = String(req.query.q || 'podcast talk music').trim();
  try {
    const audiusTracks = await searchAudiusTracks(q, 12);
    const episodes = audiusTracks.map((a) => ({
      id: a.id,
      title: a.title,
      author: a.author,
      duration: a.duration || 600,
      cover_xl: a.cover_xl,
      cover_medium: a.cover_medium,
      streamUrl: a.streamUrl,
      isAudiusNative: true,
      source: 'audius',
    }));
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.json({ ok: true, episodes, podcasts: episodes });
  } catch {
    return res.json({ ok: true, episodes: [], podcasts: [] });
  }
});

// =========================================================================
// 11. MULTI-SOURCE LYRICS WATERFALL (GET /api/lyrics)
// =========================================================================

app.get('/api/lyrics', async (req, res) => {
  const rawArtist = String(req.query.artist || '').trim();
  const rawTitle = String(req.query.title || '').trim();
  const videoId = String(req.query.videoId || req.query.ytId || '').trim();
  const durationSec = Math.max(0, Number(req.query.duration) || 0);

  if (!rawTitle && !rawArtist && !videoId) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ mode: 'none', syncedLines: [], plainLyrics: '' });
  }

  const cleaned = cleanLyricsMeta(rawArtist, rawTitle);
  let artist = cleaned.artist || rawArtist;
  let title = cleaned.title || rawTitle;
  const remixOrLong = isRemixOrLongTrack(`${rawTitle} ${rawArtist}`, durationSec);

  // Stage 1: LRCLIB (exactOnly untuk Remix/DJ/Mashup/Nonstop/Instrumental/durasi > 480s)
  let result = await fetchLyricsFromLrclib(
    artist,
    title,
    durationSec,
    cleaned.rawTitleCleaned,
    cleaned.altArtist,
    cleaned.altTitle,
    remixOrLong
  );

  // Stage 1B & Stage 2: DILARANG untuk Remix/DJ/Mashup/Nonstop/Instrumental/durasi > 480s
  if (!result && !remixOrLong) {
    const canonical = await resolveCanonicalTrackMeta(artist, title, cleaned.rawTitleCleaned);
    if (canonical && (normalizeStr(canonical.artist) !== normalizeStr(artist) || normalizeStr(canonical.title) !== normalizeStr(title))) {
      artist = canonical.artist;
      title = canonical.title;
      result = await fetchLyricsFromLrclib(artist, title, durationSec || canonical.duration, `${artist} - ${title}`);
    }
  }

  if (!result && !remixOrLong) {
    try {
      result = await Promise.any([
        fetchLyricsFromNetEase(artist, title),
        fetchLyricsFromLyrist(artist, title),
        fetchLyricsFromOvh(artist, title),
      ]);
      if (result && (!result.syncedLines || !result.syncedLines.length) && result.plainLyrics) {
        result = formatLyricsResult([], result.plainLyrics, result.source, durationSec);
      }
    } catch {
      result = null;
    }
  }

  // Stage 3: Lirik resmi YouTube Music (api/ytm.py?action=lyrics) & YouTube Captions (hanya pakai videoId valid untuk Remix/Long)
  if (!result) {
    let effectiveVid = decodeVideoIdParam(videoId);
    if (!isValidVideoId(effectiveVid) && !remixOrLong && (artist || title)) {
      const ytmFind = await callYtmPython(req, { action: 'search', q: `${artist} ${title}`.trim(), limit: '1' }, 2400);
      const foundVid = ytmFind?.tracks?.[0]?.videoId || '';
      if (isValidVideoId(foundVid)) effectiveVid = foundVid;
    }
    if (isValidVideoId(effectiveVid)) {
      const ytmLyr = await callYtmPython(req, { action: 'lyrics', videoId: effectiveVid }, 3500);
      if (ytmLyr && ytmLyr.plainLyrics && String(ytmLyr.plainLyrics).trim().length >= 20) {
        result = formatLyricsResult([], ytmLyr.plainLyrics, ytmLyr.source || 'YouTube Music', durationSec);
      }
      if (!result && !remixOrLong) {
        result = await fetchLyricsFromYouTubeCaptions(effectiveVid);
      }
    }
  }

  // Stage 4 Gemini AI Lyrics Fallback DIHAPUS permanen agar AI tidak pernah mengarang lirik palsu.

  if (result) {
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
    return res.json({
      ok: true,
      ...result,
      cleanedQuery: { artist, title },
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ok: true,
    mode: 'none',
    source: 'none',
    syncedLines: [],
    plainLyrics: '',
    cleanedQuery: { artist, title },
  });
});

const LYRICS_TRANSLATE_LANG_MAP = {
  id: 'Indonesian (Bahasa Indonesia)',
  en: 'English',
  ar: 'Arabic (العربية — use authentic Arabic script)',
  ms: 'Malay (Bahasa Melayu)',
  jv: 'Javanese (Basa Jawa)',
  su: 'Sundanese (Basa Sunda)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  zh: 'Simplified Chinese / Mandarin (简体中文)',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  pt: 'Portuguese (Português)',
  ru: 'Russian (Русский)',
  hi: 'Hindi (हिन्दी)',
  th: 'Thai (ไทย)',
  tr: 'Turkish (Türkçe)',
  it: 'Italian (Italiano)',
};

app.post('/api/lyrics/translate', async (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines.slice(0, 100) : [];
  const rawCode = String(req.body?.targetLang || 'id').trim().toLowerCase();
  const langCode = LYRICS_TRANSLATE_LANG_MAP[rawCode] ? rawCode : 'id';
  const targetLang = LYRICS_TRANSLATE_LANG_MAP[langCode];
  if (!lines.length) return res.status(400).json({ error: 'Baris lirik kosong.' });

  const prompt = `Translate each lyric line into natural, poetic ${targetLang}. Keep the EXACT same array length (${lines.length}) and line order. Output ONLY a valid JSON array of strings without markdown.\n${JSON.stringify(lines)}`;
  const aiText = await callGeminiPayload(
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    12000,
    ['gemini-3-flash-preview', 'gemini-3.1-flash-lite']
  );
  if (aiText) {
    try {
      const m = aiText.match(/\[[\s\S]*\]/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed) && parsed.length) {
          return res.json({ ok: true, targetLang: langCode, translatedLines: parsed });
        }
      }
    } catch {
      // fallback
    }
  }
  return res.json({ ok: true, targetLang: langCode, translatedLines: lines, fallback: true });
});

// --- 11B. ROMANISASI LIRIK OTOMATIS (POST /api/lyrics/romanize) ---
const HANGUL_CHO = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const HANGUL_JUNG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const HANGUL_JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'p', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

const KANA_DIGRAPHS = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo', みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
};
const HIRAGANA_MAP = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'wo', ん: 'n',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ー: '-',
};
const CYRILLIC_MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function romanizeLineAlgorithmic(line) {
  const src = String(line || '');
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const code = ch.charCodeAt(0);
    // Hangul syllables U+AC00..U+D7A3
    if (code >= 0xac00 && code <= 0xd7a3) {
      const sIdx = code - 0xac00;
      const cho = Math.floor(sIdx / 588);
      const jung = Math.floor((sIdx % 588) / 28);
      const jong = sIdx % 28;
      out += `${HANGUL_CHO[cho] || ''}${HANGUL_JUNG[jung] || ''}${HANGUL_JONG[jong] || ''}`;
      continue;
    }
    // Convert Katakana U+30A1..U+30F6 to Hiragana for unified Hepburn table
    const normCh = code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : ch;
    const nextRaw = src[i + 1] || '';
    const nextCode = nextRaw ? nextRaw.charCodeAt(0) : 0;
    const normNext = nextCode >= 0x30a1 && nextCode <= 0x30f6 ? String.fromCharCode(nextCode - 0x60) : nextRaw;

    if (normCh === 'っ' && normNext) {
      const nextRom = KANA_DIGRAPHS[normNext + (src[i + 2] || '')] || HIRAGANA_MAP[normNext] || '';
      if (nextRom) out += nextRom[0];
      continue;
    }
    if (normNext && KANA_DIGRAPHS[normCh + normNext]) {
      out += KANA_DIGRAPHS[normCh + normNext];
      i += 1;
      continue;
    }
    if (HIRAGANA_MAP[normCh]) {
      out += HIRAGANA_MAP[normCh];
      continue;
    }
    const lower = ch.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(CYRILLIC_MAP, lower)) {
      const mapped = CYRILLIC_MAP[lower];
      out += ch !== lower && mapped ? mapped[0].toUpperCase() + mapped.slice(1) : mapped;
      continue;
    }
    out += ch;
  }
  return out.replace(/\s{2,}/g, ' ').trim() || src;
}

app.post('/api/lyrics/romanize', async (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines.slice(0, 120).map((x) => String(x ?? '')) : [];
  if (!lines.length) return res.status(400).json({ ok: false, error: 'Baris lirik kosong.' });

  const prompt = `Romanize each lyric line into accurate, readable Latin script (Romaji for Japanese, Revised Romanization for Korean, Pinyin without tone numbers or clean Pinyin for Chinese, Latin transliteration for Cyrillic/other scripts). Keep English/Latin words intact. You MUST return a JSON array of strings with the EXACT same length (${lines.length}) and order. Output ONLY the valid JSON array.\n${JSON.stringify(lines)}`;
  const aiText = await callGeminiText(prompt);
  if (aiText) {
    try {
      const m = aiText.match(/\[[\s\S]*\]/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed) && parsed.length === lines.length) {
          return res.json({
            ok: true,
            provider: 'gemini',
            romanizedLines: parsed.map((x, idx) => String(x || lines[idx] || '')),
          });
        }
      }
    } catch {
      // fall through to algorithmic fallback
    }
  }

  const romanizedLines = lines.map((line) => romanizeLineAlgorithmic(line));
  return res.json({
    ok: true,
    provider: 'algorithmic',
    fallback: true,
    romanizedLines,
  });
});

// --- 11B-2. TRANSKRIPSI SUARA KE LIRIK AI (POST /api/lyrics/transcribe) ---
const AI_LYRICS_MAX_BYTES = Math.floor(3.8 * 1024 * 1024); // 3.8 MB cap (anti-OOM / anti-timeout Serverless)
const AI_LYRICS_MEM_MAX = 150;
const aiLyricsMemCache = new Map();
let aiLyricsDbTableReady = false;

async function ensureAiLyricsCacheTable(pool) {
  if (!pool || aiLyricsDbTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_lyrics_cache (
      cache_key TEXT PRIMARY KEY,
      synced_lines JSONB NOT NULL,
      plain_lyrics TEXT NOT NULL,
      provider TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  aiLyricsDbTableReady = true;
}

async function getAiLyricsFromCache(cacheKey) {
  if (!cacheKey) return null;
  if (aiLyricsMemCache.has(cacheKey)) {
    return aiLyricsMemCache.get(cacheKey);
  }
  const pool = getCloudDbPool();
  if (!pool) return null;
  try {
    await ensureAiLyricsCacheTable(pool);
    const r = await pool.query(
      'SELECT synced_lines, plain_lyrics, provider FROM ai_lyrics_cache WHERE cache_key = $1 LIMIT 1',
      [cacheKey]
    );
    const row = r.rows?.[0];
    if (row && (Array.isArray(row.synced_lines) ? row.synced_lines.length : false || row.plain_lyrics)) {
      const entry = {
        syncedLines: Array.isArray(row.synced_lines) ? row.synced_lines : [],
        plainLyrics: String(row.plain_lyrics || ''),
        provider: String(row.provider || 'gemini'),
      };
      if (aiLyricsMemCache.size >= AI_LYRICS_MEM_MAX) {
        const oldestKey = aiLyricsMemCache.keys().next().value;
        if (oldestKey) aiLyricsMemCache.delete(oldestKey);
      }
      aiLyricsMemCache.set(cacheKey, entry);
      return entry;
    }
  } catch {
    // Fallback diam jika DB belum tersedia
  }
  return null;
}

async function saveAiLyricsToCache(cacheKey, syncedLines, plainLyrics, provider = 'gemini') {
  if (!cacheKey) return;
  const entry = { syncedLines, plainLyrics, provider };
  if (aiLyricsMemCache.size >= AI_LYRICS_MEM_MAX) {
    const oldestKey = aiLyricsMemCache.keys().next().value;
    if (oldestKey) aiLyricsMemCache.delete(oldestKey);
  }
  aiLyricsMemCache.set(cacheKey, entry);

  const pool = getCloudDbPool();
  if (!pool) return;
  try {
    await ensureAiLyricsCacheTable(pool);
    await pool.query(
      `INSERT INTO ai_lyrics_cache (cache_key, synced_lines, plain_lyrics, provider, created_at)
       VALUES ($1, $2::jsonb, $3, $4, NOW())
       ON CONFLICT (cache_key) DO UPDATE SET
         synced_lines = EXCLUDED.synced_lines,
         plain_lyrics = EXCLUDED.plain_lyrics,
         provider = EXCLUDED.provider,
         created_at = NOW()`,
      [cacheKey, JSON.stringify(syncedLines), plainLyrics, provider]
    );
  } catch {
    // Tetap aman di in-memory cache
  }
}

function normalizeAudioMimeType(rawMime = '') {
  const m = String(rawMime || '').split(';')[0].trim().toLowerCase();
  if (/^audio\/(mp4|m4a|mpeg|mp3|webm|ogg|wav|x-wav|flac|aac|opus)$/.test(m)) {
    if (m === 'audio/m4a') return 'audio/mp4';
    if (m === 'audio/mp3') return 'audio/mpeg';
    if (m === 'audio/x-wav') return 'audio/wav';
    return m;
  }
  return 'audio/mp4';
}

async function downloadAudioBufferCapped(targetUrl, maxBytes = AI_LYRICS_MAX_BYTES, timeoutMs = 9000) {
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  const resp = await fetch(targetUrl, {
    method: 'GET',
    signal,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: '*/*',
    },
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`Gagal mengunduh stream audio (HTTP ${resp.status}).`);
  }
  const mimeType = normalizeAudioMimeType(resp.headers.get('content-type') || '');
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      const remaining = maxBytes - total;
      if (buf.length > remaining) {
        chunks.push(buf.subarray(0, remaining));
        total += remaining;
        try { await reader.cancel(); } catch {}
        break;
      }
      chunks.push(buf);
      total += buf.length;
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const buffer = Buffer.concat(chunks, total);
  if (buffer.length < 4096) {
    throw new Error('Data audio terlalu kecil atau kosong untuk ditranskripsi.');
  }
  return { buffer, mimeType };
}

function normalizeTranscribedLines(rawArr) {
  if (!Array.isArray(rawArr)) return [];
  const cleaned = [];
  for (const item of rawArr) {
    const timeVal = Number(item?.time ?? item?.start);
    const textVal = String(item?.text || '').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(timeVal) || timeVal < 0 || !textVal) continue;
    cleaned.push({
      time: Math.round(timeVal * 10) / 10,
      text: textVal.slice(0, 240),
    });
  }
  cleaned.sort((a, b) => a.time - b.time);
  const deduped = [];
  for (const row of cleaned) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text.toLowerCase() === row.text.toLowerCase() && Math.abs(prev.time - row.time) < 1.5) {
      continue;
    }
    deduped.push(row);
  }
  return deduped;
}

async function transcribeWithGroqWhisper(buffer, mimeType) {
  const groqKey = String(process.env.GROQ_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!groqKey) return null;
  const extMap = { 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/flac': 'flac' };
  const ext = extMap[mimeType] || 'm4a';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), `track.${ext}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(14000)
    : undefined;
  const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${groqKey}` },
    body: form,
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  if (!data) return null;
  const segments = Array.isArray(data.segments) ? data.segments : [];
  if (segments.length) {
    return normalizeTranscribedLines(segments.map((s) => ({ time: s.start, text: s.text })));
  }
  const rawText = String(data.text || '').trim();
  if (!rawText) return [];
  return normalizeTranscribedLines(
    rawText.split(/\r?\n/).filter(Boolean).map((line, idx) => ({ time: idx * 3, text: line }))
  );
}

function parseTranscribedJsonResilient(aiText) {
  const raw = String(aiText || '').trim();
  if (!raw) return null;
  // 1. Coba parse JSON array penuh terlebih dahulu
  const fullMatch = raw.match(/\[[\s\S]*\]/);
  if (fullMatch) {
    try {
      const parsed = JSON.parse(fullMatch[0]);
      if (Array.isArray(parsed)) {
        return normalizeTranscribedLines(parsed);
      }
    } catch {
      // Lanjut ke recovery parsial jika JSON terpotong di akhir
    }
  }
  // 2. Deteksi eksplisit array kosong []
  if (/^\s*(?:```(?:json)?\s*)?\[\s*\](?:\s*```)?\s*$/i.test(raw)) {
    return [];
  }
  // 3. Recovery parsial objek {"time": ..., "text": "..."} yang valid jika output terpotong token limit
  const recovered = [];
  const objRe = /\{\s*"time"\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  let m;
  while ((m = objRe.exec(raw)) !== null) {
    try {
      const textDecoded = JSON.parse(`"${m[2]}"`);
      recovered.push({ time: Number(m[1]), text: textDecoded });
    } catch {
      recovered.push({ time: Number(m[1]), text: m[2] });
    }
  }
  if (recovered.length >= 2) {
    return normalizeTranscribedLines(recovered);
  }
  return null;
}

async function resolveVideoIdForTranscribe(req, title, artist, durationSec = 0) {
  const query = [artist, title].filter(Boolean).join(' - ').trim() || title || artist;
  if (!query) return '';
  try {
    const baseUrl = getSelfBaseUrl(req);
    if (baseUrl) {
      const ytm = await fetchJson(
        `${baseUrl}/api/ytm?action=search&q=${encodeURIComponent(query)}`,
        3800
      ).catch(() => null);
      const list = Array.isArray(ytm?.tracks) ? ytm.tracks : [];
      if (list.length) {
        // Pilih videoId yang paling cocok judul & durasinya
        const normQ = normalizeStr(title || query);
        const qToks = tokenize(title || query);
        let best = null;
        let bestSc = -1;
        for (const item of list.slice(0, 6)) {
          const vid = String(item?.videoId || '').trim();
          if (!isValidVideoId(vid)) continue;
          const candT = normalizeStr(item.title || '');
          let sc = 10;
          if (qToks.length) {
            const hits = qToks.filter((tok) => candT.includes(tok)).length;
            sc += Math.round((hits / qToks.length) * 50);
          }
          if (candT && normQ && (candT.includes(normQ) || normQ.includes(candT))) sc += 25;
          const d = Number(item.duration || 0);
          if (durationSec > 30 && d > 0) {
            const diff = Math.abs(d - durationSec);
            if (diff <= 15) sc += 20;
            else if (diff > 60) sc -= 20;
          }
          if (sc > bestSc) {
            bestSc = sc;
            best = vid;
          }
        }
        if (best) return best;
      }
    }
  } catch {}
  try {
    const cands = await searchYouTubeAudioCandidates(title, artist, durationSec, 3500).catch(() => []);
    const valid = (Array.isArray(cands) ? cands : []).find((c) => isValidVideoId(c?.videoId || c?.id));
    if (valid) return String(valid.videoId || valid.id);
  } catch {}
  return '';
}

app.post('/api/lyrics/transcribe', transcribeRateLimiter, async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawTrackId = String(body.trackId || '').trim().slice(0, 120);
  const rawVideoId = String(body.videoId || '').replace(/^(yt_|direct_)/, '').trim();
  let videoId = isValidVideoId(rawVideoId) ? rawVideoId : '';
  const audioUrl = String(body.audioUrl || '').trim();
  const title = String(body.title || '').trim().slice(0, 160);
  const artist = String(body.artist || '').trim().slice(0, 120);
  const durationSec = Math.max(0, Math.round(Number(body.duration) || 0));
  const force = Boolean(body.force);
  const audioRefine = Boolean(body.audioRefine);
  const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';

  const normMetaKey = (title || artist)
    ? `meta_${normalizeStr(`${artist} ${title}`).slice(0, 80).replace(/\s+/g, '_')}`
    : '';
  const primaryCacheKey = videoId ? `vid_${videoId}` : (rawTrackId ? `trk_${rawTrackId}` : normMetaKey);

  // Langkah 1: Cek Cache (kecuali force === true atau audioRefine === true)
  if (!force && !audioRefine) {
    const keysToTry = Array.from(new Set([primaryCacheKey, normMetaKey].filter(Boolean)));
    for (const k of keysToTry) {
      const cached = await getAiLyricsFromCache(k);
      if (cached && (cached.syncedLines.length || cached.plainLyrics)) {
        return res.json({
          ok: true,
          cached: true,
          mode: cached.syncedLines.length ? 'synced' : 'plain',
          source: 'AI Transkrip (Cached)',
          provider: cached.provider || 'gemini-audio',
          syncedLines: cached.syncedLines,
          plainLyrics: cached.plainLyrics,
        });
      }
    }
  }

  // Jalur Khusus Phase-2 Auto-Refine Timestamp (dengar audio YouTube asli di latar belakang!)
  if (audioRefine && !audioBase64) {
    if (!videoId && (title || artist)) {
      videoId = await resolveVideoIdForTranscribe(req, title, artist, durationSec);
    }
    if (!videoId) {
      return res.json({ ok: false, skipped: true, reason: 'no_video_id' });
    }
    const refCacheKey = `vid_${videoId}`;
    const existing = await getAiLyricsFromCache(refCacheKey);
    if (existing && existing.provider === 'gemini-audio-refined' && existing.syncedLines.length) {
      return res.json({
        ok: true,
        cached: true,
        refined: true,
        mode: 'synced',
        source: 'AI Audio Sync',
        provider: 'gemini-audio-refined',
        syncedLines: existing.syncedLines,
        plainLyrics: existing.plainLyrics,
      });
    }
    const refinePrompt = buildStrictNativeLangLrcPrompt(title, artist, durationSec, true);
    const refText = await callGeminiPayload(
      {
        contents: [
          {
            role: 'user',
            parts: [
              { file_data: { file_uri: `https://www.youtube.com/watch?v=${videoId}` } },
              { text: refinePrompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 3072,
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
      22000,
      ['gemini-3.1-flash-lite', 'gemini-3-flash-preview']
    );
    if (!refText) {
      return res.json({ ok: false, skipped: true, reason: 'refine_unavailable' });
    }
    let refLang = '';
    let refLangName = '';
    const refLines = [];
    for (const rawL of String(refText).split(/\r?\n/)) {
      const p = parseLrcStreamLine(rawL);
      if (!p) continue;
      if (p.type === 'lang') {
        refLang = p.code;
        refLangName = p.name;
      } else if (p.type === 'line') {
        refLines.push({ time: p.time, text: p.text });
      }
    }
    if (refLines.length < 3) {
      return res.json({ ok: false, skipped: true, reason: 'too_few_lines' });
    }
    refLines.sort((a, b) => a.time - b.time);
    const refPlain = refLines.map((l) => l.text).join('\n');
    await saveAiLyricsToCache(refCacheKey, refLines, refPlain, 'gemini-audio-refined');
    if (normMetaKey && normMetaKey !== refCacheKey) {
      await saveAiLyricsToCache(normMetaKey, refLines, refPlain, 'gemini-audio-refined');
    }
    return res.json({
      ok: true,
      refined: true,
      mode: 'synced',
      source: 'AI Audio Sync',
      provider: 'gemini-audio-refined',
      detectedLang: refLang,
      detectedLangName: refLangName,
      syncedLines: refLines,
      plainLyrics: refPlain,
    });
  }

  const hasGroq = Boolean(String(process.env.GROQ_API_KEY || '').trim());
  const hasGemini = Boolean(String(process.env.GEMINI_API_KEY || '').trim());
  if (!hasGroq && !hasGemini) {
    return res.status(503).json({
      ok: false,
      error: 'Layanan transkripsi AI belum dikonfigurasi di server (GEMINI_API_KEY tidak tersedia).',
    });
  }

  // Langkah 2A: Jika bukan file lokal & videoId belum dikirim, otomatis cari videoId exact dari YouTube Music
  if (!audioBase64 && !videoId && (title || artist)) {
    videoId = await resolveVideoIdForTranscribe(req, title, artist, durationSec);
  }

  const cacheKey = videoId ? `vid_${videoId}` : (primaryCacheKey || normMetaKey);

  // Cek cache lagi jika videoId baru saja ter-resolve
  if (!force && videoId && cacheKey !== primaryCacheKey) {
    const cachedVid = await getAiLyricsFromCache(cacheKey);
    if (cachedVid && (cachedVid.syncedLines.length || cachedVid.plainLyrics)) {
      return res.json({
        ok: true,
        cached: true,
        mode: cachedVid.syncedLines.length ? 'synced' : 'plain',
        source: 'AI Transkrip (Cached)',
        provider: cachedVid.provider || 'gemini-audio',
        syncedLines: cachedVid.syncedLines,
        plainLyrics: cachedVid.plainLyrics,
      });
    }
  }

  // Langkah 2B: Cek lirik resmi YouTube Music untuk videoId exact tersebut (super cepat & 100% sesuai lagu)
  if (!audioBase64 && !force && videoId) {
    try {
      const baseUrl = getSelfBaseUrl(req);
      if (baseUrl) {
        const ytmLyr = await fetchJson(
          `${baseUrl}/api/ytm?action=lyrics&videoId=${encodeURIComponent(videoId)}`,
          2600
        ).catch(() => null);
        const ytmPlain = String(ytmLyr?.lyrics || '').trim();
        if (ytmPlain.length >= 40) {
          const autoSynced = autoSyncPlainLyrics(ytmPlain, durationSec || 210);
          if (autoSynced.length) {
            await saveAiLyricsToCache(cacheKey, autoSynced, ytmPlain, 'ytm-official');
            return res.json({
              ok: true,
              cached: false,
              mode: 'synced',
              source: 'YouTube Music Official',
              provider: 'ytm-official',
              syncedLines: autoSynced,
              plainLyrics: ytmPlain,
            });
          }
        }
      }
    } catch {}
  }

  let syncedLines = null;
  let providerUsed = '';
  const contextHint = [title ? `Judul: ${title}` : '', artist ? `Artis: ${artist}` : ''].filter(Boolean).join(' | ');
  const strictAudioPrompt =
    'Dengarkan vokal nyanyian pada audio/video lagu ini dari awal sampai akhir. Transkripsikan HANYA lirik yang benar-benar dinyanyikan secara akurat sesuai bahasa aslinya beserta perkiraan waktu mulai (dalam detik) dalam format JSON array valid: [{"time": 12.5, "text": "baris lirik"}]. Abaikan bagian musik instrumental tanpa vokal. Jika lagu benar-benar murni instrumental tanpa vokal nyanyian sama sekali, balas []. Balas HANYA JSON array valid tanpa markdown.' +
    (contextHint ? `\nInfo referensi lagu (hanya untuk akurasi ejaan/bahasa, transkripsikan persis yang dinyanyikan di audio): ${contextHint}` : '');

  // Langkah 3A (UTAMA untuk lagu online): Gemini mendengarkan langsung YouTube videoId (0 blokir IP Vercel, full song!)
  if (!audioBase64 && videoId && hasGemini) {
    const ytAiText = await callGeminiPayload(
      {
        contents: [
          {
            role: 'user',
            parts: [
              {
                file_data: {
                  file_uri: `https://www.youtube.com/watch?v=${videoId}`,
                },
              },
              { text: strictAudioPrompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
        },
      },
      22000,
      ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-flash-lite-latest']
    );

    if (ytAiText) {
      const parsedYt = parseTranscribedJsonResilient(ytAiText);
      if (Array.isArray(parsedYt)) {
        syncedLines = parsedYt;
        providerUsed = 'gemini-youtube-audio';
      }
    }
  }

  // Langkah 3B (File Lokal Base64 atau Fallback Unduh Audio Buffer <= 3.8 MB)
  if (syncedLines === null) {
    let audioBuffer = null;
    let safeMime = normalizeAudioMimeType(body.mimeType || 'audio/mp4');

    if (audioBase64) {
      const cleanedB64 = audioBase64.includes(',') ? audioBase64.slice(audioBase64.indexOf(',') + 1) : audioBase64;
      const decoded = Buffer.from(cleanedB64, 'base64');
      if (decoded.length > AI_LYRICS_MAX_BYTES) {
        return res.status(413).json({
          ok: false,
          error: 'Ukuran potongan audio lokal melebihi batas maksimum 3.8 MB.',
        });
      }
      if (decoded.length < 2048) {
        return res.status(400).json({ ok: false, error: 'Data audio lokal kosong atau tidak valid.' });
      }
      audioBuffer = decoded;
    } else {
      let streamUrl = '';
      if (videoId) {
        let streamInfo = await raceDirectAudioWithPython(req, videoId, 3200, 'low').catch(() => null);
        if (!streamInfo?.url) {
          streamInfo = await fetchDirectStreamFromIosInnertube(videoId, 3200, false, 'low').catch(() => null);
        }
        if (streamInfo?.url && isSafePublicUrl(streamInfo.url)) {
          streamUrl = streamInfo.url;
          if (streamInfo.mimeType) safeMime = normalizeAudioMimeType(streamInfo.mimeType);
        }
      }
      if (!streamUrl && audioUrl && isSafePublicUrl(audioUrl, true)) {
        streamUrl = audioUrl;
      }
      if (streamUrl) {
        try {
          const downloaded = await downloadAudioBufferCapped(streamUrl, AI_LYRICS_MAX_BYTES, 9000);
          audioBuffer = downloaded.buffer;
          if (downloaded.mimeType) safeMime = downloaded.mimeType;
        } catch {
          audioBuffer = null;
        }
      }
    }

    if (audioBuffer) {
      if (hasGroq) {
        try {
          const groqLines = await transcribeWithGroqWhisper(audioBuffer, safeMime);
          if (Array.isArray(groqLines)) {
            syncedLines = groqLines;
            providerUsed = 'groq-whisper';
          }
        } catch {}
      }

      if (syncedLines === null && hasGemini) {
        const aiText = await callGeminiPayload(
          {
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inline_data: {
                      mime_type: safeMime,
                      data: audioBuffer.toString('base64'),
                    },
                  },
                  { text: strictAudioPrompt },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4096,
            },
          },
          20000,
          ['gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-flash-lite-latest']
        );

        if (aiText) {
          const parsedBuf = parseTranscribedJsonResilient(aiText);
          if (Array.isArray(parsedBuf)) {
            syncedLines = parsedBuf;
            providerUsed = 'gemini-audio';
          }
        }
      }
    }
  }

  // Langkah 3C (Jaring Pengaman Terakhir jika stream audio tak terjangkau sama sekali, khusus lagu berjudul & berartis jelas)
  if (syncedLines === null && !audioBase64 && hasGemini && title && title.length >= 2) {
    const durTarget = durationSec > 30 ? durationSec : 210;
    const exactMetaPrompt = `Berikan lirik lagu ASLI dan AKURAT (bukan terjemahan, sesuai bahasa aslinya) untuk lagu:\nJudul: "${title}"\nArtis: "${artist || 'Unknown'}"\nDurasi: ${durTarget} detik.\nFormat output WAJIB JSON array valid berisi baris lirik dengan estimasi timestamp mulai (detik) dari awal sampai akhir lagu: [{"time": 12.0, "text": "baris lirik"}]. Jika lagu ini murni instrumental tanpa vokal, balas []. Balas HANYA JSON array tanpa markdown atau penjelasan.`;
    const metaText = await callGeminiPayload(
      {
        contents: [{ role: 'user', parts: [{ text: exactMetaPrompt }] }],
        generationConfig: { temperature: 0.15, maxOutputTokens: 3072 },
      },
      12000,
      ['gemini-3.1-flash-lite', 'gemini-3-flash-preview']
    );
    if (metaText) {
      const parsedMeta = parseTranscribedJsonResilient(metaText);
      if (Array.isArray(parsedMeta)) {
        syncedLines = parsedMeta;
        providerUsed = 'gemini-lyrics-match';
      }
    }
  }

  if (syncedLines === null) {
    return res.status(502).json({
      ok: false,
      error: 'AI belum berhasil menyusun lirik saat ini. Silakan coba lagi sebentar.',
    });
  }

  // Langkah 4: Simpan Cache & Respon
  if (!syncedLines.length) {
    return res.json({
      ok: true,
      mode: 'none',
      instrumental: true,
      provider: providerUsed || 'gemini-audio',
      message: 'Tidak terdeteksi vokal nyanyian pada lagu ini.',
    });
  }

  const plainLyrics = syncedLines.map((l) => l.text).join('\n');
  if (cacheKey) {
    await saveAiLyricsToCache(cacheKey, syncedLines, plainLyrics, providerUsed || 'gemini-audio');
  }
  if (normMetaKey && normMetaKey !== cacheKey) {
    await saveAiLyricsToCache(normMetaKey, syncedLines, plainLyrics, providerUsed || 'gemini-audio');
  }

  return res.json({
    ok: true,
    cached: false,
    mode: 'synced',
    source: 'AI Audio Sync',
    provider: providerUsed || 'gemini-audio',
    syncedLines,
    plainLyrics,
  });
});

// --- 11B-3. ULTRA-FAST STREAMING AI LYRICS (~1 DETIK BARIS PERTAMA + AUTO DETEKSI BAHASA ASLI) ---
function parseLrcStreamLine(rawLine) {
  const line = String(rawLine || '').trim();
  if (!line) return null;
  const langMatch = line.match(/^LANG\s*:\s*([a-z]{2,3})\s*(?:\|\s*(.+))?$/i);
  if (langMatch) {
    return {
      type: 'lang',
      code: langMatch[1].toLowerCase(),
      name: String(langMatch[2] || langMatch[1]).trim().slice(0, 40),
    };
  }
  if (/^INSTRUMENTAL\b/i.test(line)) {
    return { type: 'instrumental' };
  }
  const m = line.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.+)$/);
  if (m) {
    const mins = parseInt(m[1], 10) || 0;
    const secs = parseInt(m[2], 10) || 0;
    const frac = parseInt(String(m[3] || '0').padEnd(3, '0').slice(0, 3), 10) || 0;
    const time = Math.round((mins * 60 + secs + frac / 1000) * 10) / 10;
    const text = String(m[4] || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (text && !/^[\[\(\{].*[\]\)\}]$/.test(text)) {
      return { type: 'line', time, text };
    }
  }
  return null;
}

function buildStrictNativeLangLrcPrompt(title, artist, durationSec, isAudioInput = false) {
  const dur = durationSec > 20 ? durationSec : 210;
  const headerRule =
    'ATURAN MUTLAK BAHASA & AKURASI:\n' +
    '1. Identifikasi BAHASA ASLI lagu ini secara akurat berdasarkan judul, artis, asal musik, dan vokalnya.\n' +
    '2. DILARANG KERAS menerjemahkan ke Bahasa Inggris atau bahasa lain!\n' +
    '   - Lagu Indonesia / Pop Indo / Dangdut / Koplo -> WAJIB Bahasa Indonesia asli.\n' +
    '   - Lagu Jawa / Sunda -> WAJIB Bahasa Jawa / Sunda asli.\n' +
    '   - Lagu Arab / Sholawat / Nasyid / Khaleeji / Pop Arab -> WAJIB aksara & Bahasa Arab asli (العربية).\n' +
    '   - Lagu Jepang / Anime / J-Pop -> WAJIB Kanji/Kana (日本語).\n' +
    '   - Lagu Korea / K-Pop -> WAJIB Hangul (한국어).\n' +
    '   - Lagu Mandarin -> WAJIB aksara Han (中文).\n' +
    '   - Lagu Melayu / Inggris / Spanyol / Prancis / Turki / Hindi / Rusia / Thailand -> WAJIB bahasa & aksara aslinya.\n' +
    '3. Format output WAJIB:\n' +
    '   - Baris pertama PERSIS: LANG: <kode_iso2> | <Nama Bahasa Asli> (contoh: LANG: ar | العربية atau LANG: id | Indonesia atau LANG: en | English)\n' +
    '   - Baris berikutnya PERSIS format LRC: [mm:ss.x] teks lirik asli\n' +
    '   - Jika lagu benar-benar murni instrumental tanpa vokal manusia sama sekali, tulis hanya: INSTRUMENTAL\n' +
    '   - JANGAN tulis markdown (```), JANGAN tulis penjelasan atau nomor urut.';

  if (isAudioInput) {
    return (
      `Dengarkan vokal nyanyian pada audio/video lagu ini dari awal sampai akhir.\n` +
      `Info lagu (hanya referensi bahasa/ejaan, transkripsikan persis vokal yang dinyanyikan): Judul="${title || '-'}", Artis="${artist || '-'}", Durasi=${dur} detik.\n` +
      headerRule
    );
  }
  return (
    `Berikan lirik ASLI lengkap tersinkronisasi untuk lagu:\n` +
    `Judul: "${title}"\nArtis: "${artist || 'Unknown'}"\nDurasi: ${dur} detik.\n` +
    headerRule
  );
}

app.post('/api/lyrics/transcribe-stream', transcribeRateLimiter, async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const rawTrackId = String(body.trackId || '').trim().slice(0, 120);
  const rawVideoId = String(body.videoId || '').replace(/^(yt_|direct_)/, '').trim();
  let videoId = isValidVideoId(rawVideoId) ? rawVideoId : '';
  const title = String(body.title || '').trim().slice(0, 160);
  const artist = String(body.artist || '').trim().slice(0, 120);
  const durationSec = Math.max(0, Math.round(Number(body.duration) || 0));
  const force = Boolean(body.force);
  const audioMode = Boolean(body.audioMode);
  const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';

  const normMetaKey = (title || artist)
    ? `meta_${normalizeStr(`${artist} ${title}`).slice(0, 80).replace(/\s+/g, '_')}`
    : '';
  const primaryCacheKey = videoId ? `vid_${videoId}` : (rawTrackId ? `trk_${rawTrackId}` : normMetaKey);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const sendEvent = (obj) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  // 1. Cek Cache Instan (< 50ms!)
  if (!force) {
    const keysToTry = Array.from(new Set([primaryCacheKey, normMetaKey].filter(Boolean)));
    for (const k of keysToTry) {
      const cached = await getAiLyricsFromCache(k);
      if (cached && (cached.syncedLines.length || cached.plainLyrics)) {
        sendEvent({
          type: 'done',
          ok: true,
          cached: true,
          mode: cached.syncedLines.length ? 'synced' : 'plain',
          source: 'AI Transkrip (Cached)',
          provider: cached.provider || 'gemini-fast',
          syncedLines: cached.syncedLines,
          plainLyrics: cached.plainLyrics,
        });
        return res.end();
      }
    }
  }

  const apiKey = String(process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!apiKey) {
    sendEvent({ type: 'error', error: 'GEMINI_API_KEY belum tersedia di server.' });
    return res.end();
  }

  // Deteksi apakah perlu dengar audio langsung (File Lokal, mode audioMode/Transkrip Ulang, atau lagu DJ/Mashup/Nonstop)
  const isDjOrMashup = /\b(dj|mashup|nonstop|jedag\s*jedug|full\s*bass|breakbeat|medley)\b/i.test(title);
  const needDirectAudio = Boolean(audioBase64 || audioMode || isDjOrMashup);

  const parts = [];
  if (audioBase64) {
    const cleanedB64 = audioBase64.includes(',') ? audioBase64.slice(audioBase64.indexOf(',') + 1) : audioBase64;
    const decoded = Buffer.from(cleanedB64, 'base64');
    if (decoded.length > AI_LYRICS_MAX_BYTES) {
      sendEvent({ type: 'error', error: 'Ukuran potongan audio lokal melebihi batas maksimum 3.8 MB.' });
      return res.end();
    }
    const safeMime = normalizeAudioMimeType(body.mimeType || 'audio/mp4');
    parts.push({ inline_data: { mime_type: safeMime, data: decoded.toString('base64') } });
    parts.push({ text: buildStrictNativeLangLrcPrompt(title, artist, durationSec, true) });
  } else if (needDirectAudio) {
    if (!videoId && (title || artist)) {
      videoId = await resolveVideoIdForTranscribe(req, title, artist, durationSec);
    }
    if (videoId) {
      parts.push({ file_data: { file_uri: `https://www.youtube.com/watch?v=${videoId}` } });
      parts.push({ text: buildStrictNativeLangLrcPrompt(title, artist, durationSec, true) });
    } else {
      parts.push({ text: buildStrictNativeLangLrcPrompt(title, artist, durationSec, false) });
    }
  } else {
    // ULTRA-FAST 1-SECOND STREAMING PATH: langsung stream LRC akurat dalam bahasa asli!
    parts.push({ text: buildStrictNativeLangLrcPrompt(title, artist, durationSec, false) });
  }

  const streamModels = needDirectAudio
    ? ['gemini-3.1-flash-lite', 'gemini-3-flash-preview']
    : ['gemini-3-flash-preview', 'gemini-3.1-flash-lite'];

  let detectedLang = '';
  let detectedLangName = '';
  let isInstrumental = false;
  const collectedLines = [];
  let succeeded = false;

  for (const model of streamModels) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), needDirectAudio ? 24000 : 14000);
    req.on('close', () => controller.abort());
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 2048,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        }
      );

      if (!resp.ok || !resp.body) {
        clearTimeout(timer);
        continue;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let sseBuf = '';
      let textLineBuf = '';

      const processCompletedLine = (rawL) => {
        const parsed = parseLrcStreamLine(rawL);
        if (!parsed) return;
        if (parsed.type === 'lang') {
          detectedLang = parsed.code;
          detectedLangName = parsed.name;
          sendEvent({ type: 'meta', detectedLang, detectedLangName });
        } else if (parsed.type === 'instrumental') {
          isInstrumental = true;
        } else if (parsed.type === 'line') {
          const prev = collectedLines[collectedLines.length - 1];
          if (prev && prev.text.toLowerCase() === parsed.text.toLowerCase() && Math.abs(prev.time - parsed.time) < 1.5) {
            return;
          }
          collectedLines.push({ time: parsed.time, text: parsed.text });
          sendEvent({ type: 'line', time: parsed.time, text: parsed.text, count: collectedLines.length });
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
        const events = sseBuf.split('\n');
        sseBuf = events.pop() || '';
        for (const evLine of events) {
          if (!evLine.startsWith('data:')) continue;
          const jsonStr = evLine.slice(5).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const payload = JSON.parse(jsonStr);
            const cParts = payload?.candidates?.[0]?.content?.parts;
            if (!Array.isArray(cParts)) continue;
            const chunkTxt = cParts
              .filter((p) => typeof p?.text === 'string' && !p.thought)
              .map((p) => p.text)
              .join('');
            if (!chunkTxt) continue;
            textLineBuf += chunkTxt;
            const splitLines = textLineBuf.split(/\r?\n/);
            textLineBuf = splitLines.pop() || '';
            for (const l of splitLines) processCompletedLine(l);
          } catch {}
        }
      }
      if (textLineBuf.trim()) processCompletedLine(textLineBuf);
      clearTimeout(timer);
      if (collectedLines.length > 0 || isInstrumental) {
        succeeded = true;
        break;
      }
    } catch {
      clearTimeout(timer);
    }
  }

  if (!succeeded) {
    sendEvent({ type: 'error', error: 'AI belum berhasil menyusun lirik saat ini. Silakan coba lagi.' });
    return res.end();
  }

  if (isInstrumental || !collectedLines.length) {
    sendEvent({
      type: 'done',
      ok: true,
      mode: 'none',
      instrumental: true,
      detectedLang,
      detectedLangName,
      message: 'Tidak terdeteksi vokal nyanyian pada lagu ini.',
    });
    return res.end();
  }

  collectedLines.sort((a, b) => a.time - b.time);
  const plainLyrics = collectedLines.map((l) => l.text).join('\n');
  const cacheKey = videoId ? `vid_${videoId}` : (primaryCacheKey || normMetaKey);
  const providerTag = needDirectAudio ? 'gemini-audio-stream' : 'gemini-fast-stream';

  if (cacheKey) {
    await saveAiLyricsToCache(cacheKey, collectedLines, plainLyrics, providerTag);
  }
  if (normMetaKey && normMetaKey !== cacheKey) {
    await saveAiLyricsToCache(normMetaKey, collectedLines, plainLyrics, providerTag);
  }

  sendEvent({
    type: 'done',
    ok: true,
    cached: false,
    mode: 'synced',
    source: 'AI Audio Sync',
    provider: providerTag,
    detectedLang,
    detectedLangName,
    syncedLines: collectedLines,
    plainLyrics,
  });
  return res.end();
});

// --- 11C. IMPORT PLAYLIST PUBLIK SPOTIFY & YOUTUBE (POST /api/playlist/import) ---
function normalizeImportedTrack(raw, fallbackCover = '/icon-192.png') {
  const title = String(raw?.title || '').trim();
  const artistName = String(raw?.artist || raw?.artistName || 'Unknown Artist').trim() || 'Unknown Artist';
  if (!title) return null;
  const videoId = isValidVideoId(raw?.videoId) ? String(raw.videoId) : '';
  const cover = String(raw?.cover || fallbackCover || '/icon-192.png').trim() || '/icon-192.png';
  const duration = Math.max(0, Math.round(Number(raw?.duration) || 0));
  const id = videoId
    ? `ytm_${videoId}`
    : `imp_${crypto.createHash('md5').update(`${artistName.toLowerCase()}::${title.toLowerCase()}`).digest('hex').slice(0, 12)}`;
  return {
    id,
    videoId: videoId || undefined,
    title,
    artist: { name: artistName },
    album: {
      title: String(raw?.album || 'Imported Playlist').trim() || 'Imported Playlist',
      cover_big: cover,
      cover_medium: cover,
      cover_small: cover,
    },
    cover,
    duration: duration || 210,
    source: videoId ? 'youtube' : (raw?.source || 'spotify'),
  };
}

async function importYouTubePlaylist(req, playlistId) {
  // 1. Primary: Python ytmusicapi ?action=playlist
  try {
    const py = await callYtmPython(req, { action: 'playlist', playlistId, limit: '100' }, 5500);
    if (py?.ok && Array.isArray(py.tracks) && py.tracks.length) {
      const tracks = py.tracks.map((t) => normalizeImportedTrack(t, py.cover)).filter(Boolean);
      if (tracks.length) {
        return {
          ok: true,
          provider: 'youtube',
          name: String(py.name || 'YouTube Playlist').trim(),
          cover: py.cover || tracks[0].cover || '/icon-192.png',
          tracks,
        };
      }
    }
  } catch {
    // fallback to Piped / Invidious
  }

  // 2. Fallback: Race healthy Piped & Invidious playlist APIs
  const pipedHosts = getHealthyHostsSorted(PIPED_INSTANCES).slice(0, 3);
  const invHosts = getHealthyHostsSorted(INVIDIOUS_INSTANCES).slice(0, 3);
  const tasks = [
    ...pipedHosts.map(async (host) => {
      const data = await fetchJson(`${host}/playlists/${encodeURIComponent(playlistId)}`, 3600);
      const streams = Array.isArray(data?.relatedStreams) ? data.relatedStreams : [];
      if (!streams.length) throw new Error('Empty Piped playlist');
      const tracks = streams
        .slice(0, 100)
        .map((it) => {
          const m = String(it?.url || '').match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          const vid = m ? m[1] : '';
          if (!vid) return null;
          return normalizeImportedTrack({
            videoId: vid,
            title: it.title,
            artist: it.uploaderName || 'YouTube',
            duration: Number(it.duration || 0),
            cover: it.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            source: 'youtube',
          });
        })
        .filter(Boolean);
      if (!tracks.length) throw new Error('No valid Piped tracks');
      return {
        ok: true,
        provider: 'youtube',
        name: String(data?.name || 'YouTube Playlist').trim(),
        cover: data?.thumbnailUrl || tracks[0].cover || '/icon-192.png',
        tracks,
      };
    }),
    ...invHosts.map(async (host) => {
      const data = await fetchJson(`${host}/api/v1/playlists/${encodeURIComponent(playlistId)}`, 3600);
      const videos = Array.isArray(data?.videos) ? data.videos : [];
      if (!videos.length) throw new Error('Empty Invidious playlist');
      const tracks = videos
        .slice(0, 100)
        .map((it) => {
          const vid = String(it?.videoId || '').trim();
          if (!isValidVideoId(vid)) return null;
          return normalizeImportedTrack({
            videoId: vid,
            title: it.title,
            artist: it.author || 'YouTube',
            duration: Number(it.lengthSeconds || 0),
            cover: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            source: 'youtube',
          });
        })
        .filter(Boolean);
      if (!tracks.length) throw new Error('No valid Invidious tracks');
      return {
        ok: true,
        provider: 'youtube',
        name: String(data?.title || 'YouTube Playlist').trim(),
        cover: data?.playlistThumbnail || tracks[0].cover || '/icon-192.png',
        tracks,
      };
    }),
  ];
  return Promise.any(tasks);
}

async function importSpotifyPublicPlaylist(playlistId) {
  const embedUrl = `https://open.spotify.com/embed/playlist/${encodeURIComponent(playlistId)}`;
  const resp = await fetch(embedUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(6500),
  });
  if (!resp.ok) throw new Error(`Spotify embed HTTP ${resp.status}`);
  const html = await resp.text();

  let entity = null;
  const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const parsed = JSON.parse(nextDataMatch[1]);
      entity =
        parsed?.props?.pageProps?.state?.data?.entity ||
        parsed?.props?.pageProps?.state?.data?.playlist ||
        null;
    } catch {
      // try fallback regex
    }
  }
  if (!entity) {
    const resMatch = html.match(/Spotify\.Entity\s*=\s*(\{[\s\S]*?\});/i);
    if (resMatch) {
      try {
        entity = JSON.parse(resMatch[1]);
      } catch {
        entity = null;
      }
    }
  }
  if (!entity) throw new Error('Playlist Spotify tidak ditemukan atau bersifat privat.');

  const name = String(entity.name || entity.title || 'Spotify Playlist').trim();
  const coverList = entity.coverArt?.sources || entity.images || [];
  const plCover = String(coverList[0]?.url || '/icon-192.png').trim();
  const rawList = Array.isArray(entity.trackList)
    ? entity.trackList
    : Array.isArray(entity.tracks?.items)
      ? entity.tracks.items.map((x) => x.track || x)
      : [];

  const tracks = rawList
    .slice(0, 100)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const title = String(item.title || item.name || '').trim();
      const artist =
        String(item.subtitle || '').trim() ||
        (Array.isArray(item.artists) ? item.artists.map((a) => a?.name).filter(Boolean).join(', ') : '') ||
        'Spotify Artist';
      const durMs = Number(item.duration || item.duration_ms || 0);
      const duration = durMs > 10000 ? Math.round(durMs / 1000) : Math.round(durMs);
      const cov =
        item.album?.images?.[0]?.url ||
        item.images?.[0]?.url ||
        plCover;
      return normalizeImportedTrack(
        {
          title,
          artist,
          album: item.album?.name || name,
          duration: duration || 210,
          cover: cov,
          source: 'spotify',
        },
        plCover
      );
    })
    .filter(Boolean);

  if (!tracks.length) {
    throw new Error('Tidak ada lagu publik yang dapat diekstrak dari playlist Spotify ini.');
  }
  return {
    ok: true,
    provider: 'spotify',
    name,
    cover: plCover,
    tracks,
  };
}

const ALLOWED_PLAYLIST_IMPORT_HOSTS = new Set([
  'open.spotify.com',
  'play.spotify.com',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

app.post('/api/playlist/import', async (req, res) => {
  const rawUrl = String(req.body?.url || '').trim();
  if (!rawUrl || rawUrl.length > 600) {
    return res.status(400).json({ ok: false, error: 'Masukkan tautan playlist Spotify atau YouTube yang valid.' });
  }

  try {
    // Strict Anti-SSRF Domain Validation: hanya domain resmi Spotify & YouTube/YTM (atau spotify:playlist: URI)
    const isSpotifyUri = /^spotify:playlist:[a-zA-Z0-9]{10,40}$/i.test(rawUrl);
    let parsedImportUrl = null;
    if (!isSpotifyUri) {
      try {
        parsedImportUrl = new URL(rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https://${rawUrl}`);
      } catch {
        return res.status(400).json({ ok: false, error: 'Format URL tidak valid.' });
      }
      const host = parsedImportUrl.hostname.toLowerCase();
      if ((parsedImportUrl.protocol !== 'https:' && parsedImportUrl.protocol !== 'http:') || !ALLOWED_PLAYLIST_IMPORT_HOSTS.has(host)) {
        return res.status(400).json({
          ok: false,
          error: 'Hanya domain resmi Spotify (open.spotify.com) dan YouTube/YouTube Music yang diizinkan.',
        });
      }
    }

    // 1. Cek Spotify Playlist URL: open.spotify.com/playlist/{id} atau spotify:playlist:{id}
    const spMatch = rawUrl.match(/(?:(?:open|play)\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\/|spotify:playlist:)([a-zA-Z0-9]{10,40})/i);
    if (spMatch) {
      const result = await importSpotifyPublicPlaylist(spMatch[1]);
      return res.json(result);
    }

    // 2. Cek YouTube / YouTube Music Playlist URL: ?list=... atau &list=...
    const ytListId = parsedImportUrl ? String(parsedImportUrl.searchParams.get('list') || '').trim() : '';
    if (ytListId && /^[a-zA-Z0-9_-]{8,90}$/.test(ytListId)) {
      const result = await importYouTubePlaylist(req, ytListId);
      return res.json(result);
    }

    return res.status(400).json({
      ok: false,
      error: 'Format tautan tidak dikenali. Tempel tautan playlist publik Spotify (open.spotify.com/playlist/...) atau YouTube/YTM (?list=...).',
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      error: err?.message || 'Gagal mengimpor playlist. Pastikan playlist bersifat publik.',
    });
  }
});

// =========================================================================
// 12. AI ENDPOINTS (RATE LIMIT 15 REQ/MIN/IP + TIMEOUT 7000ms + SMART FALLBACK)
// =========================================================================

app.use('/api/ai', aiRateLimiterMiddleware);

app.post('/api/ai/copilot', async (req, res) => {
  const message = String(req.body?.message || req.body?.prompt || '').trim();
  const currentTrack = req.body?.currentTrack || null;
  if (!message) return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });

  const lower = message.toLowerCase();
  let action = null;
  if (/\b(8d|audio 8d)\b/i.test(lower)) {
    action = { type: 'SET_FX', value: '8d' };
  } else if (/\b(slowed|reverb)\b/i.test(lower)) {
    action = { type: 'SET_FX', value: 'slowed' };
  } else if (/\b(nightcore|sped up)\b/i.test(lower)) {
    action = { type: 'SET_FX', value: 'nightcore' };
  } else if (/\b(karaoke|hapus vokal|vocal remover)\b/i.test(lower)) {
    action = { type: 'TOGGLE_KARAOKE', value: !/\b(matikan|off)\b/i.test(lower) };
  } else if (/\b(hujan|rain|kafe|cafe|ombak|ocean|api unggun|fireplace|lofi|crackle)\b/i.test(lower) && /\b(nyalain|nyalakan|aktifkan|ambient|suara|turn on)\b/i.test(lower)) {
    let kind = 'rain';
    if (/kafe|cafe/i.test(lower)) kind = 'cafe';
    else if (/ombak|ocean/i.test(lower)) kind = 'ocean';
    else if (/api|fireplace/i.test(lower)) kind = 'fireplace';
    else if (/lofi|crackle/i.test(lower)) kind = 'lofi';
    const pctMatch = lower.match(/(\d{1,3})\s*%/);
    action = { type: 'SET_AMBIENT', value: { kind, volume: pctMatch ? Math.min(100, Number(pctMatch[1])) : 50 } };
  } else if (/\b(timer|tidur|sleep)\b/i.test(lower)) {
    const minMatch = lower.match(/(\d{1,3})\s*(menit|min|minute)/i);
    action = { type: 'SET_SLEEP', value: minMatch ? Number(minMatch[1]) : 15 };
  }

  // Tentukan kata kunci pencarian lagu yang relevan dari pesan pengguna
  let searchQuery = message
    .replace(/\b(putar|mainkan|play|cari|lagu|rekomendasi|buatkan|playlist|dong|tolong|yang|cocok|untuk|suasana|saat)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/galau|sedih|patah hati|hujan/i.test(lower)) searchQuery = 'Tulus Mahalini Hindia Nadin Amizah galau';
  else if (/semangat|gym|olahraga|lari|workout/i.test(lower)) searchQuery = 'The Weeknd Dua Lipa Imagine Dragons upbeat workout';
  else if (/fokus|belajar|kerja|coding|lofi/i.test(lower)) searchQuery = 'lofi chill study beats NIKI Joji';
  else if (/tidur|malam|santai|chill/i.test(lower)) searchQuery = 'acoustic chill night Coldplay Cigarettes After Sex';
  else if (searchQuery.length < 2) searchQuery = currentTrack?.artist || 'top hits indonesia';

  if (!action && /\b(putar|mainkan|play)\b/i.test(lower) && searchQuery) {
    action = { type: 'PLAY_SEARCH', value: searchQuery };
  }

  const contextStr = currentTrack
    ? `Lagu yang sedang diputar: "${currentTrack.title}" oleh ${currentTrack.artist?.name || currentTrack.artist || 'Artis'}.`
    : 'Belum ada lagu yang diputar.';

  const [aiReply, searchRes] = await Promise.all([
    callGeminiText(
      `Kamu adalah SpotyFlow AI Copilot, asisten musik ramah berbahasa Indonesia. ${contextStr}\nPertanyaan pengguna: ${message}\nJawab ringkas (maksimal 3 kalimat) dan rekomendasikan lagu yang langsung bisa diputar di bawah pesan ini.`,
      7000
    ),
    runMultiSourceSearch(searchQuery, 'all', 8, 0).catch(() => ({ tracks: [] })),
  ]);

  const tracks = Array.isArray(searchRes?.tracks) ? searchRes.tracks.slice(0, 6) : [];

  if (aiReply) {
    return res.json({ ok: true, reply: aiReply, tracks, action, mode: 'gemini' });
  }

  let reply = `Siap! Berikut pilihan lagu terbaik untuk "${message}" yang langsung bisa kamu putar atau simpan menjadi playlist baru.`;
  if (/galau|sedih|hujan|malam/i.test(lower)) {
    reply = 'Untuk suasana galau dan santai malam, ini deretan lagu emosional pilihan yang siap menemani kamu.';
  } else if (/semangat|gym|olahraga|lari|workout/i.test(lower)) {
    reply = 'Untuk energi penuh dan olahraga, berikut deretan lagu bertempo cepat yang siap memacu semangatmu!';
  } else if (/fokus|belajar|kerja|coding|lofi/i.test(lower)) {
    reply = 'Untuk fokus belajar dan kerja, aktifkan Ambient Hujan atau Lo-Fi Crackle lalu putar daftar lagu pilihan berikut.';
  }
  return res.json({ ok: true, reply, tracks, action, mode: 'smart-fallback' });
});

app.post('/api/ai/dj-intro', async (req, res) => {
  const track = req.body?.track || {};
  const title = String(req.body?.title || track.title || 'lagu ini').trim();
  const artist = String(req.body?.artist || track.artist?.name || track.artist || 'artis favoritmu').trim();
  const lang = String(req.body?.lang || 'id').toLowerCase() === 'en' ? 'en' : 'id';

  const prompt =
    lang === 'en'
      ? `Write a 2-sentence energetic radio DJ intro in English for the song "${title}" by ${artist} on SpotyFlow Radio. No markdown or asterisks.`
      : `Buat 2 kalimat singkat ala penyiar radio/DJ SpotyFlow yang energik dalam Bahasa Indonesia untuk memperkenalkan lagu "${title}" dari ${artist}. Tanpa tanda bintang atau markdown.`;

  const aiScript = await callGeminiText(prompt, 7000);

  const script =
    aiScript ||
    (lang === 'en'
      ? `You are locked in to SpotyFlow Radio! Up next, enjoy the signature vibe of ${artist} with "${title}".`
      : `Selamat mendengarkan di SpotyFlow! Berikutnya kita masuk ke vibe spesial dari ${artist} lewat lagu "${title}". Nikmati setiap nadanya!`);
  return res.json({ ok: true, script, introText: script, mode: aiScript ? 'gemini' : 'smart-fallback' });
});

app.post('/api/ai/music-personality', async (req, res) => {
  const topArtists = Array.isArray(req.body?.topArtists) ? req.body.topArtists.slice(0, 8) : [];
  const totalMinutes = Number(req.body?.totalMinutes || 0);
  const mode = String(req.body?.mode || 'personality').toLowerCase() === 'roast' ? 'roast' : 'personality';
  const artistSummary = topArtists.map((a) => (typeof a === 'string' ? a : a?.name)).filter(Boolean).join(', ');

  const aiBio = await callGeminiText(
    mode === 'roast'
      ? `Roast selera musik pendengar secara jenaka dan sopan berdasarkan artis favorit (${artistSummary || 'pop mainstream'}) dan durasi ${totalMinutes} menit. Buat 2 kalimat lucu Bahasa Indonesia tanpa markdown.`
      : `Analisis kepribadian musik pendengar berdasarkan artis favorit (${artistSummary || 'beragam genre'}) dan total durasi ${totalMinutes} menit. Beri julukan unik + 2 kalimat penjelasan dalam Bahasa Indonesia tanpa markdown.`,
    7000
  );

  const personaTitle =
    mode === 'roast'
      ? 'Si Paling Galau Jam 2 Pagi'
      : totalMinutes > 120
        ? 'Penjelajah Hi-Fi Sejati'
        : 'Kurator Frekuensi Modern';
  const vibeTag = mode === 'roast' ? 'SPOTYFLOW ROAST' : 'AURA FREKUENSI';
  const summary =
    aiBio ||
    (artistSummary
      ? `Seleramu punya karakter kuat yang dipengaruhi oleh ${artistSummary}. Kamu suka lagu dengan atmosfer emosional dan detail aransemen yang bersih.`
      : 'Kamu adalah pendengar fleksibel yang menikmati transisi mulus dari pop santai hingga ritme penuh energi.');

  return res.json({
    ok: true,
    mode,
    vibeTag,
    personaTitle,
    archetype: personaTitle,
    summary,
    roastQuote: mode === 'roast' ? 'Playlist kamu 80% overthinking, 20% pura-pura move on!' : 'Telinga emas dengan selera lintas dimensi.',
  });
});

// (Duplikat /api/ai/mood-playlist lama dihapus agar route Gemini v10 dengan aiRateLimiterMiddleware aktif penuh)

app.post('/api/ai/song-meaning', async (req, res) => {
  const title = String(req.body?.title || '').trim();
  const artist = String(req.body?.artist || '').trim();
  const aiMeaning = await callGeminiText(
    `Jelaskan makna singkat lagu "${title}" oleh ${artist} dalam 3 kalimat Bahasa Indonesia yang hangat.`,
    7000
  );
  return res.json({
    ok: true,
    meaning:
      aiMeaning ||
      `Lagu "${title}" dari ${artist} mengangkat nuansa emosi dan refleksi personal yang dekat dengan pengalaman pendengar sehari-hari.`,
    mood: `Atmosferik, ekspresif, dan menonjolkan karakter khas ${artist || 'musisi ini'}.`,
    funFact: `Lagu "${title}" menjadi salah satu rilisan favorit pendengar karena kekuatan melodi dan liriknya yang mudah diingat.`,
    tags: ['Hi-Fi Master', artist || 'Pop', 'Pilihan Editor'],
  });
});

// =========================================================================
// 12B. MESIN REKOMENDASI & SMART AUTOPLAY (POST /api/recommendations/smart)
// =========================================================================

async function fetchSmartSourceTracks(query, limit = 12) {
  const q = String(query || 'top hits').trim();
  const [dzRes, itRes, ytRes] = await Promise.allSettled([
    fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=${limit}`, 3500),
    fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=${limit}`, 3500),
    raceYouTubeCandidates(q),
  ]);

  const list = [];
  if (dzRes.status === 'fulfilled' && Array.isArray(dzRes.value?.data)) {
    for (const t of dzRes.value.data) {
      const covers = resolveDeezerTrackCover(t);
      list.push({
        id: String(t.id),
        title: t.title || '',
        duration: Number(t.duration || 210),
        preview: t.preview || '',
        artist: {
          id: t.artist?.id || '',
          name: t.artist?.name || 'Artis',
          picture_medium: t.artist?.picture_medium || covers.cover_medium,
        },
        album: {
          id: t.album?.id || '',
          title: t.album?.title || 'Single',
          cover_xl: covers.cover_xl,
          cover_medium: covers.cover_medium,
        },
        source: 'deezer',
      });
    }
  }
  if (itRes.status === 'fulfilled' && Array.isArray(itRes.value?.results)) {
    for (const r of itRes.value.results) {
      const art600 = upgradeItunesArt(r.artworkUrl100, 600) || '/icon-192.png';
      const art300 = upgradeItunesArt(r.artworkUrl100, 300) || art600;
      list.push({
        id: `itunes_${r.trackId}`,
        title: r.trackName || '',
        duration: Math.round(Number(r.trackTimeMillis || 0) / 1000) || 210,
        preview: r.previewUrl || '',
        isItunes: true,
        artist: {
          id: `itunes_artist_${r.artistId || ''}`,
          name: r.artistName || 'Artis',
          picture_medium: art300,
        },
        album: {
          id: String(r.collectionId || ''),
          collectionId: r.collectionId || null,
          isItunes: true,
          title: r.collectionName || 'Single',
          cover_xl: art600,
          cover_medium: art300,
        },
        source: 'itunes',
      });
    }
  }
  if (ytRes.status === 'fulfilled' && Array.isArray(ytRes.value)) {
    for (const y of ytRes.value.slice(0, 6)) {
      list.push({
        id: `yt_${y.videoId}`,
        ytId: y.videoId,
        videoId: y.videoId,
        title: y.title,
        duration: y.duration || 210,
        preview: '',
        artist: {
          id: `yt_creator_${encodeURIComponent(y.author || 'YouTube')}`,
          name: y.author || 'YouTube Music',
          picture_medium: y.thumbnail,
        },
        album: {
          id: `yt_${y.videoId}`,
          title: 'YouTube Audio',
          cover_xl: y.thumbnail,
          cover_medium: y.thumbnail,
        },
        source: 'youtube',
        isYtThumb: true,
      });
    }
  }
  return list;
}

function dedupAndFilterTracks(candidates, excludedTracks = [], maxItems = 18) {
  const seenSig = new Set();
  const seenIds = new Set();
  const makeSig = (t) => {
    const artist = normalizeStr(t?.artist?.name || t?.artist || '');
    const title = normalizeStr(String(t?.title || '').replace(/\s*[\(\[][^)\]]*[\)\]]/g, ''));
    return `${artist}|${title}`;
  };
  for (const ex of excludedTracks) {
    if (!ex) continue;
    if (ex.id) seenIds.add(String(ex.id));
    const s = makeSig(ex);
    if (s && s !== '|') seenSig.add(s);
  }
  const out = [];
  for (const item of candidates) {
    if (!item || !item.title) continue;
    const idStr = String(item.id || '');
    const sig = makeSig(item);
    if ((idStr && seenIds.has(idStr)) || (sig && seenSig.has(sig))) continue;
    if (idStr) seenIds.add(idStr);
    if (sig) seenSig.add(sig);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

app.post('/api/recommendations/smart', async (req, res) => {
  const mode = String(req.body?.mode || 'autoplay').toLowerCase() === 'daily_mix' ? 'daily_mix' : 'autoplay';
  const recentTracks = Array.isArray(req.body?.recentTracks) ? req.body.recentTracks.slice(0, 25) : [];
  const likedTracks = Array.isArray(req.body?.likedTracks) ? req.body.likedTracks.slice(0, 25) : [];
  const currentTrack = req.body?.currentTrack || recentTracks[0] || likedTracks[0] || null;

  try {
    if (mode === 'autoplay') {
      const seedArtist = String(currentTrack?.artist?.name || currentTrack?.artist || '').trim();
      const seedTitle = String(currentTrack?.title || '').trim();
      const artistId = /^\d+$/.test(String(currentTrack?.artist?.id || '')) ? String(currentTrack.artist.id) : '';
      let seedVideoId = decodeVideoIdParam(
        currentTrack?.videoId || currentTrack?.ytId || currentTrack?.sid || currentTrack?.id || ''
      );

      if (!isValidVideoId(seedVideoId) && (seedArtist || seedTitle)) {
        const ytmSeed = await callYtmPython(req, { action: 'search', q: `${seedArtist} ${seedTitle}`.trim(), limit: '1' }, 2200);
        if (isValidVideoId(ytmSeed?.tracks?.[0]?.videoId)) {
          seedVideoId = ytmSeed.tracks[0].videoId;
        }
      }

      let relatedArtistNames = [];
      if (artistId) {
        try {
          const rel = await fetchJson(`https://api.deezer.com/artist/${artistId}/related?limit=4`, 3500);
          relatedArtistNames = (Array.isArray(rel?.data) ? rel.data : []).map((a) => a.name).filter(Boolean);
        } catch {
          relatedArtistNames = [];
        }
      }

      const q1 = seedArtist || seedTitle || 'Indonesia Top Hits';
      const q2 = relatedArtistNames.length ? relatedArtistNames.slice(0, 2).join(' ') : `${seedArtist} ${seedTitle}`.trim();
      const [ytmRelRes, batch1, batch2] = await Promise.all([
        isValidVideoId(seedVideoId)
          ? callYtmPython(req, { action: 'related', videoId: seedVideoId, limit: '15' }, 3500)
          : Promise.resolve(null),
        fetchSmartSourceTracks(q1, 12),
        q2 && q2 !== q1 ? fetchSmartSourceTracks(q2, 10) : Promise.resolve([]),
      ]);

      const ytmRelatedTracks = (Array.isArray(ytmRelRes?.tracks) ? ytmRelRes.tracks : [])
        .filter((t) => t && isValidVideoId(t.videoId) && t.title)
        .map((t) => ({
          id: t.id || `ytm_${t.videoId}`,
          ytId: t.videoId,
          videoId: t.videoId,
          title: t.title,
          duration: Number(t.duration || 0),
          preview: '',
          artist: {
            id: `yt_creator_${encodeURIComponent(t.artist || 'YouTube Music')}`,
            name: t.artist || 'YouTube Music',
            picture_medium: t.cover || `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg`,
          },
          album: {
            id: `ytm_${t.videoId}`,
            title: t.album || 'YouTube Music',
            cover_xl: t.cover || `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg`,
            cover_medium: t.cover || `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg`,
          },
          source: 'youtube',
          isYtThumb: false,
        }));

      const excluded = currentTrack ? [currentTrack, ...recentTracks] : recentTracks;
      const tracks = dedupAndFilterTracks([...ytmRelatedTracks, ...batch1, ...batch2], excluded, 15);
      return res.json({
        ok: true,
        mode: 'autoplay',
        source: ytmRelatedTracks.length ? 'ytmusic-hybrid' : 'smart-catalog',
        tracks,
      });
    }

    // Mode daily_mix: 3 paket Daily Mix siap putar (15-20 lagu bersampul HD per mix)
    const artistCounts = new Map();
    for (const t of [...likedTracks, ...recentTracks]) {
      const name = String(t?.artist?.name || t?.artist || '').trim();
      if (!name || /youtube|audius|artis/i.test(name)) continue;
      artistCounts.set(name, (artistCounts.get(name) || 0) + 1);
    }
    const topArtists = [...artistCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0])
      .slice(0, 4);

    const favSeedQuery = topArtists.length ? topArtists.slice(0, 2).join(' ') : 'Tulus Sheila On 7 Hindia';
    const vibeSeedQuery = topArtists.length > 2 ? topArtists.slice(1, 3).join(' ') : 'Coldplay The Weeknd Bruno Mars';
    const chillSeedQuery = 'Acoustic Chill Lo-Fi Focus NIKI Joji';

    const [mix1Raw, mix2Raw, mix3Raw, aiTitlesRaw] = await Promise.all([
      fetchSmartSourceTracks(favSeedQuery, 18),
      fetchSmartSourceTracks(vibeSeedQuery, 18),
      fetchSmartSourceTracks(chillSeedQuery, 18),
      process.env.GEMINI_API_KEY && topArtists.length
        ? callGeminiText(
            `Berikan 3 judul singkat Daily Mix (maksimal 5 kata per judul) berdasarkan artis favorit: ${topArtists.join(', ')}. Balas HANYA JSON array 3 string.`,
            5000
          )
        : Promise.resolve(null),
    ]);

    let customTitles = null;
    if (aiTitlesRaw) {
      try {
        const m = String(aiTitlesRaw).match(/\[[\s\S]*\]/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (Array.isArray(parsed) && parsed.length >= 3) customTitles = parsed.map((s) => String(s));
        }
      } catch {
        customTitles = null;
      }
    }

    const mix1Tracks = dedupAndFilterTracks([...likedTracks.slice(0, 5), ...mix1Raw], [], 18);
    const mix2Tracks = dedupAndFilterTracks(mix2Raw, mix1Tracks.slice(0, 5), 18);
    const mix3Tracks = dedupAndFilterTracks(mix3Raw, [], 18);

    const mixes = [
      {
        id: 'daily_mix_1',
        badge: 'MIX HARIAN 1',
        title: customTitles?.[0] || 'Mix Harian 1: Favorit Kamu',
        subtitle: topArtists.length ? `Berdasarkan ${topArtists.slice(0, 3).join(', ')}` : 'Lagu favorit & paling sering kamu putar',
        accent: '#1ED760',
        cover: mix1Tracks[0]?.album?.cover_xl || mix1Tracks[0]?.album?.cover_medium || '/icon-192.png',
        tracks: mix1Tracks,
      },
      {
        id: 'daily_mix_2',
        badge: 'MIX HARIAN 2',
        title: customTitles?.[1] || 'Mix Harian 2: Eksplorasi Vibe Serupa',
        subtitle: 'Rekomendasi artis serupa & hits yang cocok dengan seleramu',
        accent: '#38BDF8',
        cover: mix2Tracks[0]?.album?.cover_xl || mix2Tracks[0]?.album?.cover_medium || '/icon-192.png',
        tracks: mix2Tracks,
      },
      {
        id: 'daily_mix_3',
        badge: 'MIX HARIAN 3',
        title: customTitles?.[2] || 'Mix Harian 3: Santai & Fokus',
        subtitle: 'Akustik hangat, Lo-Fi & melodi tenang untuk kerja atau istirahat',
        accent: '#A855F7',
        cover: mix3Tracks[0]?.album?.cover_xl || mix3Tracks[0]?.album?.cover_medium || '/icon-192.png',
        tracks: mix3Tracks,
      },
    ];

    return res.json({ ok: true, mode: 'daily_mix', mixes });
  } catch {
    return res.status(502).json({ error: 'Gagal memuat rekomendasi pintar.' });
  }
});

// =========================================================================
// 13. CLOUD DATABASE SYNC (POSTGRESQL / NEON / SUPABASE) & KOMPATIBILITAS
// =========================================================================

let cloudDbPool = null;
let cloudDbSchemaReady = false;

let cloudDbDriver = 'none';

function getCloudDbPool() {
  const dbUrl = String(process.env.DATABASE_URL || '').trim().replace(/^["']|["']$/g, '');
  if (!dbUrl || !/^postgres(?:ql)?:\/\//i.test(dbUrl)) {
    cloudDbDriver = 'none';
    return null;
  }
  if (cloudDbPool) return cloudDbPool;

  // 1. Prioritaskan driver pg.Pool (TCP murni tanpa dependensi ws, stabil di Vercel Serverless)
  try {
    const pgMod = require('pg');
    if (pgMod && typeof pgMod.Pool === 'function') {
      cloudDbPool = new pgMod.Pool({
        connectionString: dbUrl,
        max: 3,
        connectionTimeoutMillis: 4500,
        idleTimeoutMillis: 15000,
        ssl: /localhost|127\.0\.0\.1/i.test(dbUrl) ? false : { rejectUnauthorized: false },
      });
      cloudDbDriver = 'pg';
      return cloudDbPool;
    }
  } catch {
    // lanjut ke HTTP driver Neon
  }

  // 2. Fallback: @neondatabase/serverless HTTP driver neon() (tanpa WebSocket ws)
  try {
    const neonMod = require('@neondatabase/serverless');
    if (neonMod && typeof neonMod.neon === 'function') {
      const sqlFn = neonMod.neon(dbUrl);
      cloudDbPool = {
        async query(text, params = []) {
          const rows = typeof sqlFn.query === 'function'
            ? await sqlFn.query(text, params)
            : await sqlFn(text, params);
          return { rows: Array.isArray(rows) ? rows : [] };
        },
      };
      cloudDbDriver = 'neon-http';
      return cloudDbPool;
    }
  } catch {
    // fallback ke mode memory/local
  }
  cloudDbDriver = 'none';
  return null;
}

async function ensureCloudDbTable(pool) {
  if (!pool || cloudDbSchemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_library (
      user_id TEXT PRIMARY KEY,
      email TEXT,
      liked_tracks JSONB DEFAULT '[]'::jsonb,
      playlists JSONB DEFAULT '[]'::jsonb,
      recent_tracks JSONB DEFAULT '[]'::jsonb,
      listening_stats JSONB DEFAULT '{}'::jsonb,
      extra_data JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE user_library ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}'::jsonb;`);
  cloudDbSchemaReady = true;
}

const jamRooms = new Map();
let jamDbTableReady = false;

async function ensureJamRoomsTable(pool) {
  if (!pool || jamDbTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jam_rooms (
      code TEXT PRIMARY KEY,
      host_name TEXT NOT NULL,
      host_id TEXT DEFAULT '',
      host_token_hash TEXT DEFAULT '',
      track JSONB,
      is_playing BOOLEAN DEFAULT FALSE,
      current_time_sec DOUBLE PRECISION DEFAULT 0,
      listeners_count INTEGER DEFAULT 1,
      last_reaction JSONB,
      updated_at BIGINT NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE jam_rooms ADD COLUMN IF NOT EXISTS host_id TEXT DEFAULT '';`).catch(() => {});
  await pool.query(`ALTER TABLE jam_rooms ADD COLUMN IF NOT EXISTS host_token_hash TEXT DEFAULT '';`).catch(() => {});
  jamDbTableReady = true;
}

function generateJamRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function hashHostToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function sanitizePublicJamRoom(room) {
  if (!room) return null;
  const { hostTokenHash, hostId, ...pub } = room;
  return pub;
}

async function saveJamRoomState(room) {
  if (jamRooms.size > 500) {
    const oldest = jamRooms.keys().next().value;
    if (oldest) jamRooms.delete(oldest);
  }
  jamRooms.set(room.code, room);
  const pool = getCloudDbPool();
  if (!pool) return 'memory';
  try {
    await ensureJamRoomsTable(pool);
    await pool.query(
      `INSERT INTO jam_rooms (code, host_name, host_id, host_token_hash, track, is_playing, current_time_sec, listeners_count, last_reaction, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (code) DO UPDATE SET
         host_name = EXCLUDED.host_name,
         host_id = COALESCE(NULLIF(jam_rooms.host_id, ''), EXCLUDED.host_id),
         host_token_hash = COALESCE(NULLIF(jam_rooms.host_token_hash, ''), EXCLUDED.host_token_hash),
         track = EXCLUDED.track,
         is_playing = EXCLUDED.is_playing,
         current_time_sec = EXCLUDED.current_time_sec,
         listeners_count = EXCLUDED.listeners_count,
         last_reaction = EXCLUDED.last_reaction,
         updated_at = EXCLUDED.updated_at`,
      [
        room.code,
        room.hostName,
        String(room.hostId || ''),
        String(room.hostTokenHash || ''),
        JSON.stringify(room.track || null),
        Boolean(room.isPlaying),
        Number(room.currentTime || 0),
        Math.max(1, Number(room.listenersCount || 1)),
        JSON.stringify(room.lastReaction || null),
        Number(room.updatedAt || Date.now()),
      ]
    );
    return 'postgres';
  } catch {
    return 'memory';
  }
}

async function loadJamRoomState(code) {
  const cleanCode = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  if (!cleanCode) return { room: null, storage: 'memory' };
  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureJamRoomsTable(pool);
      const q = await pool.query(
        'SELECT code, host_name, host_id, host_token_hash, track, is_playing, current_time_sec, listeners_count, last_reaction, updated_at FROM jam_rooms WHERE code = $1',
        [cleanCode]
      );
      if (q.rows && q.rows[0]) {
        const r = q.rows[0];
        const room = {
          code: r.code,
          hostName: r.host_name,
          hostId: String(r.host_id || ''),
          hostTokenHash: String(r.host_token_hash || ''),
          track: r.track || null,
          isPlaying: Boolean(r.is_playing),
          currentTime: Number(r.current_time_sec || 0),
          positionSec: Number(r.current_time_sec || 0),
          listenersCount: Math.max(1, Number(r.listeners_count || 1)),
          lastReaction: r.last_reaction || null,
          updatedAt: Number(r.updated_at || Date.now()),
        };
        jamRooms.set(cleanCode, room);
        return { room, storage: 'postgres' };
      }
    } catch {
      // fallback to memory
    }
  }
  return { room: jamRooms.get(cleanCode) || null, storage: pool ? 'postgres' : 'memory' };
}

// --- 13B. DENGAR BARENG / LISTENING PARTY (VERCEL SERVERLESS: /api/jam/*) ---
app.post('/api/jam/create', async (req, res) => {
  const code = generateJamRoomCode();
  const hostName = String(req.user?.displayName || req.body?.hostName || 'Host SpotyFlow').trim().slice(0, 40) || 'Host SpotyFlow';
  const curSec = Math.max(0, Number(req.body?.currentTime ?? req.body?.positionSec ?? 0) || 0);
  const hostToken = crypto.randomBytes(16).toString('hex');
  const room = {
    code,
    hostName,
    hostId: req.user?.id ? String(req.user.id) : '',
    hostTokenHash: hashHostToken(hostToken),
    track: req.body?.track || null,
    isPlaying: Boolean(req.body?.isPlaying),
    currentTime: curSec,
    positionSec: curSec,
    listenersCount: 1,
    lastReaction: null,
    updatedAt: Date.now(),
  };
  const storage = await saveJamRoomState(room);
  res.status(201).json({
    ok: true,
    code,
    hostToken,
    room: sanitizePublicJamRoom(room),
    storage,
    note: storage === 'postgres'
      ? 'Tersinkron lintas server via PostgreSQL.'
      : 'Mode in-memory sementara (pasang DATABASE_URL PostgreSQL untuk sinkronisasi permanen lintas instance Vercel).',
  });
});

app.post('/api/jam/update', async (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  if (!code) return res.status(400).json({ ok: false, error: 'Kode room Jam wajib diisi.' });
  const loaded = await loadJamRoomState(code);
  const action = String(req.body?.action || 'sync').toLowerCase();

  if (!loaded.room) {
    return res.status(404).json({ ok: false, error: 'Room Jam tidak ditemukan atau sudah berakhir.' });
  }
  const prev = loaded.room;
  const updated = { ...prev };

  if (action === 'join') {
    updated.listenersCount = Math.min(99, Math.max(2, Number(prev.listenersCount || 1) + 1));
  } else if (action === 'leave') {
    updated.listenersCount = Math.max(1, Number(prev.listenersCount || 1) - 1);
  } else if (action === 'react' && req.body?.emoji) {
    updated.lastReaction = {
      id: crypto.randomBytes(4).toString('hex'),
      emoji: String(req.body.emoji).slice(0, 8),
      sender: String(req.user?.displayName || req.body?.sender || 'Tamu').slice(0, 28),
      ts: Date.now(),
    };
  } else {
    // Verifikasi kepemilikan Host untuk mencegah pembajakan pemutaran room (Anti-IDOR)
    const callerHostToken = String(req.body?.hostToken || req.headers['x-jam-host-token'] || '').trim();
    const tokenMatches = Boolean(
      prev.hostTokenHash &&
      callerHostToken &&
      crypto.timingSafeEqual(Buffer.from(prev.hostTokenHash, 'hex'), Buffer.from(hashHostToken(callerHostToken), 'hex'))
    );
    const ownerMatches = Boolean(prev.hostId && req.user?.id && String(req.user.id) === String(prev.hostId));
    if ((prev.hostId || prev.hostTokenHash) && !ownerMatches && !tokenMatches) {
      return res.status(403).json({ ok: false, error: 'Hanya Host room yang dapat mengubah lagu atau posisi pemutaran.' });
    }
    if (req.body?.track !== undefined) updated.track = req.body.track;
    if (typeof req.body?.isPlaying === 'boolean') updated.isPlaying = req.body.isPlaying;
    if (req.body?.currentTime !== undefined || req.body?.positionSec !== undefined) {
      const sec = Math.max(0, Number(req.body.currentTime ?? req.body.positionSec ?? prev.currentTime) || 0);
      updated.currentTime = sec;
      updated.positionSec = sec;
    }
    if (req.body?.hostName) updated.hostName = String(req.user?.displayName || req.body.hostName).slice(0, 40);
    updated.updatedAt = Date.now();
  }

  const storage = await saveJamRoomState(updated);
  res.json({ ok: true, room: sanitizePublicJamRoom(updated), storage });
});

app.get('/api/jam/state', async (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  if (!code) return res.status(400).json({ ok: false, error: 'Kode room tidak valid.' });
  const { room, storage } = await loadJamRoomState(code);
  res.setHeader('Cache-Control', 'no-store');
  if (!room) {
    return res.json({
      ok: false,
      room: null,
      storage,
      error: storage === 'memory'
        ? 'Room tidak ditemukan di instance ini (mode in-memory). Pastikan DATABASE_URL aktif atau minta Host kirim ulang kode.'
        : 'Room Jam tidak ditemukan atau sudah berakhir.',
    });
  }
  // Kompensasi jeda jaringan: estimasi detik real-time jika sedang playing
  const elapsedSec = room.isPlaying ? Math.max(0, (Date.now() - Number(room.updatedAt || Date.now())) / 1000) : 0;
  const effectiveTime = Number(room.currentTime || 0) + Math.min(elapsedSec, 600);
  return res.json({
    ok: true,
    storage,
    room: {
      ...sanitizePublicJamRoom(room),
      effectiveTime: Number(effectiveTime.toFixed(2)),
    },
  });
});

app.post('/api/v1/jam/create', (req, res) => {
  if (jamRooms.size > 500) {
    const oldest = jamRooms.keys().next().value;
    if (oldest) jamRooms.delete(oldest);
  }
  const code = `SF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const hostToken = crypto.randomBytes(16).toString('hex');
  const room = {
    code,
    hostName: req.user?.displayName || String(req.body?.hostName || 'Host SpotyFlow').slice(0, 40),
    hostId: req.user?.id ? String(req.user.id) : '',
    hostTokenHash: hashHostToken(hostToken),
    track: req.body?.track || null,
    isPlaying: Boolean(req.body?.isPlaying),
    positionSec: Number(req.body?.positionSec || 0),
    updatedAt: Date.now(),
  };
  jamRooms.set(code, room);
  res.status(201).json({ ok: true, code, hostToken, room: sanitizePublicJamRoom(room) });
});

app.post('/api/v1/jam/join', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  const found = jamRooms.get(code);
  const room = found ? sanitizePublicJamRoom(found) : { code, hostName: 'SpotyFlow Jam', track: null, isPlaying: false, positionSec: 0 };
  res.json({ ok: true, code, room });
});

app.get('/api/v1/jam/state', (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  const room = sanitizePublicJamRoom(jamRooms.get(code) || null);
  res.json({ ok: Boolean(room), room });
});

app.post('/api/v1/jam/sync', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12);
  if (!code) return res.status(400).json({ error: 'Kode Jam tidak valid.' });
  const prev = jamRooms.get(code);
  if (!prev) return res.status(404).json({ error: 'Room Jam tidak ditemukan.' });
  const callerHostToken = String(req.body?.hostToken || req.headers['x-jam-host-token'] || '').trim();
  const tokenMatches = Boolean(
    prev.hostTokenHash &&
    callerHostToken &&
    crypto.timingSafeEqual(Buffer.from(prev.hostTokenHash, 'hex'), Buffer.from(hashHostToken(callerHostToken), 'hex'))
  );
  const ownerMatches = Boolean(prev.hostId && req.user?.id && String(req.user.id) === String(prev.hostId));
  if ((prev.hostId || prev.hostTokenHash) && !ownerMatches && !tokenMatches) {
    return res.status(403).json({ error: 'Hanya Host room yang dapat menyinkronkan pemutaran.' });
  }
  const updated = {
    ...prev,
    track: req.body?.track ?? prev.track ?? null,
    isPlaying: typeof req.body?.isPlaying === 'boolean' ? req.body.isPlaying : Boolean(prev.isPlaying),
    positionSec: Number(req.body?.positionSec ?? prev.positionSec ?? 0),
    updatedAt: Date.now(),
  };
  jamRooms.set(code, updated);
  res.json({ ok: true, room: sanitizePublicJamRoom(updated) });
});

app.post('/api/v1/connect/transfer', (_req, res) => {
  res.json({ ok: true, stateless: true });
});

app.get('/api/user/sync', async (req, res) => {
  const pool = getCloudDbPool();
  if (!pool) {
    return res.json({ ok: true, synced: false, mode: 'local', data: null });
  }
  if (!req.user || req.user.isGuest) {
    return res.json({ ok: true, synced: false, mode: 'guest', data: null });
  }
  try {
    await ensureCloudDbTable(pool);
    const { rows } = await pool.query(
      'SELECT user_id, email, liked_tracks, playlists, recent_tracks, listening_stats, extra_data, updated_at FROM user_library WHERE user_id = $1 LIMIT 1',
      [String(req.user.id)]
    );
    const row = rows?.[0] || null;
    if (!row) {
      return res.json({ ok: true, synced: true, mode: 'cloud', data: null });
    }
    const extra = row.extra_data && typeof row.extra_data === 'object' ? row.extra_data : {};
    return res.json({
      ok: true,
      synced: true,
      mode: 'cloud',
      data: {
        likedTracks: Array.isArray(row.liked_tracks) ? row.liked_tracks : [],
        userPlaylists: Array.isArray(row.playlists) ? row.playlists : [],
        recentTracks: Array.isArray(row.recent_tracks) ? row.recent_tracks : [],
        listeningStats: row.listening_stats || {},
        followedArtists: Array.isArray(extra.followedArtists) ? extra.followedArtists : [],
        savedAlbums: Array.isArray(extra.savedAlbums) ? extra.savedAlbums : [],
        savedPlaylists: Array.isArray(extra.savedPlaylists) ? extra.savedPlaylists : [],
        playlistFolders: Array.isArray(extra.playlistFolders) ? extra.playlistFolders : [],
        pinnedItems: Array.isArray(extra.pinnedItems) ? extra.pinnedItems : [],
        preferences: extra.preferences && typeof extra.preferences === 'object' ? extra.preferences : null,
        updatedAt: row.updated_at,
      },
    });
  } catch (err) {
    console.warn('[SpotyFlow Cloud Sync GET Fallback]', err?.message || err);
    return res.json({ ok: true, synced: false, mode: 'local', data: null });
  }
});

async function handleUserCloudSyncWrite(req, res) {
  const pool = getCloudDbPool();
  if (!pool) {
    return res.json({ ok: true, synced: false, mode: 'local' });
  }
  if (!req.user || req.user.isGuest) {
    return res.status(200).json({ ok: true, synced: false, mode: 'guest', message: 'Mode Tamu tersimpan lokal di perangkat.' });
  }
  try {
    await ensureCloudDbTable(pool);
    const payload = req.body?.data && typeof req.body.data === 'object' ? req.body.data : req.body || {};
    const likedTracks = Array.isArray(payload.likedTracks) ? payload.likedTracks.slice(0, 500) : [];
    const playlists = Array.isArray(payload.userPlaylists)
      ? payload.userPlaylists.slice(0, 100)
      : Array.isArray(payload.playlists)
        ? payload.playlists.slice(0, 100)
        : [];
    const recentTracks = Array.isArray(payload.recentTracks) ? payload.recentTracks.slice(0, 100) : [];
    const listeningStats = payload.listeningStats && typeof payload.listeningStats === 'object' ? payload.listeningStats : {};
    const extraData = {
      followedArtists: Array.isArray(payload.followedArtists) ? payload.followedArtists.slice(0, 200) : [],
      savedAlbums: Array.isArray(payload.savedAlbums) ? payload.savedAlbums.slice(0, 200) : [],
      savedPlaylists: Array.isArray(payload.savedPlaylists) ? payload.savedPlaylists.slice(0, 100) : [],
      playlistFolders: Array.isArray(payload.playlistFolders) ? payload.playlistFolders.slice(0, 50) : [],
      pinnedItems: Array.isArray(payload.pinnedItems) ? payload.pinnedItems.slice(0, 50) : [],
      preferences: payload.preferences && typeof payload.preferences === 'object' ? payload.preferences : null,
    };

    await pool.query(
      `INSERT INTO user_library (user_id, email, liked_tracks, playlists, recent_tracks, listening_stats, extra_data, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         liked_tracks = EXCLUDED.liked_tracks,
         playlists = EXCLUDED.playlists,
         recent_tracks = EXCLUDED.recent_tracks,
         listening_stats = EXCLUDED.listening_stats,
         extra_data = EXCLUDED.extra_data,
         updated_at = NOW()`,
      [
        String(req.user.id),
        req.user.email || null,
        JSON.stringify(likedTracks),
        JSON.stringify(playlists),
        JSON.stringify(recentTracks),
        JSON.stringify(listeningStats),
        JSON.stringify(extraData),
      ]
    );
    return res.json({ ok: true, synced: true, mode: 'cloud', updatedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('[SpotyFlow Cloud Sync POST Fallback]', err?.message || err);
    return res.json({ ok: true, synced: false, mode: 'local' });
  }
}

app.post('/api/user/sync', handleUserCloudSyncWrite);
app.put('/api/user/sync', handleUserCloudSyncWrite);

app.get('/api/auth/wa/status', (_req, res) => {
  res.json({ ok: true, serverless: Boolean(process.env.VERCEL), connected: false, qrDataUrl: null, hasQr: false });
});

const trackCommentsMem = new Map();
let trackCommentsTableReady = false;
const socialBlendsMem = [];
let socialBlendsTableReady = false;

async function ensureTrackCommentsTable(pool) {
  if (!pool || trackCommentsTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS track_comments (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp_sec DOUBLE PRECISION DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_track_comments_track_id ON track_comments (track_id, created_at DESC);`);
  trackCommentsTableReady = true;
}

async function ensureSocialBlendsTable(pool) {
  if (!pool || socialBlendsTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_blends (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      partner_name TEXT DEFAULT '',
      score INTEGER DEFAULT 85,
      tracks JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  socialBlendsTableReady = true;
}

app.get('/api/social/collab/list', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const list = [];
  const seen = new Set();
  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureSharedPlaylistsTable(pool);
      const r = await pool.query(
        'SELECT code, name, description, cover, owner_name, collaborative, tracks, updated_at FROM shared_playlists ORDER BY updated_at DESC LIMIT 20'
      );
      for (const row of r.rows || []) {
        seen.add(row.code);
        list.push({
          code: row.code,
          name: row.name,
          description: row.description || '',
          cover: row.cover || '/icon-512.png',
          ownerName: row.owner_name || 'SpotyFlow',
          collaborative: Boolean(row.collaborative),
          trackCount: Array.isArray(row.tracks) ? row.tracks.length : 0,
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
        });
      }
    } catch {}
  }
  for (const pl of sharedPlaylistsMem.values()) {
    if (seen.has(pl.code)) continue;
    list.push({
      code: pl.code,
      name: pl.name,
      description: pl.description || '',
      cover: pl.cover || '/icon-512.png',
      ownerName: pl.ownerName || 'SpotyFlow',
      collaborative: Boolean(pl.collaborative),
      trackCount: Array.isArray(pl.tracks) ? pl.tracks.length : 0,
      updatedAt: pl.updatedAt || new Date().toISOString(),
    });
  }
  res.json({ ok: true, playlists: list.slice(0, 20) });
});

app.get('/api/social/blend/list', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureSocialBlendsTable(pool);
      const r = await pool.query(
        'SELECT id, title, owner_name, partner_name, score, tracks, created_at FROM social_blends ORDER BY created_at DESC LIMIT 15'
      );
      return res.json({
        ok: true,
        blends: (r.rows || []).map((row) => ({
          id: row.id,
          title: row.title,
          ownerName: row.owner_name,
          partnerName: row.partner_name || '',
          score: Number(row.score) || 85,
          tracks: Array.isArray(row.tracks) ? row.tracks : [],
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        })),
      });
    } catch {}
  }
  res.json({ ok: true, blends: socialBlendsMem.slice(0, 15) });
});

app.post('/api/social/blend/save', jamRateLimiterMiddleware, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'Silakan masuk terlebih dahulu untuk menyimpan SpotyFlow Blend.' });
  }
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const entry = {
    id: `bld_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    title: String(b.title || 'SpotyFlow Blend').trim().slice(0, 80),
    ownerName: String(req.user.displayName || 'SpotyFlow').trim().slice(0, 48),
    partnerName: String(b.partnerName || '').trim().slice(0, 48),
    score: Math.max(1, Math.min(100, Math.round(Number(b.score) || 85))),
    tracks: Array.isArray(b.tracks) ? b.tracks.slice(0, 30) : [],
    createdAt: new Date().toISOString(),
  };
  socialBlendsMem.unshift(entry);
  if (socialBlendsMem.length > 30) socialBlendsMem.length = 30;
  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureSocialBlendsTable(pool);
      await pool.query(
        'INSERT INTO social_blends (id, title, owner_name, partner_name, score, tracks) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
        [entry.id, entry.title, entry.ownerName, entry.partnerName, entry.score, JSON.stringify(entry.tracks)]
      );
    } catch {}
  }
  res.status(201).json({ ok: true, blend: entry });
});

app.get('/api/artwork', (req, res) => {
  const raw = String(req.query.u || '').trim();
  if (isAllowedProxyImageDomain(raw)) return res.redirect(302, raw);
  return res.redirect(302, '/icon-192.png');
});

app.get('/api/tracks/:trackId/comments', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const tid = String(req.params.trackId || '').trim().slice(0, 120);
  if (!tid) return res.json({ ok: true, comments: [] });
  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureTrackCommentsTable(pool);
      const r = await pool.query(
        'SELECT id, author, text, timestamp_sec, created_at FROM track_comments WHERE track_id = $1 ORDER BY created_at DESC LIMIT 80',
        [tid]
      );
      return res.json({
        ok: true,
        comments: (r.rows || []).map((row) => ({
          id: row.id,
          author: row.author,
          text: row.text,
          timestampSec: Number(row.timestamp_sec) || 0,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        })),
      });
    } catch {}
  }
  const memList = trackCommentsMem.get(tid) || [];
  res.json({ ok: true, comments: memList.slice(0, 80) });
});

app.post('/api/tracks/:trackId/comments', jamRateLimiterMiddleware, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'Silakan masuk terlebih dahulu untuk mengirim komentar.' });
  }
  const tid = String(req.params.trackId || '').trim().slice(0, 120);
  const text = String(req.body?.text || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 280);
  if (!tid || !text) return res.status(400).json({ error: 'Komentar kosong.' });
  const comment = {
    id: `cmt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    author: String(req.user.displayName || 'Pendengar SpotyFlow').trim().slice(0, 48),
    text,
    timestampSec: Math.max(0, Number(req.body?.timestampSec || 0)),
    createdAt: new Date().toISOString(),
  };
  const existing = trackCommentsMem.get(tid) || [];
  existing.unshift(comment);
  if (existing.length > 80) existing.length = 80;
  trackCommentsMem.set(tid, existing);

  const pool = getCloudDbPool();
  if (pool) {
    try {
      await ensureTrackCommentsTable(pool);
      await pool.query(
        'INSERT INTO track_comments (id, track_id, author, text, timestamp_sec) VALUES ($1, $2, $3, $4, $5)',
        [comment.id, tid, comment.author, comment.text, comment.timestampSec]
      );
    } catch {}
  }
  res.status(201).json({ ok: true, comment });
});

// Stub aman jika browser lama mencoba memuat /socket.io/socket.io.js
app.get('/socket.io/socket.io.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send('/* SpotyFlow Stateless Serverless Mode */ window.__SPOTYFLOW_SERVERLESS = true;');
});

// =========================================================================
// 14. PENYAJIAN HTML UTAMA & ASET PWA STATIS (TANPA 404)
// =========================================================================

// =========================================================================
// 16C. SPOTYFLOW X (v10.0.0): AI MOOD DJ & SONG DNA INSIGHTS
// =========================================================================
const songInsightsMemCache = new Map();

async function resolvePlayableTrackFromQuery(title, artist) {
  const q = `${artist || ''} ${title || ''}`.trim();
  if (!q) return null;
  try {
    const dz = await fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(q)}&limit=3`, 3200);
    const hit = Array.isArray(dz?.data) ? dz.data[0] : null;
    if (hit && hit.id) {
      const covers = resolveDeezerTrackCover(hit);
      return {
        id: String(hit.id),
        title: hit.title || title,
        duration: Number(hit.duration || 210),
        preview: hit.preview || '',
        artist: {
          id: hit.artist?.id || 0,
          name: hit.artist?.name || artist || 'Artis',
          picture_medium: hit.artist?.picture_medium || covers.cover_medium,
        },
        album: {
          id: hit.album?.id || 0,
          title: hit.album?.title || 'Single',
          cover_xl: covers.cover_xl,
          cover_big: covers.cover_xl,
          cover_medium: covers.cover_medium,
        },
        source: 'deezer',
      };
    }
  } catch {}
  try {
    const it = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=2`, 3000);
    const row = Array.isArray(it?.results) ? it.results[0] : null;
    if (row && row.trackId) {
      const art600 = upgradeItunesArt(row.artworkUrl100, 600) || row.artworkUrl100 || '/icon-192.png';
      const art300 = upgradeItunesArt(row.artworkUrl100, 300) || art600;
      return {
        id: `itunes_${row.trackId}`,
        title: row.trackName || title,
        duration: Math.round(Number(row.trackTimeMillis || 210000) / 1000),
        preview: row.previewUrl || '',
        isItunes: true,
        artist: { id: row.artistId || 0, name: row.artistName || artist || 'Artis' },
        album: { id: row.collectionId || 0, title: row.collectionName || 'Single', cover_xl: art600, cover_big: art600, cover_medium: art300, isItunes: true },
        source: 'itunes',
      };
    }
  } catch {}
  return {
    id: `ai_${crypto.createHash('md5').update(q.toLowerCase()).digest('hex').slice(0, 12)}`,
    title: title || q,
    duration: 210,
    artist: { id: 0, name: artist || 'Artis' },
    album: { id: 0, title: 'AI Mood Mix', cover_medium: '/icon-192.png', cover_big: '/icon-512.png' },
    source: 'ai-curated',
  };
}

const promptToPlaylistRateLimiter = createIpRateLimiter({
  maxReq: 8,
  windowMs: 60 * 1000,
  label: 'AI Curhat → Playlist',
});

function buildSmartFallbackPlaylistQueries(promptText, targetCount = 14) {
  const lower = String(promptText || '').toLowerCase();
  let title = 'Mix Spesial SpotyFlow';
  let description = 'Playlist pilihan yang diracik khusus sesuai suasana hatimu.';
  let vibeColor = '#1ED760';
  let pool = [
    { title: 'Hati-Hati di Jalan', artist: 'Tulus' },
    { title: 'Sial', artist: 'Mahalini' },
    { title: 'Evaluasi', artist: 'Hindia' },
    { title: 'Bertaut', artist: 'Nadin Amizah' },
    { title: 'Komang', artist: 'Raim Laode' },
    { title: 'As It Was', artist: 'Harry Styles' },
    { title: 'Blinding Lights', artist: 'The Weeknd' },
    { title: 'Yellow', artist: 'Coldplay' },
    { title: 'Die With A Smile', artist: 'Lady Gaga Bruno Mars' },
    { title: 'Birds of a Feather', artist: 'Billie Eilish' },
    { title: 'Lowkey', artist: 'NIKI' },
    { title: 'Glimpse of Us', artist: 'Joji' },
    { title: 'Dan', artist: 'Sheila On 7' },
    { title: 'Peri Cintaku', artist: 'Ziva Magnolya' },
    { title: 'Cruel Summer', artist: 'Taylor Swift' },
    { title: 'Tak Segampang Itu', artist: 'Anggi Marito' },
  ];

  if (/galau|sedih|putus|kangen|rindu|nangis|patah|sakit/i.test(lower)) {
    title = 'Ruang Galau & Rindu';
    description = 'Deretan lagu sendu untuk menemani perasaan yang belum selesai.';
    vibeColor = '#6366F1';
    pool = [
      { title: 'Hati-Hati di Jalan', artist: 'Tulus' },
      { title: 'Sial', artist: 'Mahalini' },
      { title: 'Tak Segampang Itu', artist: 'Anggi Marito' },
      { title: 'Runtuh', artist: 'Feby Putri Fiersa Besari' },
      { title: 'Glimpse of Us', artist: 'Joji' },
      { title: 'Traitor', artist: 'Olivia Rodrigo' },
      { title: 'Someone You Loved', artist: 'Lewis Capaldi' },
      { title: 'Fix You', artist: 'Coldplay' },
      { title: 'Pesan Terakhir', artist: 'Lyodra' },
      { title: 'Sisa Rasa', artist: 'Mahalini' },
      { title: 'Jiwa Yang Bersedih', artist: 'Ghea Indrawari' },
      { title: 'Secukupnya', artist: 'Hindia' },
      { title: 'Back To December', artist: 'Taylor Swift' },
      { title: 'All Too Well', artist: 'Taylor Swift' },
      { title: 'Monolog', artist: 'Pamungkas' },
      { title: 'Untungnya Hidup Harus Tetap Berjalan', artist: 'Bernadya' },
    ];
  } else if (/hujan|malam|tidur|santai|kopi|cafe|chill|rebahan/i.test(lower)) {
    title = 'Hujan & Malam Tenang';
    description = 'Nuansa akustik hangat dan tempo lembut untuk malam yang damai.';
    vibeColor = '#38BDF8';
    pool = [
      { title: 'Sorai', artist: 'Nadin Amizah' },
      { title: 'Zona Nyaman', artist: 'Fourtwnty' },
      { title: 'Lowkey', artist: 'NIKI' },
      { title: 'Slow Dancing in the Dark', artist: 'Joji' },
      { title: 'Best Part', artist: 'Daniel Caesar H.E.R.' },
      { title: 'Get You', artist: 'Daniel Caesar' },
      { title: 'Rehat', artist: 'Kunto Aji' },
      { title: 'Resah Jadi Luka', artist: 'Daun Jatuh' },
      { title: 'To The Bone', artist: 'Pamungkas' },
      { title: 'Seasons', artist: 'wave to earth' },
      { title: 'Bad', artist: 'wave to earth' },
      { title: 'Sunsetz', artist: 'Cigarettes After Sex' },
      { title: 'Apocalypse', artist: 'Cigarettes After Sex' },
      { title: 'Kita Ke Sana', artist: 'Hindia' },
      { title: 'Interaksi', artist: 'Tulus' },
      { title: 'Lantas', artist: 'Juicy Luicy' },
    ];
  } else if (/fokus|kerja|belajar|coding|lofi|study|skripsi/i.test(lower)) {
    title = 'Deep Focus & Lofi Flow';
    description = 'Ritme tenang bebas distraksi untuk kerja, belajar, dan coding.';
    vibeColor = '#14B8A6';
    pool = [
      { title: 'Luv(sic) Part 3', artist: 'Nujabes' },
      { title: 'Aruarian Dance', artist: 'Nujabes' },
      { title: 'Feather', artist: 'Nujabes' },
      { title: 'Snowman', artist: 'WYS' },
      { title: 'Affection', artist: 'Jinsang' },
      { title: 'Summer Madness', artist: 'Kool & The Gang' },
      { title: 'Experience', artist: 'Ludovico Einaudi' },
      { title: 'Nuvole Bianche', artist: 'Ludovico Einaudi' },
      { title: 'River Flows In You', artist: 'Yiruma' },
      { title: 'Cornfield Chase', artist: 'Hans Zimmer' },
      { title: 'Time', artist: 'Hans Zimmer' },
      { title: 'Midnight City', artist: 'M83' },
      { title: 'Resonance', artist: 'HOME' },
      { title: 'Coffee', artist: 'beabadoobee' },
      { title: 'From The Start', artist: 'Laufey' },
      { title: 'Falling Behind', artist: 'Laufey' },
    ];
  } else if (/semangat|gym|olahraga|lari|workout|energi|pagi|happy|senang/i.test(lower)) {
    title = 'High Energy Booster';
    description = 'Beat kencang dan anthem penuh semangat untuk pompa adrenalin.';
    vibeColor = '#F59E0B';
    pool = [
      { title: 'Blinding Lights', artist: 'The Weeknd' },
      { title: 'Levitating', artist: 'Dua Lipa' },
      { title: 'Uptown Funk', artist: 'Bruno Mars' },
      { title: 'Cant Hold Us', artist: 'Macklemore Ryan Lewis' },
      { title: 'Believer', artist: 'Imagine Dragons' },
      { title: 'Thunder', artist: 'Imagine Dragons' },
      { title: 'Stronger', artist: 'Kanye West' },
      { title: 'Till I Collapse', artist: 'Eminem' },
      { title: 'Starboy', artist: 'The Weeknd' },
      { title: 'Espresso', artist: 'Sabrina Carpenter' },
      { title: 'APT.', artist: 'ROSE Bruno Mars' },
      { title: 'Cruel Summer', artist: 'Taylor Swift' },
      { title: 'Viva La Vida', artist: 'Coldplay' },
      { title: 'Evaluasi', artist: 'Hindia' },
      { title: 'Sephia', artist: 'Sheila On 7' },
      { title: 'Melompat Lebih Tinggi', artist: 'Sheila On 7' },
    ];
  } else if (/anime|jepang|jpop|wibu|ost/i.test(lower)) {
    title = 'Anime & J-Pop Essentials';
    description = 'OST anime ikonik dan hits J-Pop penuh emosi dan energi.';
    vibeColor = '#EC4899';
    pool = [
      { title: 'Yoru ni Kakeru', artist: 'YOASOBI' },
      { title: 'Idol', artist: 'YOASOBI' },
      { title: 'Gurenge', artist: 'LiSA' },
      { title: 'Unravel', artist: 'TK from Ling tosite sigure' },
      { title: 'Kick Back', artist: 'Kenshi Yonezu' },
      { title: 'Lemon', artist: 'Kenshi Yonezu' },
      { title: 'Shinunoga E-Wa', artist: 'Fujii Kaze' },
      { title: 'Matsuri', artist: 'Fujii Kaze' },
      { title: 'Sparkle', artist: 'RADWIMPS' },
      { title: 'Nandemonaiya', artist: 'RADWIMPS' },
      { title: 'Blue Bird', artist: 'Ikimonogakari' },
      { title: 'Silhouette', artist: 'KANA-BOON' },
      { title: 'Kaikai Kitan', artist: 'Eve' },
      { title: 'Specialz', artist: 'King Gnu' },
      { title: 'Bling-Bang-Bang-Born', artist: 'Creepy Nuts' },
      { title: 'Suzume', artist: 'RADWIMPS' },
    ];
  } else if (/indo|indonesia|lokal|pop indo/i.test(lower)) {
    title = 'Hits Indonesia Pilihan';
    description = 'Kumpulan lagu Indonesia paling enak didengar sepanjang hari.';
    vibeColor = '#1ED760';
    pool = [
      { title: 'Hati-Hati di Jalan', artist: 'Tulus' },
      { title: 'Komang', artist: 'Raim Laode' },
      { title: 'Sial', artist: 'Mahalini' },
      { title: 'Satu Bulan', artist: 'Bernadya' },
      { title: 'Kata Mereka Ini Berlebihan', artist: 'Bernadya' },
      { title: 'Evaluasi', artist: 'Hindia' },
      { title: 'Bertaut', artist: 'Nadin Amizah' },
      { title: 'Lantas', artist: 'Juicy Luicy' },
      { title: 'Tampar', artist: 'Juicy Luicy' },
      { title: 'Dan', artist: 'Sheila On 7' },
      { title: 'Kangen', artist: 'Dewa 19' },
      { title: 'Separuh Aku', artist: 'NOAH' },
      { title: 'Peri Cintaku', artist: 'Ziva Magnolya' },
      { title: 'Nemen', artist: 'GildCoustic' },
      { title: 'To The Bone', artist: 'Pamungkas' },
      { title: 'Runtuh', artist: 'Feby Putri Fiersa Besari' },
    ];
  }

  return {
    title,
    description,
    vibeColor,
    queries: pool.slice(0, Math.max(12, Math.min(16, targetCount))),
    provider: 'smart-fallback',
  };
}

app.post('/api/ai/prompt-to-playlist', promptToPlaylistRateLimiter, async (req, res) => {
  const rawPrompt = String(req.body?.prompt || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 300);
  if (!rawPrompt) {
    return res.status(400).json({ ok: false, error: 'Tulis cerita atau suasana hatimu terlebih dahulu.' });
  }
  const count = Math.max(12, Math.min(16, parseInt(req.body?.count, 10) || 14));

  const aiPrompt = `Kamu adalah kurator musik profesional SpotyFlow.
Berdasarkan curhatan atau suasana berikut: "${rawPrompt}"
Susun tepat ${count} lagu NYATA yang sangat cocok dengan emosi, bahasa, dan budaya permintaan tersebut.
Balas HANYA JSON valid tanpa markdown:
{"title":"Judul Playlist Menarik (maks 45 karakter)","description":"Deskripsi hangat 1 kalimat","vibeColor":"#1ED760","queries":[{"title":"Judul Lagu Nyata","artist":"Nama Artis Nyata"}]}`;

  try {
    if (process.env.GEMINI_API_KEY) {
      const aiText = await callGeminiPayload(
        {
          contents: [{ parts: [{ text: aiPrompt }] }],
          generationConfig: { temperature: 0.75, maxOutputTokens: 1200 },
        },
        12000
      );
      if (aiText) {
        const m = String(aiText).match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          const queries = Array.isArray(parsed?.queries)
            ? parsed.queries
                .filter((q) => q && String(q.title || '').trim())
                .map((q) => ({
                  title: String(q.title || '').trim().slice(0, 100),
                  artist: String(q.artist || '').trim().slice(0, 80),
                }))
                .slice(0, 16)
            : [];
          if (queries.length >= 6) {
            const safeColor = /^#[0-9a-fA-F]{6}$/.test(String(parsed.vibeColor || '')) ? String(parsed.vibeColor) : '#1ED760';
            return res.status(200).json({
              ok: true,
              provider: 'gemini',
              title: String(parsed.title || 'Mix AI SpotyFlow').trim().slice(0, 60),
              description: String(parsed.description || 'Playlist hasil kurasi AI SpotyFlow.').trim().slice(0, 180),
              vibeColor: safeColor,
              queries,
            });
          }
        }
      }
    }
  } catch {
    // Fallback otomatis ke kurator suasana pintar (ANTI-500)
  }

  const fb = buildSmartFallbackPlaylistQueries(rawPrompt, count);
  return res.status(200).json({ ok: true, ...fb });
});

app.post('/api/ai/mood-playlist', aiRateLimiterMiddleware, async (req, res) => {
  const rawPrompt = String(req.body?.prompt || req.body?.mood || '').trim().slice(0, 220);
  const count = Math.max(5, Math.min(12, parseInt(req.body?.count, 10) || 10));
  const uiLang = String(req.body?.lang || 'id').toLowerCase() === 'en' ? 'English' : 'Bahasa Indonesia';
  if (!rawPrompt) {
    return res.status(400).json({ ok: false, error: 'Tulis suasana hati atau aktivitas yang kamu inginkan.' });
  }

  const aiPrompt = `Kamu adalah AI Music Director kelas dunia untuk SpotyFlow X.
Pengguna meminta playlist untuk mood/aktivitas: "${rawPrompt}".
Pilih tepat ${count} lagu NYATA, terkenal/berkualitas tinggi, dan 100% cocok dengan mood, budaya, dan bahasa permintaan tersebut (jika minta Indonesia/Jawa/Arab/Jepang/Korea, berikan lagu asli dari kultur tersebut!).
Tulis "name" dan "subtitle" dalam ${uiLang}.
Balas HANYA JSON valid:
{"name":"Judul Playlist Elegan","subtitle":"Deskripsi singkat 1 kalimat","accentColor":"#1ED760","songs":[{"title":"Judul Lagu Nyata","artist":"Nama Artis Nyata"}]}`;

  let curated = null;
  const aiText = await callGeminiPayload(
    {
      contents: [{ role: 'user', parts: [{ text: aiPrompt }] }],
      generationConfig: {
        temperature: 0.65,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    12000,
    ['gemini-3-flash-preview', 'gemini-3.1-flash-lite']
  );

  if (aiText) {
    try {
      const m = aiText.match(/\{[\s\S]*\}/);
      curated = JSON.parse(m ? m[0] : aiText);
    } catch {
      curated = null;
    }
  }

  const songList = Array.isArray(curated?.songs) && curated.songs.length
    ? curated.songs.slice(0, count)
    : [];

  let tracks = [];
  if (songList.length) {
    const settled = await Promise.allSettled(
      songList.map((s) => resolvePlayableTrackFromQuery(String(s?.title || '').trim(), String(s?.artist || '').trim()))
    );
    const seen = new Set();
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        const k = `${String(r.value.title).toLowerCase()}::${String(r.value.artist?.name || '').toLowerCase()}`;
        if (!seen.has(k)) {
          seen.add(k);
          tracks.push(r.value);
        }
      }
    }
  }

  // Fallback langsung ke Deezer search jika AI tidak mengembalikan daftar
  if (!tracks.length) {
    try {
      const dz = await fetchJson(`https://api.deezer.com/search/track?q=${encodeURIComponent(rawPrompt)}&limit=${count}`, 4000);
      tracks = (Array.isArray(dz?.data) ? dz.data : []).map((t) => {
        const covers = resolveDeezerTrackCover(t);
        return {
          id: String(t.id),
          title: t.title,
          duration: Number(t.duration || 210),
          preview: t.preview || '',
          artist: { id: t.artist?.id || 0, name: t.artist?.name || 'Artis', picture_medium: t.artist?.picture_medium || covers.cover_medium },
          album: { id: t.album?.id || 0, title: t.album?.title || 'Single', cover_xl: covers.cover_xl, cover_big: covers.cover_xl, cover_medium: covers.cover_medium },
          source: 'deezer',
        };
      });
    } catch {}
  }

  const safeColor = /^#[0-9a-fA-F]{6}$/.test(String(curated?.accentColor || '')) ? curated.accentColor : '#1ED760';
  return res.json({
    ok: true,
    name: String(curated?.name || `AI Mix: ${rawPrompt}`).slice(0, 72),
    subtitle: String(curated?.subtitle || `Kurasi otomatis AI untuk "${rawPrompt}"`).slice(0, 160),
    accentColor: safeColor,
    tracks,
  });
});

app.post('/api/ai/song-insights', aiRateLimiterMiddleware, async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 140);
  const artist = String(req.body?.artist || '').trim().slice(0, 100);
  const langCode = String(req.body?.lang || 'id').toLowerCase() === 'en' ? 'en' : 'id';
  if (!title) return res.status(400).json({ ok: false, error: 'Judul lagu diperlukan.' });

  const cacheKey = `${langCode}::${normalizeStr(`${artist} ${title}`)}`;
  if (songInsightsMemCache.has(cacheKey)) {
    return res.json({ ok: true, cached: true, ...songInsightsMemCache.get(cacheKey) });
  }

  const targetLang = langCode === 'en' ? 'English' : 'Bahasa Indonesia';
  const prompt = `Analisis lagu "${title}" oleh "${artist || 'Artis'}" dan tulis ringkasan editorial ringkas & akurat dalam ${targetLang}.
Balas HANYA JSON valid:
{
  "meaning": "Makna & cerita lagu dalam 2-3 kalimat ringkas dan menyentuh.",
  "moodTags": ["Mood1", "Mood2", "Mood3"],
  "energyPct": 72,
  "tempoVibe": "Mid-tempo / Chill / Energetic",
  "originLang": "Indonesia / Arab / English / Jepang / Korea / dll.",
  "trivia": "1 fakta menarik tentang produksi, perilisan, atau karakter musik lagu ini.",
  "similarTracks": [
    {"title": "Lagu Mirip 1", "artist": "Artis 1"},
    {"title": "Lagu Mirip 2", "artist": "Artis 2"},
    {"title": "Lagu Mirip 3", "artist": "Artis 3"}
  ]
}`;

  const aiText = await callGeminiPayload(
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    10000,
    ['gemini-3-flash-preview', 'gemini-3.1-flash-lite']
  );

  let parsed = null;
  if (aiText) {
    try {
      const m = aiText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : aiText);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || !parsed.meaning) {
    return res.status(502).json({ ok: false, error: 'Gagal memuat analisis lagu saat ini. Coba lagi sebentar.' });
  }

  const result = {
    meaning: String(parsed.meaning || '').slice(0, 600),
    moodTags: Array.isArray(parsed.moodTags) ? parsed.moodTags.slice(0, 5).map((x) => String(x).slice(0, 28)) : [],
    energyPct: Math.max(5, Math.min(100, Math.round(Number(parsed.energyPct) || 68))),
    tempoVibe: String(parsed.tempoVibe || 'Balanced Groove').slice(0, 48),
    originLang: String(parsed.originLang || 'Global').slice(0, 40),
    trivia: String(parsed.trivia || '').slice(0, 360),
    similarTracks: Array.isArray(parsed.similarTracks)
      ? parsed.similarTracks.slice(0, 4).map((t) => ({
          title: String(t?.title || '').slice(0, 80),
          artist: String(t?.artist || '').slice(0, 60),
        })).filter((t) => t.title)
      : [],
  };

  if (songInsightsMemCache.size >= 200) {
    const oldest = songInsightsMemCache.keys().next().value;
    if (oldest) songInsightsMemCache.delete(oldest);
  }
  songInsightsMemCache.set(cacheKey, result);
  return res.json({ ok: true, cached: false, ...result });
});

// =========================================================================
// 16B. PLAYLIST PUBLIK & KOLABORATIF (PostgreSQL + In-Memory Fallback)
// =========================================================================
const sharedPlaylistsMem = new Map();
let sharedPlaylistsTableReady = false;

async function ensureSharedPlaylistsTable(pool) {
  if (!pool || sharedPlaylistsTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shared_playlists (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      cover TEXT DEFAULT '',
      owner_name TEXT DEFAULT 'Pendengar SpotyFlow',
      owner_id TEXT DEFAULT '',
      collaborative BOOLEAN DEFAULT TRUE,
      tracks JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE shared_playlists ADD COLUMN IF NOT EXISTS owner_id TEXT DEFAULT '';`).catch(() => {});
  sharedPlaylistsTableReady = true;
}

function generateSharedPlaylistCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let out = 'PL-';
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function sanitizeSharedTrack(raw) {
  if (!raw || !raw.title) return null;
  const cover = String(raw.album?.cover_big || raw.album?.cover_medium || raw.cover || '/icon-192.png').slice(0, 500);
  return {
    id: String(raw.id || `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`).slice(0, 120),
    sid: String(raw.sid || '').slice(0, 64),
    videoId: String(raw.videoId || '').slice(0, 32),
    title: String(raw.title || 'Tanpa Judul').slice(0, 140),
    duration: Math.max(0, Math.round(Number(raw.duration) || 210)),
    artist: {
      id: raw.artist?.id || 0,
      name: String(raw.artist?.name || raw.artistName || 'Artis').slice(0, 100),
    },
    album: {
      id: raw.album?.id || 0,
      title: String(raw.album?.title || 'Single').slice(0, 120),
      cover_medium: cover,
      cover_big: cover,
    },
    addedBy: String(raw.addedBy || '').slice(0, 48),
  };
}

async function getSharedPlaylistByCode(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!/^PL-[A-Z0-9]{4,12}$/.test(code)) return null;
  if (sharedPlaylistsMem.has(code)) {
    return sharedPlaylistsMem.get(code);
  }
  const pool = getCloudDbPool();
  if (!pool) return null;
  try {
    await ensureSharedPlaylistsTable(pool);
    const r = await pool.query(
      'SELECT code, name, description, cover, owner_name, owner_id, collaborative, tracks, updated_at FROM shared_playlists WHERE code = $1 LIMIT 1',
      [code]
    );
    const row = r.rows?.[0];
    if (!row) return null;
    const pl = {
      code: row.code,
      name: row.name,
      description: row.description || '',
      cover: row.cover || '',
      ownerName: row.owner_name || 'SpotyFlow',
      ownerId: String(row.owner_id || ''),
      collaborative: Boolean(row.collaborative),
      tracks: Array.isArray(row.tracks) ? row.tracks : [],
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
    sharedPlaylistsMem.set(code, pl);
    return pl;
  } catch {
    return null;
  }
}

function sanitizePublicSharedPlaylist(pl) {
  if (!pl) return null;
  const { ownerId, ...pub } = pl;
  return pub;
}

async function saveSharedPlaylistRecord(pl) {
  sharedPlaylistsMem.set(pl.code, pl);
  if (sharedPlaylistsMem.size > 300) {
    const oldest = sharedPlaylistsMem.keys().next().value;
    if (oldest) sharedPlaylistsMem.delete(oldest);
  }
  const pool = getCloudDbPool();
  if (!pool) return 'memory';
  try {
    await ensureSharedPlaylistsTable(pool);
    await pool.query(
      `INSERT INTO shared_playlists (code, name, description, cover, owner_name, owner_id, collaborative, tracks, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         cover = EXCLUDED.cover,
         owner_name = EXCLUDED.owner_name,
         owner_id = COALESCE(NULLIF(shared_playlists.owner_id, ''), EXCLUDED.owner_id),
         collaborative = EXCLUDED.collaborative,
         tracks = EXCLUDED.tracks,
         updated_at = NOW()`,
      [pl.code, pl.name, pl.description, pl.cover, pl.ownerName, String(pl.ownerId || ''), pl.collaborative, JSON.stringify(pl.tracks)]
    );
    return 'postgres';
  } catch {
    return 'memory';
  }
}

app.post('/api/playlists/share', jamRateLimiterMiddleware, async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const name = String(body.name || 'Playlist SpotyFlow').trim().slice(0, 80);
  const description = String(body.description || '').trim().slice(0, 220);
  const ownerName = String(req.user?.displayName || body.ownerName || 'Pendengar SpotyFlow').trim().slice(0, 48);
  const collaborative = body.collaborative !== false;
  const rawTracks = Array.isArray(body.tracks) ? body.tracks.slice(0, 100) : [];
  const tracks = rawTracks.map(sanitizeSharedTrack).filter(Boolean);
  const coverRaw = String(body.cover || tracks[0]?.album?.cover_big || '/icon-512.png').trim();
  const cover = isAllowedProxyImageDomain(coverRaw) || coverRaw.startsWith('/') ? coverRaw.slice(0, 500) : '/icon-512.png';

  const existingCode = String(body.code || '').trim().toUpperCase();
  let code = generateSharedPlaylistCode();
  let ownerId = req.user?.id ? String(req.user.id) : '';
  if (/^PL-[A-Z0-9]{4,12}$/.test(existingCode)) {
    const existingPl = await getSharedPlaylistByCode(existingCode);
    if (existingPl) {
      // Anti-IDOR: hanya pemilik sah playlist yang boleh menimpa playlist bersama yang sudah ada
      if (!req.user?.id || !existingPl.ownerId || String(req.user.id) !== String(existingPl.ownerId)) {
        return res.status(403).json({
          ok: false,
          error: 'Anda tidak memiliki izin mengubah playlist bersama milik pengguna lain.',
        });
      }
      code = existingCode;
      ownerId = existingPl.ownerId;
    } else {
      code = existingCode;
    }
  }

  const pl = {
    code,
    name,
    description,
    cover,
    ownerName,
    ownerId,
    collaborative,
    tracks,
    updatedAt: new Date().toISOString(),
  };
  const storage = await saveSharedPlaylistRecord(pl);
  const baseUrl = getSelfBaseUrl(req) || 'https://spotyflow.vercel.app';
  return res.json({
    ok: true,
    code,
    storage,
    shareUrl: `${baseUrl}/share/playlist/${encodeURIComponent(code)}`,
    playlist: sanitizePublicSharedPlaylist(pl),
  });
});

app.get('/api/playlists/shared/:code', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pl = await getSharedPlaylistByCode(req.params.code);
  if (!pl) {
    return res.status(404).json({ ok: false, error: 'Playlist bersama tidak ditemukan atau sudah kedaluwarsa.' });
  }
  return res.json({ ok: true, playlist: sanitizePublicSharedPlaylist(pl) });
});

app.post('/api/playlists/shared/:code/tracks', jamRateLimiterMiddleware, async (req, res) => {
  const pl = await getSharedPlaylistByCode(req.params.code);
  if (!pl) {
    return res.status(404).json({ ok: false, error: 'Playlist bersama tidak ditemukan.' });
  }
  if (!pl.collaborative) {
    return res.status(403).json({ ok: false, error: 'Playlist ini bersifat baca-saja (kolaborasi dimatikan oleh pemilik).' });
  }
  const incoming = sanitizeSharedTrack(req.body?.track || req.body);
  if (!incoming) {
    return res.status(400).json({ ok: false, error: 'Data lagu tidak valid.' });
  }
  if (req.body?.addedBy) {
    incoming.addedBy = String(req.body.addedBy).trim().slice(0, 48);
  }
  const exists = pl.tracks.some(
    (t) =>
      String(t.id) === String(incoming.id) ||
      (String(t.title || '').toLowerCase() === incoming.title.toLowerCase() &&
        String(t.artist?.name || '').toLowerCase() === incoming.artist.name.toLowerCase())
  );
  if (exists) {
    return res.json({ ok: true, duplicate: true, playlist: sanitizePublicSharedPlaylist(pl) });
  }
  if (pl.tracks.length >= 150) {
    return res.status(400).json({ ok: false, error: 'Batas maksimal 150 lagu per playlist kolaboratif tercapai.' });
  }
  pl.tracks.push(incoming);
  if (!pl.cover || pl.cover === '/icon-512.png') {
    pl.cover = incoming.album.cover_big || pl.cover;
  }
  pl.updatedAt = new Date().toISOString();
  await saveSharedPlaylistRecord(pl);
  return res.json({ ok: true, added: incoming, playlist: sanitizePublicSharedPlaylist(pl) });
});

function resolveExistingFile(candidates) {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function escapeHtmlMeta(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const _cachedMainHtml = { file: '', raw: '' };

function loadMainHtmlString() {
  const htmlFile = resolveExistingFile([
    path.join(PUBLIC_DIR, 'index.html'),
    path.join(__dirname, 'spotyflow.html'),
    path.join(__dirname, 'index.html'),
  ]);
  if (!htmlFile) return null;
  if (_cachedMainHtml.file === htmlFile && _cachedMainHtml.raw) {
    return _cachedMainHtml;
  }
  _cachedMainHtml.file = htmlFile;
  _cachedMainHtml.raw = fs.readFileSync(htmlFile, 'utf8');
  return _cachedMainHtml;
}

function sendCompressedHtml(req, res, htmlString = null) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', SPOTYFLOW_HTML_CSP);
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Vary', 'Accept-Encoding');

  let raw = htmlString;
  if (raw === null) {
    const cached = loadMainHtmlString();
    if (!cached) return res.status(404).send('SpotyFlow HTML tidak ditemukan.');
    raw = cached.raw;
  }
  // Di Vercel Edge, kompresi Brotli/Gzip otomatis ditangani di Edge CDN tanpa membebani CPU Serverless
  if (process.env.VERCEL) {
    return res.status(200).send(raw);
  }
  const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (ae.includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    return res.status(200).send(zlib.gzipSync(Buffer.from(raw, 'utf8'), { level: 5 }));
  }
  return res.status(200).send(raw);
}

function injectDynamicOgHtml(rawHtml, { title, description, image, targetHash }) {
  const safeTitle = escapeHtmlMeta(title || 'SpotyFlow | Modern Hi-Fi Music Studio');
  const safeDesc = escapeHtmlMeta(description || 'Dengarkan musik Hi-Fi durasi penuh di SpotyFlow.');
  const safeImg = escapeHtmlMeta(image || '/icon-512.png');
  const safeHashJson = JSON.stringify(String(targetHash || '#/home')).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  let out = rawHtml
    .replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${safeTitle}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, () => `<meta name="description" content="${safeDesc}" />`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, () => `<meta property="og:title" content="${safeTitle}" />`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, () => `<meta property="og:description" content="${safeDesc}" />`)
    .replace(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i, () => `<meta property="og:image" content="${safeImg}" />`)
    .replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i, () => `<meta name="twitter:title" content="${safeTitle}" />`)
    .replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i, () => `<meta name="twitter:description" content="${safeDesc}" />`)
    .replace(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i, () => `<meta name="twitter:image" content="${safeImg}" />`);

  const redirectScript = `<script>if(!window.location.hash){window.history.replaceState(null,'','/'+${safeHashJson});}</script>`;
  out = out.replace('</head>', () => `${redirectScript}\n</head>`);
  return out;
}

function sendMainHtml(req, res) {
  return sendCompressedHtml(req, res, null);
}

// Dynamic Open Graph Share Routes (WhatsApp / Telegram / Discord / X Rich Preview)
app.get('/share/playlist/:code', async (req, res) => {
  const cached = loadMainHtmlString();
  if (!cached) return res.status(404).send('SpotyFlow HTML tidak ditemukan.');
  const code = String(req.params.code || '').trim().toUpperCase();
  const pl = await getSharedPlaylistByCode(code);
  const baseUrl = getSelfBaseUrl(req) || 'https://spotyflow.vercel.app';
  const imgUrl = pl?.cover && pl.cover.startsWith('http') ? pl.cover : `${baseUrl}/icon-512.png`;
  const html = injectDynamicOgHtml(cached.raw, {
    title: pl ? `${pl.name} — Playlist ${pl.collaborative ? 'Kolaboratif ' : ''}SpotyFlow` : 'Playlist Bersama SpotyFlow',
    description: pl
      ? `${pl.tracks.length} lagu oleh ${pl.ownerName}${pl.collaborative ? ' • Buka tautan untuk ikut tambah lagu & putar bersama!' : ' • Putar penuh di SpotyFlow Hi-Fi.'}`
      : 'Buka playlist bersama di SpotyFlow Hi-Fi Music Studio.',
    image: imgUrl,
    targetHash: `#/shared/${encodeURIComponent(code)}`,
  });
  return sendCompressedHtml(req, res, html);
});

app.get('/share/track/:id', async (req, res) => {
  const cached = loadMainHtmlString();
  if (!cached) return res.status(404).send('SpotyFlow HTML tidak ditemukan.');
  const id = String(req.params.id || '').trim();
  const qTitle = String(req.query.title || '').trim();
  const qArtist = String(req.query.artist || '').trim();
  const qCover = String(req.query.cover || '').trim();
  let title = qTitle;
  let artist = qArtist;
  let cover = isSafePublicUrl(qCover) ? qCover : '';

  if (!title && /^\d+$/.test(id)) {
    try {
      const dz = await fetchJson(`https://api.deezer.com/track/${encodeURIComponent(id)}`, 2800);
      if (dz?.title) {
        title = dz.title;
        artist = dz.artist?.name || artist;
        cover = dz.album?.cover_xl || dz.album?.cover_big || cover;
      }
    } catch {}
  }
  const baseUrl = getSelfBaseUrl(req) || 'https://spotyflow.vercel.app';
  const html = injectDynamicOgHtml(cached.raw, {
    title: title ? `${title}${artist ? ` — ${artist}` : ''} | SpotyFlow` : 'Dengarkan Lagu di SpotyFlow',
    description: title
      ? `Putar "${title}"${artist ? ` oleh ${artist}` : ''} dengan lirik sinkron AI & Hi-Fi EQ di SpotyFlow.`
      : 'Dengarkan lagu durasi penuh dengan lirik sinkron AI di SpotyFlow.',
    image: cover || `${baseUrl}/icon-512.png`,
    targetHash: `#/track/${encodeURIComponent(id)}`,
  });
  return sendCompressedHtml(req, res, html);
});

app.get('/share/artist/:id', async (req, res) => {
  const cached = loadMainHtmlString();
  if (!cached) return res.status(404).send('SpotyFlow HTML tidak ditemukan.');
  const id = String(req.params.id || '').trim();
  let name = String(req.query.name || '').trim();
  let picture = '';
  if (!name && /^\d+$/.test(id)) {
    try {
      const dz = await fetchJson(`https://api.deezer.com/artist/${encodeURIComponent(id)}`, 2800);
      if (dz?.name) {
        name = dz.name;
        picture = dz.picture_xl || dz.picture_big || '';
      }
    } catch {}
  }
  const baseUrl = getSelfBaseUrl(req) || 'https://spotyflow.vercel.app';
  const html = injectDynamicOgHtml(cached.raw, {
    title: name ? `${name} — Profil Artis | SpotyFlow` : 'Profil Artis | SpotyFlow',
    description: name ? `Dengarkan lagu populer & diskografi ${name} di SpotyFlow.` : 'Jelajahi profil artis & diskografi lengkap di SpotyFlow.',
    image: picture || `${baseUrl}/icon-512.png`,
    targetHash: `#/artist/${encodeURIComponent(id)}`,
  });
  return sendCompressedHtml(req, res, html);
});

function sendPwaAsset(res, filename, contentType, cacheControl) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', cacheControl);
  if (filename === 'sw.js') {
    res.setHeader('Service-Worker-Allowed', '/');
  }
  const found = resolveExistingFile([
    path.join(PUBLIC_DIR, filename),
    path.join(__dirname, filename),
  ]);
  if (found) return res.sendFile(found);
  if (contentType === 'image/png') return res.status(200).send(FALLBACK_ICON_PNG);
  return res.status(404).json({ error: `${filename} tidak ditemukan.` });
}

app.get(['/', '/index.html', '/spotyflow.html'], sendMainHtml);

app.get('/manifest.json', (_req, res) =>
  sendPwaAsset(res, 'manifest.json', 'application/manifest+json; charset=utf-8', 'public, max-age=3600')
);

app.get('/sw.js', (_req, res) =>
  sendPwaAsset(res, 'sw.js', 'application/javascript; charset=utf-8', 'no-cache, no-store, must-revalidate')
);

app.get('/icon-192.png', (_req, res) =>
  sendPwaAsset(res, 'icon-192.png', 'image/png', 'public, max-age=86400')
);

app.get('/icon-512.png', (_req, res) =>
  sendPwaAsset(res, 'icon-512.png', 'image/png', 'public, max-age=86400')
);

app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader('Cache-Control', ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=86400');
    },
  })
);

app.use((err, _req, res, _next) => {
  console.error('[SpotyFlow Serverless Error]', err?.message || err);
  if (!res.headersSent) {
    const status = Number(err?.status || err?.statusCode || 500);
    const safeMsg = status >= 500 ? 'Terjadi kesalahan internal server.' : (err?.message || 'Permintaan tidak valid.');
    res.status(status).json({ error: safeMsg });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`SpotyFlow Serverless Backend v${VERSION} berjalan di http://localhost:${PORT}`);
  });
}

module.exports = app;
