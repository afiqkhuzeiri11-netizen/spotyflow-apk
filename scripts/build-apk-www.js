'use strict';
/**
 * SpotyFlow Offline Studio HD Asset Builder (scripts/build-apk-www.js)
 * Pure Node.js (zero extra dependencies) — prepares www/ (~195 MB) for Capacitor 6 Android APK:
 *  - www/index.html (from spotyflow.html / public/index.html) + PWA manifest & icons
 *  - www/vendor/ffmpeg/ (ffmpeg-core.js & ffmpeg-core.wasm ~32 MB from @ffmpeg/core)
 *  - www/assets/audio/ambient/ (5 x 150s 48kHz 16-bit Stereo seamless WAVs, ~144 MB total)
 *  - www/assets/audio/ir/      (5 x 48kHz 24-bit Stereo Studio Impulse Responses, ~12 MB total)
 *  - www/assets/audio/sfx/     (2 x 48kHz 16-bit Stereo Chime SFX, ~2.1 MB total)
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT, 'www');
const AMBIENT_DIR = path.join(WWW_DIR, 'assets', 'audio', 'ambient');
const IR_DIR = path.join(WWW_DIR, 'assets', 'audio', 'ir');
const SFX_DIR = path.join(WWW_DIR, 'assets', 'audio', 'sfx');
const FFMPEG_DIR = path.join(WWW_DIR, 'vendor', 'ffmpeg');

const SAMPLE_RATE = 48000;
const CHANNELS = 2;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildWavHeader({ sampleRate, channels, bitsPerSample, dataByteLength }) {
  const header = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataByteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataByteLength, 40);
  return header;
}

// Deterministic fast PRNG (Mulberry32) so audio builds are clean and reproducible
function createRng(seed) {
  let a = seed >>> 0;
  return function nextRand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp1(x) {
  return x > 0.98 ? 0.98 : x < -0.98 ? -0.98 : x;
}

/**
 * Generates a 150-second 48kHz 16-bit Stereo seamless ambient loop WAV
 * with 2-second equal-power crossfade between tail and head (zero loop clicks).
 * Streams chunk-by-chunk to disk to keep peak memory tiny.
 */
function generateAmbientWav(filePath, kind, durationSec = 150, seed = 1337) {
  const totalFrames = Math.floor(SAMPLE_RATE * durationSec);
  const xfadeFrames = SAMPLE_RATE * 2; // 2-second seamless loop crossfade
  const dataBytes = totalFrames * CHANNELS * 2;

  const rng = createRng(seed);
  const randBi = () => rng() * 2 - 1;

  // Per-channel filter states for realistic studio soundscapes
  const st = [
    { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0, brown: 0, lp1: 0, lp2: 0, hp: 0, prevIn: 0 },
    { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0, brown: 0, lp1: 0, lp2: 0, hp: 0, prevIn: 0 },
  ];

  function synthSample(ch, frameIdx) {
    const s = st[ch];
    const w = randBi();
    const t = frameIdx / SAMPLE_RATE;

    // Paul Kellet pink noise
    s.b0 = 0.99886 * s.b0 + w * 0.0555179;
    s.b1 = 0.99332 * s.b1 + w * 0.0750759;
    s.b2 = 0.96900 * s.b2 + w * 0.1538520;
    s.b3 = 0.86650 * s.b3 + w * 0.3104856;
    s.b4 = 0.55000 * s.b4 + w * 0.5329522;
    s.b5 = -0.7616 * s.b5 - w * 0.0168980;
    const pink = (s.b0 + s.b1 + s.b2 + s.b3 + s.b4 + s.b5 + s.b6 + w * 0.5362) * 0.11;
    s.b6 = w * 0.115926;

    // Smooth brown noise
    s.brown = (s.brown + 0.022 * w) / 1.022;
    const brown = s.brown * 3.2;

    if (kind === 'rain') {
      // Steady tropical rain (band-shaped pink + gentle droplet sparkles)
      s.lp1 += 0.24 * (pink - s.lp1);
      const hp = s.lp1 - s.lp2;
      s.lp2 += 0.03 * (s.lp1 - s.lp2);
      const drop = rng() > 0.9994 ? randBi() * 0.28 : 0;
      const swell = 0.88 + 0.12 * Math.sin(2 * Math.PI * 0.04 * t + ch * 1.1);
      return clamp1((hp * 1.35 + drop) * swell * 0.58);
    }

    if (kind === 'ocean') {
      // Rolling stereo ocean surf with slow organic wave cycles
      s.lp1 += 0.055 * (brown - s.lp1);
      s.lp2 += 0.14 * (pink - s.lp2);
      const waveA = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.11 * t + ch * 0.45);
      const waveB = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.043 * t + 1.7 - ch * 0.3);
      const surf = 0.28 + 0.72 * Math.pow(waveA * 0.65 + waveB * 0.35, 1.5);
      const foam = s.lp2 * Math.pow(waveA, 2.2) * 0.32;
      return clamp1((s.lp1 * surf * 0.85 + foam) * 0.68);
    }

    if (kind === 'fireplace') {
      // Deep hearth warmth + organic wood embers & crackles
      s.lp1 += 0.024 * (brown - s.lp1);
      const flicker = 0.75 + 0.25 * Math.sin(2 * Math.PI * 0.27 * t + ch * 0.8);
      const rawPop = rng() > 0.9992 ? randBi() * (0.45 + rng() * 0.45) : 0;
      s.hp = 0.82 * (s.hp + rawPop - s.prevIn);
      s.prevIn = rawPop;
      return clamp1((s.lp1 * flicker * 0.8 + s.hp * 0.55) * 0.65);
    }

    if (kind === 'cafe') {
      // Cozy coffee shop room tone (warm mid murmur + soft air)
      s.lp1 += 0.12 * (pink - s.lp1);
      s.lp2 += 0.018 * (s.lp1 - s.lp2);
      const midBand = s.lp1 - s.lp2;
      const chatterLfo = 0.78 + 0.22 * Math.sin(2 * Math.PI * 0.16 * t + ch * 1.4) * Math.cos(2 * Math.PI * 0.07 * t);
      const clink = rng() > 0.99985 ? Math.sin(2 * Math.PI * (2400 + ch * 220) * t) * 0.18 : 0;
      return clamp1((midBand * chatterLfo * 1.25 + s.lp2 * 0.4 + clink) * 0.55);
    }

    // lofi: Warm analog vinyl crackle + gentle tape hiss + subtle warm floor
    const dust = rng() > 0.9989 ? randBi() * (0.3 + rng() * 0.4) : 0;
    s.hp = 0.78 * (s.hp + dust - s.prevIn);
    s.prevIn = dust;
    s.lp1 += 0.11 * (pink - s.lp1);
    s.lp2 += 0.015 * (brown - s.lp2);
    return clamp1((s.hp * 0.45 + s.lp1 * 0.18 + s.lp2 * 0.22) * 0.62);
  }

  // Pre-synthesize the extra 2s tail buffer so we can seamlessly equal-power crossfade it into the first 2s
  const headL = new Float32Array(xfadeFrames);
  const headR = new Float32Array(xfadeFrames);
  for (let i = 0; i < xfadeFrames; i++) {
    headL[i] = synthSample(0, i);
    headR[i] = synthSample(1, i);
  }

  const fd = fs.openSync(filePath, 'w');
  try {
    fs.writeSync(fd, buildWavHeader({ sampleRate: SAMPLE_RATE, channels: CHANNELS, bitsPerSample: 16, dataByteLength: dataBytes }));

    // Write middle frames (xfadeFrames .. totalFrames - 1), keeping space at offset 44 for blended head
    // Easier & 100% single-pass: write placeholder head, write body, synthesize 2s post-tail, then overwrite blended head at offset 44!
    const chunkFrames = SAMPLE_RATE; // 1 second per write chunk (~192 KB)
    const chunkBuf = Buffer.alloc(chunkFrames * CHANNELS * 2);

    // Reserve head region first (write raw head)
    for (let offset = 0; offset < xfadeFrames; offset += chunkFrames) {
      const n = Math.min(chunkFrames, xfadeFrames - offset);
      for (let i = 0; i < n; i++) {
        chunkBuf.writeInt16LE(Math.round(headL[offset + i] * 32767), i * 4);
        chunkBuf.writeInt16LE(Math.round(headR[offset + i] * 32767), i * 4 + 2);
      }
      fs.writeSync(fd, chunkBuf, 0, n * 4);
    }

    // Write main body (xfadeFrames .. totalFrames - 1)
    for (let pos = xfadeFrames; pos < totalFrames; pos += chunkFrames) {
      const n = Math.min(chunkFrames, totalFrames - pos);
      for (let i = 0; i < n; i++) {
        const l = synthSample(0, pos + i);
        const r = synthSample(1, pos + i);
        chunkBuf.writeInt16LE(Math.round(l * 32767), i * 4);
        chunkBuf.writeInt16LE(Math.round(r * 32767), i * 4 + 2);
      }
      fs.writeSync(fd, chunkBuf, 0, n * 4);
    }

    // Synthesize 2s wraparound tail and equal-power crossfade into head [0..xfadeFrames)
    for (let offset = 0; offset < xfadeFrames; offset += chunkFrames) {
      const n = Math.min(chunkFrames, xfadeFrames - offset);
      for (let i = 0; i < n; i++) {
        const idx = offset + i;
        const frac = idx / xfadeFrames;
        const fadeIn = Math.sin(frac * Math.PI * 0.5);
        const fadeOut = Math.cos(frac * Math.PI * 0.5);
        const tailL = synthSample(0, totalFrames + idx);
        const tailR = synthSample(1, totalFrames + idx);
        const blendedL = clamp1(headL[idx] * fadeIn + tailL * fadeOut);
        const blendedR = clamp1(headR[idx] * fadeIn + tailR * fadeOut);
        chunkBuf.writeInt16LE(Math.round(blendedL * 32767), i * 4);
        chunkBuf.writeInt16LE(Math.round(blendedR * 32767), i * 4 + 2);
      }
      fs.writeSync(fd, chunkBuf, 0, n * 4, 44 + offset * 4);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Generates a 48kHz 24-bit Stereo Studio Acoustic Impulse Response WAV
 * with realistic early reflections & frequency-damped decay tail.
 */
function generateImpulseResponseWav(filePath, spec, seed = 4242) {
  const totalFrames = Math.floor(SAMPLE_RATE * spec.fileDurationSec);
  const activeFrames = Math.floor(SAMPLE_RATE * spec.activeDecaySec);
  const bytesPerSample = 3; // 24-bit PCM
  const frameBytes = CHANNELS * bytesPerSample;
  const dataBytes = totalFrames * frameBytes;
  const rng = createRng(seed);

  const fd = fs.openSync(filePath, 'w');
  try {
    fs.writeSync(fd, buildWavHeader({ sampleRate: SAMPLE_RATE, channels: CHANNELS, bitsPerSample: 24, dataByteLength: dataBytes }));
    const chunkFrames = 24000;
    const buf = Buffer.alloc(chunkFrames * frameBytes);
    const lp = [0, 0];

    const writeInt24LE = (buffer, valFloat, byteOffset) => {
      const scaled = Math.max(-8388607, Math.min(8388607, Math.round(valFloat * 8388607)));
      const u = scaled < 0 ? scaled + 0x1000000 : scaled;
      buffer[byteOffset] = u & 0xff;
      buffer[byteOffset + 1] = (u >> 8) & 0xff;
      buffer[byteOffset + 2] = (u >> 16) & 0xff;
    };

    const earlyTapFrames = (spec.earlyMs || []).map((ms) => Math.floor((ms / 1000) * SAMPLE_RATE));

    for (let pos = 0; pos < totalFrames; pos += chunkFrames) {
      const n = Math.min(chunkFrames, totalFrames - pos);
      for (let i = 0; i < n; i++) {
        const f = pos + i;
        const env = f < activeFrames ? Math.pow(1 - f / activeFrames, spec.decayPow) : 0;
        const microTail = f >= activeFrames ? Math.exp(-(f - activeFrames) / (SAMPLE_RATE * 0.4)) * 0.0004 : 0;
        const effEnv = env + microTail;
        for (let ch = 0; ch < 2; ch++) {
          let raw = (rng() * 2 - 1) * effEnv;
          if (f === 0) raw = ch === 0 ? 0.92 : 0.88;
          for (let tIdx = 0; tIdx < earlyTapFrames.length; tIdx++) {
            if (f === earlyTapFrames[tIdx]) {
              raw += ((tIdx + ch) % 2 === 0 ? 0.48 : -0.44) * Math.pow(0.74, tIdx);
            }
          }
          // High-frequency air absorption over time
          const lpAlpha = Math.max(0.08, spec.lpStart * (1 - 0.65 * Math.min(1, f / activeFrames)));
          lp[ch] += lpAlpha * (raw - lp[ch]);
          writeInt24LE(buf, clamp1(lp[ch] * 0.72), i * frameBytes + ch * 3);
        }
      }
      fs.writeSync(fd, buf, 0, n * frameBytes);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Generates 48kHz 16-bit Stereo Studio SFX / Chime WAVs (~1.05 MB each).
 */
function generateChimeWav(filePath, kind, durationSec = 5.5) {
  const totalFrames = Math.floor(SAMPLE_RATE * durationSec);
  const dataBytes = totalFrames * CHANNELS * 2;
  const buf = Buffer.alloc(dataBytes);

  const notes =
    kind === 'pomodoro_bell'
      ? [
          { start: 0.0, freq: 528.0, amp: 0.45, decay: 1.4 },
          { start: 0.0, freq: 1056.0, amp: 0.22, decay: 2.1 },
          { start: 0.0, freq: 1584.0, amp: 0.12, decay: 2.9 },
          { start: 1.6, freq: 660.0, amp: 0.40, decay: 1.3 },
          { start: 1.6, freq: 1320.0, amp: 0.18, decay: 2.2 },
        ]
      : [
          { start: 0.0, freq: 261.63, amp: 0.28, decay: 1.2 },
          { start: 0.35, freq: 329.63, amp: 0.28, decay: 1.2 },
          { start: 0.7, freq: 392.0, amp: 0.28, decay: 1.1 },
          { start: 1.05, freq: 493.88, amp: 0.30, decay: 1.0 },
          { start: 1.4, freq: 587.33, amp: 0.34, decay: 0.9 },
          { start: 2.4, freq: 523.25, amp: 0.36, decay: 0.85 },
        ];

  for (let i = 0; i < totalFrames; i++) {
    const t = i / SAMPLE_RATE;
    let l = 0;
    let r = 0;
    for (let nIdx = 0; nIdx < notes.length; nIdx++) {
      const note = notes[nIdx];
      if (t < note.start) continue;
      const dt = t - note.start;
      const attack = Math.min(1, dt / 0.015);
      const env = attack * Math.exp(-dt * note.decay);
      const phase = 2 * Math.PI * note.freq * dt;
      const sample = (Math.sin(phase) + 0.25 * Math.sin(phase * 2)) * note.amp * env;
      const pan = nIdx % 2 === 0 ? 0.55 : 0.45;
      l += sample * pan;
      r += sample * (1 - pan);
    }
    buf.writeInt16LE(Math.round(clamp1(l) * 32767), i * 4);
    buf.writeInt16LE(Math.round(clamp1(r) * 32767), i * 4 + 2);
  }

  const fd = fs.openSync(filePath, 'w');
  try {
    fs.writeSync(fd, buildWavHeader({ sampleRate: SAMPLE_RATE, channels: CHANNELS, bitsPerSample: 16, dataByteLength: dataBytes }));
    fs.writeSync(fd, buf);
  } finally {
    fs.closeSync(fd);
  }
}

function getDirSizeBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += getDirSizeBytes(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

function copyFirstExisting(candidates, destPath) {
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, destPath);
      return src;
    }
  }
  return null;
}

function main() {
  const t0 = Date.now();
  console.log('[SpotyFlow APK Builder] Cleaning and preparing www/ ...');
  fs.rmSync(WWW_DIR, { recursive: true, force: true });
  ensureDir(AMBIENT_DIR);
  ensureDir(IR_DIR);
  ensureDir(SFX_DIR);
  ensureDir(FFMPEG_DIR);

  // 1. Copy core web app & PWA icons
  const htmlCopied = copyFirstExisting(
    [path.join(ROOT, 'spotyflow.html'), path.join(ROOT, 'public', 'index.html'), path.join(ROOT, 'index.html')],
    path.join(WWW_DIR, 'index.html')
  );
  if (!htmlCopied) throw new Error('spotyflow.html / public/index.html tidak ditemukan!');
  console.log('  + HTML -> www/index.html (from ' + path.relative(ROOT, htmlCopied) + ')');

  copyFirstExisting([path.join(ROOT, 'public', 'manifest.json'), path.join(ROOT, 'manifest.json')], path.join(WWW_DIR, 'manifest.json'));
  copyFirstExisting([path.join(ROOT, 'public', 'icon-192.png'), path.join(ROOT, 'icon-192.png')], path.join(WWW_DIR, 'icon-192.png'));
  copyFirstExisting([path.join(ROOT, 'public', 'icon-512.png'), path.join(ROOT, 'icon-512.png')], path.join(WWW_DIR, 'icon-512.png'));

  // 2. Copy FFmpeg WASM binaries (~32 MB) from node_modules/@ffmpeg/core
  const ffmpegSearchDirs = [
    path.join(ROOT, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd'),
    path.join(ROOT, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm'),
  ];
  let ffmpegCopiedCount = 0;
  for (const fname of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
    const found = copyFirstExisting(
      ffmpegSearchDirs.map((d) => path.join(d, fname)),
      path.join(FFMPEG_DIR, fname)
    );
    if (found) {
      ffmpegCopiedCount++;
      const sz = (fs.statSync(path.join(FFMPEG_DIR, fname)).size / 1048576).toFixed(2);
      console.log(`  + FFmpeg -> www/vendor/ffmpeg/${fname} (${sz} MB)`);
    }
  }
  if (ffmpegCopiedCount === 0) {
    console.warn('  ! Peringatan: @ffmpeg/core belum terpasang di node_modules (jalankan npm install terlebih dahulu).');
  }

  // 3. Generate 5 HD Ambient Soundscapes (48kHz 16-bit Stereo, 150s each, ~144 MB total)
  const ambients = [
    { name: 'rain.wav', kind: 'rain', seed: 101 },
    { name: 'ocean.wav', kind: 'ocean', seed: 202 },
    { name: 'fireplace.wav', kind: 'fireplace', seed: 303 },
    { name: 'cafe.wav', kind: 'cafe', seed: 404 },
    { name: 'lofi.wav', kind: 'lofi', seed: 505 },
  ];
  for (const amb of ambients) {
    const out = path.join(AMBIENT_DIR, amb.name);
    generateAmbientWav(out, amb.kind, 150, amb.seed);
    const sz = (fs.statSync(out).size / 1048576).toFixed(2);
    console.log(`  + Ambient HD -> www/assets/audio/ambient/${amb.name} (${sz} MB)`);
  }

  // 4. Generate 5 Studio 3D Impulse Responses (48kHz 24-bit Stereo, ~12 MB total)
  const irSpecs = [
    { name: 'stadium.wav', fileDurationSec: 10.0, activeDecaySec: 3.4, decayPow: 1.9, lpStart: 0.85, earlyMs: [28, 64, 118, 175], seed: 1111 },
    { name: 'concert_hall.wav', fileDurationSec: 9.5, activeDecaySec: 2.8, decayPow: 2.1, lpStart: 0.78, earlyMs: [22, 48, 86, 132], seed: 2222 },
    { name: 'rain_room.wav', fileDurationSec: 8.5, activeDecaySec: 1.8, decayPow: 2.6, lpStart: 0.62, earlyMs: [14, 32, 58], seed: 3333 },
    { name: 'studio.wav', fileDurationSec: 7.0, activeDecaySec: 0.55, decayPow: 4.2, lpStart: 0.90, earlyMs: [6, 14, 24], seed: 4444 },
    { name: 'car.wav', fileDurationSec: 6.5, activeDecaySec: 0.48, decayPow: 4.6, lpStart: 0.45, earlyMs: [4, 11, 19], seed: 5555 },
  ];
  for (const ir of irSpecs) {
    const out = path.join(IR_DIR, ir.name);
    generateImpulseResponseWav(out, ir, ir.seed);
    const sz = (fs.statSync(out).size / 1048576).toFixed(2);
    console.log(`  + Studio IR 24-bit -> www/assets/audio/ir/${ir.name} (${sz} MB)`);
  }

  // 5. Generate 2 SFX & Alarm Chimes (48kHz 16-bit Stereo, ~2.1 MB total)
  for (const sfx of ['pomodoro_bell', 'alarm_chime']) {
    const out = path.join(SFX_DIR, `${sfx}.wav`);
    generateChimeWav(out, sfx, 5.5);
    const sz = (fs.statSync(out).size / 1048576).toFixed(2);
    console.log(`  + Studio SFX -> www/assets/audio/sfx/${sfx}.wav (${sz} MB)`);
  }

  const totalBytes = getDirSizeBytes(WWW_DIR);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[SpotyFlow APK Builder] SELESAI dalam ${elapsed}s | Total ukuran www/: ${totalMb} MB (${totalBytes} bytes)`);
}

main();
