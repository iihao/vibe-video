import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startModelFixture, startStudio } from './fixtures.mjs';
import { defaultConfig, makeDemo } from '../shared/catalog.mjs';
import { complete } from '../server/ai/client.mjs';

let fixture, studio;
before(async () => {
  fixture = await startModelFixture();
  studio = await startStudio();
});
after(async () => {
  await studio?.close();
  await fixture?.close();
});
const call = (route, data, headers = {}) =>
  fetch(studio.base + route, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
const draft = (protocol = 'chat') => ({
  provider: protocol === 'anthropic' ? 'anthropic' : protocol === 'responses' ? 'openai' : 'custom',
  protocol,
  baseUrl: fixture.url,
  model: 'fixture-model',
  apiKey: 'integration-test-secret',
  timeout: 10,
  maxTokens: 6000,
  jsonMode: 'auto',
});
const config = { ...defaultConfig, topic: '为什么天空是蓝色？', duration: 30 };
const connect = async (protocol = 'chat') => {
  fixture.state.mode = 'success';
  const r = await call('/api/ai/connect', draft(protocol));
  assert.equal(r.status, 200, await r.clone().text());
  return r.json();
};
const events = (raw) =>
  raw
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => ({ event: b.split('\n')[0].slice(7), data: JSON.parse(b.split('\ndata: ')[1]) }));

test('empty config shows unconfigured status and refuses arbitrary topics', async () => {
  assert.equal((await (await call('/api/health')).json()).ai, false);
  assert.equal((await (await call('/api/ai/settings')).json()).active, null);
  assert.equal((await call('/api/generate/stream', config)).status, 422);
});
test('test performs an actual model call but does not activate or persist a key', async () => {
  const before = fixture.state.requests.length;
  const r = await call('/api/ai/test', draft());
  assert.equal(r.status, 200);
  const result = await r.json();
  assert.equal(result.ok, true);
  assert.equal(result.usage.inputTokens, 32);
  assert.equal(fixture.state.requests.length, before + 1);
  assert.equal((await (await call('/api/health')).json()).configured, false);
});
test('models are fetched from upstream with private auth headers', async () => {
  const r = await call('/api/ai/models', { ...draft(), model: '' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).models[0].id, 'fixture-model');
  assert.equal(
    fixture.state.requests.at(-1).headers.authorization,
    'Bearer integration-test-secret',
  );
});
test('test-and-activate encrypts credentials, restricts file permissions, and never exposes saved keys', async () => {
  const result = await connect();
  assert.equal(result.profile.hasApiKey, true);
  assert.equal('apiKey' in result.profile, false);
  const health = await (await call('/api/health')).json();
  assert.equal(health.verified, true);
  assert.equal(health.configured, true);
  const publicData = await (await call('/api/ai/settings')).text();
  assert.equal(publicData.includes('integration-test-secret'), false);
  const file = path.join(studio.directory, 'private/ai.json');
  const disk = await readFile(file, 'utf8');
  assert.equal(disk.includes('integration-test-secret'), false);
  assert.ok(JSON.parse(disk).profiles.custom.secret.data);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(studio.directory, 'private'))).mode & 0o777, 0o700);
});
test('blank key reuses same endpoint credential, and never forwards it to a changed endpoint', async () => {
  let r = await call('/api/ai/test', { ...draft(), apiKey: '' });
  assert.equal(r.status, 200);
  assert.equal(
    fixture.state.requests.at(-1).headers.authorization,
    'Bearer integration-test-secret',
  );
  r = await call('/api/ai/test', { ...draft(), apiKey: '', baseUrl: fixture.url + '/different' });
  assert.equal(r.status, 200);
  assert.equal(fixture.state.requests.at(-1).headers.authorization, undefined);
  r = await call('/api/ai/test', {
    ...draft(),
    provider: 'openai',
    protocol: 'responses',
    apiKey: '',
    baseUrl: fixture.url + '/different',
  });
  assert.equal(r.status, 400);
});
test('configured custom topic streams actual model output with contiguous normalized scenes and usage', async () => {
  const r = await call('/api/generate/stream', config);
  assert.equal(r.status, 200);
  const es = events(await r.text());
  assert.ok(es.some((e) => e.event === 'progress' && e.data.chars > 0));
  const drafts = es.filter((e) => e.event === 'progress' && e.data.scenes?.length);
  assert.ok(drafts.length > 1, 'scene cards arrive before the final result');
  assert.equal(drafts[0].data.scenes[0].title, '阳光里，藏着所有颜色。');
  assert.ok(es.some((e) => e.data.stage === 'validating'));
  const p = es.find((e) => e.event === 'result').data;
  assert.equal(p.topic, config.topic);
  assert.equal(p.title, '真实接口测试：为什么天空是蓝色？');
  assert.equal(p.scenes[0].title, '阳光里，藏着所有颜色。');
  assert.equal(p.scenes.at(-1).end, 30);
  p.scenes.forEach((s, i) => assert.equal(s.start, i ? p.scenes[i - 1].end : 0));
  assert.equal(p.mode, 'ai');
  assert.equal(p.generation.usage.outputTokens, 64);
  assert.equal(p.generation.model, 'fixture-model');
  assert.equal(p.sources[0].status, 'unverified');
  assert.equal(JSON.stringify(p).includes('integration-test-secret'), false);
});
test('Responses protocol uses native instructions/input/text format and supports streamed generation', async () => {
  await connect('responses');
  let b = fixture.state.requests.at(-1).body;
  assert.equal(b.store, false);
  assert.equal(b.text.format.type, 'json_object');
  assert.ok(b.max_output_tokens);
  assert.ok(b.instructions);
  assert.ok(b.input);
  const es = events(await (await call('/api/generate/stream', config)).text());
  assert.equal(es.at(-1).event, 'result');
  assert.equal(es.at(-1).data.generation.provider, 'openai');
});
test('Claude protocol uses Messages, x-api-key and version headers and supports streamed generation', async () => {
  await connect('anthropic');
  const req = fixture.state.requests.at(-1);
  assert.equal(req.headers['x-api-key'], 'integration-test-secret');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.headers.authorization, undefined);
  assert.ok(req.body.system);
  assert.ok(req.body.max_tokens);
  assert.equal(req.body.response_format, undefined);
  const es = events(await (await call('/api/generate/stream', config)).text());
  assert.equal(es.at(-1).event, 'result');
  assert.equal(es.at(-1).data.generation.usage.inputTokens, 32);
});
test('full endpoint URLs normalize before requests and the saved profile survives a server restart', async () => {
  const r = await call('/api/ai/connect', {
    ...draft(),
    baseUrl: fixture.url + '/chat/completions/',
  });
  assert.equal(r.status, 200);
  const directory = studio.directory;
  await studio.close(false);
  studio = await startStudio(directory);
  const r2 = await call('/api/ai/test', { ...draft(), apiKey: '' });
  assert.equal(r2.status, 200);
  const h = await (await call('/api/health')).json();
  assert.equal(h.verified, true);
});
test('automatic JSON fallback only retries an explicitly rejected JSON parameter', async () => {
  fixture.state.mode = 'json-fallback';
  const before = fixture.state.requests.length;
  const r = await call('/api/ai/test', { ...draft(), apiKey: '' });
  assert.equal(r.status, 200);
  assert.equal(fixture.state.requests.length, before + 2);
  assert.equal(fixture.state.requests.at(-1).body.response_format, undefined);
  fixture.state.mode = 'http-401';
  const before401 = fixture.state.requests.length;
  const failed = await call('/api/ai/test', draft());
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).code, 'UPSTREAM_401');
  assert.equal(fixture.state.requests.length, before401 + 1);
  fixture.state.mode = 'success';
});
test('provider failures are actionable, redact upstream messages and keep the working profile', async () => {
  for (const code of [401, 403, 404, 429]) {
    fixture.state.mode = 'http-' + code;
    const r = await call('/api/ai/connect', { ...draft(), model: 'invalid-model' });
    assert.equal(r.status, 502);
    const raw = await r.text();
    assert.ok(raw.includes(String(code)));
    assert.equal(raw.includes('integration-test-secret'), false);
    assert.equal(raw.includes('unsafe'), false);
    const h = await (await call('/api/health')).json();
    assert.equal(h.model, 'fixture-model');
  }
  fixture.state.mode = 'success';
});
test('fenced model JSON is extracted, while invalid schemas are repaired once with accurate total usage', async () => {
  fixture.state.mode = 'fenced';
  let r = await call('/api/generate', config);
  assert.equal(r.status, 200);
  fixture.state.mode = 'repair';
  const before = fixture.state.requests.length;
  r = await call('/api/generate', config);
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.generation.repaired, true);
  assert.equal(p.generation.usage.outputTokens, 128);
  assert.equal(fixture.state.requests.length, before + 2);
  fixture.state.mode = 'bad-json';
  const badBefore = fixture.state.requests.length;
  r = await call('/api/generate', config);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, 'INVALID_STORY');
  assert.equal(fixture.state.requests.length, badBefore + 2);
  fixture.state.mode = 'success';
});
test('truncated output and interrupted streams fail rather than returning a demo', async () => {
  fixture.state.mode = 'truncated';
  let r = await call('/api/generate', config);
  assert.equal((await r.json()).code, 'OUTPUT_TRUNCATED');
  fixture.state.mode = 'interrupted';
  const es = events(await (await call('/api/generate/stream', config)).text());
  assert.equal(es.at(-1).event, 'error');
  assert.equal(es.at(-1).data.code, 'STREAM_INTERRUPTED');
  fixture.state.mode = 'success';
});
test('streamed repair visibly clears drafts and returns validated replacement scenes', async () => {
  fixture.state.mode = 'repair';
  const es = events(await (await call('/api/generate/stream', config)).text());
  const repair = es.findIndex((event) => event.data.stage === 'repairing');
  assert.ok(repair > 0);
  assert.deepEqual(es[repair].data.scenes, []);
  assert.ok(
    es
      .slice(repair + 1)
      .some((event) => event.data.stage === 'repairing' && event.data.scenes?.length),
  );
  assert.equal(es.at(-1).event, 'result');
  assert.equal(es.at(-1).data.generation.repaired, true);
  fixture.state.mode = 'success';
});
test('scene rewriting keeps ID and timing fixed while changing actual text', async () => {
  const p = makeDemo();
  const original = p.scenes[0];
  const r = await call('/api/ai/rewrite-scene', {
    project: p,
    sceneId: original.id,
    instruction: '用更通俗的语言',
  });
  assert.equal(r.status, 200);
  const { scene } = await r.json();
  assert.equal(scene.title, 'AI 改写：从一束阳光说起');
  assert.equal(scene.id, original.id);
  assert.equal(scene.start, original.start);
  assert.equal(scene.end, original.end);
});
test('cancelled browser generation aborts the upstream HTTP stream', async () => {
  fixture.state.mode = 'slow';
  const controller = new AbortController();
  const r = await fetch(studio.base + '/api/generate/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal: controller.signal,
  });
  const reader = r.body.getReader();
  await reader.read();
  for (let i = 0; i < 30 && !fixture.state.started; i++) await delay(30);
  assert.ok(fixture.state.started > 0);
  controller.abort();
  await reader.cancel().catch(() => {});
  for (let i = 0; i < 50 && !fixture.state.disconnected; i++) await delay(30);
  assert.ok(fixture.state.disconnected > 0);
  fixture.state.mode = 'success';
});
test('cross-site requests and credential-bearing URLs are rejected before model calls', async () => {
  const before = fixture.state.requests.length;
  assert.equal(
    (await call('/api/ai/connect', draft(), { Origin: 'https://evil.example' })).status,
    403,
  );
  assert.equal(
    (await call('/api/ai/connect', { ...draft(), baseUrl: 'https://key:password@example.com/v1' }))
      .status,
    400,
  );
  assert.equal(
    (
      await call('/api/ai/connect', {
        ...draft(),
        baseUrl: 'https://example.com/v1?api_key=secret',
      })
    ).status,
    400,
  );
  assert.equal(fixture.state.requests.length, before);
});
test('an upstream stream exceeding its timeout reports a timeout and closes the connection', async () => {
  fixture.state.mode = 'slow';
  await assert.rejects(
    complete(
      { ...draft(), timeout: 0.05 },
      {
        system: 'Return JSON',
        messages: [{ role: 'user', content: 'Test timeout' }],
        onDelta: () => {},
      },
    ),
    (e) => e.code === 'AI_TIMEOUT',
  );
  fixture.state.mode = 'success';
});
test('disable and forget retain explicit demo mode across restarts and remove saved credentials', async () => {
  await call('/api/ai/disable', {});
  const h = await (await call('/api/health')).json();
  assert.equal(h.configured, false);
  assert.equal((await call('/api/generate', config)).status, 422);
  await call('/api/ai/forget', { provider: 'custom' });
  const s = await (await call('/api/ai/settings')).json();
  assert.equal(s.profiles.custom, undefined);
  assert.equal(studio.getLogs().includes('integration-test-secret'), false);
});
