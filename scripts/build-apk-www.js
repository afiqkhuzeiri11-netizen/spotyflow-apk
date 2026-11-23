'use strict';
/**
 * SpotyFlow v4.0.0 Clean Modular Production APK Web Asset Builder (scripts/build-apk-www.js)
 *  - Copies clean spotyflow.html -> www/index.html (zero cdn.tailwindcss.com runtime JS!)
 *  - Copies entire public/sf/ modular engine (sf-auralys.css + all 10 sf-*.js) -> www/sf/
 *  - Verifies every required modular file exists and is non-empty before succeeding.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT, 'www');
const PUBLIC_SF_DIR = path.join(ROOT, 'public', 'sf');
const WWW_SF_DIR = path.join(WWW_DIR, 'sf');

const REQUIRED_SF_FILES = [
  'sf-auralys.css',
  'sf-store.js',
  'sf-api.js',
  'sf-audio.js',
  'sf-lyrics.js',
  'sf-ui-dock.js',
  'sf-ui-views.js',
  'sf-ui-player.js',
  'sf-ui-settings.js',
  'sf-poster3d.js',
  'sf-main.js',
];

function copyFirstExisting(candidates, destPath) {
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, destPath);
      return src;
    }
  }
  return null;
}

function findFirstExisting(candidates) {
  for (const src of candidates) {
    if (fs.existsSync(src)) return src;
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

function copyModularSfFolder() {
  if (!fs.existsSync(PUBLIC_SF_DIR)) {
    console.error('[SpotyFlow APK Builder] ERROR: Folder public/sf/ tidak ditemukan!');
    process.exit(1);
  }
  fs.mkdirSync(WWW_SF_DIR, { recursive: true });
  const entries = fs.readdirSync(PUBLIC_SF_DIR, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    fs.copyFileSync(path.join(PUBLIC_SF_DIR, entry.name), path.join(WWW_SF_DIR, entry.name));
    count++;
  }
  for (const reqFile of REQUIRED_SF_FILES) {
    const target = path.join(WWW_SF_DIR, reqFile);
    if (!fs.existsSync(target) || fs.statSync(target).size < 200) {
      console.error(`[SpotyFlow APK Builder] ERROR: Modul wajib www/sf/${reqFile} hilang atau terlalu kecil!`);
      process.exit(1);
    }
  }
  console.log(`  + Modular Engine -> www/sf/ (${count} files verified, all ${REQUIRED_SF_FILES.length} core modules OK)`);
}

function buildApkHtml(htmlSrcPath, destPath) {
  const html = fs.readFileSync(htmlSrcPath, 'utf8');
  if (/cdn\.tailwindcss\.com/i.test(html)) {
    console.error('[SpotyFlow APK Builder] ERROR: cdn.tailwindcss.com masih ada di spotyflow.html!');
    process.exit(1);
  }
  if (!html.includes('./sf/sf-auralys.css')) {
    console.error('[SpotyFlow APK Builder] ERROR: ./sf/sf-auralys.css belum dimuat di spotyflow.html!');
    process.exit(1);
  }
  fs.writeFileSync(destPath, html, 'utf8');
  console.log('  + HTML -> www/index.html (v4.0.0 Clean Modular Shell, source: ' + path.relative(ROOT, htmlSrcPath) + ')');
}

function main() {
  const t0 = Date.now();
  console.log('[SpotyFlow v4.0.0 APK Builder] Preparing ultra-lean modular www/ ...');
  fs.rmSync(WWW_DIR, { recursive: true, force: true });
  fs.mkdirSync(WWW_DIR, { recursive: true });

  const htmlSrc = findFirstExisting([
    path.join(ROOT, 'spotyflow.html'),
    path.join(ROOT, 'public', 'index.html'),
    path.join(ROOT, 'index.html'),
  ]);
  if (!htmlSrc) {
    console.error('[SpotyFlow APK Builder] ERROR: spotyflow.html tidak ditemukan!');
    process.exit(1);
  }

  copyModularSfFolder();
  buildApkHtml(htmlSrc, path.join(WWW_DIR, 'index.html'));

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

  const totalKb = (getDirSizeBytes(WWW_DIR) / 1024).toFixed(1);
  console.log(`[SpotyFlow v4.0.0 APK Builder] SELESAI dalam ${Date.now() - t0}ms — total www/: ${totalKb} KB`);
}

main();
