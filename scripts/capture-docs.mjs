/**
 * 生成 README 用的截图与展示动图。
 *
 * 用法：
 *   1. 先启动工作台：npm run dev（默认 http://127.0.0.1:3000）
 *   2. npm run docs:capture
 *
 * 依赖本机 Chrome / Chromium 和 ffmpeg。可用 CAPTURE_URL 覆盖地址。
 * 脚本只读取页面，不会修改 .data 里的项目。
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDemo, styles } from '../shared/catalog.mjs';

const APP = process.env.CAPTURE_URL || 'http://127.0.0.1:3000';
const RENDER = new URL('/render', APP).toString();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'screenshots');
await mkdir(out, { recursive: true });

const chrome =
  process.env.CHROME_EXECUTABLE ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
});

const clean = (text) => String(text || '').replace(/[。，、；：!?！？…]+$/g, '');

/** 给内置示例加一条假配音时间戳，用于展示逐字字幕与配音面板。 */
function demoWithVoice() {
  const project = makeDemo();
  const scene = project.scenes[0];
  const text = [clean(scene.title), clean(scene.subtitle)].filter(Boolean).join('，');
  scene.voice = {
    voice: 'longanyang',
    words: [...text].map((char, i) => ({
      text: char,
      beginMs: i * 170,
      endMs: (i + 1) * 170,
    })),
    durationMs: text.length * 170,
  };
  return project;
}

async function openStudio(theme) {
  await page.goto(APP);
  await page.evaluate(
    ({ project, theme }) => {
      localStorage.setItem('vibe-current', JSON.stringify(project));
      localStorage.setItem('vibe-theme', theme);
    },
    { project: demoWithVoice(), theme },
  );
  await page.reload();
  await page.waitForTimeout(1200);
}

console.log('→ 工作台截图');
await openStudio('light');
await page.screenshot({ path: path.join(out, 'studio-light.png') });
await page.locator('.step', { hasText: '分镜' }).click();
await page.waitForTimeout(500);
await page.locator('.voice-box').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'voice-editor.png') });

await openStudio('dark');
await page.screenshot({ path: path.join(out, 'studio-dark.png') });

await openStudio('light');
await page.getByRole('button', { name: /导出视频/ }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(out, 'export.png') });

console.log('→ 六套风格总览');
const styleScene = { cosmos: 0, blueprint: 2, editorial: 4, minimal: 1, pixel: 3, claude: 1 };
const base = makeDemo();
await page.goto(RENDER);
await page.waitForFunction(() => window.ready);
const grid = await page.evaluate(
  async ({ base, styles, styleScene }) => {
    const load = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    const tileW = 640,
      tileH = 400,
      gap = 16,
      cols = 3;
    const sheet = document.createElement('canvas');
    sheet.width = cols * tileW + (cols + 1) * gap;
    sheet.height = 2 * tileH + 3 * gap;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#0b0c0e';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (let i = 0; i < styles.length; i++) {
      const style = styles[i];
      const scene = base.scenes[styleScene[style.id] ?? 0];
      const project = {
        ...base,
        style: style.id,
        duration: 3,
        scenes: [{ ...scene, start: 0, end: 3 }],
      };
      window.draw(project, 1.5, tileW, 360);
      const tile = document.createElement('canvas');
      tile.width = tileW;
      tile.height = tileH;
      const tctx = tile.getContext('2d');
      tctx.drawImage(document.querySelector('canvas'), 0, 0, tileW, 360);
      tctx.fillStyle = '#0b0c0e';
      tctx.fillRect(0, 360, tileW, 40);
      tctx.fillStyle = '#e6e6e5';
      tctx.font = '600 18px "PingFang SC", "Microsoft YaHei", sans-serif';
      tctx.fillText(style.name, 22, 386);
      tctx.fillStyle = '#7d8084';
      tctx.font = '10px monospace';
      tctx.fillText(style.en, 190, 386);
      const img = await load(tile.toDataURL('image/png'));
      const x = gap + (i % cols) * (tileW + gap);
      const y = gap + Math.floor(i / cols) * (tileH + gap);
      ctx.drawImage(img, x, y);
    }
    return sheet.toDataURL('image/png');
  },
  { base, styles, styleScene },
);
await writeFile(path.join(out, 'styles.png'), Buffer.from(grid.split(',')[1], 'base64'));

console.log('→ 展示动图');
const framesDir = await mkdtemp(path.join(tmpdir(), 'vibe-showcase-'));
const fps = 10,
  seconds = 1.2,
  width = 640,
  height = 360;
let frame = 0;
for (const style of styles) {
  const scene = base.scenes[styleScene[style.id] ?? 0];
  const project = {
    ...base,
    style: style.id,
    duration: seconds,
    scenes: [{ ...scene, start: 0, end: seconds }],
  };
  for (let i = 0; i < Math.round(fps * seconds); i++) {
    const t = i / fps + 0.3;
    const data = await page.evaluate(
      ({ project, t, width, height }) => window.draw(project, t, width, height),
      { project, t, width, height },
    );
    await writeFile(
      path.join(framesDir, `frame-${String(frame).padStart(4, '0')}.jpg`),
      Buffer.from(data, 'base64'),
    );
    frame += 1;
  }
}

const gifPath = path.join(out, 'showcase.gif');
const ffmpeg = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-framerate',
    String(fps),
    '-i',
    path.join(framesDir, 'frame-%04d.jpg'),
    '-vf',
    'split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
    '-loop',
    '0',
    gifPath,
  ],
  { stdio: 'inherit' },
);
await rm(framesDir, { recursive: true, force: true });
if (ffmpeg.status !== 0) throw new Error('ffmpeg 生成 GIF 失败');
console.log(`✓ 已写入 ${(await readFile(gifPath)).length / 1024 / 1024} MB 动图`);

await browser.close();
console.log('✓ 截图完成：docs/screenshots');
