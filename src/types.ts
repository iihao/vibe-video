export type Visual =
  | 'blackhole'
  | 'orbits'
  | 'grid'
  | 'particles'
  | 'bars'
  | 'nebula'
  | 'candles'
  | 'pie'
  | 'compare'
  | 'equation'
  | 'dna'
  | 'atom'
  | 'gears'
  | 'clock'
  | 'waveform'
  | 'rays'
  | 'pyramid'
  | 'network'
  | 'pipeline'
  | 'path'
  | 'balance'
  | 'map';
export type StyleId = 'cosmos' | 'blueprint' | 'editorial' | 'minimal' | 'pixel' | 'claude';
export interface SceneArt {
  kind?: string;
  text?: string;
  left?: number;
  right?: number;
  data?: (number | string | { label: string; value: number })[];
}
export interface Config {
  topic: string;
  style: StyleId;
  duration: number;
  aspect: string;
  music: string;
  sfxStyle: 'cinematic' | 'digital' | 'pixel' | 'soft' | 'impact' | 'off';
  references: string;
}
export interface VoiceWord {
  text: string;
  beginMs: number;
  endMs: number;
}
export interface SceneVoice {
  voice?: string;
  words: VoiceWord[];
  durationMs?: number;
}
export interface Scene {
  id: string;
  title: string;
  subtitle: string;
  visual: Visual;
  art?: SceneArt;
  note: string;
  label: string;
  start: number;
  end: number;
  voice?: SceneVoice;
}
export interface Source {
  title: string;
  url: string;
  status: string;
}
export interface Project extends Config {
  id: string;
  title: string;
  scenes: Scene[];
  sources: Source[];
  caption: string;
  mode: string;
  createdAt: string;
  generation?: {
    provider: string;
    model: string;
    usage?: { inputTokens: number; outputTokens: number };
    repaired?: boolean;
  };
}
export interface ExportJob {
  id: string;
  status: 'queued' | 'rendering' | 'encoding' | 'complete' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  url?: string;
  error?: string;
  projectId: string;
  projectTitle: string;
  fps: number;
  duration: number;
  framesDone: number;
  totalFrames: number;
  sceneCount: number;
  sceneIndex?: number;
  sceneTitle?: string;
  videoTime?: number;
  width?: number;
  height?: number;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  finishedAt?: number;
  previewUrl?: string;
}
export type GenerationStage = 'connecting' | 'writing' | 'validating' | 'repairing' | 'ready';
export interface GenerationUpdate {
  stage: GenerationStage;
  message: string;
  model?: string;
  chars?: number;
  scenes?: Scene[];
}
export interface GenerationRun {
  config: Config;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  stage: GenerationStage;
  message: string;
  model: string;
  chars: number;
  scenes: Scene[];
  startedAt: number;
  finishedAt?: number;
  projectId?: string;
  mode?: string;
  events: { message: string; stage: GenerationStage; at: number }[];
}
export interface ServerStatus {
  ai: boolean;
  configured?: boolean;
  verified?: boolean;
  provider?: string;
  model: string;
  ffmpeg: boolean;
  browser: boolean;
}
