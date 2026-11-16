import { z } from 'zod';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import path from 'node:path';
import { providers } from '../../shared/providers.mjs';

export class AIError extends Error {
  constructor(message, code = 'AI_ERROR', status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function normalizeUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AIError('请填写完整的模型服务地址。', 'INVALID_SETTINGS', 400);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new AIError(
      '服务地址必须为 HTTP / HTTPS，且不能包含账户、查询参数或锚点。',
      'INVALID_SETTINGS',
      400,
    );
  url.pathname = url.pathname
    .replace(/\/(chat\/completions|responses|messages|models)\/?$/, '')
    .replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}
const draftSchema = z.object({
  provider: z.enum(providers.map((p) => p.id)),
  protocol: z.enum(['chat', 'responses', 'anthropic']),
  baseUrl: z.string().min(1).max(2000).transform(normalizeUrl),
  model: z.string().trim().max(200).default(''),
  apiKey: z.string().trim().max(2000).default(''),
  timeout: z.number().int().min(10).max(600).default(180),
  maxTokens: z.number().int().min(512).max(32768).default(6000),
  jsonMode: z.enum(['auto', 'json', 'prompt']).default('auto'),
});
const publicProfile = (p) => {
  if (!p) return null;
  const { apiKey, ...safe } = p;
  return { ...safe, hasApiKey: Boolean(apiKey) };
};

export async function createSettingsStore(dataDir, env = process.env) {
  const dir = path.join(dataDir, 'private');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const keyFile = path.join(dir, 'master.key'),
    settingsFile = path.join(dir, 'ai.json');
  let master;
  try {
    master = await readFile(keyFile);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    master = randomBytes(32);
    try {
      await writeFile(keyFile, master, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      master = await readFile(keyFile);
    }
  }
  if (master.length !== 32) throw Error('模型配置加密密钥损坏，请恢复 .data/private/master.key。');
  await chmod(keyFile, 0o600);
  function seal(text) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', master, iv);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: ciphertext.toString('base64'),
    };
  }
  function unseal(s) {
    const cipher = createDecipheriv('aes-256-gcm', master, Buffer.from(s.iv, 'base64'));
    cipher.setAuthTag(Buffer.from(s.tag, 'base64'));
    return Buffer.concat([cipher.update(Buffer.from(s.data, 'base64')), cipher.final()]).toString(
      'utf8',
    );
  }
  let state = { active: null, disabled: false, profiles: {} };
  try {
    const saved = JSON.parse(await readFile(settingsFile, 'utf8'));
    state = {
      ...saved,
      profiles: Object.fromEntries(
        Object.entries(saved.profiles).map(([id, p]) => [
          id,
          { ...p, apiKey: p.secret ? unseal(p.secret) : '', secret: undefined },
        ]),
      ),
    };
  } catch (e) {
    if (e.code !== 'ENOENT') throw Error('无法读取模型配置，请检查 .data/private 文件是否完整。');
  }
  if (env.AI_API_KEY && !Object.keys(state.profiles).length && !state.disabled) {
    const preset = providers.find((p) => p.id === env.AI_PROVIDER) || providers[0];
    const p = draftSchema.parse({
      ...preset,
      provider: preset.id,
      baseUrl: env.AI_BASE_URL || preset.baseUrl,
      model: env.AI_MODEL || preset.model,
      apiKey: env.AI_API_KEY,
      protocol: env.AI_PROTOCOL || preset.protocol,
    });
    state.profiles[p.provider] = p;
    state.active = p.provider;
  }
  async function persist(next) {
    const profiles = Object.fromEntries(
      Object.entries(next.profiles).map(([id, p]) => {
        const { apiKey, ...rest } = p;
        return [id, { ...rest, secret: apiKey ? seal(apiKey) : null }];
      }),
    );
    const temp = path.join(dir, `ai-${randomBytes(8).toString('hex')}.tmp`);
    await writeFile(temp, JSON.stringify({ ...next, profiles }, null, 2), { mode: 0o600 });
    await rename(temp, settingsFile);
    state = next;
  }
  function resolve(input, requireModel = true) {
    const p = draftSchema.parse(input),
      saved = state.profiles[p.provider];
    if (!p.apiKey && saved?.baseUrl === p.baseUrl && saved.protocol === p.protocol)
      p.apiKey = saved.apiKey;
    if (providers.find((x) => x.id === p.provider)?.keyRequired && !p.apiKey)
      throw new AIError(
        '请填写这个服务地址的 API Key。更换地址后需要重新填写密钥。',
        'MISSING_KEY',
        400,
      );
    if (requireModel && !p.model)
      throw new AIError('请选择或填写模型 ID，可以先获取模型列表。', 'MISSING_MODEL', 400);
    return p;
  }
  return {
    resolve,
    current() {
      return state.disabled ? null : state.profiles[state.active] || null;
    },
    snapshot() {
      return {
        active: state.disabled ? null : state.active,
        profiles: Object.fromEntries(
          Object.entries(state.profiles).map(([id, p]) => [id, publicProfile(p)]),
        ),
      };
    },
    async activate(profile, test) {
      const p = { ...profile, verifiedAt: new Date().toISOString(), latencyMs: test.latencyMs };
      await persist({
        ...state,
        active: p.provider,
        disabled: false,
        profiles: { ...state.profiles, [p.provider]: p },
      });
      return publicProfile(p);
    },
    async disable() {
      await persist({ ...state, active: null, disabled: true });
    },
    async forget(id) {
      if (!providers.some((p) => p.id === id))
        throw new AIError('服务不存在。', 'INVALID_SETTINGS', 400);
      const profiles = { ...state.profiles };
      delete profiles[id];
      await persist({
        ...state,
        profiles,
        active: state.active === id ? null : state.active,
        disabled: state.active === id ? true : state.disabled,
      });
    },
  };
}
