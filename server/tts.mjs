import { AIError } from './ai/settings.mjs';

/* 通义千问 CosyVoice 实时语音合成（WebSocket）。
 * 用 Node 内置 WebSocket（Node 22+），无需额外依赖。
 * 通过 enable_subtitle 获取字级时间戳，用于字幕逐字高亮对齐。
 *
 * 参考：https://docs.aliyun.com/zh/model-studio/cosyvoice-websocket-api
 */

const DEFAULT_VOICES = [
  { id: 'longanyang', name: '龙洋洋（女声·自然）' },
  { id: 'longxiaochun_v2', name: '龙晓春（女声·温柔）' },
  { id: 'longhuashuo_v2', name: '龙华硕（男声·沉稳）' },
  { id: 'longyueting_v2', name: '龙悦婷（女声·活泼）' },
];

/* 把 DashScope 的 baseUrl 转成 CosyVoice WebSocket 地址。
 * 兼容两种：旧域名 dashscope.aliyuncs.com → wss://dashscope.aliyuncs.com/api-ws/v1/inference；
 * 新域名 {ws}.cn-beijing.maas.aliyuncs.com → 已是 ws 地址，直接加路径。 */
function wsUrlFor(baseUrl) {
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    return 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
  }
  const hostname = u.hostname; // 只取域名，丢弃 /compatible-mode/v1 等路径
  if (hostname.includes('maas.aliyuncs.com')) {
    // 新业务空间域名（带 WorkspaceId），语音合成走 /api-ws/v1/inference
    return `wss://${hostname}/api-ws/v1/inference`;
  }
  // 旧 dashscope 域名
  return `wss://dashscope.aliyuncs.com/api-ws/v1/inference`;
}

/* 合成一段文本，返回 { audio: Float32Array(单声道样本), sampleRate, words: [{text,beginMs,endMs}] } */
export async function synthesize(
  text,
  profile,
  { voice = 'longanyang', model = 'cosyvoice-v3-flash', signal } = {},
) {
  if (!profile?.apiKey)
    throw new AIError('请先接入支持语音合成的模型（如通义千问）。', 'TTS_NO_KEY', 422);
  const clean = String(text || '').trim();
  if (!clean) throw new AIError('没有可配音的文本。', 'TTS_EMPTY', 400);

  const url = wsUrlFor(profile.baseUrl);
  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${profile.apiKey}`,
      'user-agent': 'vibe-studio/1.0',
    },
  });

  const chunks = []; // 二进制音频帧
  const words = []; // 逐字时间戳
  let sentenceOffsetMs = 0; // 累计句子音频时长，用于把句内相对时间戳转成全局时间戳
  let taskFinished = false;
  let lastError = null;
  const sampleRate = 24000; // CosyVoice 默认 PCM 采样率

  const timeoutMs = (profile.timeout || 180) * 1000;
  const timer = setTimeout(() => {
    lastError =
      lastError || new AIError(`语音合成超过 ${profile.timeout} 秒，请重试。`, 'TTS_TIMEOUT', 504);
    try {
      ws.close();
    } catch {}
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  };
  const onAbort = () => {
    lastError = new AIError('已取消配音生成。', 'CANCELLED', 499);
    try {
      ws.close();
    } catch {}
  };
  if (signal) signal.addEventListener('abort', onAbort);

  // 同一任务内 run-task / continue-task / finish-task 必须共享同一个 task_id，
  // 否则服务端无法关联，直接失败或返回错乱音频。
  const taskId = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const send = (obj) => {
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (e) {
      lastError = lastError || new AIError(`发送配音请求失败：${e?.message || e}`, 'TTS_SEND', 502);
      try {
        ws.close();
      } catch {}
      return false;
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = () => {
      // eslint-disable-next-line no-console
      if (process.env.TTS_DEBUG) console.log('[tts] onopen, 发送 run-task（task_id=', taskId, '）');
      // 第一步：只发 run-task 开启任务，等收到 task-started 后再发文本（协议要求）。
      send({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model,
          parameters: {
            voice,
            format: 'pcm',
            sample_rate: sampleRate,
            enable_subtitle: true,
          },
          input: {},
        },
      });
    };

    ws.onmessage = (ev) => {
      // eslint-disable-next-line no-console
      if (process.env.TTS_DEBUG)
        console.log(
          '[tts] onmessage typeof=',
          typeof ev.data,
          'len=',
          typeof ev.data === 'string' ? ev.data.length : ev.data?.byteLength,
        );
      if (typeof ev.data === 'string') {
        // 文本事件：sentence-begin / sentence-end / task-finished 等
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        // eslint-disable-next-line no-console
        if (process.env.TTS_DEBUG)
          console.log('[tts] event=', msg?.header?.event, 'err=', msg?.header?.error_message);
        // 收到 task-started 后，才开始发送文本与结束标记（协议要求先等确认）。
        if (msg?.header?.event === 'task-started') {
          // eslint-disable-next-line no-console
          if (process.env.TTS_DEBUG)
            console.log('[tts] task-started, 发送 continue-task + finish-task');
          send({
            header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: { text: clean } },
          });
          send({
            header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
            payload: { input: {} },
          });
          return;
        }
        // 服务端可能直接在 header 里返回 task-failed（如 Model not exist / 未开通语音服务），
        // 此时 payload 为空，必须优先检测，否则会漏掉失败原因。
        if (msg?.header?.event === 'task-failed') {
          const code = msg.header.error_code || '';
          const msg0 = msg.header.error_message || '';
          if (/not exist/i.test(msg0))
            lastError = new AIError(
              '当前接入的模型服务未开通语音合成（CosyVoice），请到阿里云百炼控制台开通语音服务，或改用已开通语音的 API Key。',
              'TTS_NOT_ENABLED',
              422,
            );
          else
            lastError = new AIError(
              `语音合成失败：${msg0 || code || '未知错误'}`,
              'TTS_UPSTREAM',
              502,
            );
          return;
        }
        const output = msg?.payload?.output;
        if (!output) return;
        const type = output.type;
        if (type === 'sentence-end') {
          const sentenceWords = output.sentence?.words || [];
          // words 的 begin_time/end_time 是相对当前句子的毫秒时间戳
          for (const w of sentenceWords) {
            if (typeof w.text === 'string' && w.text.trim()) {
              words.push({
                text: w.text,
                beginMs: sentenceOffsetMs + (w.begin_time || 0),
                endMs: sentenceOffsetMs + (w.end_time || w.begin_time || 0),
              });
            }
          }
          // 句子时长从最后一个字的 end_time 推算
          const lastEnd = sentenceWords.length
            ? sentenceWords[sentenceWords.length - 1].end_time || 0
            : 0;
          sentenceOffsetMs += lastEnd;
        } else if (type === 'task-finished') {
          taskFinished = true;
        } else if (type === 'error' || output.code) {
          lastError = new AIError(
            output.message || '语音合成失败，请检查音色或模型。',
            'TTS_UPSTREAM',
            502,
          );
        }
      } else if (ev.data instanceof ArrayBuffer || (ev.data && ev.data.buffer)) {
        const buf = Buffer.from(ev.data instanceof ArrayBuffer ? ev.data : ev.data.buffer);
        chunks.push(buf);
      }
    };

    ws.onerror = () => {
      lastError =
        lastError || new AIError('无法连接语音合成服务，请检查网络与密钥。', 'TTS_NETWORK', 502);
    };

    ws.onclose = () => {
      cleanup();
      // eslint-disable-next-line no-console
      if (process.env.TTS_DEBUG)
        console.log(
          '[tts] onclose lastError=',
          lastError?.code,
          'chunks=',
          chunks.length,
          'taskFinished=',
          taskFinished,
        );
      if (lastError) reject(lastError);
      else if (!taskFinished && chunks.length === 0)
        reject(new AIError('语音合成未返回音频，请检查模型与音色是否匹配。', 'TTS_NO_AUDIO', 502));
      else resolve();
    };
  });

  if (lastError) throw lastError;

  // 合并 PCM 音频帧（16-bit signed little-endian, 单声道）
  const pcm = Buffer.concat(chunks.length ? chunks : [Buffer.alloc(0)]);
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;

  const durationMs = samples.length ? (samples.length / sampleRate) * 1000 : 0;
  return { samples, sampleRate, words, durationMs };
}

export function listVoices() {
  return DEFAULT_VOICES;
}

/** 旁白文案：去掉句末标点后以逗号连接，避免出现「。。」。 */
export function speechText(scene) {
  const clean = (value) =>
    String(value || '')
      .trim()
      .replace(/[。，、；：!?！？…]+$/g, '');
  return [clean(scene.title), clean(scene.subtitle)].filter(Boolean).join('，');
}

/** 配音文件只允许安全字符，避免客户端 id 造成路径穿越。 */
export function ttsFileName(projectId, sceneId) {
  return `${projectId}-${sceneId}`.replace(/[^A-Za-z0-9_-]/g, '_') + '.wav';
}

/**
 * 把配音时长压进分镜：超长时用 atempo 加速（上限 1.6x），
 * 并同步缩放逐字时间戳，让字幕和声音继续对齐。
 * 加速后仍放不下时返回 overflow=true，调用方应提示用户缩短文案。
 */
export function fitVoiceTiming(result, sceneDur) {
  const neededMs = result.durationMs;
  const sceneMs = sceneDur * 1000;
  const tempo = neededMs > sceneMs * 1.02 ? Math.min(1.6, neededMs / sceneMs) : 1;
  const fittedMs = neededMs / tempo;
  return {
    tempo,
    neededMs,
    fittedMs,
    overflow: fittedMs > sceneMs + 80,
    words: result.words.map((w) => ({
      text: w.text,
      beginMs: w.beginMs / tempo,
      endMs: w.endMs / tempo,
    })),
  };
}
