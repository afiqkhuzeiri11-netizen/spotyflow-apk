'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SF_MODULES = [
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

let fails = 0;

function pass(label, detail = '') {
  console.log(`PASS  ${label}${detail ? ' — ' + detail : ''}`);
}

function fail(label, detail = '') {
  fails++;
  console.error(`FAIL  ${label}${detail ? ' — ' + detail : ''}`);
}

function runNodeCheck(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return fail(`node --check ${relPath}`, 'file tidak ditemukan');
  const res = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  if (res.status === 0) pass(`node --check ${relPath}`);
  else fail(`node --check ${relPath}`, (res.stderr || res.stdout || '').trim());
}

function httpGetLocal(port, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: reqPath, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function main() {
  console.log('=== SpotyFlow v4.0.0 Automated Verification Suite ===');

  // 1. Syntax check server, build scripts & all 10 modular files
  runNodeCheck('server.js');
  runNodeCheck('scripts/build-apk-www.js');
  runNodeCheck('scripts/patch-android-apk.js');
  for (const mod of SF_MODULES) {
    runNodeCheck(`public/sf/${mod}`);
  }

  // 2. Check ZERO TODO / FIXME / hardcoded secrets in public/sf/*.js
  for (const mod of SF_MODULES) {
    const full = path.join(ROOT, 'public/sf', mod);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    if (/\b(TODO|FIXME)\b/.test(src)) {
      fail(`No TODO/FIXME in public/sf/${mod}`, 'ditemukan komentar TODO/FIXME');
    } else if (/GOCSPX-|AQ\.Ab8/.test(src)) {
      fail(`No secrets in public/sf/${mod}`, 'terdeteksi token/secret!');
    } else if (src.length < 1024) {
      fail(`Size public/sf/${mod}`, `terlalu kecil (${src.length} bytes)`);
    } else {
      pass(`Clean & non-stub public/sf/${mod}`, `${(src.length / 1024).toFixed(1)} KB`);
    }
  }

  // 3. Check spotyflow.html cleanliness, script order & inline script syntax
  const htmlPath = path.join(ROOT, 'spotyflow.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('./sf/sf-auralys.css')) fail('spotyflow.html CSS link', 'missing ./sf/sf-auralys.css');
  else pass('spotyflow.html loads ./sf/sf-auralys.css');

  const forbiddenHtml = ['cdn.tailwindcss.com', '#sf-v2-auralys-style', '#sf-liquid-overhaul-css', '#sf-v3-parity-css'];
  const badFound = forbiddenHtml.filter((t) => html.includes(t));
  if (badFound.length) fail('spotyflow.html legacy purge', `masih ada: ${badFound.join(', ')}`);
  else pass('spotyflow.html free of Tailwind CDN & legacy style blocks');

  let lastPos = -1;
  let orderOk = true;
  for (const mod of SF_MODULES) {
    const needle = `./sf/${mod}`;
    const pos = html.indexOf(needle);
    if (pos < 0 || pos < lastPos) {
      fail('spotyflow.html script order', `masalah urutan atau hilang: ${needle}`);
      orderOk = false;
      break;
    }
    lastPos = pos;
  }
  if (orderOk) pass('spotyflow.html loads all 10 sf-*.js modules in strict deterministic order');

  // Inline <script> syntax check via vm.Script
  const inlineRe = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let inlineIdx = 0;
  let m;
  while ((m = inlineRe.exec(html))) {
    const code = (m[1] || '').trim();
    if (!code) continue;
    inlineIdx++;
    try {
      new vm.Script(code, { filename: `spotyflow.html#inline-${inlineIdx}` });
      pass(`spotyflow.html inline <script> #${inlineIdx}`);
    } catch (e) {
      fail(`spotyflow.html inline <script> #${inlineIdx}`, e.message);
    }
  }

  // 4. Check capacitor.config.json
  const cap = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
  if (cap.appId === 'com.netease.cloudmusic' && cap.appName === 'SpotyFlow' && !cap.server?.url) {
    pass('capacitor.config.json invariants', 'appId=com.netease.cloudmusic, appName=SpotyFlow, no server.url');
  } else {
    fail('capacitor.config.json invariants', JSON.stringify(cap));
  }

  // 5. Check scripts/patch-android-apk.js + templates
  const patchSrc = fs.readFileSync(path.join(ROOT, 'scripts/patch-android-apk.js'), 'utf8');
  const tplPath = path.join(ROOT, 'scripts/v3-native-templates.js');
  const nativeCombined = patchSrc + (fs.existsSync(tplPath) ? '\n' + fs.readFileSync(tplPath, 'utf8') : '');
  const mustHaveNative = [
    ['versionCode 400', 'versionCode 400'],
    ['versionName "4.0.0"', 'versionName "4.0.0"'],
    ['WindowCompat.setDecorFitsSystemWindows', 'WindowCompat.setDecorFitsSystemWindows'],
    ['setSystemBarTheme', 'setSystemBarTheme'],
    ['desugar_jdk_libs_nio:2.0.4', 'desugar_jdk_libs_nio:2.0.4'],
    ['NewPipeExtractor:v0.27.1', 'NewPipeExtractor:v0.27.1'],
    ['s.getContent()', 's.getContent()'],
    ['media3-exoplayer:1.4.1', 'media3-exoplayer:1.4.1'],
    ['segmentation-selfie:16.0.0-beta6', 'segmentation-selfie:16.0.0-beta6'],
    ['FLAG_IMMUTABLE', 'FLAG_IMMUTABLE'],
    ['SDK_INT >= 33', 'Build.VERSION.SDK_INT >= 33'],
    ['SpotyFlowPlayer1x1Provider', 'SpotyFlowPlayer1x1Provider'],
    ['SpotyFlowPlayer2x2Provider', 'SpotyFlowPlayer2x2Provider'],
    ['SpotyFlowPlayer2x4Provider', 'SpotyFlowPlayer2x4Provider'],
    ['SpotyFlowPlayer4x1Provider', 'SpotyFlowPlayer4x1Provider'],
    ['SpotyFlowPlayer4x2Provider', 'SpotyFlowPlayer4x2Provider'],
  ];
  for (const [label, token] of mustHaveNative) {
    if (nativeCombined.includes(token)) pass(`Native invariant: ${label}`);
    else fail(`Native invariant: ${label}`, `tidak ditemukan "${token}"`);
  }
  const hasRealGetUrl = nativeCombined
    .split(/\r?\n/)
    .some((line) => line.includes('s.getUrl()') && !line.includes("!np.includes('s.getUrl()')"));
  if (nativeCombined.includes('desugar_jdk_libs_nio:2.1') || hasRealGetUrl) {
    fail('Native forbidden patterns', 'ditemukan desugar 2.1 atau s.getUrl()');
  } else {
    pass('Native free of forbidden desugar 2.1 & s.getUrl()');
  }

  // 6. Run npm run build:apk & verify www/ bundle
  const buildRes = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm run build:apk'], { cwd: ROOT, encoding: 'utf8' })
    : spawnSync('npm', ['run', 'build:apk'], { cwd: ROOT, encoding: 'utf8' });
  if (buildRes.status !== 0) {
    fail('npm run build:apk', (buildRes.stderr || buildRes.stdout || '').trim());
  } else {
    pass('npm run build:apk exited 0');
    const mustWww = ['www/index.html', 'www/sf/sf-auralys.css', ...SF_MODULES.map((f) => `www/sf/${f}`)];
    for (const rel of mustWww) {
      const fp = path.join(ROOT, rel);
      if (!fs.existsSync(fp)) fail(`Bundle ${rel}`, 'hilang');
      else {
        const sz = fs.statSync(fp).size;
        if (sz < 1024) fail(`Bundle ${rel}`, `ukuran terlalu kecil (${sz} bytes)`);
        else pass(`Bundle ${rel}`, `${(sz / 1024).toFixed(1)} KB`);
      }
    }
  }

  // 7. Local HTTP Smoke Test (start server.js on temporary port)
  const testPort = 47891;
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(testPort) }),
    stdio: 'pipe',
  });

  try {
    let ready = false;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const probe = await httpGetLocal(testPort, '/api/app/version');
        if (probe.status === 200) {
          ready = true;
          break;
        }
      } catch {}
    }
    if (!ready) {
      fail('Local HTTP Smoke Test server boot', 'server tidak merespons dalam batas waktu');
    } else {
      const endpoints = ['/', '/sf/sf-auralys.css', '/sf/sf-main.js', '/api/app/version'];
      for (const ep of endpoints) {
        const r = await httpGetLocal(testPort, ep);
        if (r.status === 200 && r.body.length > 20) {
          pass(`HTTP Smoke GET ${ep}`, `200 OK (${r.body.length} bytes)`);
        } else {
          fail(`HTTP Smoke GET ${ep}`, `status=${r.status}`);
        }
      }
      const ver = await httpGetLocal(testPort, '/api/app/version');
      const vJson = JSON.parse(ver.body || '{}');
      if (vJson.version === '4.0.0' && Number(vJson.versionCode) === 400) {
        pass('HTTP Smoke /api/app/version payload', 'version=4.0.0, versionCode=400');
      } else {
        fail('HTTP Smoke /api/app/version payload', ver.body);
      }
    }
  } finally {
    try { srv.kill('SIGTERM'); } catch {}
  }

  console.log('---------------------------------------------------');
  if (fails > 0) {
    console.error(`VERIFY FAILED: ${fails} error(s) found.`);
    process.exit(1);
  }
  console.log('ALL SPOTYFLOW v4.0.0 VERIFICATION CHECKS PASSED 100%!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
