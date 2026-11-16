/* 内容相关图形库：每一种图形都由 (ctx, visual, art, t, local, p, rand, seed) 确定性驱动。
 *
 * 与 renderer.mjs 解耦，但同样保持「零依赖 + 无帧间状态」，这样离线 HTML 内联时也能跑。
 * 每个图形函数接收统一坐标系：原点在画面主体的中心，单位约 1/1000 视宽。
 *
 * art 字段（可选）来自 AI 分镜的结构化画面指令，形如：
 *   { kind: 'pie', data: [{label:'A', value: 60}, {label:'B', value:40}] }
 * 没有 art 时，图形用主题无关的示意数据，保证仍然可渲染。
 */

/* ---- 基础工具 ---- */
function segColor(p, i, n, alpha = 'ff') {
  const colors = [p.accent, p.ink, p.faint];
  return `${colors[i % colors.length]}${alpha}`;
}

function arc(ctx, x, y, r, a0, a1) {
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
}

/* ---- 各图形绘制 ---- */

/* K 线 / 走势：只有存在输入数据时才绘制带数值的走势。 */
export function drawCandles(ctx, p, t, local, art) {
  const closes = Array.isArray(art?.data)
    ? art.data.filter((n) => typeof n === 'number' && Number.isFinite(n))
    : [];
  const w = 900,
    h = 420;
  const x0 = -w / 2,
    y0 = h / 2;
  // 网格
  ctx.strokeStyle = p.grid;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const gy = y0 - (h * 0.8 * g) / 4;
    ctx.beginPath();
    ctx.moveTo(x0, gy);
    ctx.lineTo(x0 + w, gy);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (closes.length < 2) {
    ctx.strokeStyle = p.faint;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(x0 + 50, y0 - h * 0.2);
    ctx.lineTo(x0 + w - 50, y0 - h * 0.2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }
  const n = closes.length;
  const step = w / n;
  const min = Math.min(...closes),
    max = Math.max(...closes);
  const span = max - min || 1;
  const y = (v) => y0 - ((v - min) / span) * (h * 0.8);
  // 走势线（渐进绘制，制造入场动效）
  const reveal = Math.min(1, local / 1.2);
  const upto = Math.max(1, Math.floor(n * reveal));
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < upto; i++) {
    const x = x0 + i * step + step / 2;
    const yy = y(closes[i]);
    if (i === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
  ctx.stroke();
  // 柱
  for (let i = 0; i < upto; i++) {
    const x = x0 + i * step + step / 2;
    const open = closes[Math.max(0, i - 1)];
    const close = closes[i];
    const up = close >= open;
    ctx.fillStyle = up ? '#e14b4b' : '#2f9e63';
    const bodyH = Math.max(2, Math.abs(y(open) - y(close)));
    const bodyTop = Math.min(y(open), y(close));
    ctx.fillRect(x - step * 0.18, bodyTop, step * 0.36, bodyH);
  }
  // 最新值标注
  const lastV = closes[upto - 1];
  ctx.fillStyle = p.ink;
  ctx.font = '18px "SFMono-Regular", monospace';
  ctx.fillText(String(lastV), x0 + w + 14, y(lastV) + 6);
}

/* 饼图 / 比例：art.data 为 [{label, value}]，画真实占比，扇形逐块扫入。 */
export function drawPie(ctx, p, t, local, art) {
  const data = Array.isArray(art?.data)
    ? art.data.filter(
        (d) => d && typeof d.label === 'string' && Number.isFinite(d.value) && d.value > 0,
      )
    : [];
  if (data.length < 2) {
    ctx.strokeStyle = p.faint;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.arc(0, 0, 180, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1;
  const r = 220;
  const reveal = Math.min(1, local / 1.0);
  let angle = -Math.PI / 2;
  data.forEach((d, i) => {
    const frac = (Number(d.value) || 0) / total;
    const sweep = frac * Math.PI * 2 * reveal;
    ctx.fillStyle = segColor(p, i, data.length);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, angle, angle + sweep);
    ctx.closePath();
    ctx.fill();
    angle += frac * Math.PI * 2;
  });
  // 中心留白
  ctx.fillStyle = p.bg;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.52, 0, Math.PI * 2);
  ctx.fill();
  // 图例
  ctx.font = '16px "PingFang SC", sans-serif';
  let lx = -r - 40,
    ly = -r - 20;
  data.forEach((d, i) => {
    ctx.fillStyle = segColor(p, i, data.length);
    ctx.fillRect(lx, ly + i * 30, 14, 14);
    ctx.fillStyle = p.ink;
    ctx.fillText(
      `${d.label} ${Math.round((Number(d.value) / total) * 100)}%`,
      lx + 22,
      ly + i * 30 + 13,
    );
  });
}

/* 横向对比柱状图：art.data 为 [{label, value}]。 */
export function drawCompare(ctx, p, t, local, art) {
  const data = Array.isArray(art?.data)
    ? art.data.filter(
        (d) => d && typeof d.label === 'string' && Number.isFinite(d.value) && d.value >= 0,
      )
    : [];
  if (data.length < 2) {
    ctx.strokeStyle = p.faint;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-260, 240);
    ctx.lineTo(260, 240);
    ctx.moveTo(-260, 240);
    ctx.lineTo(-260, -180);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  const max = Math.max(...data.map((d) => Number(d.value) || 0)) || 1;
  const bw = 110,
    gap = 60,
    baseY = 240;
  const reveal = Math.min(1, local / 0.9);
  data.forEach((d, i) => {
    const h = ((Number(d.value) || 0) / max) * 420 * reveal;
    const x = (-(data.length - 1) * (bw + gap)) / 2 + i * (bw + gap);
    ctx.fillStyle = i === data.length - 1 ? p.accent : p.faint;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, baseY - h, bw, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.ink;
    ctx.font = '18px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(d.value), x + bw / 2, baseY - h - 12);
    ctx.font = '16px "PingFang SC", sans-serif';
    ctx.fillText(String(d.label), x + bw / 2, baseY + 28);
    ctx.textAlign = 'left';
  });
  ctx.strokeStyle = p.faint;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(-(data.length * (bw + gap)) / 2 + 20, baseY);
  ctx.lineTo((data.length * (bw + gap)) / 2 - 20, baseY);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/* 公式 / 方程：art.text 为 LaTeX 风格的 ASCII 表达式，逐字符浮现。 */
export function drawEquation(ctx, p, t, local, art) {
  const expr = art?.text || 'E = mc²';
  const reveal = Math.min(1, local / 1.2);
  const shown = Math.max(0, Math.floor(expr.length * reveal));
  const str = expr.slice(0, shown);
  ctx.fillStyle = p.ink;
  ctx.font = '500 58px "SFMono-Regular", "PingFang SC", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, 0, 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  // 下方强调线
  if (reveal >= 1) {
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-str.length * 18, 60);
    ctx.lineTo(str.length * 18, 60);
    ctx.stroke();
  }
}

/* DNA 双螺旋：两条缠绕的链 + 横档，缓慢旋转。 */
export function drawDna(ctx, p, t, local, art) {
  const r = 120,
    len = 420,
    coils = 3;
  ctx.save();
  ctx.rotate(t * 0.25);
  for (const strand of [0, 1]) {
    ctx.strokeStyle = strand ? p.accent : p.ink;
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i <= coils * 40; i++) {
      const s = i / (coils * 40);
      const y = -len / 2 + s * len;
      const ang = s * coils * Math.PI * 2 + strand * Math.PI;
      const x = Math.cos(ang) * r;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](x, y);
    }
    ctx.stroke();
  }
  // 横档
  for (let i = 0; i <= coils * 12; i++) {
    const s = i / (coils * 12);
    const y = -len / 2 + s * len;
    const ang = s * coils * Math.PI * 2;
    const x1 = Math.cos(ang) * r,
      x2 = Math.cos(ang + Math.PI) * r;
    ctx.strokeStyle = p.faint;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* 原子轨道：核 + 若干椭圆电子轨道 + 运动的电子。 */
export function drawAtom(ctx, p, t, local, art) {
  const orbits = 3;
  // 轨道
  for (let i = 0; i < orbits; i++) {
    const rx = 140 + i * 55,
      ry = (140 + i * 55) * 0.55;
    ctx.strokeStyle = p.faint;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1.5;
    ctx.save();
    ctx.rotate(i * 0.8);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // 电子
    const a = t * (0.9 - i * 0.18) + i * 2.1;
    const ex = Math.cos(a) * rx,
      ey = Math.sin(a) * ry;
    ctx.save();
    ctx.rotate(i * 0.8);
    ctx.fillStyle = p.accent;
    ctx.shadowColor = p.accent;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(ex, ey, 7 + i, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  // 核
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 40);
  g.addColorStop(0, p.ink);
  g.addColorStop(1, `${p.accent}66`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 36, 0, Math.PI * 2);
  ctx.fill();
}

/* 齿轮组：两个啮合的齿轮反向旋转。 */
export function drawGears(ctx, p, t, local, art) {
  const teeth = (r, n, rot) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + rot;
      const a1 = a0 + (Math.PI * 2) / n;
      ctx.arc(0, 0, r, a0, a0 + (Math.PI * 2) / n / 2);
      ctx.arc(0, 0, r * 1.12, a0 + (Math.PI * 2) / n / 2, a1);
    }
    ctx.closePath();
  };
  const g1 = { x: -110, y: 0, r: 110, n: 12, rot: t * 0.6 };
  const g2 = { x: 120, y: 10, r: 72, n: 8, rot: -t * 0.9 + 0.2 };
  for (const g of [g1, g2]) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.fillStyle = p.faint;
    teeth(g.r, g.n, g.rot);
    ctx.fill();
    ctx.fillStyle = p.bg;
    ctx.beginPath();
    ctx.arc(0, 0, g.r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(0, 0, g.r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* 时钟 / 时间：表盘 + 走动的指针。 */
export function drawClock(ctx, p, t, local, art) {
  const r = 230;
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  // 刻度
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.strokeStyle = p.faint;
    ctx.lineWidth = i % 3 === 0 ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
    ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
    ctx.stroke();
  }
  // 指针：秒针走一圈代表一幕时长
  const secA = -Math.PI / 2 + (local / 12) * Math.PI * 2;
  ctx.strokeStyle = p.accent;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(secA) * r * 0.66, Math.sin(secA) * r * 0.66);
  ctx.stroke();
  const minA = -Math.PI / 2 + t * 0.05;
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(minA) * r * 0.5, Math.sin(minA) * r * 0.5);
  ctx.stroke();
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
}

/* 声波：从中心扩散的同心波纹，随 local 脉冲。 */
export function drawWaveform(ctx, p, t, local, art) {
  const n = 5;
  for (let i = 0; i < n; i++) {
    const phase = (local * 1.2 + i / n) % 1;
    const r = phase * 300;
    ctx.strokeStyle = p.accent;
    ctx.globalAlpha = (1 - phase) * 0.6;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 中心源
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();
}

/* 光 / 射线：从一点射出的光线，缓慢扫动。 */
export function drawRays(ctx, p, t, local, art) {
  const n = 12;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 180);
  g.addColorStop(0, p.accent);
  g.addColorStop(1, '#00000000');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 180, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + t * 0.1;
    const len = 260 + Math.sin(t * 0.7 + i) * 30;
    ctx.strokeStyle = p.accent;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 20, Math.sin(a) * 20);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* 金字塔 / 层级：art.data 为各层宽度，自下而上堆叠。 */
export function drawPyramid(ctx, p, t, local, art) {
  const levels = Array.isArray(art?.data)
    ? art.data.map((d) => Number(d) || 40)
    : [80, 130, 180, 230, 280];
  const h = 60;
  const baseY = 220;
  const reveal = Math.min(1, local / 1.0);
  levels.forEach((w, i) => {
    const y = baseY - i * h;
    const ww = w * reveal;
    ctx.fillStyle = segColor(p, i, levels.length);
    ctx.globalAlpha = 0.9;
    ctx.fillRect(-ww / 2, y, ww, h - 8);
  });
  ctx.globalAlpha = 1;
}

/* 神经网：节点 + 连边，脉冲沿边传播。 */
export function drawNetwork(ctx, p, t, local, art) {
  const labels = Array.isArray(art?.data)
    ? art.data.filter((value) => typeof value === 'string' && value.trim()).slice(0, 9)
    : [];
  const nodes = labels.length
    ? labels.map((label, i) => ({
        x: -180 + (i % 3) * 180,
        y: -110 + Math.floor(i / 3) * 110,
        label,
      }))
    : [
        [-220, -80],
        [-220, 0],
        [-220, 80],
        [-80, -140],
        [-80, -40],
        [-80, 40],
        [-80, 140],
        [80, -140],
        [80, -40],
        [80, 40],
        [80, 140],
        [220, -80],
        [220, 0],
        [220, 80],
      ].map(([x, y]) => ({ x, y }));
  // 边
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x,
        dy = nodes[i].y - nodes[j].y;
      if (Math.hypot(dx, dy) < 190) {
        ctx.strokeStyle = p.faint;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  // 节点 + 脉冲
  nodes.forEach(({ x, y, label }, i) => {
    const pulse = Math.sin(t * 2.4 + i * 0.9) * 0.5 + 0.5;
    ctx.fillStyle = p.accent;
    ctx.globalAlpha = 0.3 + pulse * 0.7;
    ctx.beginPath();
    ctx.arc(x, y, 6 + pulse * 6, 0, Math.PI * 2);
    ctx.fill();
    if (label) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = p.ink;
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y + 25, 150);
      ctx.textAlign = 'left';
    }
  });
  ctx.globalAlpha = 1;
}

/* 流水线：art.data 为阶段名，物料沿传送带从左向右移动。 */
export function drawPipeline(ctx, p, t, local, art) {
  const stages = Array.isArray(art?.data) && art.data.length ? art.data : ['输入', '处理', '输出'];
  const w = 900,
    h = 90;
  const x0 = -w / 2,
    y0 = -h / 2;
  // 传送带
  ctx.fillStyle = p.faint;
  ctx.globalAlpha = 0.25;
  ctx.fillRect(x0, y0, w, h);
  ctx.globalAlpha = 1;
  // 物料
  const seg = w / stages.length;
  const pos = ((t * 0.4) % 1) * w;
  ctx.fillStyle = p.accent;
  ctx.shadowColor = p.accent;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(x0 + pos - 12, y0 + h / 2, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // 阶段框
  ctx.font = '18px "PingFang SC", sans-serif';
  stages.forEach((s, i) => {
    const sx = x0 + i * seg;
    ctx.strokeStyle = p.ink;
    ctx.globalAlpha = 0.5;
    ctx.strokeRect(sx + 8, y0 - 16, seg - 16, h + 32);
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.ink;
    ctx.textAlign = 'center';
    ctx.fillText(String(s), sx + seg / 2, y0 + h + 52);
    ctx.textAlign = 'left';
  });
}

/* 路径 / 地图：从起点到终点的折线路径，带移动的标记点。 */
export function drawPath(ctx, p, t, local, art) {
  const labels = Array.isArray(art?.data)
    ? art.data.filter((value) => typeof value === 'string' && value.trim()).slice(0, 6)
    : [];
  const bends = [140, 60, 150, 20, 120, 40];
  const pts =
    labels.length >= 2
      ? labels.map((label, i) => ({
          x: -300 + (i * 600) / (labels.length - 1),
          y: bends[i],
          label,
        }))
      : [
          [-300, 140],
          [-120, 60],
          [40, 150],
          [180, 20],
          [300, 120],
        ].map(([x, y]) => ({ x, y }));
  ctx.strokeStyle = p.faint;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3;
  ctx.beginPath();
  pts.forEach(({ x, y }, i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.globalAlpha = 1;
  // 起点/终点
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.arc(pts[0].x, pts[0].y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.arc(pts[pts.length - 1].x, pts[pts.length - 1].y, 12, 0, Math.PI * 2);
  ctx.fill();
  if (labels.length >= 2) {
    ctx.font = '14px "PingFang SC", sans-serif';
    ctx.fillStyle = p.ink;
    ctx.textAlign = 'center';
    pts.forEach(({ x, y, label }) => ctx.fillText(label, x, y + 35, 130));
    ctx.textAlign = 'left';
  }
  // 移动标记
  const progress = (local / 8) % 1;
  const segIdx = Math.floor(progress * (pts.length - 1));
  const frac = (progress * (pts.length - 1)) % 1;
  const a = pts[Math.min(segIdx, pts.length - 1)],
    b = pts[Math.min(segIdx + 1, pts.length - 1)];
  const mx = a.x + (b.x - a.x) * frac,
    my = a.y + (b.y - a.y) * frac;
  ctx.fillStyle = p.accent;
  ctx.shadowColor = p.accent;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(mx, my, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

/* 天平：两端砝码随 art 数据倾斜。 */
export function drawBalance(ctx, p, t, local, art) {
  const hasWeights = Number.isFinite(art?.left) && Number.isFinite(art?.right);
  const left = hasWeights ? art.left : 0;
  const right = hasWeights ? art.right : 0;
  const tilt = hasWeights ? Math.min(1, local / 1.0) * Math.atan2(right - left, 20) : 0;
  ctx.save();
  ctx.rotate(tilt);
  // 横梁
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-220, 0);
  ctx.lineTo(220, 0);
  ctx.stroke();
  // 立柱
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -180);
  ctx.stroke();
  // 底盘
  ctx.beginPath();
  ctx.moveTo(-80, -180);
  ctx.lineTo(80, -180);
  ctx.stroke();
  // 托盘
  for (const [sx, v] of [
    [-220, left],
    [220, right],
  ]) {
    ctx.fillStyle = p.faint;
    ctx.beginPath();
    ctx.arc(sx, 0, 40, Math.PI, 0);
    ctx.fill();
    if (hasWeights && v > 0) {
      ctx.fillStyle = p.accent;
      const boxH = Math.min(60, v * 12);
      ctx.fillRect(sx - 24, -boxH - 4, 48, boxH);
    }
  }
  ctx.restore();
  if (hasWeights) {
    ctx.fillStyle = p.ink;
    ctx.font = '20px "SFMono-Regular", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(left), -220, 90);
    ctx.fillText(String(right), 220, 90);
    ctx.textAlign = 'left';
  }
}

/* 地图路径的简化：经纬网格 + 定位点（用于地理话题）。 */
export function drawMap(ctx, p, t, local, art) {
  const w = 700,
    h = 460;
  // 经纬网
  ctx.strokeStyle = p.faint;
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 1;
  for (let i = -5; i <= 5; i++) {
    ctx.beginPath();
    ctx.moveTo((i * w) / 10, -h / 2);
    ctx.lineTo((i * w) / 10, h / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-w / 2, (i * h) / 10);
    ctx.lineTo(w / 2, (i * h) / 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // 定位点（脉冲）
  const pulse = Math.sin(t * 2.4) * 0.5 + 0.5;
  ctx.strokeStyle = p.accent;
  ctx.globalAlpha = 0.5 - pulse * 0.3;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, 40 + pulse * 60, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.accent;
  ctx.shadowColor = p.accent;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

/* ---- 注册表：visual 枚举 → 绘制函数 ---- */
export const figures = {
  candles: drawCandles,
  pie: drawPie,
  compare: drawCompare,
  equation: drawEquation,
  dna: drawDna,
  atom: drawAtom,
  gears: drawGears,
  clock: drawClock,
  waveform: drawWaveform,
  rays: drawRays,
  pyramid: drawPyramid,
  network: drawNetwork,
  pipeline: drawPipeline,
  path: drawPath,
  balance: drawBalance,
  map: drawMap,
};

export function hasFigure(kind) {
  return Object.prototype.hasOwnProperty.call(figures, kind);
}
