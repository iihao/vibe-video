import { z } from 'zod';
export const configSchema = z.object({
  topic: z.string().trim().min(2).max(300),
  style: z.enum(['cosmos', 'blueprint', 'editorial', 'minimal', 'pixel', 'claude']),
  duration: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]),
  aspect: z.enum(['16:9', '9:16', '1:1']),
  music: z.string().max(100),
  sfxStyle: z.enum(['cinematic', 'digital', 'pixel', 'soft', 'impact', 'off']).default('cinematic'),
  references: z.string().max(6000).default(''),
});
export const VISUALS = [
  'blackhole',
  'orbits',
  'grid',
  'particles',
  'bars',
  'nebula',
  'candles',
  'pie',
  'compare',
  'equation',
  'dna',
  'atom',
  'gears',
  'clock',
  'waveform',
  'rays',
  'pyramid',
  'network',
  'pipeline',
  'path',
  'balance',
  'map',
];
const artSchema = z
  .object({
    kind: z.string().max(40).optional(),
    text: z.string().max(400).optional(),
    left: z.number().optional(),
    right: z.number().optional(),
    data: z
      .array(
        z.union([
          z.number(),
          z.string().max(120),
          z.object({ label: z.string().max(120), value: z.number() }),
        ]),
      )
      .max(40)
      .optional(),
  })
  .optional();
/* 配音逐字时间戳：来自 TTS 服务，用于字幕逐字高亮对齐。 */
const voiceWordSchema = z.object({
  text: z.string().max(20),
  beginMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
});
const voiceSchema = z
  .object({
    voice: z.string().max(60).optional(),
    words: z.array(voiceWordSchema).max(400),
    durationMs: z.number().nonnegative().optional(),
    /** >1 表示为了塞进分镜做了节奏加速（ffmpeg atempo），逐字时间戳已按同一比例缩放。 */
    tempo: z.number().min(1).max(2).optional(),
  })
  .optional();

export const sceneSchema = z.object({
  id: z.string().max(80),
  title: z.string().min(1).max(80),
  subtitle: z.string().max(240),
  visual: z.enum(VISUALS),
  art: artSchema,
  note: z.string().max(600),
  label: z.string().max(60),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  voice: voiceSchema,
});
export const storySchema = z.object({
  title: z.string().min(1).max(80),
  scenes: z.array(sceneSchema).min(3).max(40),
  sources: z
    .array(
      z.object({
        title: z.string().max(200),
        url: z
          .string()
          .url()
          .max(2000)
          .refine((v) => /^https?:\/\//.test(v)),
        status: z.string().max(40),
      }),
    )
    .max(12),
  caption: z.string().max(3000),
});
export const projectSchema = configSchema
  .extend({
    // 项目 id 会参与服务端配音文件命名，只允许安全字符，避免路径穿越。
    id: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/, '项目 ID 只能包含字母、数字、下划线和连字符'),
    title: storySchema.shape.title,
    scenes: storySchema.shape.scenes,
    sources: storySchema.shape.sources,
    caption: storySchema.shape.caption,
    mode: z.string().max(30),
    createdAt: z.string().max(80),
    generation: z
      .object({
        provider: z.string().max(50),
        model: z.string().max(200),
        usage: z
          .object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative() })
          .optional(),
        repaired: z.boolean().optional(),
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    let last = 0;
    p.scenes.forEach((s, i) => {
      if (Math.abs(s.start - last) > 0.01 || s.end <= s.start || s.end > p.duration + 0.01)
        ctx.addIssue({ code: 'custom', message: `分镜 ${i + 1} 时间必须连续且在总时长内` });
      last = s.end;
    });
    if (Math.abs(last - p.duration) > 0.01)
      ctx.addIssue({ code: 'custom', message: '分镜必须覆盖完整视频时长' });
  });
