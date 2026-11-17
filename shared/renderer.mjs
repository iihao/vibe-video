/* 艺术层可以由外部提供（three.js WebGL），核心渲染器保持零依赖，
   这样离线 HTML 直接内联本文件时依然能跑。 */
let artProvider = null;

/* 内容相关图形库（figures.mjs）：离线 HTML 内联时会一起打入，零依赖。 */
import { figures, hasFigure } from './figures.mjs';
export function setArtProvider(provider) {
  artProvider = provider;
}

const nebulaHash = (n) => {
  const v = Math.sin(n * 91.7 + 41.3) * 43758.5453123;
  return v - Math.floor(v);
};

/** 没有 WebGL 时的 2D 星云回退：同一套配色，但没有真实景深。 */
function drawNebula2D(ctx, p, t, W, H, portrait) {
  const cx = portrait ? W * 0.5 : W * 0.66,
    cy = portrait ? H * 0.55 : H * 0.56;
  const base = Math.max(W, H);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const clouds = [
    { dx: -0.1, dy: 0.04, r: 0.3, color: p.accent, alpha: 0.3, drift: 0.05 },
    { dx: 0.12, dy: -0.05, r: 0.26, color: p.ink, alpha: 0.16, drift: -0.04 },
    { dx: -0.02, dy: -0.02, r: 0.13, color: p.accent, alpha: 0.42, drift: 0.02 },
    { dx: 0.2, dy: 0.1, r: 0.2, color: p.faint, alpha: 0.18, drift: -0.07 },
  ];
  for (const [i, cloud] of clouds.entries()) {
    const x = cx + Math.sin(t * cloud.drift + i * 1.7) * base * 0.05 + cloud.dx * base;
    const y = cy + Math.cos(t * cloud.drift * 0.8 + i) * base * 0.035 + cloud.dy * base;
    const radius = cloud.r * base * (1 + Math.sin(t * 0.3 + i) * 0.03);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(
      0,
      `${cloud.color}${Math.round(cloud.alpha * 255)
        .toString(16)
        .padStart(2, '0')}`,
    );
    gradient.addColorStop(0.45, `${cloud.color}22`);
    gradient.addColorStop(1, `${cloud.color}00`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 260; i++) {
    const angle = nebulaHash(i + 3) * Math.PI * 2 + t * (0.05 + nebulaHash(i + 17) * 0.06);
    const radius = Math.pow(nebulaHash(i + 31), 0.6) * base * 0.42;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius * 0.55;
    ctx.globalAlpha = 0.14 + nebulaHash(i + 57) * 0.5;
    ctx.fillStyle = i % 9 === 0 ? p.ink : p.accent;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + nebulaHash(i + 71) * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawPixelVisual(ctx, visual, t, p, rand) {
  const tile = 12;
  const square = (x, y, color = p.accent, size = tile) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x / tile) * tile, Math.round(y / tile) * tile, size, size);
  };
  const colors = [p.accent, p.ink, p.faint];
  for (let i = 0; i < 42; i++) {
    const x = (rand(i + 8) - 0.5) * 500;
    const y = (rand(i + 29) - 0.5) * 300;
    if (Math.abs(x) > 145 || Math.abs(y) > 105) square(x, y, colors[i % colors.length], 6);
  }
  if (visual === 'blackhole') {
    for (let ring = 7; ring >= 0; ring--) {
      ctx.fillStyle = ring % 2 ? p.faint : p.accent;
      ctx.fillRect(-150 - ring * 12, -36 - ring * 6, 300 + ring * 24, 12);
    }
    for (let row = -5; row <= 5; row++)
      for (let col = -5; col <= 5; col++)
        if (col * col + row * row <= 25) square(col * tile, row * tile, '#101827');
    for (let i = 0; i < 12; i++) square(102 + i * 5, 12 + Math.sin(t * 2 + i) * 28, p.ink, 6);
  } else if (visual === 'orbits') {
    for (let ring = 4; ring > 0; ring--) {
      const rx = 36 + ring * 26,
        ry = 24 + ring * 17;
      for (let a = 0; a < 64; a += Math.max(2, ring * 2)) {
        const angle = (a / 64) * Math.PI * 2;
        square(Math.cos(angle) * rx, Math.sin(angle) * ry, colors[ring % 3], 8);
      }
      const angle = t * (0.12 + ring * 0.035) + ring;
      square(Math.cos(angle) * rx, Math.sin(angle) * ry, p.ink, 14);
    }
    square(0, 0, p.accent, 24);
  } else if (visual === 'grid') {
    for (let row = -7; row <= 7; row++) {
      for (let col = -9; col <= 9; col++) {
        const dip = Math.max(0, 5 - Math.floor(Math.hypot(col, row) / 2));
        if (row % 2 === 0 || col % 2 === 0) square(col * 18, row * 17 + dip * 7, p.faint, 6);
      }
    }
    square(0, -6, p.accent, 24);
    square(-12, 6, p.ink, 12);
    square(12, 6, p.ink, 12);
  } else if (visual === 'bars') {
    for (let col = 0; col < 7; col++) {
      const height = 4 + Math.floor((2 + Math.sin(t * 0.8 + col * 1.4)) * 6);
      for (let row = 0; row < height; row++)
        square(-180 + col * 54, 90 - row * tile, col === 4 ? p.accent : p.faint, 34);
      square(-180 + col * 54, 108, p.ink, 18);
    }
  } else {
    for (let i = 0; i < 130; i++) {
      const angle = i * 0.21 + t * 0.12;
      const radius = Math.sqrt(i) * 15;
      square(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.72,
        colors[i % 3],
        i % 6 ? 7 : 12,
      );
    }
  }
}

function drawClaudeVisual(ctx, visual, t, p, rand) {
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#cfc5b6';
  ctx.fillStyle = '#e9e1d6';
  ctx.beginPath();
  ctx.arc(0, 0, 170, 0, Math.PI * 2);
  ctx.fill();
  if (visual === 'blackhole') {
    ctx.strokeStyle = p.accent;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.52 - i * 0.11;
      ctx.beginPath();
      ctx.arc(0, 0, 95 + i * 28, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(118, Math.sin(t * 0.65) * 95, 8, 0, Math.PI * 2);
    ctx.fill();
  } else if (visual === 'orbits') {
    ctx.strokeStyle = p.accent;
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.36 + i * 0.12;
      ctx.beginPath();
      ctx.ellipse(0, 0, 58 + i * 31, 33 + i * 18, -0.34, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(Math.cos(t * 0.38) * 151, Math.sin(t * 0.38) * 92, 7, 0, Math.PI * 2);
    ctx.fill();
  } else if (visual === 'grid') {
    ctx.strokeStyle = '#b7aa98';
    ctx.globalAlpha = 0.6;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 42, -124);
      ctx.lineTo(i * 42, 124);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-124, i * 42);
      ctx.lineTo(124, i * 42);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
  } else if (visual === 'bars') {
    const heights = [68, 108, 82, 144, 102, 126];
    heights.forEach((height, i) => {
      ctx.fillStyle = i === 3 ? p.accent : '#c6b9a8';
      ctx.fillRect(-156 + i * 53, 88 - height, 28, height);
    });
    ctx.strokeStyle = p.faint;
    ctx.beginPath();
    ctx.moveTo(-170, 91);
    ctx.lineTo(171, 91);
    ctx.stroke();
  } else {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + t * 0.08;
      const radius = 42 + (i % 3) * 34;
      ctx.fillStyle = i % 3 === 0 ? p.accent : i % 2 ? '#b8aa98' : '#d5c8b7';
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, 6 + (i % 3) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = p.accent;
  for (let i = 0; i < 5; i++) {
    const x = -142 + rand(i + 3) * 284,
      y = -142 + rand(i + 21) * 284;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* 平滑周期函数：把时间映射到 [0,1) 的往复，用于镜头呼吸式运动。 */
function cycle(t, period, phase = 0) {
  const x = ((t + phase * period) % period) / period;
  return 0.5 - 0.5 * Math.cos(x * Math.PI * 2);
}

/* 连续摄像机运镜：基于全局时间 t 的确定性镜头变换。
 * 返回 { zoom, panX, panY, roll }，全部用平滑周期驱动，保证：
 * 1) 镜头始终在缓慢运动（呼吸感、漂浮感）；
 * 2) 纯函数确定，预览/导出/离线 HTML 三路一致；
 * 3) 切镜不断镜头，消除翻页感。 */
function cameraTransform(t, duration, portrait) {
  const norm = duration > 0 ? t / duration : 0;
  // 推拉：极缓慢的呼吸缩放，幅度克制（±3%），周期约 14s
  const zoom = 1 + Math.sin(t * 0.45) * 0.03 + Math.sin(t * 0.17 + 1.3) * 0.012;
  // 横移：缓慢漂移，竖屏幅度略大以增加动感
  const panAmp = portrait ? 26 : 16;
  const panX = Math.sin(t * 0.23 + 0.6) * panAmp + Math.sin(t * 0.11) * panAmp * 0.5;
  const panY = Math.cos(t * 0.19 + 2.1) * panAmp * 0.6;
  // 俯仰（轻微旋转）：极小的 roll，制造"漂浮"但不眩晕
  const roll = Math.sin(t * 0.13 + 0.9) * 0.012;
  // 进场：视频前 1.2 秒从轻微放大中"落定"，给开头一个确定性的推入
  const settle = Math.min(1, t / 1.2);
  const settleEase = 1 - Math.pow(1 - settle, 3);
  const settleZoom = 1 + (1 - settleEase) * 0.04;
  return { zoom: zoom * settleZoom, panX, panY, roll };
}

/* Deterministic animation: every pixel depends only on project + t. */
function drawStandardFrame(canvas, project, time, options = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width,
    h = canvas.height;
  const portrait = h > w * 1.2;
  const W = 1000,
    H = (W * h) / w;
  const palettes = {
    cosmos: { bg: '#080b0e', ink: '#f5e5ce', accent: '#e9b77c', faint: '#65716e', grid: '#b8bca9' },
    blueprint: {
      bg: '#0d1d29',
      ink: '#ddeef4',
      accent: '#80c7e7',
      faint: '#7a9bae',
      grid: '#a7daec',
    },
    editorial: {
      bg: '#e6dfcf',
      ink: '#34362f',
      accent: '#996843',
      faint: '#817b6c',
      grid: '#636d5c',
    },
    minimal: {
      bg: '#152019',
      ink: '#eceddf',
      accent: '#b9d39a',
      faint: '#7d9580',
      grid: '#b9d39a',
    },
    pixel: { bg: '#101722', ink: '#eff6e8', accent: '#73dfb5', faint: '#728ca0', grid: '#53736e' },
    claude: { bg: '#f4f0e8', ink: '#312c27', accent: '#bf6449', faint: '#776d62', grid: '#c7bcad' },
  };
  const p = palettes[project.style] || palettes.cosmos;
  const t = Math.max(0, Math.min(time, project.duration - 0.001));
  const scenes = project.scenes || [];
  const index = Math.max(
    0,
    scenes.findIndex((s) => t >= s.start && t < s.end),
  );
  const scene = scenes[index] || {
    title: project.title,
    subtitle: '',
    visual: 'blackhole',
    label: '',
  };
  const local = t - (scene.start || 0);
  const rand = (n) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return v - Math.floor(v);
  };
  ctx.save();
  ctx.setTransform(w / W, 0, 0, w / W, 0, 0);
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  const softStyle = ['pixel', 'claude'].includes(project.style);
  if (!softStyle) {
    const warm = ctx.createRadialGradient(W * 0.68, H * 0.6, 0, W * 0.68, H * 0.6, W * 0.6);
    warm.addColorStop(0, project.style === 'editorial' ? '#b3ad9122' : `${p.accent}0d`);
    warm.addColorStop(1, '#00000000');
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, W, H);
  }
  if (project.style === 'claude') {
    for (let i = 0; i < 85; i++) {
      ctx.globalAlpha = 0.035 + rand(i + 44) * 0.04;
      ctx.fillStyle = i % 2 ? '#897762' : '#ffffff';
      ctx.fillRect(rand(i + 1) * W, rand(i + 210) * H, 1 + rand(i + 600) * 2, 1);
    }
  } else {
    for (let i = 0; i < 180; i++) {
      ctx.globalAlpha = (0.15 + rand(i + 44) * 0.5) * (0.7 + Math.sin(t * 0.4 + i) * 0.3);
      ctx.fillStyle = p.ink;
      if (project.style === 'pixel') {
        ctx.fillRect(
          Math.round((rand(i + 1) * W) / 12) * 12,
          Math.round((rand(i + 210) * H) / 12) * 12,
          5 + (i % 3) * 3,
          5 + (i % 3) * 3,
        );
      } else {
        ctx.beginPath();
        ctx.arc(rand(i + 1) * W, rand(i + 210) * H, 0.25 + rand(i + 600) * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  const visual = scene.visual || 'blackhole';
  const figure = scene.art && hasFigure(scene.art.kind) ? scene.art.kind : visual;
  /* 'nebula' 的艺术层可以由外部 WebGL 提供（见 nebula-webgl.mjs）；
     没有提供者时（离线 HTML、无 WebGL 的机器）退回下面的 2D 版本。 */
  let nebulaDrawn = false;
  if (figure === 'nebula' && !['pixel', 'claude'].includes(project.style)) {
    const progress = Math.min(
      1,
      Math.max(0, local / Math.max(0.001, (scene.end || 0) - (scene.start || 0))),
    );
    nebulaDrawn = Boolean(
      artProvider?.(ctx, {
        project,
        scene,
        index,
        t,
        local,
        progress,
        W,
        H,
        palette: p,
        portrait,
      }),
    );
    if (!nebulaDrawn) drawNebula2D(ctx, p, t, W, H);
    nebulaDrawn = true;
  }
  const cx = portrait ? 500 : 680,
    cy = portrait ? H * 0.56 : H * 0.59;
  const artScale = portrait ? 1.25 : 0.96;
  /* 连续摄像机运镜：给整个画面一个缓慢、确定性的镜头运动（推拉 + 横移 + 轻微俯仰）。
   * 关键：用全局时间 t（而非分镜内 local）驱动，让镜头"永远在动"，切镜也不中断，
   * 消除"PPT 翻页"的静止感。每一段用 smoothstep 周期往复，避免突变。 */
  const cam = cameraTransform(t, project.duration, portrait);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(artScale * cam.zoom, artScale * cam.zoom);
  ctx.rotate(cam.roll);
  ctx.translate(cam.panX, cam.panY);
  // Spatial guide grid.
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = p.grid;
  ctx.globalAlpha = 0.1;
  if (!nebulaDrawn && !['pixel', 'claude'].includes(project.style))
    for (let j = -8; j <= 8; j++) {
      ctx.beginPath();
      for (let k = -12; k <= 12; k++) {
        const x = k * 27,
          y = j * 26;
        const dip = 72 * Math.exp(-(x * x + y * y) / 18000);
        const py = y * 0.6 + dip;
        if (k === -12) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let k = -8; k <= 8; k++) {
        const x = j * 38,
          y = k * 26;
        const dip = 72 * Math.exp(-(x * x + y * y) / 18000);
        const py = y * 0.6 + dip;
        if (k === -8) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
  ctx.globalAlpha = 1;
  if (nebulaDrawn) {
    // 星云已经画满整帧，不再叠加 2D 图形。
  } else if (hasFigure(figure)) {
    // Semantic figures take precedence; pixel and Claude styles are applied around them.
    figures[figure](ctx, p, t, local, scene.art || {});
  } else if (project.style === 'pixel') {
    drawPixelVisual(ctx, visual, t, p, rand);
  } else if (project.style === 'claude') {
    drawClaudeVisual(ctx, visual, t, p, rand);
  } else if (visual === 'blackhole' || visual === 'grid') {
    const r = visual === 'grid' ? 70 : 106;
    ctx.save();
    ctx.rotate(-0.15);
    const glow = ctx.createRadialGradient(0, 0, r * 0.65, 0, 0, r * 2.4);
    glow.addColorStop(0, '#00000000');
    glow.addColorStop(0.25, `${p.accent}18`);
    glow.addColorStop(0.5, `${p.accent}08`);
    glow.addColorStop(1, '#00000000');
    ctx.fillStyle = glow;
    ctx.fillRect(-350, -350, 700, 700);
    for (let k = 28; k >= 0; k--) {
      ctx.globalAlpha = 0.03 + ((28 - k) / 28) * 0.36;
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = k > 18 ? 2 : 0.7;
      ctx.beginPath();
      ctx.ellipse(0, 0, r + k * 2.8, r * 0.94 + k * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.bg;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = p.accent;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.02, r * 0.98, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let k = 0; k < 52; k++) {
      const rr = 105 + k * 2.45;
      ctx.globalAlpha = 0.025 + 0.22 * Math.pow(1 - k / 52, 2);
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(0, 10, rr * 1.33, rr * 0.23, 0, 0, Math.PI);
      ctx.stroke();
    }
    for (let i = 0; i < 700; i++) {
      const angle = rand(i + 8) * Math.PI * 2 + t * (0.04 + rand(i + 20) * 0.07);
      const radius = 112 + rand(i + 91) * 113;
      const x = Math.cos(angle) * radius * 1.33,
        y = Math.sin(angle) * radius * 0.23 + 10;
      if (y < 0 && Math.abs(x) < r * 0.94) continue;
      ctx.globalAlpha = rand(i + 119) * 0.75;
      ctx.fillStyle = i % 7 === 0 ? p.ink : p.accent;
      ctx.fillRect(x, y, rand(i + 37) * 1.5 + 0.3, 0.7);
    }
    ctx.restore();
  } else if (visual === 'orbits') {
    ctx.strokeStyle = p.accent;
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.15 + i * 0.06;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(0, 0, 92 + i * 39, 55 + i * 18, -0.4, 0, Math.PI * 2);
      ctx.stroke();
      const a = t * (0.15 + i * 0.05) + i * 1.8;
      const x = Math.cos(a) * (92 + i * 39),
        y = Math.sin(a) * (55 + i * 18);
      ctx.save();
      ctx.rotate(-0.4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.ink;
      ctx.shadowColor = p.accent;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(x, y, 3 + i * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(-20, -20, 0, 0, 0, 59);
    g.addColorStop(0, p.accent);
    g.addColorStop(0.6, `${p.accent}88`);
    g.addColorStop(1, `${p.accent}05`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 59, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 59, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = '10px monospace';
    ctx.fillStyle = p.faint;
    ctx.fillText('RELATIVITY IN MOTION', -65, 155);
  } else if (visual === 'bars') {
    for (let i = 0; i < 7; i++) {
      const bh = (65 + rand(i + 40) * 155) * Math.min(1, 0.4 + local / 2);
      ctx.fillStyle = `${p.accent}${i === 4 ? 'ff' : '65'}`;
      ctx.fillRect(-190 + i * 55, 100 - bh, 31, bh);
      ctx.font = '12px monospace';
      ctx.fillText(String(i + 1), -180 + i * 55, 123);
    }
    ctx.strokeStyle = p.faint;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(-220, 100);
    ctx.lineTo(215, 100);
    ctx.stroke();
  } else {
    for (let i = 0; i < 400; i++) {
      const a = i * 0.17 + t * 0.08;
      const r = Math.sqrt(i) * 10;
      const twist = Math.sin(t * 0.15 + i * 0.008) * 0.7;
      ctx.globalAlpha = 0.2 + rand(i + 45) * 0.7;
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(Math.cos(a + twist) * r, Math.sin(a) * r * 0.7, 0.5 + rand(i) * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  if (options.text !== false) {
    const margin = portrait ? 75 : 60;
    ctx.font = '10px "SFMono-Regular", monospace';
    ctx.fillStyle = p.faint;
    ctx.fillText('V I B E   /   K N O W L E D G E', margin, 46);
    ctx.textAlign = 'right';
    ctx.fillText(
      `NO. ${String(index + 1).padStart(2, '0')}  —  ${String(scenes.length).padStart(2, '0')}`,
      W - margin,
      46,
    );
    ctx.textAlign = 'left';
    // 形态同构转场：切镜后的短暂窗口，标题用缓动从上滑入 + 淡入（确定性，依赖 local）。
    // 替代原来的生硬黑遮罩，让"换镜"有落定感而非突兀硬切。
    const cutIn = index > 0 ? Math.min(1, local / 0.3) : 1;
    const easeIn = 1 - Math.pow(1 - cutIn, 3); // easeOutCubic
    const titleLift = (1 - easeIn) * 26;
    ctx.save();
    ctx.globalAlpha = easeIn;
    ctx.translate(0, titleLift);
    const titleY = portrait ? 190 : H * 0.29;
    ctx.fillStyle = p.accent;
    ctx.font = '11px "PingFang SC", sans-serif';
    ctx.fillText(scene.label || '让知识被看见', margin, titleY - (portrait ? 85 : 64));
    ctx.fillStyle = p.ink;
    const fontSize = portrait ? 58 : 44;
    const maxWidth = portrait ? 850 : 580;
    ctx.font =
      project.style === 'claude'
        ? `500 ${fontSize}px "PingFang SC", "Helvetica Neue", sans-serif`
        : project.style === 'pixel'
          ? `bold ${fontSize}px "Courier New", monospace`
          : `500 ${fontSize}px "Songti SC", "Noto Serif CJK SC", "SimSun", serif`;
    let lines = [],
      line = '';
    for (const char of scene.title || '') {
      if (
        ctx.measureText(line + char).width > maxWidth &&
        line &&
        !/[，。！？；：、）》」』】]/.test(char)
      ) {
        lines.push(line);
        line = char;
      } else line += char;
    }
    if (line) lines.push(line);
    // 标题逐字入场：每个字依次浮现 + 轻微上移，形成节奏冲击。
    // 首幕（index===0）立即全显（强钩子首帧）；后续幕用 local 在 0.5s 内逐字完成。
    const totalChars = Math.max(
      1,
      lines.reduce((s, l) => s + l.length, 0),
    );
    const charDur = index > 0 ? 0.5 / totalChars : 0;
    let globalChar = 0;
    lines.forEach((str, i) => {
      const y = titleY + i * fontSize * 1.35;
      let xCursor = margin;
      for (const ch of str) {
        const appearT = index > 0 ? globalChar * charDur : 0;
        const appear =
          index > 0 ? Math.min(1, Math.max(0, (local - appearT) / (charDur * 1.4))) : 1;
        const lift = (1 - appear) * 18;
        ctx.save();
        ctx.globalAlpha = appear;
        ctx.translate(0, lift);
        ctx.fillText(ch, xCursor, y);
        ctx.restore();
        xCursor += ctx.measureText(ch).width;
        globalChar += 1;
      }
    });
    // 有配音时，底部逐字字幕会显示旁白文案，顶部不再重复画副标题。
    if (!(scene.voice && scene.voice.words && scene.voice.words.length)) {
      ctx.font = `${portrait ? 20 : 13}px "PingFang SC", sans-serif`;
      ctx.fillStyle = p.faint;
      const subWidth = portrait ? 830 : 420;
      let subLines = [],
        sub = '';
      for (const char of scene.subtitle || '') {
        if (
          ctx.measureText(sub + char).width > subWidth &&
          sub &&
          !/[，。！？；：、）》」』】]/.test(char)
        ) {
          subLines.push(sub);
          sub = char;
        } else sub += char;
      }
      if (sub) subLines.push(sub);
      const subY = portrait
        ? titleY + lines.length * fontSize * 1.35 + 30
        : titleY + lines.length * fontSize * 1.35 + 17;
      // 副标题淡入跟随标题逐字完成后出现（index>0 时延后，首幕稍快）
      const subDelay = index > 0 ? 0.35 : 0.15;
      const subIn = Math.min(1, Math.max(0, (local - subDelay) / 0.4));
      ctx.save();
      ctx.globalAlpha = subIn;
      ctx.translate(0, (1 - subIn) * 14);
      subLines.forEach((str, i) => ctx.fillText(str, margin, subY + i * (portrait ? 34 : 24)));
      ctx.restore();
    }
    ctx.restore(); // 结束转场位移/淡入，页脚保持固定
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.faint;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(margin, H - 56);
    ctx.lineTo(W - margin, H - 56);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = '9px monospace';
    ctx.fillStyle = p.faint;
    ctx.fillText('A SMALL THOUGHT. A BIGGER UNIVERSE.', margin, H - 31);
    ctx.textAlign = 'right';
    ctx.font = '9px "PingFang SC", sans-serif';
    ctx.fillText('知识可视化 · 艺术示意', W - margin, H - 31);
    ctx.textAlign = 'left';
    // 逐字高亮字幕（Karaoke 字幕）：当分镜携带 TTS 逐字时间戳时，
    // 在画面底部渲染一条"当前句"，正在朗读的字用 accent 高亮 + 放大，
    // 已读字用 ink、未读字用 faint，跟随配音逐字点亮。
    if (scene.voice && scene.voice.words && scene.voice.words.length) {
      drawKaraokeCaption(ctx, scene.voice.words, local, p, W, H, portrait);
    }
    // 形态同构转场：切镜瞬间一道发光能量环从中心扩散扫过，画面随之"穿场"。
    // 0.22s 内完成，环扩散 + 画面短暂泛白，比旧版纯闪白更有"推进感"。
    if (index > 0 && local < 0.22) {
      const k = local / 0.22; // 0→1
      const ringR = Math.pow(k, 0.6) * Math.max(W, H) * 0.75;
      const ringAlpha = (1 - k) * 0.9;
      // 发光能量环
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const ringGrad = ctx.createRadialGradient(W / 2, H / 2, ringR * 0.82, W / 2, H / 2, ringR);
      ringGrad.addColorStop(0, `${p.accent}00`);
      ringGrad.addColorStop(
        0.85,
        `${p.accent}${Math.round(ringAlpha * 255)
          .toString(16)
          .padStart(2, '0')}`,
      );
      ringGrad.addColorStop(1, `${p.accent}00`);
      ctx.fillStyle = ringGrad;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, ringR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // 轻微泛白落定
      const flash = (1 - k) * 0.32;
      ctx.fillStyle = `rgba(255,255,255,${flash.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
  applyAmbientMotion(ctx, p, project, t, W, H);
  applyCinematicLayer(ctx, p, project, t, W, H, index);
  applyClimaxBurst(ctx, p, project, scene, index, local, t, W, H, scenes);
  ctx.restore();
}

/* 逐字高亮字幕（Karaoke 字幕）：
 * 只显示“当前一句”，用固定字号排版，高亮只改颜色与发光、不改变字宽，
 * 因此整行位置稳定，不会随朗读进度左右抖动。
 * 时间戳是相对分镜起点的毫秒数，local 是相对分镜起点的秒数。 */
function drawKaraokeCaption(ctx, words, local, p, W, H, portrait) {
  const nowMs = local * 1000;
  const baseFontSize = portrait ? 30 : 24;
  const lineHeight = baseFontSize * 1.65;
  const maxWidth = W - (portrait ? 160 : 200);
  const sentenceEnd = /[。！？!?；;]/;
  const y = portrait ? H - 150 : H - 120;

  // 最后一个已经开始朗读的字；还没开口时先展示第一句。
  let rawActive = -1;
  for (let i = 0; i < words.length; i++) {
    if (nowMs >= words[i].beginMs) rawActive = i;
    else break;
  }
  const focus = Math.max(0, rawActive);

  // 只取当前句子（以句末标点为界），避免整段旁白常驻屏幕。
  let start = focus;
  let end = focus;
  while (start > 0 && !sentenceEnd.test(words[start - 1].text)) start--;
  while (end < words.length - 1 && !sentenceEnd.test(words[end].text)) end++;
  const segment = words.slice(start, end + 1);
  if (!segment.length) return;

  // 把连续的数字/英文合并成不可拆分的词组，避免把「45」拆成「4 / 5」。
  const isAlnumToken = (text) => /^[A-Za-z0-9%.]+$/.test(text);
  const groups = [];
  for (const word of segment) {
    const prev = groups[groups.length - 1];
    if (prev && isAlnumToken(word.text) && /[A-Za-z0-9%.]$/.test(prev.text)) {
      prev.text += word.text;
      prev.endMs = Math.max(prev.endMs, word.endMs);
    } else groups.push({ ...word });
  }

  let activeIndex = -1;
  for (let i = 0; i < groups.length; i++) {
    if (nowMs >= groups[i].beginMs) activeIndex = i;
    else break;
  }

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const font = (size) => `600 ${size}px "PingFang SC", "Helvetica Neue", sans-serif`;
  ctx.font = font(baseFontSize);
  const tracking = baseFontSize * 0.06;
  const widths = groups.map((w) => ctx.measureText(w.text).width);

  // 固定用基础字号计算换行与居中，所有帧布局一致。
  const lines = [];
  let line = { start: 0, end: 0, width: 0 };
  for (let i = 0; i < groups.length; i++) {
    const add = widths[i] + (i > line.start ? tracking : 0);
    // 句末标点尽量不单独换行。
    const keepWithPrevious = /^[，。！？；：、）》」』】…]$/.test(groups[i].text);
    if (line.width + add > maxWidth && i > line.start && !keepWithPrevious) {
      line.end = i;
      lines.push(line);
      line = { start: i, end: i + 1, width: widths[i] };
    } else {
      line.width += add;
      line.end = i + 1;
    }
  }
  lines.push(line);

  const totalHeight = lines.length * lineHeight;
  const firstY = y - (totalHeight - lineHeight) / 2;
  const boxTop = firstY - lineHeight * 0.62;
  const boxBottom = firstY + (lines.length - 1) * lineHeight + lineHeight * 0.62;

  // 底部压暗/压亮条，字幕压在图形或亮环上也能读。
  const scrim = ctx.createLinearGradient(
    0,
    boxTop - lineHeight * 0.5,
    0,
    boxBottom + lineHeight * 0.5,
  );
  scrim.addColorStop(0, `${p.bg}00`);
  scrim.addColorStop(0.18, `${p.bg}d9`);
  scrim.addColorStop(0.82, `${p.bg}d9`);
  scrim.addColorStop(1, `${p.bg}00`);
  ctx.fillStyle = scrim;
  ctx.fillRect(0, boxTop - lineHeight * 0.5, W, boxBottom - boxTop + lineHeight);

  lines.forEach((ln, li) => {
    let x = W / 2 - ln.width / 2;
    const ly = firstY + li * lineHeight;
    for (let i = ln.start; i < ln.end; i++) {
      const w = groups[i];
      const current = i === activeIndex && nowMs < w.endMs;
      const done = i < activeIndex || (i === activeIndex && nowMs >= w.endMs);
      ctx.font = font(baseFontSize);
      ctx.fillStyle = current ? p.accent : done ? p.ink : p.faint;
      ctx.globalAlpha = current ? 1 : done ? 0.92 : 0.5;
      if (current) {
        ctx.shadowColor = p.accent;
        ctx.shadowBlur = 14;
      }
      ctx.fillText(w.text, x, ly);
      ctx.shadowBlur = 0;
      x += widths[i] + tracking;
    }
  });
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* 炫酷氛围层：持续流动的粒子场 + 缓慢扫过的光线，让画面"始终活着"。
 * 全部确定性（seed + t 驱动），叠加在最上层但保持克制，不与主体抢戏。
 * 这是"PPT 动图"和"真视频"之间最直观的差距之一。 */
function applyAmbientMotion(ctx, p, project, t, W, H) {
  const soft = ['editorial', 'claude', 'pixel'].includes(project.style);
  if (soft) return; // 纸感/像素风不叠加流动粒子，保持温润
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 1) 缓慢扫过的斜向光束：两道极淡的光带，周期性穿过画面
  for (let b = 0; b < 2; b++) {
    const speed = 0.12 + b * 0.07;
    const sweep = ((t * speed + b * 0.5) % 1.4) - 0.7; // -0.7 ~ 0.7
    const x = sweep * W;
    const grad = ctx.createLinearGradient(x - W * 0.18, 0, x + W * 0.18, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, `${p.accent}0c`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }
  // 2) 缓慢上浮的微光粒子：少量、极淡，营造"尘埃在光里漂浮"的呼吸感
  const count = 70;
  for (let i = 0; i < count; i++) {
    const speed = 0.02 + nebulaHash(i + 3) * 0.06;
    const driftX = Math.sin(t * 0.4 + i) * 20;
    const y = H - ((t * speed + nebulaHash(i + 55) * H) % H);
    const x = (nebulaHash(i + 111) * W + driftX + W) % W;
    const twinkle = 0.5 + 0.5 * Math.sin(t * 1.3 + i * 1.7);
    ctx.globalAlpha = (0.06 + nebulaHash(i + 77) * 0.12) * twinkle;
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(x, y, 0.6 + nebulaHash(i + 99) * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* 高潮爆发：在最后一段的中点做一次"中心高光脉冲 + 边缘泛白"，与音效 impact 对齐。
 * 与 sound.mjs 的 climax 计算规则一致（最后一段中点），保证音画同步。 */
function applyClimaxBurst(ctx, p, project, scene, index, local, t, W, H, scenes) {
  if (scenes.length < 2 || index !== scenes.length - 1) return;
  const last = scenes[scenes.length - 1];
  const peak = last.start + (last.end - last.start) * 0.5;
  // 爆发前 0.1s 到爆发后 0.35s 内，从中心扩散一道高光
  const rel = t - peak;
  if (rel < -0.1 || rel > 0.4) return;
  const rise = rel < 0 ? 0 : Math.min(1, rel / 0.35);
  const a = (1 - rise) * 0.4; // 爆发瞬间最亮，随后衰减
  if (a <= 0) return;
  const cx = W * 0.5,
    cy = H * 0.45;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, H * 0.7);
  g.addColorStop(0, `rgba(255,255,255,${(a * 0.9).toFixed(3)})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* 电影感质感层：暗角 + 胶片颗粒 + 柔光晕，全部确定性（不依赖随机数）。
 * 爆款 vibe 视频的"高级感"很大程度来自这层克制叠加：
 * - 暗角把视线收拢到主体，同时压低四角避免廉价平面感；
 * - 颗粒打破大面积纯色的"数字感"，模拟胶片；
 * - 顶部柔光晕给标题区一点呼吸。
 * 纸感风格（editorial/claude）用更轻的颗粒、无强暗角，保持温润。 */
function applyCinematicLayer(ctx, p, project, t, W, H, index) {
  const soft = ['editorial', 'claude', 'pixel'].includes(project.style);
  const g = ctx;
  // 1) 暗角：径向渐变从中心透明到四角暗
  if (!soft) {
    const vig = g.createRadialGradient(W * 0.5, H * 0.48, H * 0.35, W * 0.5, H * 0.48, H * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
  } else {
    const vig = g.createRadialGradient(W * 0.5, H * 0.5, H * 0.4, W * 0.5, H * 0.5, H * 0.9);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
  }
  // 2) 胶片颗粒：用固定种子确定性撒点，每帧位置固定 + 微闪，避免雪花噪
  const grainCount = soft ? 500 : 1100;
  const grainAlpha = soft ? 0.05 : 0.07;
  g.save();
  g.globalCompositeOperation = 'overlay';
  for (let i = 0; i < grainCount; i++) {
    const rx = nebulaHash(i + 7),
      ry = nebulaHash(i + 991);
    const x = rx * W,
      y = ry * H;
    const twinkle = 0.7 + 0.3 * Math.sin(t * 1.7 + i * 0.37);
    g.globalAlpha = grainAlpha * twinkle;
    g.fillStyle = rx > 0.5 ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
    g.fillRect(x, y, 1.2, 1.2);
  }
  g.restore();
  // 3) 顶部柔光晕：给标题区一点氛围，但克制
  if (!soft) {
    const glow = g.createRadialGradient(W * 0.5, -H * 0.05, 0, W * 0.5, -H * 0.05, W * 0.7);
    glow.addColorStop(0, `${p.accent}14`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
  }
}

export function drawFrame(canvas, project, time, options = {}) {
  if (project.style !== 'pixel') {
    drawStandardFrame(canvas, project, time, options);
    return;
  }
  const low = document.createElement('canvas');
  low.width = Math.max(1, Math.round(canvas.width / 2));
  low.height = Math.max(1, Math.round(canvas.height / 2));
  drawStandardFrame(low, project, time, options);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(low, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}
