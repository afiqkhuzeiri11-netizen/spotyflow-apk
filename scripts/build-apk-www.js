'use strict';
/**
 * SpotyFlow Lean Production APK Web Asset Builder (scripts/build-apk-www.js)
 *  - Compiles official static minified Tailwind CSS v3 into www/assets/tailwind.min.css
 *    (zero cdn.tailwindcss.com runtime JS & zero MutationObserver overhead inside APK!)
 *  - Rewrites ONLY www/index.html (original spotyflow.html & public/index.html remain untouched for Vercel Web)
 *    to load ./assets/tailwind.min.css and guard tailwind.config against ReferenceError.
 *  - Copies ONLY core web assets: index.html, assets/tailwind.min.css, manifest.json, icon-192.png, icon-512.png.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const WWW_DIR = path.join(ROOT, 'www');
const WWW_ASSETS_DIR = path.join(WWW_DIR, 'assets');
const TAILWIND_INPUT = path.join(ROOT, 'scripts', 'tailwind.apk.input.css');
const TAILWIND_CONFIG = path.join(ROOT, 'tailwind.apk.config.js');
const TAILWIND_OUT = path.join(WWW_ASSETS_DIR, 'tailwind.min.css');

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

function compileStaticTailwindCss() {
  if (!fs.existsSync(TAILWIND_INPUT)) {
    console.error('[SpotyFlow APK Builder] ERROR: Missing', TAILWIND_INPUT);
    process.exit(1);
  }
  if (!fs.existsSync(TAILWIND_CONFIG)) {
    console.error('[SpotyFlow APK Builder] ERROR: Missing', TAILWIND_CONFIG);
    process.exit(1);
  }

  fs.mkdirSync(WWW_ASSETS_DIR, { recursive: true });
  console.log('  + Compiling official static Tailwind CSS -> www/assets/tailwind.min.css ...');
  execSync(
    'npx tailwindcss -i ./scripts/tailwind.apk.input.css -o ./www/assets/tailwind.min.css --config ./tailwind.apk.config.js --minify',
    { cwd: ROOT, stdio: 'inherit' }
  );

  if (!fs.existsSync(TAILWIND_OUT)) {
    console.error('[SpotyFlow APK Builder] ERROR: www/assets/tailwind.min.css tidak terbentuk!');
    process.exit(1);
  }
  const cssSize = fs.statSync(TAILWIND_OUT).size;
  if (cssSize <= 15 * 1024) {
    console.error(`[SpotyFlow APK Builder] ERROR: www/assets/tailwind.min.css terlalu kecil (${cssSize} bytes <= 15 KB)!`);
    process.exit(1);
  }
  console.log(`  + Compiled static Tailwind CSS: ${(cssSize / 1024).toFixed(1)} KB (${cssSize} bytes)`);
}

function buildApkHtml(htmlSrcPath, destPath) {
  let html = fs.readFileSync(htmlSrcPath, 'utf8');

  // 1. Replace Tailwind Play CDN <script> with compiled static stylesheet
  const cdnRegex = /<script\b[^>]*src=["']https:\/\/cdn\.tailwindcss\.com[^"']*["'][^>]*>\s*<\/script>/i;
  if (!cdnRegex.test(html)) {
    console.error('[SpotyFlow APK Builder] ERROR: Tag <script src="https://cdn.tailwindcss.com..."> tidak ditemukan di HTML!');
    process.exit(1);
  }
  html = html.replace(cdnRegex, '<link rel="stylesheet" href="./assets/tailwind.min.css" />');

  // 2. Safely guard `tailwind.config = { ... };` so it NEVER throws ReferenceError in APK
  const twConfigRegex = /^(\s*)tailwind\.config\s*=\s*\{[\s\S]*?^\1\};/m;
  if (twConfigRegex.test(html)) {
    html = html.replace(twConfigRegex, (match, indent) => {
      return `${indent}if (typeof tailwind !== 'undefined') {\n${match}\n${indent}}`;
    });
  } else if (/tailwind\.config\s*=/.test(html)) {
    // Fallback guard for any single-line tailwind.config assignment
    html = html.replace(/tailwind\.config\s*=/g, "if (typeof tailwind !== 'undefined') tailwind.config =");
  }

  // 3. Strict self-verification on www/index.html
  if (/cdn\.tailwindcss\.com/i.test(html)) {
    console.error('[SpotyFlow APK Builder] ERROR: cdn.tailwindcss.com masih tersisa di www/index.html!');
    process.exit(1);
  }
  if (!html.includes('./assets/tailwind.min.css')) {
    console.error('[SpotyFlow APK Builder] ERROR: ./assets/tailwind.min.css tidak terpasang di www/index.html!');
    process.exit(1);
  }
  if (/(^|[^\w$])tailwind\.config\s*=/.test(html) && !html.includes("typeof tailwind !== 'undefined'")) {
    console.error('[SpotyFlow APK Builder] ERROR: tailwind.config belum dibungkus guard typeof tailwind !== undefined!');
    process.exit(1);
  }

  fs.writeFileSync(destPath, html, 'utf8');
  console.log('  + HTML -> www/index.html (static Tailwind CSS, guarded tailwind.config, source: ' + path.relative(ROOT, htmlSrcPath) + ')');
}

function main() {
  const t0 = Date.now();
  console.log('[SpotyFlow Production APK Builder] Cleaning and preparing lightweight www/ ...');
  fs.rmSync(WWW_DIR, { recursive: true, force: true });
  fs.mkdirSync(WWW_ASSETS_DIR, { recursive: true });

  const htmlSrc = findFirstExisting([
    path.join(ROOT, 'spotyflow.html'),
    path.join(ROOT, 'public', 'index.html'),
    path.join(ROOT, 'index.html'),
  ]);
  if (!htmlSrc) {
    console.error('[SpotyFlow APK Builder] ERROR: spotyflow.html / public/index.html tidak ditemukan!');
    process.exit(1);
  }

  compileStaticTailwindCss();
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

  const totalBytes = getDirSizeBytes(WWW_DIR);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[SpotyFlow Production APK Builder] SELESAI dalam ${elapsed}s | Total www/: ${totalMb} MB (${totalBytes} bytes)`);
}

main();
