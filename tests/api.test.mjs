import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeDemo, defaultConfig } from '../shared/catalog.mjs';

let upstream,
  child,
  base,
  mode = 'success',
  seenRequest,
  logs = '',
  testData;
before(async () => {
  testData = await mkdtemp(path.join(tmpdir(), 'vibe-api-'));
  upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    seenRequest = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'upstream-error') {
      res.statusCode = 429;
      return res.end('{}');
    }
    let content = 'not-json';
    if (mode === 'success') {
      const p = makeDemo();
      p.title = '模拟模型：测试主题';
      p.scenes = p.scenes.map((s) => ({ ...s, start: 0, end: 1 }));
      content = JSON.stringify(p);
    }
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const reserve = http.createServer();
  await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      VIBE_DATA_DIR: testData,
      AI_API_KEY: 'test-fixture-key',
      AI_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
      AI_MODEL: 'test-model',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => {
    logs += d;
  });
  child.stderr.on('data', (d) => {
    logs += d;
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return;
    } catch {}
    await delay(100);
  }
  throw Error(`API test server did not start: ${logs}`);
});
after(async () => {
  child?.kill('SIGTERM');
  await new Promise((resolve) => upstream?.close(resolve));
  await rm(testData, { recursive: true, force: true });
});
const generate = () =>
  fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...defaultConfig,
      topic: '测试任意主题',
      duration: 90,
      references: '只作为资料的数据',
    }),
  });

function waveDataLength(wave) {
  for (let offset = 12; offset + 8 <= wave.length;) {
    const size = wave.readUInt32LE(offset + 4);
    if (wave.toString('ascii', offset, offset + 4) === 'data') return size;
    offset += 8 + size + (size % 2);
  }
  throw Error('WAV data chunk missing');
}

test('model endpoint generates structured projects and normalizes timing', async () => {
  mode = 'success';
  const response = await generate();
  assert.equal(response.status, 200);
  const p = await response.json();
  assert.equal(p.topic, '测试任意主题');
  assert.equal(p.duration, 90);
  assert.equal(p.scenes.at(-1).end, 90);
  p.scenes.forEach((s, i) => {
    assert.equal(s.start, i === 0 ? 0 : p.scenes[i - 1].end);
  });
  assert.equal(p.sources[0].status, 'unverified');
  assert.equal(p.mode, 'ai');
  assert.equal(seenRequest.response_format.type, 'json_object');
  assert.equal(seenRequest.model, 'test-model');
  assert.equal(JSON.stringify(p).includes('test-fixture-key'), false);
});
test('bad model output is reported instead of fabricated success', async () => {
  mode = 'bad-json';
  const response = await generate();
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /有效分镜/);
});
test('provider rate limit is explained without exposing provider response or keys', async () => {
  mode = 'upstream-error';
  const response = await generate();
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /429/);
});
test('invalid project export and nonaudio uploads are rejected', async () => {
  const response = await fetch(`${base}/api/export/html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 400);
  const form = new FormData();
  form.append('file', new Blob(['not an audio'], { type: 'text/plain' }), 'test.txt');
  const upload = await fetch(`${base}/api/assets`, { method: 'POST', body: form });
  assert.equal(upload.status, 400);
});
test('audio preview renders scene effects and mixes uploaded background music', async () => {
  const project = makeDemo({ ...defaultConfig, duration: 30 });
  project.music = 'none';
  const preview = () =>
    fetch(`${base}/api/audio/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });

  const generated = await preview();
  assert.equal(generated.status, 200);
  const generatedWave = Buffer.from(await generated.arrayBuffer());
  assert.equal(generatedWave.subarray(0, 4).toString(), 'RIFF');
  assert.equal(waveDataLength(generatedWave), 30 * 44100 * 4);

  const clip = await readFile(
    new URL('../public/sfx/kenney/interface-sounds/click_001.ogg', import.meta.url),
  );
  const form = new FormData();
  form.append('file', new Blob([clip], { type: 'audio/ogg' }), 'bgm.ogg');
  const upload = await fetch(`${base}/api/assets`, { method: 'POST', body: form });
  assert.equal(upload.status, 200);
  project.music = `upload:${(await upload.json()).id}`;
  const mixed = await preview();
  assert.equal(mixed.status, 200);
  const mixedWave = Buffer.from(await mixed.arrayBuffer());
  assert.equal(mixedWave.subarray(0, 4).toString(), 'RIFF');
  assert.equal(waveDataLength(mixedWave), 30 * 44100 * 4);
});
test('HTML export escapes script closing tags from editable text', async () => {
  const p = makeDemo();
  p.scenes[0].title = '</script><script>window.injected=true</script>';
  const response = await fetch(`${base}/api/export/html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal(html.includes(p.scenes[0].title), false);
  assert.ok(html.includes('\\u003c/script>'));
});

// 回归：取消导出的 DELETE 没有请求体，曾被「必须 JSON」的守卫判成 415，
// 按钮点了没反应、任务还在后台跑。空体的写入请求必须能到达自己的处理器，
// 但表单编码（跨站表单唯一能发的东西）仍然要挡住。
test('bodyless DELETE reaches its handler while form posts stay blocked', async () => {
  const cancel = await fetch(`${base}/api/render/does-not-exist`, { method: 'DELETE' });
  assert.notEqual(cancel.status, 415);
  assert.equal(cancel.status, 404);

  const forgetAsset = await fetch(`${base}/api/assets/00000000-0000-0000-0000-000000000000.wav`, {
    method: 'DELETE',
  });
  assert.equal(forgetAsset.status, 200);

  const form = await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'topic=abcd',
  });
  assert.equal(form.status, 415);
});
