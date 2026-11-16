import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { startModelFixture, startStudio } from './fixtures.mjs';

const output = path.resolve('test-results');
await mkdir(output, { recursive: true });
const fixture = await startModelFixture();
const studio = await startStudio();
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  colorScheme: 'light',
});
const errors = [],
  checks = [];
page.on('pageerror', (e) => errors.push(e.message));
function check(name, condition) {
  assert.ok(condition, name);
  checks.push(name);
  console.log(`✓ ${name}`);
}
try {
  await page.goto(studio.base + '/?settings=1');
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: /自定义接口/ }).click();
  await page.getByLabel('服务地址').fill(fixture.url);
  await page.getByLabel('API Key', { exact: false }).fill('browser-fixture-secret');
  await page.getByRole('button', { name: '获取模型列表' }).click();
  await page.getByLabel('从模型列表选择').selectOption('fixture-model');
  check(
    'settings fetches actual HTTP model list',
    fixture.state.requests.some((r) => r.path.endsWith('/models')),
  );
  fixture.state.mode = 'http-401';
  await page.getByRole('button', { name: '仅测试连接' }).click();
  await dialog.getByRole('alert').waitFor();
  check(
    'authentication errors are visible with no false activation',
    (await dialog.getByRole('alert').innerText()).includes('401') &&
      !(await (await fetch(studio.base + '/api/health')).json()).configured,
  );
  fixture.state.mode = 'success';
  await page.getByRole('button', { name: '仅测试连接' }).click();
  await page.getByText('模型真实调用成功', { exact: true }).waitFor();
  check(
    'test request succeeds without activating draft',
    !(await (await fetch(studio.base + '/api/health')).json()).configured,
  );
  await page.getByRole('button', { name: '测试并启用', exact: true }).click();
  await page
    .getByText('已保存并启用。关闭设置，即可输入任意主题开始创作。', { exact: true })
    .waitFor();
  check(
    'test-and-activate takes effect immediately',
    (await (await fetch(studio.base + '/api/health')).json()).verified,
  );
  await page.reload();
  await page.getByText('当前使用 自定义接口', { exact: true }).waitFor();
  check(
    'saved profile reloads with empty password field and no browser credential cache',
    (await page.getByLabel('API Key', { exact: false }).inputValue()) === '' &&
      !(await page.evaluate(() => JSON.stringify(localStorage))).includes('browser-fixture-secret'),
  );
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, 'ai-settings-desktop.png'),
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, 'ai-settings-mobile.png'),
    animations: 'disabled',
  });
  check(
    'mobile provider controls and modal fit without horizontal overflow',
    await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
  );
  await page.getByRole('button', { name: /高级设置/ }).click();
  await page.getByLabel('最大输出 Tokens').scrollIntoViewIfNeeded();
  check(
    'advanced settings fit on mobile',
    await dialog.evaluate((d) => d.scrollWidth <= d.clientWidth + 1),
  );
  await page.getByRole('button', { name: '关闭对话框' }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel('主题').fill('为什么天空是蓝色？');
  fixture.state.mode = 'paced';
  await page.getByRole('button', { name: '生成脚本与分镜', exact: true }).click();
  const processPanel = page.getByRole('region', { name: '生成过程可视化' });
  await processPanel.locator('.live-scene-card').first().waitFor();
  check(
    'live process shows provisional model scenes before generation finishes',
    (await processPanel.getAttribute('aria-busy')) === 'true' &&
      (await processPanel.locator('.live-scene-card:disabled').count()) > 0 &&
      (await page.evaluate(() => JSON.parse(localStorage.getItem('vibe-current')).mode)) !== 'ai',
  );
  await processPanel.screenshot({
    animations: 'disabled',
    path: path.join(output, 'generation-live-desktop.png'),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await processPanel.screenshot({
    animations: 'disabled',
    path: path.join(output, 'generation-live-mobile.png'),
  });
  check(
    'live process and scene cards fit mobile without horizontal overflow',
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel('画面主标题').waitFor();
  fixture.state.mode = 'success';
  check(
    'custom topic uses actual streamed model output',
    (await page.getByLabel('画面主标题').inputValue()) === '阳光里，藏着所有颜色。',
  );
  const project = await page.evaluate(() => JSON.parse(localStorage.getItem('vibe-current')));
  check(
    'completed process exposes validated scenes and real execution log',
    (await processPanel.locator('.live-scene-card:enabled').count()) === project.scenes.length &&
      (await processPanel.locator('.generation-event-log').innerText()).includes('分镜已编排'),
  );
  check(
    'generated project records model provenance without a key',
    project.mode === 'ai' &&
      project.generation.model === 'fixture-model' &&
      !JSON.stringify(project).includes('browser-fixture-secret'),
  );
  const firstPixels = await page.locator('.main-canvas').evaluate((c) => c.toDataURL());
  await page.getByLabel('分镜修改要求').fill('用生活中的例子开场');
  await page.getByRole('button', { name: 'AI 重写这一幕', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#scene-title')?.value === 'AI 改写：从一束阳光说起',
  );
  check(
    'single-scene rewrite changes actual model text and canvas while retaining timing',
    firstPixels !== (await page.locator('.main-canvas').evaluate((c) => c.toDataURL())) &&
      (await page.evaluate(
        () => JSON.parse(localStorage.getItem('vibe-current')).scenes[0].end,
      )) === project.scenes[0].end,
  );
  await page.screenshot({
    animations: 'disabled',
    path: path.join(output, 'ai-storyboard-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '导出视频', exact: true }).click();
  await page.getByLabel('6 秒样片').check();
  await page.getByLabel('帧率', { exact: true }).selectOption('24');
  await page.getByRole('button', { name: '开始渲染 MP4' }).click();
  const renderPanel = page.getByRole('dialog').getByLabel('视频渲染过程');
  const renderedImage = renderPanel.getByRole('img', { name: /实际渲染画面/ });
  await renderedImage.waitFor({ timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector('.modal .render-live-frame img')?.naturalWidth > 0,
  );
  await renderPanel.screenshot({
    animations: 'disabled',
    path: path.join(output, 'render-live-desktop.png'),
  });
  const previewResponse = await fetch(studio.base + (await renderedImage.getAttribute('src')));
  const preview = Buffer.from(await previewResponse.arrayBuffer());
  check(
    'render progress displays an actual JPEG frame served by the running job',
    previewResponse.ok &&
      preview[0] === 0xff &&
      preview[1] === 0xd8 &&
      (await renderPanel.innerText()).includes('帧'),
  );
  await page.getByRole('button', { name: '关闭对话框' }).click();
  check(
    'render remains visible on the workspace when the export dialog closes',
    await processPanel.getByLabel('视频渲染过程').isVisible(),
  );
  await processPanel.screenshot({
    animations: 'disabled',
    path: path.join(output, 'generation-render-desktop.png'),
  });
  await page.getByRole('button', { name: '导出视频', exact: true }).click();
  const link = page.getByRole('link', { name: '下载 MP4 视频' });
  await link.waitFor({ timeout: 180000 });
  check(
    'finished job shows an in-page playable video with a full frame count',
    (await page.getByRole('dialog').getByLabel('已导出视频预览').isVisible()) &&
      (await page.getByRole('dialog').locator('.render-metrics').innerText()).includes('144 / 144'),
  );
  const video = await fetch(studio.base + (await link.getAttribute('href')));
  const filename = path.join(output, 'ai-generated-sample.mp4');
  await writeFile(filename, Buffer.from(await video.arrayBuffer()));
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0);
  const meta = JSON.parse(probe.stdout);
  check(
    'AI-generated and rewritten project renders a playable 6s H.264/AAC MP4',
    meta.streams.some((s) => s.codec_name === 'h264') &&
      meta.streams.some((s) => s.codec_name === 'aac') &&
      Math.abs(Number(meta.format.duration) - 6) < 0.2,
  );
  await page.getByRole('button', { name: '关闭对话框' }).click();
  await page.getByRole('button', { name: '返回主题' }).click();
  fixture.state.mode = 'slow';
  await page.getByRole('button', { name: '生成脚本与分镜', exact: true }).click();
  await page.getByRole('button', { name: '取消生成', exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector('.generation-progress')?.textContent.includes('fixture-model'),
  );
  await page.getByRole('button', { name: '取消生成', exact: true }).click();
  await page.getByRole('button', { name: '生成脚本与分镜', exact: true }).waitFor();
  check(
    'cancellation restores the creation form and retains the prior project',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('vibe-current')).id)) === project.id,
  );
  check(
    'cancelled process keeps its execution record and exposes a stopped stage',
    (await processPanel.innerText()).includes('生成已取消') &&
      (await processPanel.locator('.process-pipeline .halted').count()) === 1,
  );
  fixture.state.mode = 'success';
  check('no browser JavaScript exceptions', errors.length === 0);
  await writeFile(
    path.join(output, 'ai-report.json'),
    JSON.stringify({ checks, errors, video: meta.format }, null, 2),
  );
  console.log(`\n${checks.length} AI browser checks passed.`);
} finally {
  await browser.close();
  await studio.close();
  await fixture.close();
}
