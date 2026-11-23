---
name: spotyflow-guard
description: Enforces SpotyFlow Android APK, Capacitor 6, Media3, NewPipe, ML Kit, and surgical HTML editing invariants. Always use when editing spotyflow.html, server.js, capacitor.config.json, or scripts/patch-android-apk.js.
---

# SpotyFlow Architecture & Build Guard

Follow these strict non-negotiable invariants on every edit to `spotyflow.html`, `server.js`, `capacitor.config.json`, or `scripts/patch-android-apk.js`.

## 1. App Identity & Surgical HTML Discipline
- **NEVER** change `"appId": "com.netease.cloudmusic"` or `"appName": "SpotyFlow"` in `capacitor.config.json`.
- **NEVER** rewrite `spotyflow.html` from scratch or delete/rename existing DOM `id` attributes referenced by legacy JS.
- Always apply modular surgical edits (dedicated `<style id="...">` and versioned `window.SF*` namespaces). Hide superseded legacy UI elements via CSS only (e.g., `display: none !important;`).
- Always mirror `spotyflow.html` to `public/index.html` and `index.html` when updating the frontend.

## 2. Locked Gradle, Capacitor 6, & Java 17 Stack
- `compileSdk 34`, `targetSdk 34`, `minSdkVersion >= 23` (recommended `24`).
- `coreLibraryDesugaringEnabled true` with `com.android.tools:desugar_jdk_libs_nio:2.0.4` (**NEVER** upgrade to `2.1.x` on AGP 8.2).
- `com.github.teamnewpipe:NewPipeExtractor:v0.27.1`:
  - **ALWAYS** call `s.getContent()` (NEVER `s.getUrl()`).
  - **ALWAYS** use pure `java.net.HttpURLConnection` + `org.json.*` (NO OkHttp dependency conflicts).
- `androidx.media3:media3-{common,session,exoplayer,datasource,database}:1.4.1`.
- `com.google.mlkit:segmentation-selfie:16.0.0-beta6`.
- Every generated Java class MUST declare `package com.netease.cloudmusic;` and keep lambda-captured locals explicitly `final`.

## 3. Android 12–15 Anti-Crash Rules
- Every `PendingIntent` MUST include `PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE`.
- Every dynamic `registerReceiver(...)` MUST check `Build.VERSION.SDK_INT >= 33` and pass `Context.RECEIVER_EXPORTED` or `Context.RECEIVER_NOT_EXPORTED`.
- All `Equalizer`, `LoudnessEnhancer`, and `WindowManager` overlay calls MUST be wrapped in `try/catch`; overlay services MUST check `Settings.canDrawOverlays(ctx)` before attaching views.
- AppWidget `RemoteViews` XML layouts may ONLY use `FrameLayout`, `LinearLayout`, `RelativeLayout`, `ImageView`, `TextView`, `ImageButton`, and `ProgressBar` (NO `ConstraintLayout` or `CardView`) with compact bitmaps well under Binder IPC limits.

## 4. Playback, Security, & Repository Hygiene
- Keep 4G-safe ExoPlayer `DefaultLoadControl` durations: `(25000, 60000, 900, 1800)`.
- **NEVER** send 30-second preview URLs (`dzcdn.net`, `itunes.apple.com`) to ExoPlayer.
- **NEVER** hardcode secrets (`GOCSPX-`, `AQ.Ab8`, API keys, tokens) or commit `www/`, `android/`, `*.apk`, or `.env`.
- Escape ALL external API and user-supplied text with `escapeHtml()` before inserting into HTML.
