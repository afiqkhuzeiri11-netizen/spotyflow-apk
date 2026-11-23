---
name: spotyflow-verify-gate
description: Mandatory pre-push verification gate for SpotyFlow. Always run verify_all.js before declaring any task complete or running git push.
---

# SpotyFlow Mandatory Pre-Push Verification Gate

Before declaring any SpotyFlow task complete, committing, or running `git push`, you **MUST** execute the automated verification gate:

```bash
node .agents/skills/spotyflow-verify-gate/scripts/verify_all.js
```

## What `verify_all.js` Enforces
1. `node --check` syntax verification on `server.js`, `scripts/build-apk-www.js`, and `scripts/patch-android-apk.js`.
2. `vm.Script` syntax parsing of EVERY inline `<script>` block inside `spotyflow.html`.
3. `capacitor.config.json` invariant: `appId === "com.netease.cloudmusic"`.
4. Gradle/NewPipe safety scan: rejects `desugar_jdk_libs_nio:2.1` and deprecated `s.getUrl()`.
5. Secret leak scan across core source files: rejects hardcoded `GOCSPX-` or `AQ.Ab8` tokens.
6. Static APK web build (`npm run build:apk`) verifying `www/assets/tailwind.min.css > 15 KB` and `www/index.html` free of `cdn.tailwindcss.com`.
7. Git workspace hygiene check: verifies `git status` contains NO tracked/staged `.env` or `*.apk` files (when run inside a Git repository).

## Rule
- If **ANY** check prints `FAIL`, `verify_all.js` exits with code `1`.
- **DO NOT** run `git push` or declare the task complete until **100% of checks print `PASS`**.
