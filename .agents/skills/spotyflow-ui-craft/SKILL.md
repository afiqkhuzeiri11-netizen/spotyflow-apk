---
name: spotyflow-ui-craft
description: Enforces Auralys and iOS-grade Liquid Glass, Light/Dark/AMOLED themes, Editorial mode, Poster 3D quality, and 60-120 FPS WebView performance. Always use when building or refining SpotyFlow UI, CSS, layouts, animations, or canvas posters.
---

# SpotyFlow UI Craft & 60–120 FPS Visual Standard

Use this skill whenever designing, refactoring, or polishing SpotyFlow CSS, layouts, themes, transitions, or HTML5 Canvas posters.

## 1. 60–120 FPS Liquid Glass Budget
- Apply `backdrop-filter: blur(12px) saturate(160%)` **ONLY** on static floating surfaces: bottom dock, floating mini-player, floating circular buttons, and modal dialogs/sheets.
- **NEVER** place `backdrop-filter` on scrollable track rows, playlist cards, or grid items inside `#main-scroll` / `#page-content`.
- **NEVER** run continuous `requestAnimationFrame` mesh loops behind blurred glass surfaces; render ambient canvases statically once and fade with CSS `opacity`.

## 2. Compositor-Only Motion
- Animate exclusively GPU-composited properties: `transform` and `opacity`.
- Use smooth spring-like easing `cubic-bezier(0.22, 1, 0.36, 1)` for morphing docks, sheets, and card transitions.
- Avoid layout-thrashing DOM writes (`innerHTML` rebuilds or `lucide.createIcons()` loops across inactive rows) during Play/Pause clicks.

## 3. Theme Tokens & Layout Polish
- Respect all three theme surfaces with crisp contrast and `22px` card radii:
  - **Light**: canvas `#F3F4F6`, surface `#FFFFFF`, primary text `#111215`, high-contrast dark controls.
  - **Dark**: canvas `#0D0E12`, surface `#171920`, primary text `#F8FAFC`, crisp light controls.
  - **AMOLED**: canvas `#000000`, surface `#0B0C10`.
- **Editorial Mode**: disable `backdrop-filter: none !important`, tighten radii (`10px–14px`), and prioritize crisp typography and zero GPU overhead.
- Always preserve safe mobile bottom padding (`calc(168px + env(safe-area-inset-bottom, 0px))`) so floating dock and mini-player never obscure the last list item.

## 4. Canvas & Poster 3D Image Pipeline
- Load remote album artwork into `<canvas>` exclusively via `API_BASE + '/api/proxy-image?url=' + encodeURIComponent(url)` with `img.crossOrigin = 'anonymous'`, plus a graceful dominant-gradient fallback so PNG export never fails due to CORS/offline state.
- For user gallery uploads, decode orientation safely with `createImageBitmap(file, { imageOrientation: 'from-image' })` (with `FileReader` fallback), downscale to `<= 1600px` offscreen to prevent mobile OOM, and render every image through `drawImageCover(...)` to prevent stretching.
