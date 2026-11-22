'use strict';
/**
 * SpotyFlow Lean APK Web Asset Builder (scripts/build-apk-www.js)
 * Prepares a fast, lightweight www/ bundle (~1.5 MB) for Capacitor 6 + Media3 ExoPlayer Android APK (~12–20 MB final).
 * Copies ONLY core web assets: index.html, manifest.json, icon-192.png, icon-512.png (zero dummy WAV/WASM bloat).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT, 'www');

function copyFirstExisting(candidates, destPath) {
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, destPath);
      return src;
    }
  }
  return null;
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

function main() {
  const t0 = Date.now();
  console.log('[SpotyFlow Lean APK Builder] Cleaning and preparing lightweight www/ ...');
  fs.rmSync(WWW_DIR, { recursive: true, force: true });
  fs.mkdirSync(WWW_DIR, { recursive: true });

  const htmlSrc = copyFirstExisting(
    [path.join(ROOT, 'spotyflow.html'), path.join(ROOT, 'public', 'index.html'), path.join(ROOT, 'index.html')],
    path.join(WWW_DIR, 'index.html')
  );
  if (!htmlSrc) {
    console.error('[SpotyFlow Lean APK Builder] ERROR: spotyflow.html / public/index.html tidak ditemukan!');
    process.exit(1);
  }
  console.log('  + HTML -> www/index.html (from ' + path.relative(ROOT, htmlSrc) + ')');

  const manifestSrc = copyFirstExisting(
    [path.join(ROOT, 'public', 'manifest.json'), path.join(ROOT, 'manifest.json')],
    path.join(WWW_DIR, 'manifest.json')
  );
  if (manifestSrc) console.log('  + Manifest -> www/manifest.json');

  const icon192 = copyFirstExisting(
    [path.join(ROOT, 'public', 'icon-192.png'), path.join(ROOT, 'icon-192.png')],
    path.join(WWW_DIR, 'icon-192.png')
  );
  if (icon192) console.log('  + Icon -> www/icon-192.png');

  const icon512 = copyFirstExisting(
    [path.join(ROOT, 'public', 'icon-512.png'), path.join(ROOT, 'icon-512.png')],
    path.join(WWW_DIR, 'icon-512.png')
  );
  if (icon512) console.log('  + Icon -> www/icon-512.png');

  const totalBytes = getDirSizeBytes(WWW_DIR);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[SpotyFlow Lean APK Builder] SELESAI dalam ${elapsed}s | Total www/: ${totalMb} MB (${totalBytes} bytes)`);
}

main();
