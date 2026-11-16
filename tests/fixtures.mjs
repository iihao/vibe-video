import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { makeDemo } from '../shared/catalog.mjs';

export async function startModelFixture() {
  const state = { mode: 'success', requests: [], disconnected: 0, started: 0 };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : {};
    state.requests.push({ path: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/models'))
      return res.end(
        JSON.stringify({
          data: [
            { id: 'fixture-model', display_name: 'Fixture · 测试模型' },
            { id: 'another-model' },
          ],
        }),
      );
    if (state.mode.startsWith('http-')) {
      res.statusCode = Number(state.mode.slice(5));
      return res.end(
        JSON.stringify({
          error: {
            message: `unsafe upstream ${req.headers.authorization} ${req.headers['x-api-key']}`,
          },
        }),
      );
    }
    if (state.mode === 'json-fallback' && (body.response_format || body.text?.format)) {
      res.statusCode = 400;
      return res.end('{"error":{"message":"unsupported response_format json_object"}}');
    }
    const system = body.system || body.instructions || body.messages?.[0]?.content || '';
    const input = body.input || body.messages || [];
    const isTest = system.startsWith('Return only valid JSON');
    const p = makeDemo();
    p.title = '真实接口测试：为什么天空是蓝色？';
    p.scenes = p.scenes.map((s, i) => ({
      ...s,
      start: i * 2,
      end: i * 2 + 2 * (i + 1),
      title: i === 0 ? '阳光里，藏着所有颜色。' : s.title,
    }));
    let content = isTest ? '{"ok":true}' : JSON.stringify(p);
    if (system.includes('本次只重写')) {
      const data = JSON.parse(input.at(-1).content);
      const original = data.scenes.find((s) => s.id === data.selectedScene);
      content = JSON.stringify({
        scene: {
          ...original,
          title: 'AI 改写：从一束阳光说起',
          subtitle: '模型返回的分镜文本',
          start: 999,
          end: 1000,
        },
      });
    }
    if (!isTest && state.mode === 'repair' && !system.includes('修复'))
      content = '{"title":"缺少分镜"}';
    if (!isTest && state.mode === 'bad-json') content = 'Definitely not JSON';
    if (!isTest && state.mode === 'fenced') content = '这里是分镜：\n```json\n' + content + '\n```';
    const protocol = req.url.endsWith('/responses')
      ? 'responses'
      : req.url.endsWith('/messages')
        ? 'anthropic'
        : 'chat';
    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders();
      if (state.mode === 'slow') {
        state.started++;
        res.write(': wait\n\n');
        res.on('close', () => {
          state.disconnected++;
        });
        return;
      }
      const events = [];
      const add = (value) => events.push('data: ' + JSON.stringify(value) + '\n\n');
      if (protocol === 'anthropic')
        add({ type: 'message_start', message: { usage: { input_tokens: 32 } } });
      for (let i = 0; i < content.length; i += 41) {
        const delta = content.slice(i, i + 41);
        if (protocol === 'responses') add({ type: 'response.output_text.delta', delta });
        else if (protocol === 'anthropic')
          add({ type: 'content_block_delta', delta: { type: 'text_delta', text: delta } });
        else add({ choices: [{ delta: { content: delta } }] });
      }
      if (state.mode !== 'interrupted') {
        if (protocol === 'responses')
          add({
            type: 'response.completed',
            response: { usage: { input_tokens: 32, output_tokens: 64 } },
          });
        else if (protocol === 'anthropic') {
          add({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 64 },
          });
          add({ type: 'message_stop' });
        } else {
          add({
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 32, completion_tokens: 64 },
          });
          events.push('data: [DONE]\n\n');
        }
      }
      const bytes = Buffer.from(events.join(''));
      // Split multibyte Chinese characters and SSE delimiters across network writes.
      for (let i = 0; i < bytes.length && !res.destroyed; i += 67) {
        res.write(bytes.subarray(i, i + 67));
        if (state.mode === 'paced') await delay(18);
      }
      return res.end();
    }
    const truncated = state.mode === 'truncated';
    if (protocol === 'responses')
      res.end(
        JSON.stringify({
          status: truncated ? 'incomplete' : 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: content }] }],
          usage: { input_tokens: 32, output_tokens: 64 },
        }),
      );
    else if (protocol === 'anthropic')
      res.end(
        JSON.stringify({
          content: [{ type: 'text', text: content }],
          stop_reason: truncated ? 'max_tokens' : 'end_turn',
          usage: { input_tokens: 32, output_tokens: 64 },
        }),
      );
    else
      res.end(
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: truncated ? 'length' : 'stop' }],
          usage: { prompt_tokens: 32, completion_tokens: 64 },
        }),
      );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}/v1`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
export async function startStudio(existingData) {
  const directory = existingData || (await mkdtemp(path.join(tmpdir(), 'vibe-integration-')));
  const reserve = http.createServer();
  await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  let logs = '';
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      VIBE_DATA_DIR: directory,
      AI_API_KEY: '',
      AI_BASE_URL: '',
      AI_MODEL: '',
      AI_PROVIDER: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {}
    if (i === 99) throw Error('Test studio did not start: ' + logs);
    await delay(80);
  }
  return {
    base,
    directory,
    getLogs: () => logs,
    async close(removeData = true) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
      if (removeData) await rm(directory, { recursive: true, force: true });
    },
  };
}
