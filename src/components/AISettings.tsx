import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleCheck,
  Eye,
  EyeOff,
  Film,
  KeyRound,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { providers } from '../../shared/providers.mjs';
import type { ServerStatus } from '../types';

type Protocol = 'chat' | 'responses' | 'anthropic';
type Draft = {
  provider: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeout: number;
  maxTokens: number;
  jsonMode: 'auto' | 'json' | 'prompt';
};
type Profile = Omit<Draft, 'apiKey'> & {
  hasApiKey: boolean;
  verifiedAt?: string;
  latencyMs?: number;
};
type Settings = { active: string | null; profiles: Record<string, Profile> };
type ConnectionTest = {
  model: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number };
};
const createDraft = (id: string, saved?: Profile): Draft => {
  const preset = providers.find((p) => p.id === id) || providers[0];
  return {
    provider: id,
    protocol: preset.protocol as Protocol,
    baseUrl: preset.baseUrl,
    model: preset.model,
    timeout: 180,
    maxTokens: 6000,
    jsonMode: 'auto',
    ...saved,
    apiKey: '',
  };
};
async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        }
      : { signal },
  );
  // 代理或崩溃页面可能返回 HTML，先容错再取错误信息。
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw Error(data?.error || `设置请求失败（${response.status}），请稍后重试或检查服务端日志。`);
  if (!data) throw Error('服务端返回了无法解析的响应，请检查服务是否正常。');
  return data as T;
}
export function AISettings({
  status,
  onConnected,
}: {
  status: ServerStatus | null;
  onConnected: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Draft>(() => createDraft('deepseek'));
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tested, setTested] = useState<ConnectionTest | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request<Settings>('/api/ai/settings', undefined, controller.signal)
      .then((s) => {
        setSettings(s);
        const selected = s.active || 'deepseek';
        setDraft(createDraft(selected, s.profiles[selected]));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => setLoading(false));
    return () => {
      controller.abort();
      abortRef.current?.abort();
    };
  }, []);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setTested(null);
    setError('');
    setNotice('');
    if (['baseUrl', 'protocol', 'apiKey'].includes(key)) setModels([]);
  };
  const selectProvider = (id: string) => {
    setDraft(createDraft(id, settings?.profiles[id]));
    setTested(null);
    setModels([]);
    setError('');
    setNotice('');
    setShowKey(false);
  };
  const act = async (action: 'models' | 'test' | 'connect' | 'disable' | 'forget') => {
    setError('');
    setNotice('');
    setPending(action);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (action === 'models') {
        const result = await request<{ models: { id: string; name: string }[] }>(
          '/api/ai/models',
          draft,
          controller.signal,
        );
        setModels(result.models);
        if (!draft.model && result.models.length === 1)
          setDraft((d) => ({ ...d, model: result.models[0].id }));
        setNotice(`找到 ${result.models.length} 个模型，可从下方列表选择，也可以手动输入 ID。`);
      } else if (action === 'test') {
        setTested(await request<ConnectionTest>('/api/ai/test', draft, controller.signal));
        setNotice('真实调用已通过。点击「测试并启用」后，创作将使用这个模型。');
      } else {
        if (action === 'connect') {
          const result = await request<{ profile: Profile; test: ConnectionTest }>(
            '/api/ai/connect',
            draft,
            controller.signal,
          );
          setDraft(createDraft(draft.provider, result.profile));
          setTested(result.test);
          setNotice('已保存并启用。关闭设置，即可输入任意主题开始创作。');
        } else {
          await request(`/api/ai/${action}`, { provider: draft.provider }, controller.signal);
          if (action === 'forget') setDraft(createDraft(draft.provider));
          setTested(null);
          setNotice(
            action === 'disable'
              ? '已切换到内置示例模式，保存的配置可随时重新启用。'
              : '已移除此服务的已保存配置与密钥。',
          );
        }
        const s = await request<Settings>('/api/ai/settings', undefined, controller.signal);
        setSettings(s);
        onConnected();
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      setPending('');
    }
  };
  const preset = providers.find((p) => p.id === draft.provider)!;
  const saved = settings?.profiles[draft.provider];
  const sameEndpoint =
    saved?.baseUrl.replace(/\/+$/, '') === draft.baseUrl.trim().replace(/\/+$/, '') &&
    saved?.protocol === draft.protocol;
  const reusesKey = sameEndpoint && saved?.hasApiKey;
  const active =
    settings?.active === draft.provider &&
    saved?.model === draft.model &&
    sameEndpoint &&
    !draft.apiKey &&
    saved?.timeout === draft.timeout &&
    saved?.maxTokens === draft.maxTokens &&
    saved?.jsonMode === draft.jsonMode;
  if (loading)
    return (
      <div className="ai-loading">
        <LoaderCircle size={20} className="spin" /> 正在读取模型配置…
      </div>
    );
  return (
    <div className="ai-settings">
      <div className="ai-current">
        <span className="ai-current-icon">
          <PlugZap size={21} />
        </span>
        <div>
          <h3>
            {settings?.active
              ? `当前使用 ${providers.find((p) => p.id === settings.active)?.name}`
              : '未接入模型'}
          </h3>
          <p>{settings?.active ? settings.profiles[settings.active]?.model : ''}</p>
        </div>
        {settings?.active && (
          <span className={`status-pill ${status?.verified ? 'ready' : ''}`}>
            {status?.verified ? '已验证' : '待验证'}
          </span>
        )}
      </div>
      <div className="provider-grid" role="group" aria-label="选择模型服务商">
        {providers.map((p, i) => (
          <button
            key={p.id}
            disabled={Boolean(pending)}
            className={`provider-card ${draft.provider === p.id ? 'selected' : ''}`}
            onClick={() => selectProvider(p.id)}
            aria-pressed={draft.provider === p.id}
          >
            <span className={`provider-symbol provider-${p.id}`}>
              {['D', '千', 'O', '✳', '↗', '◉'][i]}
            </span>
            <span>
              <b>{p.name}</b>
            </span>
            {draft.provider === p.id && <Check size={14} />}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act('connect');
        }}
      >
        <fieldset disabled={Boolean(pending)}>
          <div className="ai-field-row">
            <label className="field-label" htmlFor="ai-base-url">
              服务地址
            </label>
            {active && (
              <span className="saved-label">
                <CircleCheck size={12} /> 当前配置
              </span>
            )}
          </div>
          <input
            id="ai-base-url"
            type="url"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="https://你的接口地址/v1"
            value={draft.baseUrl}
            onChange={(e) => update('baseUrl', e.target.value)}
          />
          <label className="field-label" htmlFor="ai-api-key">
            API Key {!preset.keyRequired && <small>可选</small>}
            {reusesKey && (
              <span className="saved-label">
                <ShieldCheck size={12} /> 已保存
              </span>
            )}
          </label>
          <div className="secret-input">
            <KeyRound size={15} />
            <input
              id="ai-api-key"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                reusesKey
                  ? '已保存 · 留空继续使用，填写可替换'
                  : preset.keyRequired
                    ? 'API Key'
                    : '可留空'
              }
              value={draft.apiKey}
              onChange={(e) => update('apiKey', e.target.value)}
            />
            <button
              className="icon-button"
              type="button"
              aria-label={showKey ? '隐藏密钥' : '显示密钥'}
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="ai-field-row model-label">
            <label className="field-label" htmlFor="ai-model">
              模型 <small>Model ID</small>
            </label>
            <button
              className="text-button"
              type="button"
              disabled={!draft.baseUrl}
              onClick={() => void act('models')}
            >
              {pending === 'models' ? (
                <LoaderCircle className="spin" size={12} />
              ) : (
                <PlugZap size={12} />
              )}{' '}
              获取模型列表
            </button>
          </div>
          <input
            id="ai-model"
            required
            autoComplete="off"
            list="ai-models"
            spellCheck={false}
            placeholder="Model ID"
            value={draft.model}
            onChange={(e) => update('model', e.target.value)}
          />
          <datalist id="ai-models">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>
          {models.length > 0 && (
            <select
              className="ai-model-select"
              aria-label="从模型列表选择"
              value={models.some((m) => m.id === draft.model) ? draft.model : ''}
              onChange={(e) => update('model', e.target.value)}
            >
              <option value="" disabled>
                从 {models.length} 个可用模型中选择…
              </option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <button
            className={`ai-advanced-toggle ${advanced ? 'open' : ''}`}
            type="button"
            onClick={() => setAdvanced(!advanced)}
          >
            <ChevronDown size={14} /> 高级设置
          </button>
          {advanced && (
            <div className="ai-advanced-grid">
              <label>
                <span className="field-label">接口协议</span>
                <select
                  aria-label="接口协议"
                  value={draft.protocol}
                  onChange={(e) => update('protocol', e.target.value as Protocol)}
                >
                  <option value="chat">Chat Completions（兼容）</option>
                  <option value="responses">OpenAI Responses</option>
                  <option value="anthropic">Anthropic Messages</option>
                </select>
              </label>
              <label>
                <span className="field-label">JSON 输出</span>
                <select
                  aria-label="JSON 输出"
                  value={draft.jsonMode}
                  onChange={(e) => update('jsonMode', e.target.value as Draft['jsonMode'])}
                >
                  <option value="auto">自动兼容（推荐）</option>
                  <option value="json" disabled={draft.protocol === 'anthropic'}>
                    强制 JSON 模式
                  </option>
                  <option value="prompt">仅提示词约束</option>
                </select>
              </label>
              <label>
                <span className="field-label">
                  响应超时 <small>秒</small>
                </span>
                <input
                  aria-label="响应超时"
                  type="number"
                  min="10"
                  max="600"
                  value={draft.timeout}
                  onChange={(e) => update('timeout', Number(e.target.value))}
                />
              </label>
              <label>
                <span className="field-label">
                  最大输出 <small>Tokens</small>
                </span>
                <input
                  aria-label="最大输出 Tokens"
                  type="number"
                  min="512"
                  max="32768"
                  step="1"
                  value={draft.maxTokens}
                  onChange={(e) => update('maxTokens', Number(e.target.value))}
                />
              </label>
            </div>
          )}
        </fieldset>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {tested && (
          <div className="ai-test-result">
            <CircleCheck size={18} />
            <div>
              <b>模型真实调用成功</b>
              <span>
                {tested.model} · {(tested.latencyMs / 1000).toFixed(2)} 秒 ·{' '}
                {tested.usage.inputTokens + tested.usage.outputTokens > 0
                  ? `${tested.usage.inputTokens + tested.usage.outputTokens} Tokens`
                  : '用量未返回'}
              </span>
            </div>
          </div>
        )}
        {notice && (
          <p className="ai-notice" role="status">
            {notice}
          </p>
        )}
        <div className="ai-actions">
          <button
            type="button"
            className="outline-button"
            disabled={Boolean(pending) || !draft.model || !draft.baseUrl}
            onClick={() => void act('test')}
          >
            {pending === 'test' ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <PlugZap size={15} />
            )}{' '}
            仅测试连接
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={Boolean(pending) || !draft.model || !draft.baseUrl}
          >
            {pending === 'connect' ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{' '}
            {pending === 'connect' ? '正在测试并保存…' : '测试并启用'}
          </button>
        </div>
        {pending && (
          <button
            type="button"
            className="text-button ai-stop"
            onClick={() => {
              abortRef.current?.abort();
            }}
          >
            <X size={12} /> 取消请求
          </button>
        )}
      </form>
      <div className="ai-settings-footer">
        <span>
          <Film size={14} /> 视频导出{' '}
          {status?.ffmpeg && status?.browser ? '已就绪' : '需要 Chrome / FFmpeg'}
        </span>
        <div>
          {settings?.active && (
            <button
              className="text-button"
              disabled={Boolean(pending)}
              onClick={() => void act('disable')}
            >
              <Unplug size={12} /> 停用模型
            </button>
          )}
          {saved && (
            <button
              className="text-button danger"
              disabled={Boolean(pending)}
              onClick={() => void act('forget')}
            >
              <Trash2 size={12} /> 清除此配置
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
