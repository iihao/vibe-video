import { AIError } from './settings.mjs';

const headersFor = (p) => ({
  'Content-Type': 'application/json',
  ...(p.protocol === 'anthropic'
    ? { 'anthropic-version': '2023-06-01', ...(p.apiKey ? { 'x-api-key': p.apiKey } : {}) }
    : p.apiKey
      ? { Authorization: `Bearer ${p.apiKey}` }
      : {}),
});
function upstreamError(status) {
  const help = {
    400: '请求参数不被支持，请检查模型 ID 或切换 JSON 模式。',
    401: 'API Key 无效或已过期，请重新填写。',
    402: '账户额度不足，请检查服务商余额。',
    403: '没有访问权限，请检查模型授权或服务地区。',
    404: '接口或模型不存在，请检查基础地址和模型 ID。',
    429: '请求受限或额度不足，请检查服务商配额，稍后重试。',
    503: '模型服务暂时繁忙，请稍后重试。',
  };
  return new AIError(
    `模型服务返回 ${status}：${help[status] || '上游服务异常，请稍后重试。'}`,
    `UPSTREAM_${status}`,
  );
}
export function parseJSON(text) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {}
  // Some compatible services wrap JSON in prose. Only accept one complete object.
  const first = trimmed.indexOf('{'),
    last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new AIError('模型未返回 JSON。', 'INVALID_OUTPUT');
}
function textParts(parts) {
  if (typeof parts === 'string') return parts;
  return (parts || [])
    .filter((p) => ['text', 'output_text'].includes(p.type))
    .map((p) => p.text || '')
    .join('');
}
function readOutput(json, protocol) {
  if (protocol === 'responses') {
    if (json.status === 'incomplete')
      throw new AIError('模型输出被截断，请在高级设置中提高输出 Token 上限。', 'OUTPUT_TRUNCATED');
    const refusal = json.output?.flatMap((o) => o.content || []).some((p) => p.type === 'refusal');
    if (refusal) throw new AIError('模型拒绝了本次请求，请调整主题或参考资料。', 'MODEL_REFUSAL');
    return (
      json.output_text ||
      (json.output || [])
        .filter((o) => o.type === 'message')
        .map((o) => textParts(o.content))
        .join('')
    );
  }
  if (protocol === 'anthropic') {
    if (json.stop_reason === 'max_tokens')
      throw new AIError('模型输出被截断，请提高输出 Token 上限。', 'OUTPUT_TRUNCATED');
    return textParts(json.content);
  }
  if (json.choices?.[0]?.finish_reason === 'length')
    throw new AIError('模型输出被截断，请提高输出 Token 上限。', 'OUTPUT_TRUNCATED');
  if (json.choices?.[0]?.message?.refusal || json.choices?.[0]?.finish_reason === 'content_filter')
    throw new AIError('模型拒绝了本次请求，请调整主题或参考资料。', 'MODEL_REFUSAL');
  return textParts(json.choices?.[0]?.message?.content);
}
const usageOf = (u) => ({
  inputTokens: u?.input_tokens ?? u?.prompt_tokens ?? 0,
  outputTokens: u?.output_tokens ?? u?.completion_tokens ?? 0,
});

async function readStream(response, protocol, onDelta) {
  let buffer = '',
    content = '',
    usage = {},
    complete = false,
    length = false;
  const decoder = new TextDecoder();
  const accept = (block) => {
    const raw = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!raw) return;
    if (raw === '[DONE]') {
      complete = true;
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new AIError('模型流式响应格式错误，请检查兼容接口。', 'STREAM_INVALID');
    }
    if (data.error || data.type === 'error' || data.type === 'response.failed')
      throw new AIError('模型在生成中返回错误，请检查服务商状态与配额后重试。', 'STREAM_ERROR');
    let delta = '';
    if (protocol === 'responses') {
      if (data.type === 'response.output_text.delta') delta = data.delta || '';
      if (data.type === 'response.completed') {
        complete = true;
        usage = data.response?.usage || usage;
      }
      if (data.type === 'response.incomplete') length = true;
    } else if (protocol === 'anthropic') {
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta')
        delta = data.delta.text || '';
      if (data.type === 'message_start') usage = { ...usage, ...data.message?.usage };
      if (data.type === 'message_delta') {
        usage = { ...usage, ...data.usage };
        length ||= data.delta?.stop_reason === 'max_tokens';
      }
      if (data.type === 'message_stop') complete = true;
    } else {
      delta = textParts(data.choices?.[0]?.delta?.content);
      length ||= data.choices?.[0]?.finish_reason === 'length';
      if (data.choices?.[0]?.finish_reason) complete = true;
      if (data.usage) usage = data.usage;
    }
    if (delta) {
      content += delta;
      if (content.length > 200000)
        throw new AIError('模型输出过长，请缩短要求后重试。', 'OUTPUT_TOO_LARGE');
      onDelta(content.length, content);
    }
  };
  for await (const part of response.body) {
    buffer += decoder.decode(part, { stream: true }).replace(/\r/g, '');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      accept(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
    if (buffer.length > 1000000) throw new AIError('模型流式响应过大。', 'STREAM_INVALID');
  }
  buffer += decoder.decode();
  if (buffer.trim()) accept(buffer);
  if (length) throw new AIError('模型输出被截断，请提高输出 Token 上限。', 'OUTPUT_TRUNCATED');
  if (!complete) throw new AIError('模型连接提前中断，请重新生成。', 'STREAM_INTERRUPTED');
  return { text: content, usage: usageOf(usage) };
}
export async function complete(p, { system, messages, signal, onDelta, maxTokens }) {
  const combined = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(p.timeout * 1000),
  ]);
  const request = async (useJson) => {
    const stream = Boolean(onDelta),
      tokens = maxTokens || p.maxTokens;
    let suffix, body;
    if (p.protocol === 'responses') {
      suffix = 'responses';
      body = {
        model: p.model,
        instructions: system,
        input: messages,
        max_output_tokens: tokens,
        stream,
        store: false,
        ...(useJson ? { text: { format: { type: 'json_object' } } } : {}),
      };
    } else if (p.protocol === 'anthropic') {
      suffix = 'messages';
      body = { model: p.model, system, messages, max_tokens: tokens, stream };
    } else {
      suffix = 'chat/completions';
      const tokenParam =
        p.provider === 'openai' || /^(gpt-5|gpt-6|o[134])/.test(p.model)
          ? 'max_completion_tokens'
          : 'max_tokens';
      body = {
        model: p.model,
        messages: [{ role: 'system', content: system }, ...messages],
        [tokenParam]: tokens,
        stream,
        ...(useJson ? { response_format: { type: 'json_object' } } : {}),
        ...(p.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
        ...(p.provider === 'qwen' && /^(qwen3|qwen-plus|qwen-turbo|qwen-flash)/.test(p.model)
          ? { enable_thinking: false }
          : {}),
        ...(stream && ['deepseek', 'qwen', 'openai'].includes(p.provider)
          ? { stream_options: { include_usage: true } }
          : {}),
      };
    }
    const res = await fetch(`${p.baseUrl}/${suffix}`, {
      method: 'POST',
      headers: headersFor(p),
      body: JSON.stringify(body),
      signal: combined,
      redirect: 'error',
    });
    if (!res.ok) {
      // Only retry when the provider explicitly rejects the optional JSON parameter.
      const errorText = (await res.text()).slice(0, 10000);
      if (
        useJson &&
        p.jsonMode === 'auto' &&
        [400, 422].includes(res.status) &&
        /response_format|json_object|text\.format|text\[format\]/i.test(errorText)
      )
        return request(false);
      throw upstreamError(res.status);
    }
    if (res.headers.get('content-type')?.includes('text/event-stream'))
      return readStream(res, p.protocol, onDelta || (() => {}));
    let data;
    try {
      data = await res.json();
    } catch {
      throw new AIError('接口没有返回有效 JSON，请检查基础地址及协议。', 'INVALID_RESPONSE');
    }
    if (data.error) throw new AIError('模型服务返回错误，请检查服务商控制台。', 'UPSTREAM_ERROR');
    const text = readOutput(data, p.protocol);
    onDelta?.(text?.length || 0, text || '');
    return { text, usage: usageOf(data.usage) };
  };
  try {
    const result = await request(p.jsonMode !== 'prompt' && p.protocol !== 'anthropic');
    if (!result.text?.trim())
      throw new AIError(
        '模型没有返回正文。思考模型可尝试提高输出 Token 上限，或更换模型。',
        'EMPTY_OUTPUT',
      );
    return result;
  } catch (e) {
    if (signal?.aborted) throw new AIError('已取消生成。', 'CANCELLED', 499);
    if (combined.aborted)
      throw new AIError(
        `模型响应超过 ${p.timeout} 秒，请重试或在高级设置延长超时。`,
        'AI_TIMEOUT',
        504,
      );
    if (e instanceof AIError) throw e;
    throw new AIError('无法连接模型服务，请检查地址、网络或代理是否可用。', 'AI_NETWORK_ERROR');
  }
}
export async function listModels(p, signal) {
  try {
    const res = await fetch(`${p.baseUrl}/models`, {
      headers: headersFor(p),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]),
      redirect: 'error',
    });
    if (!res.ok) throw upstreamError(res.status);
    const json = await res.json();
    const models = (json.data || json.models || [])
      .map((m) => ({ id: m.id || m.name, name: m.display_name || m.id || m.name }))
      .filter((m) => typeof m.id === 'string');
    if (!models.length)
      throw new AIError('接口没有返回模型列表，请手动填写服务商提供的模型 ID。', 'NO_MODELS');
    return models.slice(0, 500);
  } catch (e) {
    if (e instanceof AIError) throw e;
    throw new AIError('获取模型列表失败，可手动填写模型 ID 后测试连接。', 'MODELS_FAILED');
  }
}
export async function testConnection(p, signal) {
  const start = performance.now();
  const result = await complete(p, {
    system: 'Return only valid JSON. Reply with exactly {"ok":true}.',
    messages: [
      { role: 'user', content: 'Connection test. Respond with the JSON object {"ok":true}.' },
    ],
    signal,
    maxTokens: Math.min(2048, p.maxTokens),
  });
  let json;
  try {
    json = parseJSON(result.text);
  } catch {}
  if (json?.ok !== true)
    throw new AIError(
      '模型可达，但没有通过 JSON 输出测试。请尝试其他 JSON 模式或模型。',
      'TEST_INVALID_OUTPUT',
    );
  return {
    ok: true,
    model: p.model,
    latencyMs: Math.round(performance.now() - start),
    usage: result.usage,
  };
}
