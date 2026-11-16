/* 分镜感知的音效合成器。
 *
 * 目标：让音轨与画面切镜、标题入场精确对齐（"卡点"）。
 * 输入 scenes 时间轴 + 音乐模式，输出可编码为 WAV 的 PCM 样本。
 *
 * 此模块只负责程序合成节拍。server 混音层另叠加 CC0 素材与上传音乐。
 *
 * 确定性：同一 (scenes, mode) 每次生成完全相同的样本。
 */

const RATE = 44100;

/* 通用包络 */
function env(i, n, attack = 0.001, release = 0.05) {
  const t = i / n;
  if (t < attack) return t / attack;
  if (t > 1 - release) return (1 - t) / release;
  return 1;
}

/* 正弦振荡器 + 频率滑动 */
function osc(i, freq, { glide = 0, phase = 0 } = {}) {
  const t = i / RATE;
  const f = freq + glide * t;
  return Math.sin(2 * Math.PI * (f * t) + phase);
}

/* ---- 单次音效：返回长度为 n 的 Float32Array ---- */
function kick(n) {
  const out = new Float32Array(n);
  const dur = 0.28;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const e = Math.exp(-t * 22);
    const f = 120 * Math.exp(-t * 8) + 45;
    out[i] = Math.sin(2 * Math.PI * f * (i / RATE)) * e;
  }
  return out;
}

function snare(n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const e = Math.exp(-t * 16);
    const random = Math.sin(i * 12.9898) * 43758.5453;
    const noise = random - Math.floor(random); // 确定性伪随机，保持零均值
    out[i] = (noise * 2 - 1) * 0.5 * e + Math.sin(2 * Math.PI * 180 * (i / RATE)) * 0.3 * e;
  }
  return out;
}

function hat(n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const e = Math.exp(-t * 55);
    const random = Math.sin(i * 78.233) * 43758.5453;
    const noise = random - Math.floor(random);
    out[i] = (noise * 2 - 1) * 0.35 * e;
  }
  return out;
}

/* 转场上扬音：切镜前 0.5s 开始上升，到切镜点落在重音上 */
function riser(n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = 200 + t * t * 1600;
    out[i] = Math.sin(2 * Math.PI * f * (i / RATE)) * (t * t) * 0.4;
  }
  return out;
}

/* 切镜重音 hit：低频冲击 + 高频谐波 */
function hit(n) {
  const out = new Float32Array(n);
  const dur = 0.4;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const e = Math.exp(-t * 12);
    out[i] =
      Math.sin(2 * Math.PI * 65 * (i / RATE)) * e +
      Math.sin(2 * Math.PI * 130 * (i / RATE)) * e * 0.5 +
      Math.sin(2 * Math.PI * 520 * (i / RATE)) * Math.exp(-t * 30) * 0.3;
  }
  return out;
}

/* 标题提示音：短促清脆的"叮" */
function chime(n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const e = Math.exp(-t * 8);
    out[i] =
      Math.sin(2 * Math.PI * 880 * (i / RATE)) * e * 0.4 +
      Math.sin(2 * Math.PI * 1320 * (i / RATE)) * e * 0.2;
  }
  return out;
}

/* 高潮爆发冲击：比 hit 更重、更低沉、尾音更长，用于"破茧爆发"瞬间 */
function impact(n) {
  const out = new Float32Array(n);
  const dur = 0.9;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const body = Math.exp(-t * 5);
    const crack = Math.exp(-t * 28);
    out[i] =
      Math.sin(2 * Math.PI * 48 * (i / RATE)) * body +
      Math.sin(2 * Math.PI * 82 * (i / RATE)) * body * 0.6 +
      Math.sin(2 * Math.PI * 110 * (i / RATE)) * crack * 0.4 +
      Math.sin(2 * Math.PI * 440 * (i / RATE)) * crack * 0.2;
  }
  return out;
}

const EFFECTS = { kick, snare, hat, riser, hit, chime, impact };
const EFFECT_DURATIONS = new Map([
  [kick, 0.28],
  [snare, 0.18],
  [hat, 0.06],
  [riser, 0.5],
  [hit, 0.4],
  [chime, 0.4],
  [impact, 0.9],
]);

/* 把单个音效叠加到主缓冲的指定秒数位置；maxSec 限制音效时长（默认放到缓冲区末尾） */
function place(buf, effect, atSec, gain = 1, maxSec) {
  const start = Math.floor(atSec * RATE);
  if (start < 0 || start >= buf.length) return;
  const avail = buf.length - start;
  // Generate at the natural duration, then trim the tail at the end of the movie.
  // Scaling the envelope to the remaining movie length turns a short kick into a long drone.
  const n = Math.ceil((maxSec ?? EFFECT_DURATIONS.get(effect) ?? 0.4) * RATE);
  if (n <= 0) return;
  const e = effect(n);
  for (let i = 0; i < Math.min(n, avail); i++) {
    buf[start + i] += e[i] * gain;
  }
}

/* 主合成：返回 Float32Array 样本（时长 = duration 秒）
 * climax 可选：高潮爆发时间点（秒）。默认取最后一个分镜的中点，
 * 在「蓄能 riser → 静寂 → 爆发 impact」处制造全片情绪最高点。 */
export function synthTrack(
  duration,
  { mode = 'ambient', scenes = [], climax, rhythm = true } = {},
) {
  const n = Math.ceil(duration * RATE);
  const buf = new Float32Array(n);

  // 确定高潮点：显式传入，否则取最后一段的中点（收束/回味段）
  let peak = typeof climax === 'number' ? climax : null;
  if (peak == null && scenes.length > 0) {
    const last = scenes[scenes.length - 1];
    peak = last.start + (last.end - last.start) * 0.5;
  }

  // 1) 底层氛围垫（延续原有和声，但更克制，给音效让出空间）
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const fade = Math.min(1, t / 2, (duration - t) / 2);
    const pad =
      mode === 'none'
        ? 0
        : Math.sin(t * Math.PI * 2 * 130.8128) * 0.032 +
          Math.sin(t * Math.PI * 2 * 196) * 0.018 +
          Math.sin(t * Math.PI * 2 * 261.6256) * 0.012;
    // 高潮前的"静寂"：把底垫压到接近无声，制造爆发前的抽离感。
    // 静寂窗 peak-0.1s ~ peak，与 riser 截止点对齐，形成清晰的"一瞬静音"。
    let silenceGate = 1;
    if (rhythm && peak != null && t >= peak - 0.1 && t < peak) {
      silenceGate = 0.02; // 仅保留 2% 音量，几乎完全静音
    }
    buf[i] = pad * (0.6 + 0.3 * Math.sin(t * 0.6)) * Math.max(0, fade) * silenceGate;
  }

  if (rhythm) {
    // Each scene gets its own 80 BPM-like grid, stretched slightly so its last beat lands on the cut.
    for (const scene of scenes) {
      const span = scene.end - scene.start;
      if (span <= 0) continue;
      const beats = Math.max(1, Math.round(span / 0.75));
      const beatLength = span / beats;
      for (let beat = 0; beat < beats; beat++) {
        const at = scene.start + beat * beatLength;
        if (beat === 0 && scene.start > 0.01) continue;
        if (beat % 4 === 2) place(buf, EFFECTS.snare, at, mode === 'pulse' ? 0.48 : 0.36);
        else if (beat % 2 === 0) place(buf, EFFECTS.kick, at, mode === 'pulse' ? 0.38 : 0.28);
        if (beat % 2 === 1) place(buf, EFFECTS.hat, at, 0.1);
      }
    }

    // Scene cut accents and risers land on the exact frame boundary.
    const cuts = scenes.map((s) => s.start).filter((st) => st > 0.01);
    for (const cut of cuts) {
      place(buf, EFFECTS.riser, Math.max(0, cut - 0.5), 0.8, 0.5);
      place(buf, EFFECTS.hit, cut, 0.75);
      place(buf, EFFECTS.kick, cut, mode === 'pulse' ? 0.8 : 0.65);
      place(buf, EFFECTS.hat, cut + 0.06, 0.35);
    }

    // Title cues follow the cut closely.
    for (const s of scenes) place(buf, EFFECTS.chime, s.start + 0.08, 0.35, 0.35);

    // Climax: riser, a short silence, then impact.
    if (peak != null && peak > 0.3 && peak < duration - 0.3) {
      place(buf, EFFECTS.riser, peak - 0.9, 1.0, 0.8);
      place(buf, EFFECTS.impact, peak, 1.0);
      place(buf, EFFECTS.hit, peak, 0.7);
    }
  }

  // 5) 软限幅：避免叠加后削波（尤其切镜点 hit+kick 同时触发）
  for (let i = 0; i < n; i++) {
    const v = buf[i];
    buf[i] = Math.tanh(v * 1.1);
  }

  return buf;
}

/* 将 Float32 样本编码为 16-bit PCM WAV Buffer */
export function encodeWav(samples, rate = RATE) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
