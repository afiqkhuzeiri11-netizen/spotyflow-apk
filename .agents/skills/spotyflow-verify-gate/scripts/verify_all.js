#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
let failed = false;

function pass(label, detail = '') {
  console.log(`PASS: ${label}${detail ? ' — ' + detail : ''}`);
}

function fail(label, detail = '') {
  failed = true;
  console.error(`FAIL: ${label}${detail ? ' — ' + detail : ''}`);
}

function runCmd(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: Boolean(opts.shell),
    env: opts.env || process.env,
  });
}

function findGitExecutable() {
  const direct = runCmd('git', ['--version']);
  if (direct.status === 0) return 'git';
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const ghBase = path.join(process.env.LOCALAPPDATA, 'GitHubDesktop');
    if (fs.existsSync(ghBase)) {
      const apps = fs.readdirSync(ghBase).filter((d) => d.startsWith('app-')).sort().reverse();
      for (const appDir of apps) {
        const cand = path.join(ghBase, appDir, 'resources', 'app', 'git', 'cmd', 'git.exe');
        if (fs.existsSync(cand)) return cand;
      }
    }
  }
  return null;
}

console.log(`[spotyflow-verify-gate] Running strict checks in: ${ROOT}`);

// 1. node --check on core JS files & modular public/sf/*.js
const coreJs = ['server.js', 'scripts/build-apk-www.js', 'scripts/patch-android-apk.js'];
const sfDir = path.join(ROOT, 'public/sf');
if (fs.existsSync(sfDir)) {
  for (const f of fs.readdirSync(sfDir).filter((x) => x.endsWith('.js')).sort()) {
    coreJs.push(`public/sf/${f}`);
  }
}
for (const rel of coreJs) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail(`node --check ${rel}`, 'File not found');
    continue;
  }
  const r = runCmd(process.execPath, ['--check', abs]);
  if (r.status === 0) pass(`node --check ${rel}`);
  else fail(`node --check ${rel}`, (r.stderr || r.stdout || 'Syntax error').trim());
}

// 2. Inline <script> syntax check on spotyflow.html via vm.Script
const htmlPath = path.join(ROOT, 'spotyflow.html');
if (!fs.existsSync(htmlPath)) {
  fail('spotyflow.html inline scripts', 'spotyflow.html not found');
} else {
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    let count = 0;
    while ((m = re.exec(html))) {
      count++;
      new vm.Script(m[1], { filename: `spotyflow_inline_${count}.js` });
    }
    if (count > 0) pass('spotyflow.html inline <script> syntax', `${count} script block(s) valid`);
    else fail('spotyflow.html inline <script> syntax', 'No inline scripts found');
  } catch (err) {
    fail('spotyflow.html inline <script> syntax', err.message);
  }
}

// 3. capacitor.config.json appId check
const capPath = path.join(ROOT, 'capacitor.config.json');
if (!fs.existsSync(capPath)) {
  fail('capacitor.config.json appId', 'File not found');
} else {
  try {
    const cap = JSON.parse(fs.readFileSync(capPath, 'utf8'));
    if (cap.appId === 'com.netease.cloudmusic') {
      pass('capacitor.config.json appId', cap.appId);
    } else {
      fail('capacitor.config.json appId', `Expected "com.netease.cloudmusic", got "${cap.appId}"`);
    }
  } catch (err) {
    fail('capacitor.config.json appId', err.message);
  }
}

// 4. Forbidden Android/NewPipe patterns (desugar_jdk_libs_nio:2.1 & s.getUrl())
const patchPath = path.join(ROOT, 'scripts/patch-android-apk.js');
if (fs.existsSync(patchPath)) {
  const patchSrc = fs.readFileSync(patchPath, 'utf8');
  if (patchSrc.includes('desugar_jdk_libs_nio:2.1')) {
    fail('No desugar_jdk_libs_nio:2.1', 'Found incompatible 2.1.x desugaring in patch-android-apk.js');
  } else {
    pass('No desugar_jdk_libs_nio:2.1');
  }
  const hasRealGetUrl = patchSrc
    .split(/\r?\n/)
    .some((line) => line.includes('s.getUrl()') && !line.includes("!np.includes('s.getUrl()')"));
  if (hasRealGetUrl) {
    fail('No deprecated NewPipe s.getUrl()', 'Found s.getUrl() usage in patch-android-apk.js');
  } else {
    pass('No deprecated NewPipe s.getUrl()');
  }
}

// 5. Hardcoded secret scan (GOCSPX-, AQ.Ab8)
const secretScanFiles = [
  'server.js',
  'spotyflow.html',
  'package.json',
  'capacitor.config.json',
  'scripts/build-apk-www.js',
  'scripts/patch-android-apk.js',
];
const secretPatterns = ['GOCSPX-', 'AQ.Ab8'];
let secretHits = [];
for (const rel of secretScanFiles) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const txt = fs.readFileSync(abs, 'utf8');
  for (const pat of secretPatterns) {
    if (txt.includes(pat)) secretHits.push(`${rel} contains ${pat}`);
  }
}
if (secretHits.length === 0) {
  pass('No hardcoded secrets (GOCSPX- / AQ.Ab8)');
} else {
  fail('No hardcoded secrets (GOCSPX- / AQ.Ab8)', secretHits.join('; '));
}

// 6. Run npm run build:apk and verify modular www/sf/* bundle & no cdn.tailwindcss.com
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const buildRes = runCmd(npmCmd, ['run', 'build:apk'], { shell: process.platform === 'win32' });
if (buildRes.status !== 0) {
  fail('npm run build:apk', (buildRes.stderr || buildRes.stdout || 'Build failed').trim().slice(-300));
} else {
  const sfCssPath = path.join(ROOT, 'www/sf/sf-auralys.css');
  const twCssPath = path.join(ROOT, 'www/assets/tailwind.min.css');
  const wwwHtmlPath = path.join(ROOT, 'www/index.html');
  if (fs.existsSync(sfCssPath)) {
    const size = fs.statSync(sfCssPath).size;
    if (size > 10 * 1024) pass('www/sf/sf-auralys.css > 10 KB', `${(size / 1024).toFixed(1)} KB`);
    else fail('www/sf/sf-auralys.css > 10 KB', `Only ${size} bytes`);
  } else if (fs.existsSync(twCssPath)) {
    const size = fs.statSync(twCssPath).size;
    if (size > 15 * 1024) pass('www/assets/tailwind.min.css > 15 KB', `${(size / 1024).toFixed(1)} KB`);
    else fail('www/assets/tailwind.min.css > 15 KB', `Only ${size} bytes`);
  } else {
    fail('Static CSS bundle missing', 'Neither www/sf/sf-auralys.css nor www/assets/tailwind.min.css found');
  }
  if (!fs.existsSync(wwwHtmlPath)) {
    fail('www/index.html free of cdn.tailwindcss.com', 'www/index.html missing');
  } else {
    const wwwHtml = fs.readFileSync(wwwHtmlPath, 'utf8');
    if (wwwHtml.includes('cdn.tailwindcss.com')) {
      fail('www/index.html free of cdn.tailwindcss.com', 'Found cdn.tailwindcss.com reference');
    } else {
      pass('www/index.html free of cdn.tailwindcss.com');
    }
  }
}

// 7. git status check for .env / *.apk (if inside a git repo)
const gitBin = findGitExecutable();
if (fs.existsSync(path.join(ROOT, '.git')) && gitBin) {
  const st = runCmd(gitBin, ['status', '--short']);
  if (st.status !== 0) {
    fail('git status hygiene', (st.stderr || 'git status failed').trim());
  } else {
    const badLines = (st.stdout || '')
      .split(/\r?\n/)
      .filter((line) => /(^|\s)(\.env($|\.)|.*\.apk$)/i.test(line.trim()));
    if (badLines.length === 0) {
      pass('git status free of .env / *.apk');
    } else {
      fail('git status free of .env / *.apk', badLines.join(' | '));
    }
  }
} else {
  pass('git status hygiene', 'Skipped (no .git directory in current folder)');
}

if (failed) {
  console.error('\n[spotyflow-verify-gate] RESULT: FAILED — fix errors above before git push!');
  process.exit(1);
} else {
  console.log('\n[spotyflow-verify-gate] RESULT: ALL CHECKS PASSED 100%!');
  process.exit(0);
}
