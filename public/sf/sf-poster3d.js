(function () {
  'use strict';

  const SF = (window.SF = window.SF || {});

  const RATIOS = {
    '9:16': { label: '9:16 TikTok', w: 1080, h: 1920 },
    '16:9': { label: '16:9 YouTube', w: 1920, h: 1080 },
    '4:5': { label: '4:5 Feed', w: 1080, h: 1350 },
    '1:1': { label: '1:1 Kotak', w: 1080, h: 1080 },
  };

  const state = {
    tracks: [],
    ratio: '9:16',
    activeTab: 'foto',
    photoCanvas: null,
    depthCutoutCanvas: null,
    depthEnabled: true,
    depthBusy: false,
    bgPreset: 'aurora',
    cardStyle: 'glass',
    tiltX: 16,
    tiltY: -22,
    cardScale: 1.0,
    cardX: 0.5,
    cardY: 0.48,
    thickness: 18,
    glare: 0.65,
    backlight: 0.72,
    flare: 0.6,
    stickers: [],
    customStickers: [],
  };

  const coverCache = new Map();
  let previewCanvas = null;
  let dragging = false;
  let dragStart = null;

  function esc(v) {
    return SF.utils.escapeHtml(v);
  }

  function loadCustomStickers() {
    state.customStickers = SF.store.safeGetJson('sf_custom_stickers_v1', []);
    if (!Array.isArray(state.customStickers)) state.customStickers = [];
  }

  function saveCustomStickers() {
    SF.store.safeSet('sf_custom_stickers_v1', state.customStickers.slice(0, 18));
  }

  function drawImageCover(ctx, img, dx, dy, dw, dh) {
    const sw = img.width || img.naturalWidth || 1;
    const sh = img.height || img.naturalHeight || 1;
    const sRatio = sw / sh;
    const dRatio = dw / dh;
    let sx = 0, sy = 0, cw = sw, ch = sh;
    if (sRatio > dRatio) {
      cw = sh * dRatio;
      sx = (sw - cw) / 2;
    } else {
      ch = sw / dRatio;
      sy = (sh - ch) / 2;
    }
    ctx.drawImage(img, sx, sy, cw, ch, dx, dy, dw, dh);
  }

  function loadSafeCover(track) {
    const rawUrl = SF.utils.getCoverUrl(track);
    if (!rawUrl) return Promise.resolve(null);
    if (coverCache.has(rawUrl)) return Promise.resolve(coverCache.get(rawUrl));
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        coverCache.set(rawUrl, img);
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = SF.api.proxyCoverUrl(rawUrl);
    });
  }

  function buildTrackCardCanvas(track, img, style) {
    const w = 520;
    const h = 680;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const pal = SF.utils.getPalette(track?.title || 'SpotyFlow');

    // Rounded card clip
    const r = 42;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.clip();

    if (style === 'dark') {
      ctx.fillStyle = '#12141B';
    } else if (style === 'light') {
      ctx.fillStyle = '#FFFFFF';
    } else if (style === 'vinyl') {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#0F172A');
      g.addColorStop(1, pal[0]);
      ctx.fillStyle = g;
    } else {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(255,255,255,0.28)');
      g.addColorStop(1, 'rgba(18,20,28,0.68)');
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, w, h);

    // Subtle colored wash behind glass
    if (style === 'glass') {
      const g2 = ctx.createLinearGradient(0, 0, w, h);
      g2.addColorStop(0, pal[0] + '88');
      g2.addColorStop(1, pal[1] + 'AA');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
    }

    // Album art square
    const pad = 34;
    const artSize = w - pad * 2;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(pad, pad, artSize, artSize, 26);
    ctx.clip();
    if (img) {
      drawImageCover(ctx, img, pad, pad, artSize, artSize);
    } else {
      const ag = ctx.createLinearGradient(pad, pad, pad + artSize, pad + artSize);
      ag.addColorStop(0, pal[0]);
      ag.addColorStop(1, pal[1]);
      ctx.fillStyle = ag;
      ctx.fillRect(pad, pad, artSize, artSize);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = 'bold 120px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('♪', w / 2, pad + artSize / 2 + 40);
      ctx.textAlign = 'left';
    }
    ctx.restore();

    // Text metadata
    const fg = style === 'light' ? '#111215' : '#FFFFFF';
    const sub = style === 'light' ? 'rgba(17,18,21,0.62)' : 'rgba(255,255,255,0.75)';
    ctx.fillStyle = fg;
    ctx.font = '900 32px -apple-system, BlinkMacSystemFont, sans-serif';
    const titleStr = String(track?.title || 'SpotyFlow').slice(0, 24);
    ctx.fillText(titleStr, pad, pad + artSize + 62);

    ctx.fillStyle = sub;
    ctx.font = '600 23px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(String(track?.artist || 'SpotyFlow').slice(0, 30), pad, pad + artSize + 98);

    // Mini playback bar
    const barY = pad + artSize + 132;
    ctx.fillStyle = style === 'light' ? 'rgba(17,18,21,0.14)' : 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.roundRect(pad, barY, artSize, 7, 4);
    ctx.fill();
    ctx.fillStyle = style === 'light' ? '#111215' : '#FFFFFF';
    ctx.beginPath();
    ctx.roundRect(pad, barY, artSize * 0.44, 7, 4);
    ctx.fill();

    // Glass rim highlight
    ctx.strokeStyle = style === 'light' ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.48)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, r);
    ctx.stroke();

    return c;
  }

  // True 3D Perspective Projection (8x12 seamless quad mesh + thickness + diagonal glare)
  function projectPoint(nx, ny, cx, cy, halfW, halfH, rxRad, ryRad, focal) {
    let x = nx * halfW;
    let y = ny * halfH;
    let z = 0;

    // Rotate Y
    const x1 = x * Math.cos(ryRad) + z * Math.sin(ryRad);
    const z1 = -x * Math.sin(ryRad) + z * Math.cos(ryRad);
    // Rotate X
    const y2 = y * Math.cos(rxRad) - z1 * Math.sin(rxRad);
    const z2 = y * Math.sin(rxRad) + z1 * Math.cos(rxRad);

    const p = focal / Math.max(220, focal + z2);
    return { x: cx + x1 * p, y: cy + y2 * p };
  }

  function drawTexturedTriangle(ctx, img, sx0, sy0, sx1, sy1, sx2, sy2, dx0, dy0, dx1, dy1, dx2, dy2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(dx0, dy0);
    ctx.lineTo(dx1, dy1);
    ctx.lineTo(dx2, dy2);
    ctx.closePath();
    ctx.clip();

    const denom = sx0 * (sy2 - sy1) - sx1 * sy2 + sx2 * sy1 + (sx1 - sx2) * sy0;
    if (Math.abs(denom) < 1e-5) {
      ctx.restore();
      return;
    }
    const m11 = -(sy0 * (dx2 - dx1) - sy1 * dx2 + sy2 * dx1 + (sy1 - sy2) * dx0) / denom;
    const m12 = (sy1 * dy2 + sy0 * (dy1 - dy2) - sy2 * dy1 + (sy2 - sy1) * dy0) / denom;
    const m21 = (sx0 * (dx2 - dx1) - sx1 * dx2 + sx2 * dx1 + (sx1 - sx2) * dx0) / denom;
    const m22 = -(sx1 * dy2 + sx0 * (dy1 - dy2) - sx2 * dy1 + (sx2 - sx1) * dy0) / denom;
    const dx = (sx0 * (sy2 * dx1 - sy1 * dx2) + sy0 * (sx1 * dx2 - sx2 * dx1) + (sx2 * sy1 - sx1 * sy2) * dx0) / denom;
    const dy = (sx0 * (sy2 * dy1 - sy1 * dy2) + sy0 * (sx1 * dy2 - sx2 * dy1) + (sx2 * sy1 - sx1 * sy2) * dy0) / denom;
    ctx.transform(m11, m12, m21, m22, dx, dy);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function drawCard3D(ctx, cardCanvas, cx, cy, halfW, halfH, rxDeg, ryDeg, thicknessPx, glareAlpha) {
    const rx = (rxDeg * Math.PI) / 180;
    const ry = (ryDeg * Math.PI) / 180;
    const focal = 1550;
    const cols = 8;
    const rows = 12;

    // 3D Thickness Extrusion
    const steps = Math.max(2, Math.round(thicknessPx / 2.2));
    const dxStep = Math.sin(ry) * -1.4;
    const dyStep = Math.sin(rx) * 1.4 + 0.6;
    for (let s = steps; s >= 1; s--) {
      const ox = dxStep * s;
      const oy = dyStep * s;
      const p0 = projectPoint(-1, -1, cx + ox, cy + oy, halfW, halfH, rx, ry, focal);
      const p1 = projectPoint(1, -1, cx + ox, cy + oy, halfW, halfH, rx, ry, focal);
      const p2 = projectPoint(1, 1, cx + ox, cy + oy, halfW, halfH, rx, ry, focal);
      const p3 = projectPoint(-1, 1, cx + ox, cy + oy, halfW, halfH, rx, ry, focal);
      ctx.fillStyle = s === steps ? 'rgba(0,0,0,0.42)' : `rgba(255,255,255,${(0.14 + (1 - s / steps) * 0.14).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fill();
    }

    // 8x12 Perspective Mesh
    const grid = [];
    for (let r = 0; r <= rows; r++) {
      const row = [];
      const ny = -1 + (2 * r) / rows;
      for (let c = 0; c <= cols; c++) {
        const nx = -1 + (2 * c) / cols;
        row.push(projectPoint(nx, ny, cx, cy, halfW, halfH, rx, ry, focal));
      }
      grid.push(row);
    }

    const cw = cardCanvas.width;
    const ch = cardCanvas.height;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sx0 = (c / cols) * cw;
        const sy0 = (r / rows) * ch;
        const sx1 = ((c + 1) / cols) * cw;
        const sy1 = ((r + 1) / rows) * ch;
        const p00 = grid[r][c];
        const p10 = grid[r][c + 1];
        const p11 = grid[r + 1][c + 1];
        const p01 = grid[r + 1][c];
        drawTexturedTriangle(ctx, cardCanvas, sx0, sy0, sx1, sy0, sx1, sy1, p00.x, p00.y, p10.x, p10.y, p11.x, p11.y);
        drawTexturedTriangle(ctx, cardCanvas, sx0, sy0, sx1, sy1, sx0, sy1, p00.x, p00.y, p11.x, p11.y, p01.x, p01.y);
      }
    }

    // Diagonal Glass Glare Overlay
    if (glareAlpha > 0.02) {
      const tl = grid[0][0];
      const tr = grid[0][cols];
      const br = grid[rows][cols];
      const bl = grid[rows][0];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y);
      ctx.lineTo(tr.x, tr.y);
      ctx.lineTo(br.x, br.y);
      ctx.lineTo(bl.x, bl.y);
      ctx.closePath();
      ctx.clip();
      const gg = ctx.createLinearGradient(tl.x, tl.y, br.x, br.y);
      gg.addColorStop(0.25, 'rgba(255,255,255,0)');
      gg.addColorStop(0.46, `rgba(255,255,255,${(glareAlpha * 0.42).toFixed(2)})`);
      gg.addColorStop(0.55, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg;
      ctx.fill();
      ctx.restore();
    }
  }

  function drawLensFlare(ctx, x, y, radius, alpha) {
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.translate(x, y);
    const rg = ctx.createRadialGradient(0, 0, 2, 0, 0, radius);
    rg.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(2)})`);
    rg.addColorStop(0.35, `rgba(255,244,214,${(alpha * 0.45).toFixed(2)})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    // Sharp 4-point star ✦
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, alpha + 0.15).toFixed(2)})`;
    ctx.beginPath();
    const outer = radius * 0.85;
    const inner = radius * 0.09;
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const rad = i % 2 === 0 ? outer : inner;
      const px = Math.cos(ang) * rad;
      const py = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawStickerItem(ctx, stItem, w, h) {
    const x = stItem.x * w;
    const y = stItem.y * h;
    const sz = stItem.size * Math.min(w, h);
    ctx.save();
    ctx.translate(x, y);
    if (stItem.type === 'sparkle') {
      drawLensFlare(ctx, 0, 0, sz * 0.7, 0.92);
    } else if (stItem.type === 'birds') {
      ctx.strokeStyle = 'rgba(255,255,255,0.88)';
      ctx.lineWidth = Math.max(3, sz * 0.055);
      ctx.lineCap = 'round';
      [[-0.3, -0.1, 1], [0.18, -0.25, 0.75], [0.42, 0.05, 0.6]].forEach(([ox, oy, sc]) => {
        const bx = ox * sz;
        const by = oy * sz;
        const r = sz * 0.24 * sc;
        ctx.beginPath();
        ctx.moveTo(bx - r, by + r * 0.3);
        ctx.quadraticCurveTo(bx - r * 0.45, by - r * 0.55, bx, by);
        ctx.quadraticCurveTo(bx + r * 0.45, by - r * 0.55, bx + r, by + r * 0.3);
        ctx.stroke();
      });
    } else if (stItem.type === 'custom' && stItem.img) {
      ctx.drawImage(stItem.img, -sz / 2, -sz / 2, sz, sz);
    }
    ctx.restore();
  }

  async function renderPosterToCanvas(targetCanvas, fullRes = false) {
    if (!targetCanvas) return;
    const spec = RATIOS[state.ratio] || RATIOS['9:16'];
    const scale = fullRes ? 1 : 0.48;
    const W = Math.round(spec.w * scale);
    const H = Math.round(spec.h * scale);
    targetCanvas.width = W;
    targetCanvas.height = H;
    const ctx = targetCanvas.getContext('2d');

    const primary = state.tracks[0] || SF.store.state.currentTrack || { title: 'SpotyFlow', artist: 'Auralys Edition' };
    const pal = SF.utils.getPalette(primary.title);

    // 1. Background Photo or Rich Gradient
    if (state.photoCanvas) {
      drawImageCover(ctx, state.photoCanvas, 0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      if (state.bgPreset === 'midnight') {
        g.addColorStop(0, '#0B0F1A');
        g.addColorStop(1, '#1E1B4B');
      } else if (state.bgPreset === 'sunset') {
        g.addColorStop(0, '#F97316');
        g.addColorStop(1, '#EC4899');
      } else if (state.bgPreset === 'pearl') {
        g.addColorStop(0, '#E2E8F0');
        g.addColorStop(1, '#F8FAFC');
      } else {
        g.addColorStop(0, pal[0]);
        g.addColorStop(1, pal[1]);
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Backlight Halo Behind 3D Cards
    const cx = W * state.cardX;
    const cy = H * state.cardY;
    if (state.backlight > 0.02) {
      const rad = Math.min(W, H) * 0.56;
      const bg = ctx.createRadialGradient(cx, cy, rad * 0.05, cx, cy, rad);
      bg.addColorStop(0, `rgba(${pal[2]}, ${(state.backlight * 0.65).toFixed(2)})`);
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    }

    // 3. Draw 1–5 3D Perspective Cards (fan stack!)
    const activeTracks = state.tracks.length ? state.tracks.slice(0, 5) : [primary];
    const imgs = await Promise.all(activeTracks.map((t) => loadSafeCover(t)));
    const baseHalfW = Math.min(W, H) * 0.28 * state.cardScale;
    const baseHalfH = baseHalfW * 1.307;

    for (let i = activeTracks.length - 1; i >= 0; i--) {
      const offsetIdx = i - (activeTracks.length - 1) / 2;
      const cardC = buildTrackCardCanvas(activeTracks[i], imgs[i], state.cardStyle);
      const spreadX = offsetIdx * baseHalfW * 0.42;
      const spreadY = Math.abs(offsetIdx) * baseHalfH * 0.09;
      const sc = 1 - Math.abs(offsetIdx) * 0.07;
      drawCard3D(
        ctx,
        cardC,
        cx + spreadX,
        cy + spreadY,
        baseHalfW * sc,
        baseHalfH * sc,
        state.tiltX,
        state.tiltY + offsetIdx * 8,
        state.thickness * scale,
        state.glare
      );
    }

    // 4. AI Depth Cutout Foreground Layer (Places 3D cards BEHIND photo subject!)
    if (state.photoCanvas && state.depthEnabled && state.depthCutoutCanvas) {
      drawImageCover(ctx, state.depthCutoutCanvas, 0, 0, W, H);
    }

    // 5. Lens Flare ✦ & Stickers
    if (state.flare > 0.05) {
      drawLensFlare(ctx, cx + baseHalfW * 0.72, cy - baseHalfH * 0.68, Math.min(W, H) * 0.14, state.flare);
    }
    for (const s of state.stickers) {
      drawStickerItem(ctx, s, W, H);
    }
  }

  async function handlePhotoUpload(file) {
    if (!file) return;
    try {
      const bmp = typeof createImageBitmap === 'function'
        ? await createImageBitmap(file, { imageOrientation: 'from-image' })
        : await new Promise((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = rej;
            img.src = URL.createObjectURL(file);
          });

      // Safe resize <= 1600px
      const maxDim = 1600;
      const ratio = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const rw = Math.max(1, Math.round(bmp.width * ratio));
      const rh = Math.max(1, Math.round(bmp.height * ratio));
      const c = document.createElement('canvas');
      c.width = rw;
      c.height = rh;
      c.getContext('2d').drawImage(bmp, 0, 0, rw, rh);
      if (typeof bmp.close === 'function') bmp.close();

      state.photoCanvas = c;
      state.depthCutoutCanvas = null;
      await renderPosterToCanvas(previewCanvas, false);

      // Request Native ML Kit AI Depth Segmentation (<= 512px upright)
      const br = SF.utils.getBridge();
      if (br && typeof br.segmentPhotoDepthAsync === 'function') {
        state.depthBusy = true;
        SF.ui.toast('Memproses AI Depth ML Kit...');
        const dScale = Math.min(1, 512 / Math.max(rw, rh));
        const dc = document.createElement('canvas');
        dc.width = Math.max(1, Math.round(rw * dScale));
        dc.height = Math.max(1, Math.round(rh * dScale));
        dc.getContext('2d').drawImage(c, 0, 0, dc.width, dc.height);
        const b64 = dc.toDataURL('image/jpeg', 0.86).split(',')[1];
        const reqId = 'depth_' + Date.now();
        window.__sfOnDepthSegmentResult = (id, pngBase64) => {
          if (id !== reqId) return;
          state.depthBusy = false;
          if (!pngBase64) return;
          const cutImg = new Image();
          cutImg.onload = () => {
            const cc = document.createElement('canvas');
            cc.width = cutImg.width;
            cc.height = cutImg.height;
            cc.getContext('2d').drawImage(cutImg, 0, 0);
            state.depthCutoutCanvas = cc;
            renderPosterToCanvas(previewCanvas, false);
            SF.ui.toast('AI Depth aktif — Kartu 3D di belakang subjek!');
          };
          cutImg.src = 'data:image/png;base64,' + pngBase64;
        };
        try { br.segmentPhotoDepthAsync(reqId, b64); } catch { state.depthBusy = false; }
      }
    } catch {
      SF.ui.toast('Gagal memuat foto');
    }
  }

  function openSongPickerModal(onPicked) {
    const st = SF.store.state;
    const pool = [...(st.currentTrack ? [st.currentTrack] : []), ...st.likedTracks, ...st.history, ...SF.views.getHomeFeedCache()];
    const uniq = [];
    const seen = new Set();
    for (const t of pool) {
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        uniq.push(t);
      }
    }

    SF.ui.openModal(
      `
      <div class="sf-row-between" style="margin-bottom:10px;">
        <b style="font-size:17px;">Pilih Lagu Poster (Maks 5)</b>
        <button type="button" class="sf-icon-btn" id="sf-p3-pk-close">${SF.icons.close(18)}</button>
      </div>
      <div class="sf-row-gap" style="margin-bottom:10px;">
        <input id="sf-p3-pk-q" type="search" placeholder="Cari lagu lain tanpa memutus musik..." style="flex:1;padding:10px 12px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);font-size:13.5px;outline:none;">
        <button type="button" class="sf-pill-btn accent" id="sf-p3-pk-go" style="padding:9px 13px;">Cari</button>
      </div>
      <div id="sf-p3-pk-list" class="sf-stack" style="gap:4px;"></div>
      `,
      (sheet) => {
        sheet.querySelector('#sf-p3-pk-close').onclick = SF.ui.closeModal;
        const listEl = sheet.querySelector('#sf-p3-pk-list');
        function renderList(items) {
          listEl.innerHTML = items.slice(0, 20).map((t, i) => {
            const chosen = state.tracks.some((x) => x.id === t.id);
            return `
              <button type="button" class="sf-track-row" data-pi="${i}" style="${chosen ? 'background:var(--accent-soft);' : ''}">
                ${SF.ui.renderArtHtml(t, 44, 10, t.title)}
                <div style="flex:1;min-width:0;text-align:left;">
                  <div class="sf-trunc" style="font-size:13.5px;font-weight:800;">${esc(t.title)}</div>
                  <div class="sf-trunc sf-muted" style="font-size:11.5px;">${esc(t.artist)}</div>
                </div>
                <span style="font-size:12px;font-weight:800;color:var(--accent);">${chosen ? 'Dipilih' : '+ Pilih'}</span>
              </button>
            `;
          }).join('');
          listEl.querySelectorAll('[data-pi]').forEach((b) => {
            b.onclick = () => {
              const t = items[parseInt(b.getAttribute('data-pi'), 10)];
              if (!t) return;
              const idx = state.tracks.findIndex((x) => x.id === t.id);
              if (idx >= 0) {
                if (state.tracks.length > 1) state.tracks.splice(idx, 1);
              } else {
                if (state.tracks.length >= 5) return SF.ui.toast('Maksimal 5 lagu di 1 poster');
                state.tracks.push(t);
              }
              renderList(items);
              onPicked();
            };
          });
        }
        renderList(uniq);
        sheet.querySelector('#sf-p3-pk-go').onclick = async () => {
          const q = sheet.querySelector('#sf-p3-pk-q').value.trim();
          if (!q) return renderList(uniq);
          const res = await SF.api.searchAll(q, 'tracks');
          renderList(res.tracks || []);
        };
      }
    );
  }

  async function saveOrSharePoster(shareMode = false) {
    SF.ui.toast('Merender Full HD...');
    const exportCanvas = document.createElement('canvas');
    await renderPosterToCanvas(exportCanvas, true);
    const dataUrl = exportCanvas.toDataURL('image/png');
    const b64 = dataUrl.split(',')[1];
    const filename = `SpotyFlow_Poster3D_${Date.now()}.png`;
    const br = SF.utils.getBridge();

    if (shareMode && br?.sharePosterImage) {
      try {
        br.sharePosterImage(b64, filename);
        return;
      } catch {}
    }
    if (!shareMode && br?.savePosterToGallery) {
      try {
        br.savePosterToGallery(b64, filename);
        SF.ui.toast('Disimpan ke Galeri (Pictures/SpotyFlow)!');
        return;
      } catch {}
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
    SF.ui.toast('Poster 3D Full HD diunduh!');
  }

  function open(initialTrack) {
    loadCustomStickers();
    const seed = SF.utils.normalizeTrack(initialTrack) || SF.store.state.currentTrack || SF.store.state.likedTracks[0];
    state.tracks = seed ? [seed] : [];

    SF.ui.openSubpage({
      id: 'poster-3d',
      title: 'Poster lagu',
      actionsHtml: `
        <button type="button" class="sf-icon-btn" id="sf-p3-reset" aria-label="Reset">${SF.icons.repeat(18)}</button>
        <button type="button" class="sf-icon-btn" id="sf-p3-share" aria-label="Bagikan">${SF.icons.share(18)}</button>
        <button type="button" class="sf-pill-btn accent" id="sf-p3-save" style="padding:7px 13px;font-size:12.5px;">Simpan</button>
      `,
      bodyHtml: `
        <div class="sf-stack" style="gap:12px;">
          <div style="display:flex;justify-content:center;background:var(--surface-2);border-radius:22px;padding:10px;border:1px solid var(--border);">
            <canvas id="sf-p3-canvas" style="max-height:46vh;max-width:100%;border-radius:16px;touch-action:none;box-shadow:0 16px 36px rgba(0,0,0,0.22);"></canvas>
          </div>

          <div class="sf-scroll-x" id="sf-p3-ratios">
            ${Object.entries(RATIOS).map(([k, v]) => `<button type="button" class="sf-chip ${state.ratio === k ? 'active' : ''}" data-rat="${k}" style="padding:7px 12px;font-size:12px;">${v.label}</button>`).join('')}
            <button type="button" class="sf-chip" id="sf-p3-rand" style="padding:7px 12px;font-size:12px;">Acak</button>
          </div>

          <div class="sf-subtabs" id="sf-p3-tabs">
            ${[['foto', 'Foto'], ['kartu', 'Kartu'], ['gaya', 'Gaya kartu'], ['efek', 'Efek'], ['stiker', 'Stiker']].map(([id, lbl]) => `
              <button type="button" class="sf-subtab ${state.activeTab === id ? 'active' : ''}" data-pt="${id}">${lbl}</button>
            `).join('')}
          </div>

          <div id="sf-p3-panel" class="sf-card" style="padding:14px;"></div>
        </div>
      `,
      onBind(body, root) {
        previewCanvas = body.querySelector('#sf-p3-canvas');
        const redraw = () => renderPosterToCanvas(previewCanvas, false);

        // Touch drag card position directly on preview canvas
        previewCanvas.addEventListener('pointerdown', (e) => {
          dragging = true;
          previewCanvas.setPointerCapture(e.pointerId);
          dragStart = { x: e.clientX, y: e.clientY, cx: state.cardX, cy: state.cardY };
        });
        previewCanvas.addEventListener('pointermove', (e) => {
          if (!dragging || !dragStart) return;
          const r = previewCanvas.getBoundingClientRect();
          state.cardX = Math.max(0.15, Math.min(0.85, dragStart.cx + (e.clientX - dragStart.x) / Math.max(1, r.width)));
          state.cardY = Math.max(0.15, Math.min(0.85, dragStart.cy + (e.clientY - dragStart.y) / Math.max(1, r.height)));
          redraw();
        });
        previewCanvas.addEventListener('pointerup', () => { dragging = false; dragStart = null; });
        previewCanvas.addEventListener('pointercancel', () => { dragging = false; dragStart = null; });

        function renderPanel() {
          const panel = body.querySelector('#sf-p3-panel');
          if (!panel) return;

          if (state.activeTab === 'foto') {
            panel.innerHTML = `
              <div class="sf-stack" style="gap:10px;">
                <div class="sf-row-gap">
                  <button type="button" class="sf-pill-btn accent" id="sf-p3-up-photo" style="flex:1;">Pilih Foto Galeri (AI Depth)</button>
                  ${state.photoCanvas ? '<button type="button" class="sf-pill-btn soft" id="sf-p3-rm-photo">Hapus</button>' : ''}
                </div>
                <div class="sf-row-between">
                  <b style="font-size:13px;">AI Depth (Kartu di Belakang Subjek)</b>
                  <button type="button" class="sf-switch ${state.depthEnabled ? 'on' : ''}" id="sf-p3-depth-sw"></button>
                </div>
                <div class="sf-scroll-x">
                  ${[['aurora', 'Aurora'], ['midnight', 'Tengah Malam'], ['sunset', 'Senja'], ['pearl', 'Mutiara']].map(([k, l]) => `
                    <button type="button" class="sf-chip ${state.bgPreset === k ? 'active' : ''}" data-bg="${k}" style="padding:7px 12px;font-size:12px;">${l}</button>
                  `).join('')}
                </div>
              </div>
            `;
            panel.querySelector('#sf-p3-up-photo').onclick = () => {
              const inp = document.createElement('input');
              inp.type = 'file';
              inp.accept = 'image/*';
              inp.onchange = () => handlePhotoUpload(inp.files?.[0]);
              inp.click();
            };
            const rm = panel.querySelector('#sf-p3-rm-photo');
            if (rm) rm.onclick = () => {
              state.photoCanvas = null;
              state.depthCutoutCanvas = null;
              renderPanel();
              redraw();
            };
            panel.querySelector('#sf-p3-depth-sw').onclick = (e) => {
              state.depthEnabled = !state.depthEnabled;
              e.currentTarget.classList.toggle('on', state.depthEnabled);
              redraw();
            };
            panel.querySelectorAll('[data-bg]').forEach((b) => {
              b.onclick = () => {
                state.bgPreset = b.getAttribute('data-bg');
                state.photoCanvas = null;
                renderPanel();
                redraw();
              };
            });
          } else if (state.activeTab === 'kartu') {
            panel.innerHTML = `
              <div class="sf-stack" style="gap:10px;">
                <div class="sf-row-between">
                  <b style="font-size:13.5px;">Lagu Terpilih (${state.tracks.length}/5)</b>
                  <button type="button" class="sf-pill-btn accent" id="sf-p3-pick" style="padding:7px 12px;font-size:12px;">+ Pilih Lagu</button>
                </div>
                <div class="sf-stack" style="gap:6px;">
                  ${state.tracks.map((t, i) => `
                    <div class="sf-row-between sf-card-soft" style="padding:8px 10px;">
                      <div class="sf-row-gap" style="flex:1;min-width:0;">
                        ${SF.ui.renderArtHtml(t, 36, 8, t.title)}
                        <div class="sf-trunc" style="font-size:13px;font-weight:800;">${esc(t.title)}</div>
                      </div>
                      ${state.tracks.length > 1 ? `<button type="button" class="sf-icon-btn" data-rmt="${i}">${SF.icons.close(15)}</button>` : ''}
                    </div>
                  `).join('')}
                </div>
                <div class="sf-row-between"><span style="font-size:12.5px;font-weight:700;">Ukuran Kartu</span><span>${Math.round(state.cardScale * 100)}%</span></div>
                <input type="range" class="sf-slider" id="sf-p3-sc" min="0.6" max="1.45" step="0.05" value="${state.cardScale}">
              </div>
            `;
            panel.querySelector('#sf-p3-pick').onclick = () => openSongPickerModal(() => { renderPanel(); redraw(); });
            panel.querySelectorAll('[data-rmt]').forEach((b) => {
              b.onclick = () => {
                state.tracks.splice(parseInt(b.getAttribute('data-rmt'), 10), 1);
                renderPanel();
                redraw();
              };
            });
            panel.querySelector('#sf-p3-sc').oninput = (e) => { state.cardScale = Number(e.target.value); redraw(); };
          } else if (state.activeTab === 'gaya') {
            panel.innerHTML = `
              <div class="sf-stack" style="gap:10px;">
                <div class="sf-scroll-x">
                  ${[['glass', 'Liquid Glass'], ['dark', 'Gelap Elegan'], ['light', 'Putih Bersih'], ['vinyl', 'Gradien Vinyl']].map(([k, l]) => `
                    <button type="button" class="sf-chip ${state.cardStyle === k ? 'active' : ''}" data-cs="${k}" style="padding:7px 12px;font-size:12px;">${l}</button>
                  `).join('')}
                </div>
                <div>
                  <div class="sf-row-between"><span style="font-size:12.5px;font-weight:700;">Sudut 3D Horizontal (Y)</span><span>${state.tiltY}°</span></div>
                  <input type="range" class="sf-slider" id="sf-p3-ty" min="-42" max="42" step="1" value="${state.tiltY}">
                </div>
                <div>
                  <div class="sf-row-between"><span style="font-size:12.5px;font-weight:700;">Sudut 3D Vertikal (X)</span><span>${state.tiltX}°</span></div>
                  <input type="range" class="sf-slider" id="sf-p3-tx" min="-35" max="35" step="1" value="${state.tiltX}">
                </div>
                <div>
                  <div class="sf-row-between"><span style="font-size:12.5px;font-weight:700;">Ketebalan 3D</span><span>${state.thickness}px</span></div>
                  <input type="range" class="sf-slider" id="sf-p3-th" min="4" max="34" step="1" value="${state.thickness}">
                </div>
              </div>
            `;
            panel.querySelectorAll('[data-cs]').forEach((b) => {
              b.onclick = () => { state.cardStyle = b.getAttribute('data-cs'); renderPanel(); redraw(); };
            });
            panel.querySelector('#sf-p3-ty').oninput = (e) => { state.tiltY = Number(e.target.value); redraw(); };
            panel.querySelector('#sf-p3-tx').oninput = (e) => { state.tiltX = Number(e.target.value); redraw(); };
            panel.querySelector('#sf-p3-th').oninput = (e) => { state.thickness = Number(e.target.value); redraw(); };
          } else if (state.activeTab === 'efek') {
            panel.innerHTML = `
              <div class="sf-stack" style="gap:10px;">
                <div>
                  <div class="sf-row-between"><span style="font-size:12.5px;font-weight:700;">Kilau Kaca Diagonal</span><span>${Math.round(state.glare * 100)}%</span></div>
                  <input type="range" class="sf-slider" id="sf-p3-gl" min="0" max="1" step="0.05" value="${state.glare}">
                </div>
                <div>
                  <div class="sf-row-between"><span style="font-size:12.5px;font-weight:700;">Cahaya Belakang</span><span>${Math.round(state.backlight * 100)}%</span></div>
                  <input type="range" class="sf-slider" id="sf-p3-bl" min="0" max="1" step="0.05" value="${state.backlight}">
                </div>
                <div>
                  <div class="sf-row-between"><span style="font-size:12.5px;font-weight:700;">Lens Flare ✦</span><span>${Math.round(state.flare * 100)}%</span></div>
                  <input type="range" class="sf-slider" id="sf-p3-fl" min="0" max="1" step="0.05" value="${state.flare}">
                </div>
              </div>
            `;
            panel.querySelector('#sf-p3-gl').oninput = (e) => { state.glare = Number(e.target.value); redraw(); };
            panel.querySelector('#sf-p3-bl').oninput = (e) => { state.backlight = Number(e.target.value); redraw(); };
            panel.querySelector('#sf-p3-fl').oninput = (e) => { state.flare = Number(e.target.value); redraw(); };
          } else if (state.activeTab === 'stiker') {
            panel.innerHTML = `
              <div class="sf-stack" style="gap:10px;">
                <div class="sf-scroll-x">
                  <button type="button" class="sf-chip active" id="sf-p3-add-custom" style="padding:7px 12px;font-size:12px;">+ Tambah stiker</button>
                  <button type="button" class="sf-chip" id="sf-p3-add-birds" style="padding:7px 12px;font-size:12px;">Burung</button>
                  <button type="button" class="sf-chip" id="sf-p3-add-sparkle" style="padding:7px 12px;font-size:12px;">Kilau ✦</button>
                  ${state.stickers.length ? '<button type="button" class="sf-chip" id="sf-p3-clr-stk" style="padding:7px 12px;font-size:12px;">Bersihkan</button>' : ''}
                </div>
                ${state.customStickers.length ? `
                  <div>
                    <div class="sf-muted" style="font-size:12px;font-weight:700;margin-bottom:6px;">Stiker saya</div>
                    <div class="sf-scroll-x">
                      ${state.customStickers.map((src, idx) => `
                        <button type="button" data-cs-idx="${idx}" style="width:48px;height:48px;border-radius:12px;border:1px solid var(--border);overflow:hidden;flex:0 0 auto;background:var(--surface-2);">
                          <img src="${esc(src)}" alt="" style="width:100%;height:100%;object-fit:contain;">
                        </button>
                      `).join('')}
                    </div>
                  </div>
                ` : '<div class="sf-muted" style="font-size:12px;">Tambahkan stiker PNG/foto sendiri atau pilih Burung & Kilau di atas.</div>'}
              </div>
            `;
            panel.querySelector('#sf-p3-add-birds').onclick = () => {
              state.stickers.push({ type: 'birds', x: 0.25 + Math.random() * 0.5, y: 0.16 + Math.random() * 0.22, size: 0.22 });
              renderPanel();
              redraw();
            };
            panel.querySelector('#sf-p3-add-sparkle').onclick = () => {
              state.stickers.push({ type: 'sparkle', x: 0.2 + Math.random() * 0.6, y: 0.18 + Math.random() * 0.55, size: 0.18 });
              renderPanel();
              redraw();
            };
            const clr = panel.querySelector('#sf-p3-clr-stk');
            if (clr) clr.onclick = () => { state.stickers = []; renderPanel(); redraw(); };

            panel.querySelector('#sf-p3-add-custom').onclick = () => {
              const inp = document.createElement('input');
              inp.type = 'file';
              inp.accept = 'image/*';
              inp.onchange = () => {
                const f = inp.files?.[0];
                if (!f) return;
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = String(reader.result || '');
                  const im = new Image();
                  im.onload = () => {
                    const sc = Math.min(1, 256 / Math.max(im.width, im.height));
                    const c = document.createElement('canvas');
                    c.width = Math.max(1, Math.round(im.width * sc));
                    c.height = Math.max(1, Math.round(im.height * sc));
                    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
                    const small = c.toDataURL('image/png');
                    state.customStickers.unshift(small);
                    saveCustomStickers();
                    state.stickers.push({ type: 'custom', img: c, x: 0.5, y: 0.78, size: 0.22 });
                    renderPanel();
                    redraw();
                  };
                  im.src = dataUrl;
                };
                reader.readAsDataURL(f);
              };
              inp.click();
            };

            panel.querySelectorAll('[data-cs-idx]').forEach((b) => {
              b.onclick = () => {
                const src = state.customStickers[parseInt(b.getAttribute('data-cs-idx'), 10)];
                if (!src) return;
                const im = new Image();
                im.onload = () => {
                  state.stickers.push({ type: 'custom', img: im, x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4, size: 0.22 });
                  redraw();
                };
                im.src = src;
              };
            });
          }
        }

        body.querySelectorAll('#sf-p3-ratios [data-rat]').forEach((b) => {
          b.onclick = () => {
            state.ratio = b.getAttribute('data-rat');
            body.querySelectorAll('#sf-p3-ratios [data-rat]').forEach((x) => x.classList.toggle('active', x === b));
            redraw();
          };
        });
        body.querySelector('#sf-p3-rand').onclick = () => {
          state.tiltX = Math.round((Math.random() - 0.5) * 44);
          state.tiltY = Math.round((Math.random() - 0.5) * 56);
          state.bgPreset = ['aurora', 'midnight', 'sunset', 'pearl'][Math.floor(Math.random() * 4)];
          state.cardStyle = ['glass', 'dark', 'light', 'vinyl'][Math.floor(Math.random() * 4)];
          renderPanel();
          redraw();
        };
        body.querySelectorAll('#sf-p3-tabs [data-pt]').forEach((b) => {
          b.onclick = () => {
            state.activeTab = b.getAttribute('data-pt');
            body.querySelectorAll('#sf-p3-tabs [data-pt]').forEach((x) => x.classList.toggle('active', x === b));
            renderPanel();
          };
        });

        root.querySelector('#sf-p3-reset').onclick = () => {
          state.tiltX = 16;
          state.tiltY = -22;
          state.cardScale = 1.0;
          state.cardX = 0.5;
          state.cardY = 0.48;
          state.thickness = 18;
          state.stickers = [];
          renderPanel();
          redraw();
        };
        root.querySelector('#sf-p3-share').onclick = () => saveOrSharePoster(true);
        root.querySelector('#sf-p3-save').onclick = () => saveOrSharePoster(false);

        renderPanel();
        redraw();
      },
    });
  }

  SF.poster3d = {
    init() {
      loadCustomStickers();
    },
    open,
  };
})();
