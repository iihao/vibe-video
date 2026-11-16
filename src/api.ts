import type { Config, GenerationUpdate, Project } from './types';
import { projectSchema } from '../server/schema.mjs';
export async function generateProject(
  config: Config,
  signal: AbortSignal,
  onProgress: (update: GenerationUpdate) => void,
): Promise<Project> {
  const res = await fetch('/api/generate/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `请求失败 (${res.status})` }));
    throw Error(data.error || '生成失败');
  }
  if (!res.body) throw Error('浏览器无法读取生成进度，请更新浏览器。');
  const reader = res.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    result: Project | null = null;
  const accept = (block: string) => {
    const lines = block.split('\n'),
      event = lines
        .find((l) => l.startsWith('event:'))
        ?.slice(6)
        .trim();
    const raw = lines
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (event === 'error') throw Error(data.error || '模型生成失败');
    if (event === 'progress') onProgress(data as GenerationUpdate);
    if (event === 'result') result = projectSchema.parse(data) as Project;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        accept(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) accept(buffer);
    if (!result) throw Error('生成连接提前中断，请重试。');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
