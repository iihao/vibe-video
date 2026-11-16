import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeDemo, defaultConfig } from '../shared/catalog.mjs';

const url = process.env.TEST_URL || 'http://127.0.0.1:3000';
const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const checks = [];
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push(name);
  console.log(`✓ ${name}`);
};
try {
  await page.goto(url);
  await page.getByRole('heading', { name: '视频创作' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, 'desktop.png'),
    fullPage: true,
  });
  check(
    'desktop has no horizontal overflow',
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  const frame = () => page.locator('.main-canvas').evaluate((c) => c.toDataURL());
  const first = await frame();
  await page.getByRole('button', { name: '切换到深色模式' }).click();
  check(
    'theme switch retains the project and video artwork',
    (await frame()) === first &&
      (await page.evaluate(() => document.documentElement.dataset.theme === 'dark')),
  );
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, 'studio-dark.png'),
    fullPage: true,
  });
  await page.reload();
  check(
    'selected theme survives reload',
    await page.getByRole('button', { name: '切换到亮色模式' }).isVisible(),
  );
  await page.getByRole('button', { name: '切换到亮色模式' }).click();
  check(
    'light theme paints bright page and panel surfaces',
    await page.evaluate(
      () =>
        getComputedStyle(document.body).backgroundColor === 'rgb(247, 247, 245)' &&
        getComputedStyle(document.querySelector('.creation-panel')).backgroundColor ===
          'rgb(255, 255, 255)',
    ),
  );
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, 'studio-light.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '播放视频', exact: true }).click();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  check('playback advances deterministic animation', (await frame()) !== first);
  await page.getByLabel('画面比例').selectOption('9:16');
  check(
    'portrait preview updates canvas dimensions',
    await page.locator('.main-canvas').evaluate((c) => c.height > c.width),
  );
  await page.getByLabel('画面比例').selectOption('16:9');
  await page.getByLabel('主题').fill('这是没有密钥时不能生成的任意主题');
  await page.getByRole('button', { name: '生成脚本与分镜', exact: true }).click();
  await page.getByRole('alert').waitFor();
  check(
    'unconfigured AI is disclosed without fake content',
    (await page.getByRole('alert').innerText()).includes('需要配置模型'),
  );
  await page.getByRole('button', { name: '使用内置示例' }).click();
  await page.getByRole('button', { name: '生成脚本与分镜', exact: true }).click();
  await page.getByLabel('画面主标题').waitFor();
  await page.getByLabel('画面主标题').fill('测试：时间的另一面。');
  check(
    'storyboard editing changes live project',
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('vibe-current')).scenes[0].title === '测试：时间的另一面。',
    ),
  );
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page
    .locator('.sidebar')
    .getByRole('button', { name: /我的项目/ })
    .click();
  check('saved projects are discoverable', (await page.locator('.project-card').count()) > 0);
  await page.reload();
  check(
    'current project survives reload',
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('vibe-current')).scenes[0].title === '测试：时间的另一面。',
    ),
  );
  await page.locator('.sidebar').getByRole('button', { name: '风格模板', exact: true }).click();
  check(
    'six usable style templates',
    (await page.getByRole('button', { name: '使用这个风格' }).count()) === 6,
  );
  await page.getByRole('button', { name: '使用这个风格' }).nth(1).click();
  check(
    'template selection applies to project',
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('vibe-current')).style === 'blueprint',
    ),
  );
  await page.locator('.sidebar').getByRole('button', { name: '风格模板', exact: true }).click();
  const pixelCanvas = page
    .locator('.template-card')
    .filter({ hasText: '像素方格' })
    .locator('canvas');
  const pixelFrame = await pixelCanvas.evaluate((c) => c.toDataURL());
  await page
    .locator('.template-card')
    .filter({ hasText: '像素方格' })
    .getByRole('button', { name: '使用这个风格' })
    .click();
  check(
    'pixel art style applies and renders its own low-resolution frame',
    (await page.evaluate(
      () => JSON.parse(localStorage.getItem('vibe-current')).style === 'pixel',
    )) && pixelFrame !== (await page.locator('.main-canvas').evaluate((c) => c.toDataURL())),
  );
  await page.locator('.sidebar').getByRole('button', { name: '风格模板', exact: true }).click();
  const claudeCover = page.locator('.template-card.theme-claude canvas');
  const claudeFrame = await claudeCover.evaluate((c) => c.toDataURL());
  await page
    .locator('.template-card')
    .filter({ hasText: 'Claude 灵感' })
    .getByRole('button', { name: '使用这个风格' })
    .click();
  check(
    'Claude-inspired palette, typography and illustration apply to the live frame',
    (await page.evaluate(
      () => JSON.parse(localStorage.getItem('vibe-current')).style === 'claude',
    )) && claudeFrame !== (await page.locator('.main-canvas').evaluate((c) => c.toDataURL())),
  );
  await page.locator('.sidebar').getByRole('button', { name: '灵感广场', exact: true }).click();
  check(
    'researched creator sources have real links',
    (await page.locator('.reference-card a').count()) === 4,
  );
  await page.getByRole('button', { name: '心理', exact: true }).click();
  check('reference category filters work', (await page.locator('.reference-card').count()) === 1);
  await page.locator('.sidebar').getByRole('button', { name: '新建视频', exact: true }).click();
  await page.getByRole('button', { name: '导出视频', exact: true }).click();
  await page
    .getByRole('dialog')
    .screenshot({ animations: 'disabled', path: path.join(output, 'export-light.png') });
  const htmlDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '动画 HTML' }).click();
  const html = await htmlDownload;
  await html.saveAs(path.join(output, 'animation.html'));
  const offline = await browser.newPage();
  await offline.goto(`file://${path.join(output, 'animation.html')}`);
  await offline.waitForFunction(() => typeof window.draw === 'function');
  const frames = await offline.evaluate(() => {
    const c = document.querySelector('canvas');
    window.draw(0);
    const first = c.toDataURL();
    window.draw(15);
    const second = c.toDataURL();
    window.draw(15);
    return { first, second, repeated: c.toDataURL() };
  });
  check(
    'exported HTML runs offline and seeks deterministically',
    frames.first !== frames.second && frames.second === frames.repeated,
  );
  const renderSemanticExport = async (style, data) => {
    const project = makeDemo({ ...defaultConfig, style });
    project.scenes[0] = {
      ...project.scenes[0],
      visual: 'pipeline',
      art: { kind: 'pipeline', data },
    };
    const response = await fetch(`${url}/api/export/html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    assert.equal(response.status, 200);
    const html = (await response.text()).replaceAll('requestAnimationFrame(tick)', 'void 0');
    const semanticPage = await browser.newPage();
    await semanticPage.setContent(html);
    await semanticPage.waitForFunction(() => typeof window.draw === 'function');
    const image = await semanticPage.locator('canvas').evaluate((canvas) => {
      window.draw(2);
      return canvas.toDataURL();
    });
    await semanticPage.close();
    return image;
  };
  for (const style of ['pixel', 'claude']) {
    const first = await renderSemanticExport(style, ['Input', 'Process', 'Output']);
    const second = await renderSemanticExport(style, ['Photon', 'Scattering', 'Blue']);
    check(`${style} style renders scene-specific diagram labels`, first !== second);
  }
  await offline.close();
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '九宫格关键帧' }).click();
  const png = await pngDownload;
  await png.saveAs(path.join(output, 'keyframes.png'));
  const { readFile } = await import('node:fs/promises');
  const pngBuffer = await readFile(path.join(output, 'keyframes.png'));
  check(
    'nine-keyframe contact sheet exports at expected size',
    pngBuffer.readUInt32BE(16) === 1984 && pngBuffer.readUInt32BE(20) === 1246,
  );
  await page.getByLabel('6 秒样片').check();
  await page.getByLabel('帧率', { exact: true }).selectOption('24');
  await page.getByRole('button', { name: '开始渲染 MP4' }).click();
  await page.getByRole('link', { name: '下载 MP4 视频' }).waitFor({ timeout: 180000 });
  const videoPath = await page.getByRole('link', { name: '下载 MP4 视频' }).getAttribute('href');
  const video = await fetch(`${url}${videoPath}`);
  await writeFile(path.join(output, 'sample.mp4'), Buffer.from(await video.arrayBuffer()));
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      path.join(output, 'sample.mp4'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0);
  const meta = JSON.parse(probe.stdout);
  check(
    'real MP4 has 6s H.264 video and AAC audio',
    meta.streams.some((s) => s.codec_name === 'h264') &&
      meta.streams.some((s) => s.codec_name === 'aac') &&
      Math.abs(Number(meta.format.duration) - 6) < 0.2,
  );
  await page.getByRole('button', { name: '关闭对话框' }).click();
  const renderStyleSample = async (styleId, styleName, aspect, filename) => {
    await page.locator('.sidebar').getByRole('button', { name: '新建视频', exact: true }).click();
    await page.locator('.sidebar').getByRole('button', { name: '风格模板', exact: true }).click();
    await page
      .locator(`.template-card.theme-${styleId}`)
      .getByRole('button', { name: '使用这个风格' })
      .click();
    await page.getByLabel('画面比例').selectOption(aspect);
    const canvasSize = await page
      .locator('.main-canvas')
      .evaluate((c) => ({ width: c.width, height: c.height }));
    await page.getByRole('button', { name: '导出视频', exact: true }).click();
    await page.getByLabel('6 秒样片').check();
    await page.getByLabel('帧率', { exact: true }).selectOption('24');
    await page.getByRole('button', { name: '开始渲染 MP4' }).click();
    const link = page.getByRole('link', { name: '下载 MP4 视频' });
    await link.waitFor({ timeout: 180000 });
    const response = await fetch(`${url}${await link.getAttribute('href')}`);
    const target = path.join(output, filename);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    const result = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', target],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0);
    const rendered = JSON.parse(result.stdout);
    check(
      `${styleName} ${aspect} MP4 renders in the requested aspect ratio`,
      canvasSize.height / canvasSize.width === (aspect === '9:16' ? 16 / 9 : 1) &&
        rendered.streams.some((s) => s.codec_name === 'h264') &&
        Math.abs(Number(rendered.format.duration) - 6) < 0.2,
    );
    await page.getByRole('button', { name: '关闭对话框' }).click();
  };
  await renderStyleSample('pixel', 'Pixel art', '9:16', 'pixel-sample.mp4');
  await renderStyleSample('claude', 'Claude-inspired', '1:1', 'claude-sample.mp4');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.main-canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(100);
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, 'mobile.png'),
    fullPage: true,
  });
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, 'studio-light-mobile.png'),
    fullPage: true,
  });
  check(
    'mobile has no horizontal overflow',
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.getByRole('button', { name: '搜索灵感' }).count();
  await page.keyboard.press('Meta+k');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  check('keyboard palette opens and dismisses', (await page.getByRole('dialog').count()) === 0);
  check('no browser javascript exceptions', errors.length === 0);
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify({ checks, errors, video: meta.format }, null, 2),
  );
  console.log(
    `\n${checks.length} browser checks passed. Screenshots and playable sample: ${output}`,
  );
} finally {
  await browser.close();
}
