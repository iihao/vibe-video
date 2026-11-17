import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Clock3,
  Command,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Film,
  FolderOpen,
  Grid2X2,
  Image,
  Layers3,
  LoaderCircle,
  Maximize2,
  Monitor,
  Music2,
  Moon,
  Sun,
  Orbit,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Shapes,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
} from 'lucide-react';
import { defaultConfig, makeDemo, references, styles } from '../shared/catalog.mjs';
import { drawFrame } from '../shared/renderer.mjs';
import { registerNebula } from '../shared/nebula-webgl.mjs';
import { sfxClips, sfxStyles } from '../shared/sfx.mjs';
import { projectSchema } from '../server/schema.mjs';
import { AISettings } from './components/AISettings';
import { GenerationProcess, RenderProcess } from './components/GenerationProcess';
import { generateProject } from './api';
import { useTheme } from './theme';
import { usePreviewAudio } from './usePreviewAudio';
import type {
  Config,
  ExportJob,
  GenerationRun,
  Project,
  Scene,
  ServerStatus,
  StyleId,
} from './types';

// 星云视觉的 WebGL 艺术层在应用启动时就注册，首帧即可生效。
registerNebula();

type Page = 'create' | 'projects' | 'templates' | 'explore' | 'assets';
type Modal = 'export' | 'settings' | 'help' | 'command' | null;
type Asset = { id: string; name: string; size: number };
/** 快捷键提示随平台切换，避免 Windows / Linux 上显示不可用的 ⌘。 */
const keyHint =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
    ? '⌘ K'
    : 'Ctrl K';
const read = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};
function initialProject(): Project {
  const stored = read('vibe-current', null);
  const result = projectSchema.safeParse(stored);
  return result.success ? (result.data as Project) : (makeDemo() as Project);
}
const fmt = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
/** 按比例重排分镜时间轴，保证仍满足 schema：连续、递增、正好铺满总时长。 */
function retimeProject(p: Project, duration: number): Project {
  if (p.duration === duration || !p.scenes.length) return { ...p, duration };
  const total = p.scenes.reduce((sum, s) => sum + Math.max(0.001, s.end - s.start), 0) || 1;
  const scale = duration / total;
  let cursor = 0;
  const scenes = p.scenes.map((s, i) => {
    const start = cursor;
    const length = Math.max(0.001, s.end - s.start) * scale;
    cursor = i === p.scenes.length - 1 ? duration : Math.min(duration, start + length);
    return { ...s, start, end: Math.max(start + 0.001, cursor) };
  });
  scenes[scenes.length - 1].end = duration;
  return { ...p, duration, scenes };
}
function download(name: string, data: Blob | string, type = 'application/json') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `请求失败 (${res.status})` }));
    throw Error(data.error || '请求失败');
  }
  return res.json();
}
const post = (data: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`}>
      <svg viewBox="0 0 36 36" fill="none">
        <path
          d="m6 11 8 17 6-14 4 9 6-12"
          stroke="currentColor"
          strokeWidth="2.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
function StyleIcon({ id, size = 16 }: { id: string; size?: number }) {
  return id === 'cosmos' ? (
    <Orbit size={size} />
  ) : id === 'blueprint' ? (
    <Grid2X2 size={size} />
  ) : id === 'editorial' ? (
    <BookOpen size={size} />
  ) : id === 'pixel' ? (
    <Grid2X2 size={size} />
  ) : id === 'claude' ? (
    <BookOpen size={size} />
  ) : (
    <Shapes size={size} />
  );
}
const styleVisual = (id: string) =>
  ({
    cosmos: 'blackhole',
    blueprint: 'grid',
    editorial: 'orbits',
    minimal: 'particles',
    pixel: 'particles',
    claude: 'orbits',
  })[id] || 'blackhole';
/** 缩略图的固有像素尺寸跟随画面比例，否则竖屏项目会被压成横屏构图。 */
const thumbSize = (aspect: string): [number, number] =>
  aspect === '9:16' ? [360, 640] : aspect === '1:1' ? [480, 480] : [640, 360];
function MiniCanvas({
  style = 'cosmos',
  visual = 'blackhole',
  className = '',
  project,
  aspect,
}: {
  style?: string;
  visual?: string;
  className?: string;
  project?: Project;
  aspect?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ratio = project?.aspect || aspect || '16:9';
  const [width, height] = thumbSize(ratio);
  useEffect(() => {
    if (ref.current) {
      const p = project || {
        ...makeDemo(),
        style,
        aspect: ratio,
        scenes: [{ ...makeDemo().scenes[0], visual }],
      };
      drawFrame(ref.current, p, 0, { text: false });
    }
  }, [style, visual, project, ratio]);
  return (
    <canvas ref={ref} width={width} height={height} className={className} aria-hidden="true" />
  );
}
function ModalFrame({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    ref.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const all = ref.current.querySelectorAll<HTMLElement>(
          'button,a[href],input,select,textarea,[tabindex="0"]',
        );
        const first = all[0],
          last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', listener);
      document.body.style.overflow = old;
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭对话框">
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [page, setPage] = useState<Page>('create');
  const [project, setProject] = useState<Project>(initialProject);
  const [config, setConfig] = useState<Config>(() => {
    const p = initialProject();
    return {
      topic: p.topic,
      style: p.style,
      duration: p.duration,
      aspect: p.aspect,
      music: p.music,
      sfxStyle: p.sfxStyle,
      references: p.references,
    };
  });
  const [projects, setProjects] = useState<Project[]>(() =>
    read('vibe-projects', []).filter((p: unknown) => projectSchema.safeParse(p).success),
  );
  const [assets, setAssets] = useState<Asset[]>(() => read('vibe-assets', []));
  const [stage, setStage] = useState(0),
    [modal, setModal] = useState<Modal>(() =>
      new URLSearchParams(location.search).has('settings') ? 'settings' : null,
    );
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  /** 可撤销提示：只用于会真正丢数据的操作（移除项目）。 */
  const [undoAction, setUndoAction] = useState<(() => void) | null>(null);
  const [generationRun, setGenerationRun] = useState<GenerationRun | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState('');
  const generationAbort = useRef<AbortController | null>(null);
  const rewriteAbort = useRef<AbortController | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const [status, setStatus] = useState<ServerStatus | null>(null),
    [selectedScene, setSelectedScene] = useState(0);
  const [quality, setQuality] = useState('720p'),
    [fps, setFps] = useState(30),
    [teaser, setTeaser] = useState(false);
  const [job, setJob] = useState<ExportJob | null>(null),
    [uploading, setUploading] = useState(false);
  const [ttsVoices, setTtsVoices] = useState<{ id: string; name: string }[]>([]),
    [ttsVoice, setTtsVoice] = useState('longanyang'),
    [generatingVoice, setGeneratingVoice] = useState(false);
  const ttsAbort = useRef<AbortController | null>(null);
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('全部'),
    [command, setCommand] = useState('');
  const [refOpen, setRefOpen] = useState(false),
    [saveState, setSaveState] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null),
    fileRef = useRef<HTMLInputElement>(null),
    importRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null),
    timeRef = useRef(time);
  timeRef.current = time;
  const notify = useCallback((message: string) => {
    setUndoAction(null);
    setToast(message);
  }, []);
  const audioWaitingRef = usePreviewAudio(project, playing, muted, audioRef, timeRef, notify);
  const closeModal = useCallback(() => setModal(null), []);
  const refreshStatus = useCallback(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);
  useEffect(() => {
    fetch('/api/tts/voices')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.voices) && d.voices.length) setTtsVoices(d.voices);
      })
      .catch(() => {});
  }, []);
  useEffect(
    () => () => {
      generationAbort.current?.abort();
      rewriteAbort.current?.abort();
      ttsAbort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    try {
      localStorage.setItem('vibe-current', JSON.stringify(project));
    } catch {
      notify('浏览器存储空间不足，请导出项目 JSON 备份。');
    }
  }, [project, notify]);
  useEffect(() => {
    try {
      localStorage.setItem('vibe-projects', JSON.stringify(projects));
    } catch {
      notify('项目保存失败：浏览器存储空间不足。');
    }
  }, [projects, notify]);
  useEffect(() => {
    try {
      localStorage.setItem('vibe-assets', JSON.stringify(assets));
    } catch {
      notify('素材记录保存失败。');
    }
  }, [assets, notify]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(
      () => {
        setToast('');
        setUndoAction(null);
      },
      undoAction ? 6000 : 3600,
    );
    return () => clearTimeout(id);
  }, [toast, undoAction]);
  useEffect(() => {
    if (!playing) return;
    let id = 0,
      last = 0;
    const tick = (now: number) => {
      if (last) {
        if (audioWaitingRef.current) {
          last = now;
          id = requestAnimationFrame(tick);
          return;
        }
        const audio = audioRef.current;
        const next =
          audio && !audio.paused && !muted
            ? audio.currentTime
            : audio?.ended && !muted
              ? project.duration
              : timeRef.current + (now - last) / 1000;
        if (next >= project.duration) {
          setTime(project.duration);
          setPlaying(false);
          return;
        }
        setTime(next);
      }
      last = now;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, muted, project.duration, audioWaitingRef]);
  useEffect(() => {
    if (!job || !['queued', 'rendering', 'encoding'].includes(job.status)) return;
    let stopped = false;
    const id = setInterval(() => {
      api<ExportJob>(`/api/render/${job.id}`)
        .then((j) => {
          if (!stopped) setJob(j);
        })
        .catch((e) => {
          if (!stopped) setJob((j) => (j ? { ...j, status: 'failed', error: e.message } : null));
        });
    }, 800);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [job?.id, job?.status]);
  const togglePlay = useCallback(() => {
    if (timeRef.current >= project.duration) setTime(0);
    setPlaying((p) => !p);
  }, [project.duration]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setModal((m) => (m === 'command' ? null : 'command'));
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || modal) return;
      if (e.code === 'Space' && page === 'create') {
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal, page, togglePlay]);
  const seek = (t: number) => {
    setTime(t);
    if (audioRef.current && playing) audioRef.current.currentTime = t;
  };
  const changeConfig = <K extends keyof Config>(key: K, value: Config[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
    if (['style', 'aspect', 'music', 'duration', 'sfxStyle'].includes(key))
      setProject((p) => {
        if (key !== 'duration') return { ...p, [key]: value };
        // 时长一改，分镜必须跟着重排：否则下拉框说 30 秒、时间轴和导出的仍是 60 秒。
        const next = retimeProject(p, Number(value));
        // 配音文件与逐字时间戳是按旧分镜时长生成的，改了时长就清掉，避免越剪越断。
        if (next.scenes.some((s) => s.voice)) {
          next.scenes = next.scenes.map((s) => ({ ...s, voice: undefined }));
          notify('时长已修改，配音已清除，请重新生成配音');
        }
        if (timeRef.current > next.duration) {
          setTime(next.duration);
          setPlaying(false);
        }
        return next;
      });
  };
  const saveProject = (p = project) => {
    const saved = { ...p, id: p.id === 'demo-gravity' ? crypto.randomUUID() : p.id };
    setProject(saved);
    setProjects((list) => [saved, ...list.filter((x) => x.id !== saved.id)].slice(0, 50));
    setSaveState(true);
    setTimeout(() => setSaveState(false), 2000);
    notify('项目已保存到「我的项目」');
  };
  const generate = async () => {
    if (generationAbort.current) return;
    setBusy(true);
    setError('');
    setPlaying(false);
    const controller = new AbortController();
    generationAbort.current = controller;
    if (!rendering) setJob(null);
    const startedAt = Date.now();
    setGenerationRun({
      config: { ...config },
      status: 'running',
      stage: 'connecting',
      message: '准备生成请求',
      model: status?.model || '内置示例',
      chars: 0,
      scenes: [],
      startedAt,
      events: [{ stage: 'connecting', message: '已提交主题与视觉风格', at: startedAt }],
    });
    try {
      const p = await generateProject(config, controller.signal, (update) => {
        if (generationAbort.current !== controller || controller.signal.aborted) return;
        setGenerationRun((run) => {
          if (!run) return run;
          const stage = update.stage || run.stage;
          const message = stage === 'writing' ? '模型开始返回分镜' : update.message;
          const scenes = update.scenes ?? run.scenes;
          const events = [...run.events];
          if (stage !== run.stage) events.push({ stage, message, at: Date.now() });
          if (scenes.length > run.scenes.length)
            events.push({ stage, message: `已接收 ${scenes.length} 幕分镜草稿`, at: Date.now() });
          return { ...run, ...update, stage, scenes, events: events.slice(-24) };
        });
      });
      if (controller.signal.aborted) return;
      setGenerationRun((run) =>
        run
          ? {
              ...run,
              status: 'complete',
              stage: 'ready',
              scenes: p.scenes,
              message:
                p.mode === 'demo' ? '内置示例已载入，可编辑预览' : '分镜校验通过，动画预览已就绪',
              projectId: p.id,
              mode: p.mode,
              finishedAt: Date.now(),
              events: [
                ...run.events,
                {
                  stage: 'ready',
                  message: `${p.scenes.length} 幕分镜已编排，覆盖 ${p.duration} 秒`,
                  at: Date.now(),
                },
              ],
            }
          : run,
      );
      setProject(p);
      setTime(0);
      setStage(1);
      setSelectedScene(0);
      setProjects((list) => [p, ...list.filter((x) => x.id !== p.id)].slice(0, 50));
      notify(
        p.mode === 'demo' ? '示例分镜已就绪，可以开始编辑' : '脚本和分镜已生成，请核对事实与来源',
      );
    } catch (e) {
      if (generationAbort.current !== controller) return;
      const cancelled = controller.signal.aborted;
      const message = cancelled ? '生成已取消，原项目已保留' : (e as Error).message;
      setGenerationRun((run) =>
        run
          ? {
              ...run,
              status: cancelled ? 'cancelled' : 'failed',
              message,
              finishedAt: Date.now(),
              events: [...run.events, { stage: run.stage, message, at: Date.now() }],
            }
          : run,
      );
      if (controller.signal.aborted) notify('已取消生成，当前草稿已保留');
      else setError((e as Error).message);
    } finally {
      if (generationAbort.current === controller) {
        setBusy(false);
        generationAbort.current = null;
      }
    }
  };
  const newProject = () => {
    generationAbort.current?.abort();
    generationAbort.current = null;
    setBusy(false);
    setGenerationRun(null);
    rewriteAbort.current?.abort();
    setRewriteError('');
    setRewriteInstruction('');
    const p = makeDemo() as Project;
    if (!rendering) setJob(null);
    setTeaser(false);
    setProject(p);
    setConfig({ ...defaultConfig } as Config);
    setTime(0);
    setPlaying(false);
    setStage(0);
    setPage('create');
    setError('');
  };
  const openProject = (p: Project) => {
    generationAbort.current?.abort();
    generationAbort.current = null;
    setBusy(false);
    setGenerationRun(null);
    rewriteAbort.current?.abort();
    setRewriteError('');
    setRewriteInstruction('');
    if (!rendering) setJob(null);
    setTeaser(false);
    setProject(p);
    setConfig({
      topic: p.topic,
      style: p.style,
      duration: p.duration,
      aspect: p.aspect,
      music: p.music,
      sfxStyle: p.sfxStyle,
      references: p.references,
    });
    setTime(0);
    setPlaying(false);
    setSelectedScene(0);
    setStage(1);
    setPage('create');
  };
  /** 移除后 toast 里给一次撤销机会，避免误点一次就永久丢掉项目。 */
  const removeProject = (p: Project) => {
    const index = projects.findIndex((x) => x.id === p.id);
    setProjects((list) => list.filter((x) => x.id !== p.id));
    setToast('项目已移出列表，当前编辑内容仍保留');
    setUndoAction(() => () => {
      setProjects((list) => {
        if (list.some((x) => x.id === p.id)) return list;
        const next = [...list];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, p);
        return next;
      });
      setUndoAction(null);
      setToast('项目已恢复');
    });
  };
  const updateScene = (key: keyof Scene, value: string) => {
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, i) => {
        if (i !== selectedScene) return s;
        const next = { ...s, [key]: value };
        // 文案改了，旧配音和逐字时间戳就失效了；清掉比默默声画不同步好。
        if ((key === 'title' || key === 'subtitle') && s.voice) {
          next.voice = undefined;
          notify('文案已修改，配音已清除，请重新生成配音');
        }
        return next;
      }),
    }));
  };
  const rewriteScene = async () => {
    const original = project.scenes[selectedScene],
      snapshot = project.id;
    if (!status?.configured) {
      setModal('settings');
      return;
    }
    setRewriting(true);
    setRewriteError('');
    const controller = new AbortController();
    rewriteAbort.current = controller;
    try {
      const result = await api<{ scene: Scene; model: string }>('/api/ai/rewrite-scene', {
        ...post({ project, sceneId: original.id, instruction: rewriteInstruction }),
        signal: controller.signal,
      });
      if (
        projectRef.current.id !== snapshot ||
        JSON.stringify(projectRef.current.scenes.find((s) => s.id === original.id)) !==
          JSON.stringify(original)
      ) {
        notify('这幕已发生修改，请重新发起重写。');
        return;
      }
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((s) => (s.id === original.id ? result.scene : s)),
      }));
      notify(`这一幕已由 ${result.model} 重写`);
    } catch (e) {
      if (!controller.signal.aborted) setRewriteError((e as Error).message);
    } finally {
      setRewriting(false);
      rewriteAbort.current = null;
    }
  };
  /** 生成全片 AI 配音：逐分镜调用 TTS，把逐字时间戳写回 project.scenes[].voice */
  const generateVoice = async () => {
    if (!status?.configured) {
      setModal('settings');
      return;
    }
    const controller = new AbortController();
    ttsAbort.current = controller;
    setGeneratingVoice(true);
    try {
      const result = await api<{
        scenes: Scene[];
        voice: string;
        model: string;
        warnings?: {
          title: string;
          neededMs: number;
          sceneMs: number;
          tempo: number;
          truncated: boolean;
        }[];
      }>('/api/tts/generate', {
        ...post({ project, voice: ttsVoice }),
        signal: controller.signal,
      });
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((s) => {
          const updated = result.scenes.find((r) => r.id === s.id);
          return updated ? { ...s, voice: updated.voice } : s;
        }),
      }));
      const warnings = result.warnings || [];
      const truncated = warnings.filter((w) => w.truncated);
      if (truncated.length)
        notify(
          `配音已生成，但 ${truncated.length} 幕在加速后仍超出时长（${truncated
            .slice(0, 2)
            .map((w) => `「${w.title}」`)
            .join('')}），建议缩短文案或加长视频`,
        );
      else if (warnings.length)
        notify(`配音已生成，${warnings.length} 幕文案较长，已自动加速以贴合分镜`);
      else notify(`配音已生成（${result.model} · ${result.voice}），字幕将逐字跟随`);
    } catch (e) {
      if (!controller.signal.aborted) notify((e as Error).message);
      else notify('已取消配音生成');
    } finally {
      if (ttsAbort.current === controller) ttsAbort.current = null;
      setGeneratingVoice(false);
    }
  };
  const clearVoice = () => {
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s) => ({ ...s, voice: undefined })),
    }));
    notify('已移除配音，视频将使用背景音乐与音效');
  };
  const uploadFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const data = new FormData();
      data.append('file', file);
      const a = await api<Asset>('/api/assets', { method: 'POST', body: data });
      setAssets((prev) => [a, ...prev]);
      changeConfig('music', `upload:${a.id}`);
      notify('背景音乐已上传并应用');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const exportVideo = async () => {
    setError('');
    try {
      const j = await api<ExportJob>('/api/render', post({ project, quality, fps, teaser }));
      setJob(j);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const exportHTML = async () => {
    try {
      const res = await fetch('/api/export/html', post(project));
      if (!res.ok) {
        // 服务端异常时可能不是 JSON，直接 .json() 会把解析错误当成用户可见提示。
        const data = await res.json().catch(() => null);
        throw Error(data?.error || `导出失败（${res.status}）`);
      }
      download(`${project.title}.html`, await res.blob());
      notify('动画 HTML 已下载，可离线打开');
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const exportSrt = () => {
    const stamp = (sec: number) => {
      const ms = Math.round(sec * 1000);
      return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
    };
    // 标题与解释是多行输入框，里面可能带换行；SRT 用空行分隔字幕块，
    // 直接照抄会让一条字幕断成两条无效字幕，这里先压成单行。
    const oneLine = (text: string) => (text || '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
    download(
      `${oneLine(project.title)}.srt`,
      project.scenes
        .map(
          (s, i) =>
            `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${oneLine(s.title)}\n${oneLine(s.subtitle)}\n`,
        )
        .join('\n'),
      'text/plain;charset=utf-8',
    );
  };
  const exportKeyframes = () => {
    const portrait = project.aspect === '9:16',
      square = project.aspect === '1:1';
    const cw = portrait ? 360 : square ? 480 : 640,
      ch = portrait ? 640 : square ? 480 : 360,
      gap = 16,
      labelHeight = 34;
    const sheet = document.createElement('canvas');
    sheet.width = cw * 3 + gap * 4;
    sheet.height = (ch + labelHeight) * 3 + gap * 4;
    const ctx = sheet.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#151618';
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    const frame = document.createElement('canvas');
    frame.width = cw;
    frame.height = ch;
    for (let i = 0; i < 9; i++) {
      const t = Math.min(project.duration - 0.001, (project.duration * i) / 8),
        x = gap + (i % 3) * (cw + gap),
        y = gap + Math.floor(i / 3) * (ch + labelHeight + gap);
      drawFrame(frame, project, t);
      ctx.drawImage(frame, x, y);
      ctx.fillStyle = '#b8afa2';
      ctx.font = '12px monospace';
      ctx.fillText(`${String(i + 1).padStart(2, '0')} / ${fmt(t)}`, x + 8, y + ch + 22);
    }
    sheet.toBlob((blob) => {
      if (blob) {
        download(`${project.title}_关键帧.png`, blob);
        notify('九宫格关键帧已下载');
      } else notify('关键帧导出失败，请重试');
    }, 'image/png');
  };
  const importProject = async (file?: File) => {
    if (!file) return;
    try {
      const result = projectSchema.safeParse(JSON.parse(await file.text()));
      if (!result.success)
        throw Error('项目格式或分镜时间无效，请导入由 Vibe Studio 导出的 JSON。');
      openProject({ ...result.data, id: crypto.randomUUID() } as Project);
      notify('项目已导入');
    } catch (e) {
      notify((e as Error).message);
    }
    if (importRef.current) importRef.current.value = '';
  };
  const sceneIndex = Math.max(
    0,
    project.scenes.findIndex((s) => time >= s.start && time < s.end),
  );
  const scene = project.scenes[selectedScene] || project.scenes[0];
  const voiceCount = project.scenes.filter((s) => s.voice?.words?.length).length;
  const voiceReady = Boolean(status?.configured && status.tts);
  const pageNames = {
    create: '创作工作台',
    projects: '我的项目',
    templates: '风格模板',
    explore: '灵感广场',
    assets: '素材库',
  };
  const rendering = !!job && ['queued', 'rendering', 'encoding'].includes(job.status);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('create')} aria-label="Vibe Studio 首页">
          <Mark />
          <span>
            vibe<span className="brand-light"> studio</span>
            <span className="brand-dot">.</span>
          </span>
        </button>
        <button className="new-project" onClick={newProject} aria-label="新建视频">
          <Plus size={17} />
          <span>新建视频</span>
          <span className="key-hint">{keyHint}</span>
        </button>
        <div className="nav-caption">工作空间</div>
        <nav>
          {(
            [
              { id: 'create', label: '创作工作台', icon: WandSparkles },
              { id: 'projects', label: '我的项目', icon: FolderOpen },
              { id: 'templates', label: '风格模板', icon: Layers3 },
              { id: 'assets', label: '素材库', icon: Image },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.id === 'projects' && projects.length > 0 && (
                <span className="nav-count">{projects.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-caption second">发现</div>
        <button
          aria-label="灵感广场"
          className={`nav-item ${page === 'explore' ? 'active' : ''}`}
          onClick={() => setPage('explore')}
        >
          <Orbit size={17} />
          <span>灵感广场</span>
          <span className="tiny-badge">精选</span>
        </button>
        <button className="nav-item" aria-label="创作指南" onClick={() => setModal('help')}>
          <BookOpen size={17} />
          <span>创作指南</span>
          <ArrowUpRight size={13} className="muted" />
        </button>
        <div className="sidebar-bottom">
          <button
            className="nav-item settings-nav"
            aria-label="设置与接入"
            onClick={() => setModal('settings')}
          >
            <Settings2 size={17} />
            <span>设置与接入</span>
          </button>
          <div className="profile">
            <span className="avatar">H</span>
            <div>
              <b>我的工作空间</b>
            </div>
            <button
              className="icon-button"
              onClick={() => setModal('settings')}
              aria-label="工作空间设置"
            >
              <ChevronDown size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空间</span>
            <ChevronRight size={12} />
            <b>{pageNames[page]}</b>
          </div>
          <div className="top-actions">
            <button className="search-shortcut" onClick={() => setModal('command')}>
              <Search size={14} />
              <span>搜索灵感</span>
              <kbd>{keyHint}</kbd>
            </button>
            <span className="top-separator" />
            <button className="environment" onClick={() => setModal('settings')}>
              <i className={status?.ai ? 'online' : ''} />
              {status?.verified ? '模型已验证' : status?.configured ? '模型待验证' : '接入大模型'}
              <ChevronDown size={12} />
            </button>
            <button
              className="icon-button help-button"
              onClick={() => setModal('help')}
              aria-label="帮助"
            >
              <CircleHelp size={18} />
            </button>
            <button
              className="icon-button theme-toggle"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              aria-label={theme === 'light' ? '切换到深色模式' : '切换到亮色模式'}
              title={theme === 'light' ? '深色模式' : '亮色模式'}
            >
              {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
            </button>
          </div>
        </header>
        <main className={`main-content page-${page}`}>
          {page === 'create' ? (
            <>
              <div className="page-heading">
                <h1>视频创作</h1>
                <button className="text-button" onClick={() => setPage('explore')}>
                  <Sparkles size={14} /> 灵感广场
                </button>
              </div>
              <div className="workflow">
                <div className="steps">
                  {['主题', '分镜', '导出'].map((label, i) => (
                    <div className="step-wrap" key={label}>
                      <button
                        className={`step ${stage === i ? 'current' : stage > i ? 'done' : ''}`}
                        onClick={() => {
                          setStage(i);
                          if (i === 2) {
                            setError('');
                            setModal('export');
                          }
                        }}
                      >
                        <span className="step-number">
                          {stage > i ? <Check size={12} /> : String(i + 1).padStart(2, '0')}
                        </span>
                        <span>{label}</span>
                      </button>
                      {i < 2 && <span className="step-line" />}
                    </div>
                  ))}
                </div>
              </div>
              <GenerationProcess
                run={generationRun}
                job={job}
                onCancel={() => generationAbort.current?.abort()}
                onExport={() => {
                  setError('');
                  setModal('export');
                }}
                onSelectScene={(index) => {
                  if (generationRun?.projectId !== project.id) return;
                  setStage(1);
                  setSelectedScene(index);
                  seek(project.scenes[index].start);
                }}
              />
              <div className="studio-grid">
                <section className="panel creation-panel">
                  <div className="panel-heading">
                    <div className="panel-title">
                      <span className="panel-icon">
                        <WandSparkles size={16} />
                      </span>
                      <h2>{stage === 1 ? '编辑分镜' : '创作设置'}</h2>
                    </div>
                  </div>
                  {stage === 1 ? (
                    <div className="form-body editor-body">
                      <div className="editor-top">
                        <span className="field-label">
                          分镜编辑{' '}
                          <small>
                            {selectedScene + 1} / {project.scenes.length}
                          </small>
                        </span>
                        <button className="text-button" onClick={() => setStage(0)}>
                          <ArrowLeft size={12} /> 返回主题
                        </button>
                      </div>
                      <div className="scene-tabs">
                        {project.scenes.map((s, i) => (
                          <button
                            key={s.id}
                            className={selectedScene === i ? 'selected' : ''}
                            onClick={() => {
                              setSelectedScene(i);
                              seek(s.start);
                            }}
                          >
                            {String(i + 1).padStart(2, '0')}
                          </button>
                        ))}
                      </div>
                      <label className="field-label" htmlFor="scene-title">
                        画面主标题
                      </label>
                      <textarea
                        id="scene-title"
                        className="scene-title-input"
                        maxLength={80}
                        value={scene.title}
                        onChange={(e) => updateScene('title', e.target.value)}
                      />
                      <label className="field-label" htmlFor="scene-subtitle">
                        解释文案
                      </label>
                      <textarea
                        id="scene-subtitle"
                        className="sub-input"
                        maxLength={240}
                        value={scene.subtitle}
                        onChange={(e) => updateScene('subtitle', e.target.value)}
                      />
                      <label className="field-label" htmlFor="scene-visual">
                        画面元素
                      </label>
                      <select
                        id="scene-visual"
                        value={scene.visual}
                        onChange={(e) => updateScene('visual', e.target.value)}
                      >
                        <option value="blackhole">引力黑洞</option>
                        <option value="orbits">行星轨道</option>
                        <option value="grid">时空网格</option>
                        <option value="particles">流动粒子</option>
                        <option value="bars">对比柱图（概念示意）</option>
                        <option value="nebula">星云星域 · 3D 实验</option>
                        <option value="candles">K线走势 · 数据</option>
                        <option value="pie">饼图占比 · 比例</option>
                        <option value="compare">横向对比柱图 · 数据</option>
                        <option value="equation">公式方程 · 推导</option>
                        <option value="dna">DNA 双螺旋 · 生物</option>
                        <option value="atom">原子轨道 · 化学物理</option>
                        <option value="gears">齿轮机构 · 机械</option>
                        <option value="clock">时钟走时 · 时间</option>
                        <option value="waveform">声波扩散 · 声音</option>
                        <option value="rays">光线放射 · 光学</option>
                        <option value="pyramid">层级金字塔 · 结构</option>
                        <option value="network">神经网络 · 连接</option>
                        <option value="pipeline">流水线 · 流程</option>
                        <option value="path">路径轨迹 · 地理</option>
                        <option value="balance">天平称量 · 权衡</option>
                        <option value="map">地图定位 · 地理</option>
                      </select>
                      <label className="field-label" htmlFor="scene-note">
                        导演笔记
                      </label>
                      <textarea
                        id="scene-note"
                        className="note-input"
                        value={scene.note}
                        maxLength={600}
                        onChange={(e) => updateScene('note', e.target.value)}
                      />
                      <div className="ai-rewrite-box">
                        <div className="ai-rewrite-heading">
                          <span>
                            <Sparkles size={14} /> AI 改写
                          </span>
                          <small>{status?.configured ? status.model : '连接模型后使用'}</small>
                        </div>
                        <textarea
                          aria-label="分镜修改要求"
                          placeholder="比如：用生活中的例子解释，语言更通俗…"
                          maxLength={1000}
                          value={rewriteInstruction}
                          onChange={(e) => setRewriteInstruction(e.target.value)}
                          disabled={rewriting}
                        />
                        <div className="ai-rewrite-actions">
                          <button
                            className="outline-button"
                            disabled={rewriting}
                            onClick={() => void rewriteScene()}
                          >
                            {rewriting ? (
                              <LoaderCircle className="spin" size={13} />
                            ) : (
                              <WandSparkles size={13} />
                            )}{' '}
                            {status?.configured ? 'AI 重写这一幕' : '接入模型'}
                          </button>
                          {rewriting && (
                            <button
                              className="text-button"
                              onClick={() => rewriteAbort.current?.abort()}
                            >
                              取消
                            </button>
                          )}
                        </div>
                        {rewriteError && (
                          <div className="error-message" role="alert">
                            {rewriteError}
                          </div>
                        )}
                      </div>
                      <div className="ai-rewrite-box voice-box">
                        <div className="ai-rewrite-heading">
                          <span>
                            <Volume2 size={14} /> AI 配音
                          </span>
                          <small>{voiceReady ? '通义千问 · CosyVoice' : '需要通义千问'}</small>
                        </div>
                        <p className="voice-hint">
                          {voiceCount
                            ? `已为 ${voiceCount} / ${project.scenes.length} 幕生成旁白，逐字字幕跟随朗读。修改文案会自动清除配音。`
                            : '按标题与解释文案生成普通话旁白。较长文案会自动加速贴合分镜，仍超出时会提示。'}
                        </p>
                        <div className="voice-controls">
                          <select
                            id="tts-voice"
                            aria-label="配音音色"
                            value={ttsVoice}
                            onChange={(e) => setTtsVoice(e.target.value)}
                            disabled={generatingVoice}
                          >
                            {(ttsVoices.length
                              ? ttsVoices
                              : [
                                  { id: 'longanyang', name: '龙洋洋（女声·自然）' },
                                  { id: 'longxiaochun_v2', name: '龙晓春（女声·温柔）' },
                                  { id: 'longhuashuo_v2', name: '龙华硕（男声·沉稳）' },
                                ]
                            ).map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="outline-button"
                            onClick={() => void generateVoice()}
                            disabled={generatingVoice || !voiceReady}
                          >
                            {generatingVoice ? (
                              <LoaderCircle size={13} className="spin" />
                            ) : (
                              <Sparkles size={13} />
                            )}
                            {generatingVoice ? '配音中…' : voiceCount ? '重新生成配音' : '生成配音'}
                          </button>
                          {generatingVoice ? (
                            <button
                              className="text-button"
                              onClick={() => ttsAbort.current?.abort()}
                            >
                              取消
                            </button>
                          ) : (
                            voiceCount > 0 && (
                              <button className="text-button" onClick={clearVoice}>
                                清除配音
                              </button>
                            )
                          )}
                        </div>
                        {!voiceReady && (
                          <p className="voice-hint voice-warn">
                            配音目前只支持通义千问（DashScope
                            CosyVoice）。请切换模型，并在阿里云百炼控制台开通语音合成。
                          </p>
                        )}
                      </div>
                      <button
                        className="primary-button"
                        onClick={() => {
                          saveProject();
                          setStage(2);
                          setError('');
                          setModal('export');
                        }}
                      >
                        <CheckCheck size={16} /> 完成编辑 <ArrowRight size={16} />
                      </button>
                    </div>
                  ) : (
                    <div className="form-body">
                      <div className="label-row">
                        <label className="field-label" htmlFor="topic">
                          主题
                        </label>
                      </div>
                      <div className="topic-box">
                        <textarea
                          id="topic"
                          placeholder="比如：为什么引力，能让时间变慢？"
                          maxLength={300}
                          value={config.topic}
                          onChange={(e) => changeConfig('topic', e.target.value)}
                        />
                        <span>{config.topic.length}/300</span>
                        <Sparkles size={15} />
                      </div>
                      <div className="topic-suggestions">
                        <span>试试</span>
                        {['引力与时间', '认识熵增', '幸存者偏差'].map((text, i) => (
                          <button
                            key={text}
                            onClick={() =>
                              changeConfig(
                                'topic',
                                i === 0
                                  ? defaultConfig.topic
                                  : i === 1
                                    ? '为什么时间越长，熵总是越来越大？'
                                    : '我们看到的成功，为什么可能是一种偏差？',
                              )
                            }
                          >
                            {text}
                            <ArrowUpRight size={10} />
                          </button>
                        ))}
                      </div>
                      <div className="field-block">
                        <div className="label-row">
                          <span className="field-label">视觉风格</span>
                          <button
                            className="text-button small"
                            onClick={() => setPage('templates')}
                          >
                            全部模板 <ArrowRight size={11} />
                          </button>
                        </div>
                        <div className="style-options">
                          {styles.map((s) => (
                            <button
                              key={s.id}
                              className={`style-option ${config.style === s.id ? 'selected' : ''}`}
                              onClick={() => changeConfig('style', s.id as StyleId)}
                              aria-pressed={config.style === s.id}
                            >
                              <div className="style-art">
                                <MiniCanvas style={s.id} visual={styleVisual(s.id)} />
                                <span className="style-indicator">
                                  {config.style === s.id ? <Check size={11} /> : null}
                                </span>
                              </div>
                              <span className="style-option-label">
                                <StyleIcon id={s.id} size={12} />
                                {s.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="two-fields">
                        <div>
                          <label className="field-label" htmlFor="duration">
                            视频时长
                          </label>
                          <div className="select-wrap">
                            <Clock3 size={14} />
                            <select
                              id="duration"
                              value={config.duration}
                              onChange={(e) => changeConfig('duration', Number(e.target.value))}
                            >
                              <option value={30}>30 秒</option>
                              <option value={60}>60 秒</option>
                              <option value={90}>90 秒</option>
                              <option value={120}>120 秒</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="field-label" htmlFor="aspect">
                            画面比例
                          </label>
                          <div className="select-wrap">
                            <Monitor size={14} />
                            <select
                              id="aspect"
                              value={config.aspect}
                              onChange={(e) => changeConfig('aspect', e.target.value)}
                            >
                              <option value="16:9">16:9 · 横屏</option>
                              <option value="9:16">9:16 · 竖屏</option>
                              <option value="1:1">1:1 · 方形</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <div className="music-field">
                        <label className="field-label" htmlFor="music">
                          背景音乐
                        </label>
                        <div className="music-control">
                          <span className="music-icon">
                            <AudioLines size={17} />
                          </span>
                          <select
                            id="music"
                            value={config.music}
                            onChange={(e) => changeConfig('music', e.target.value)}
                          >
                            <option value="ambient">星际漫游 · Ambient</option>
                            <option value="pulse">思维脉冲 · Pulse</option>
                            <option value="none">无背景音乐</option>
                            {assets.map((a) => (
                              <option key={a.id} value={`upload:${a.id}`}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="icon-button"
                            title="上传自己的音乐"
                            aria-label="上传背景音乐"
                            onClick={() => fileRef.current?.click()}
                            disabled={uploading}
                          >
                            {uploading ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : (
                              <Upload size={15} />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="music-field">
                        <label className="field-label" htmlFor="sfx-style">
                          切镜音效
                        </label>
                        <div className="select-wrap">
                          <AudioLines size={14} />
                          <select
                            id="sfx-style"
                            value={config.sfxStyle}
                            onChange={(e) =>
                              changeConfig('sfxStyle', e.target.value as Config['sfxStyle'])
                            }
                          >
                            {sfxStyles.map((style) => (
                              <option key={style.id} value={style.id}>
                                {style.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <button
                        className={`reference-toggle ${refOpen ? 'open' : ''}`}
                        onClick={() => setRefOpen(!refOpen)}
                      >
                        <Plus size={14} />
                        <span>添加参考资料</span>
                        <small>可选</small>
                        <ChevronDown size={13} />
                      </button>
                      {refOpen && (
                        <textarea
                          className="reference-input"
                          aria-label="参考资料"
                          placeholder="粘贴事实要点、资料链接或你希望借鉴的叙事方式。"
                          value={config.references}
                          maxLength={6000}
                          onChange={(e) => changeConfig('references', e.target.value)}
                        />
                      )}
                      {error && (
                        <div className="error-message" role="alert">
                          {error}
                          {!status?.configured && (
                            <button onClick={() => setModal('settings')}>
                              接入大模型 <ArrowRight size={12} />
                            </button>
                          )}
                          {!status?.configured && (
                            <button
                              onClick={() => {
                                changeConfig('topic', defaultConfig.topic);
                                setError('');
                              }}
                            >
                              使用内置示例 <ArrowRight size={12} />
                            </button>
                          )}
                        </div>
                      )}
                      <button
                        className="primary-button generate-button"
                        onClick={generate}
                        disabled={busy || config.topic.trim().length < 2}
                      >
                        {busy ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <Sparkles size={17} />
                        )}
                        <span>{busy ? '模型正在创作…' : '生成脚本与分镜'}</span>
                        {!busy && <ArrowRight size={16} />}
                      </button>
                      {!busy && (
                        <div className="generation-connection">
                          <span className="connection-status">
                            {status?.configured ? status.model : '内置示例'}
                          </span>
                          <button className="text-button" onClick={() => setModal('settings')}>
                            <Settings2 size={12} />
                            {status?.configured ? '切换模型' : '接入模型'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                <section className="preview-panel">
                  <div className="preview-heading">
                    <div className="panel-title">
                      <span className="live-dot" />
                      <h2>画面预览</h2>
                      <span className="preview-tag">
                        {styles.find((s) => s.id === project.style)?.name}
                      </span>
                    </div>
                    <div className="preview-actions">
                      <button
                        className="icon-button"
                        onClick={() => {
                          seek(0);
                          setPlaying(false);
                        }}
                        title="回到开头"
                        aria-label="回到开头"
                      >
                        <RotateCcw size={15} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() =>
                          previewRef.current
                            ?.requestFullscreen()
                            .catch(() => notify('浏览器暂不支持全屏'))
                        }
                        title="全屏"
                        aria-label="全屏预览"
                      >
                        <Maximize2 size={15} />
                      </button>
                      <span />
                      <button
                        className="save-button"
                        aria-label={saveState ? '已保存' : '保存项目'}
                        onClick={() => saveProject()}
                      >
                        {saveState ? <Check size={14} /> : <Save size={14} />}
                        <span>{saveState ? '已保存' : '保存项目'}</span>
                      </button>
                    </div>
                  </div>
                  <div
                    className={`player-container aspect-${project.aspect.replace(':', '-')}`}
                    ref={previewRef}
                  >
                    <CanvasPreview project={project} time={time} />
                    <button
                      className={`canvas-play ${playing ? 'is-playing' : ''}`}
                      onClick={togglePlay}
                      aria-label={playing ? '暂停视频' : '播放视频'}
                    >
                      {playing ? (
                        <Pause size={20} fill="currentColor" />
                      ) : (
                        <Play size={21} fill="currentColor" />
                      )}
                    </button>
                  </div>
                  <div className="player-controls">
                    <button
                      className="icon-button play-control"
                      onClick={togglePlay}
                      aria-label={playing ? '暂停' : '播放'}
                    >
                      {playing ? (
                        <Pause size={16} fill="currentColor" />
                      ) : (
                        <Play size={16} fill="currentColor" />
                      )}
                    </button>
                    <span className="time-current">{fmt(time)}</span>
                    <input
                      aria-label="播放进度"
                      className="seek-bar"
                      type="range"
                      min="0"
                      max={project.duration}
                      step="0.05"
                      value={time}
                      onChange={(e) => seek(Number(e.target.value))}
                      style={
                        {
                          '--progress': `${(time / project.duration) * 100}%`,
                        } as React.CSSProperties
                      }
                    />
                    <span className="time-duration">{fmt(project.duration)}</span>
                    <button
                      className="icon-button volume-button"
                      onClick={() => setMuted(!muted)}
                      aria-label={muted ? '开启声音' : '静音'}
                    >
                      {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <span className="resolution-badge">
                      {project.aspect} <ChevronDown size={10} />
                    </span>
                  </div>
                  <div className="preview-info">
                    <div>
                      <h3>{project.title}</h3>
                      <p>
                        <span>{project.scenes.length} 个分镜</span>
                        <i />
                        <span>{project.duration} 秒</span>
                        <i />
                        <span>{project.mode === 'demo' ? '内置示例' : 'AI 分镜'}</span>
                      </p>
                    </div>
                    <button
                      className="outline-button export-trigger"
                      onClick={() => {
                        setError('');
                        setModal('export');
                      }}
                    >
                      <ArrowDownToLine size={15} /> 导出视频 <ArrowUpRight size={13} />
                    </button>
                  </div>
                  <div className="scene-strip">
                    <div className="section-mini-heading">
                      <span>
                        <Clapperboard size={13} /> 分镜速览
                      </span>
                      <button
                        className="text-button small"
                        onClick={() => {
                          setStage(1);
                          setSelectedScene(sceneIndex);
                        }}
                      >
                        编辑分镜 <ArrowRight size={12} />
                      </button>
                    </div>
                    <div className="scene-thumbnails">
                      {project.scenes.map((s, i) => (
                        <button
                          className={`scene-thumbnail ${sceneIndex === i ? 'active' : ''}`}
                          key={s.id}
                          onClick={() => {
                            seek(s.start);
                            setSelectedScene(i);
                          }}
                        >
                          <div>
                            <MiniCanvas
                              style={project.style}
                              visual={s.visual}
                              aspect={project.aspect}
                            />
                            <span className="scene-number">{String(i + 1).padStart(2, '0')}</span>
                            <span className="scene-time">{Math.round(s.end - s.start)}s</span>
                            <span className="scene-mini-title">{s.title}</span>
                          </div>
                          <p>{s.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </>
          ) : null}

          {page === 'projects' && (
            <>
              <PageTitle title="我的项目" />
              <div className="list-toolbar">
                <div className="search-input">
                  <Search size={16} />
                  <input
                    placeholder="搜索项目名称或主题"
                    aria-label="搜索项目"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div>
                  <button className="outline-button" onClick={() => importRef.current?.click()}>
                    <Upload size={15} /> 导入项目
                  </button>
                  <button className="primary-button compact" onClick={newProject}>
                    <Plus size={16} /> 新建视频
                  </button>
                </div>
              </div>
              {projects.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <FolderOpen size={34} />
                  </div>
                  <h2>你的第一个故事，从这里开始。</h2>

                  <button className="primary-button compact" onClick={newProject}>
                    <Plus size={16} /> 开始创作
                  </button>
                </div>
              ) : (
                <div className="project-grid">
                  {projects
                    .filter((p) => `${p.title}${p.topic}`.includes(search))
                    .map((p) => (
                      <article className="project-card" key={p.id}>
                        <button className="project-cover" onClick={() => openProject(p)}>
                          <MiniCanvas project={p} />
                          <span className="project-cover-title">{p.title}</span>
                          <span className="project-duration">{fmt(p.duration)}</span>
                        </button>
                        <div className="project-card-info">
                          <span>
                            {styles.find((s) => s.id === p.style)?.name} · {p.aspect}
                          </span>
                          <h3>{p.title}</h3>
                          <div>
                            <small>
                              {new Date(p.createdAt).toLocaleDateString('zh-CN')} ·{' '}
                              {p.scenes.length} 个分镜
                            </small>
                            <button
                              className="icon-button"
                              aria-label={`删除项目 ${p.title}`}
                              onClick={() => removeProject(p)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                  {projects.filter((p) => `${p.title}${p.topic}`.includes(search)).length === 0 && (
                    <div className="no-results">没有找到匹配的项目</div>
                  )}
                </div>
              )}
            </>
          )}

          {page === 'templates' && (
            <>
              <PageTitle title="风格模板" />
              <div className="template-grid">
                {styles.map((s) => (
                  <article className={`template-card theme-${s.id}`} key={s.id}>
                    <div className="template-cover">
                      <MiniCanvas style={s.id} visual={styleVisual(s.id)} />
                      <span className="template-en">{s.en}</span>
                      <h2>{s.name}</h2>
                      <span className="template-corner">
                        {s.category} / {s.id.toUpperCase()}
                      </span>
                    </div>
                    <div className="template-info">
                      <div>
                        <StyleIcon id={s.id} />
                        <h3>{s.name}</h3>
                      </div>

                      <button
                        className="outline-button"
                        onClick={() => {
                          changeConfig('style', s.id as StyleId);
                          setPage('create');
                          notify(`已应用「${s.name}」风格`);
                        }}
                      >
                        使用这个风格 <ArrowRight size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {page === 'explore' && (
            <>
              <PageTitle title="灵感广场" />
              <div className="list-toolbar">
                <div className="filter-tabs">
                  {['全部', '科学', '科技', '思维', '心理'].map((f) => (
                    <button
                      className={f === filter ? 'active' : ''}
                      key={f}
                      onClick={() => setFilter(f)}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <span className="muted small-text">公开创作案例 · 非热度排名</span>
              </div>
              <div className="reference-grid">
                {references
                  .filter((r) => filter === '全部' || r.category === filter)
                  .map((r, i) => (
                    <article className="reference-card" key={r.title}>
                      <div className="reference-cover">
                        <MiniCanvas
                          style={r.style}
                          visual={['particles', 'orbits', 'blackhole', 'grid'][i % 4]}
                        />
                        <span className="reference-category">{r.category}</span>
                        <h2>{r.title}</h2>
                        <span className="reference-author">BY {r.author.toUpperCase()}</span>
                      </div>
                      <div className="reference-content">
                        <span className="small-label">{r.label}</span>
                        <h3>{r.title}</h3>
                        <p>{r.description}</p>
                        <div className="takeaway">
                          <Sparkles size={14} />
                          {r.takeaway}
                        </div>
                        <div className="reference-buttons">
                          <a className="text-button" href={r.url} target="_blank" rel="noreferrer">
                            查看公开项目 <ExternalLink size={13} />
                          </a>
                          <button
                            className="outline-button compact"
                            onClick={() => {
                              changeConfig('style', r.style as StyleId);
                              changeConfig('references', `${r.title}（${r.url}）\n${r.takeaway}`);
                              setRefOpen(true);
                              setPage('create');
                              setStage(0);
                              notify('已应用视觉风格，并添加叙事参考');
                            }}
                          >
                            借鉴这个思路 <ArrowRight size={13} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
              </div>
            </>
          )}

          {page === 'assets' && (
            <>
              <PageTitle title="素材库" />
              <div
                className="upload-zone"
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fileRef.current?.click();
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void uploadFile(e.dataTransfer.files[0]);
                }}
              >
                <span>
                  {uploading ? <LoaderCircle className="spin" size={25} /> : <Upload size={25} />}
                </span>
                <h2>{uploading ? '正在上传…' : '把音乐拖到这里'}</h2>
                <p>MP3 / WAV / M4A / OGG · 30MB</p>
              </div>
              <h2 className="subheading">内置音景</h2>
              <div className="audio-grid">
                {[
                  {
                    id: 'ambient',
                    name: '星际漫游',
                    type: 'AMBIENT',
                    desc: '持续的和弦，给思考留一点空间。',
                  },
                  {
                    id: 'pulse',
                    name: '思维脉冲',
                    type: 'PULSE',
                    desc: '轻微低频节拍，推动故事往前走。',
                  },
                ].map((a) => (
                  <div className="audio-card" key={a.id}>
                    <span className="audio-card-icon">
                      <AudioLines size={25} />
                    </span>
                    <div>
                      <span className="small-label">{a.type}</span>
                      <h3>{a.name}</h3>
                    </div>
                    <button
                      className="outline-button compact"
                      onClick={() => {
                        changeConfig('music', a.id);
                        setPage('create');
                        notify('音景已应用，点击预览播放即可试听');
                      }}
                    >
                      应用 <Plus size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <details className="sfx-library">
                <summary>
                  <span>音效素材</span>
                  <small>{sfxClips.length}</small>
                </summary>
                <div className="asset-list">
                  {sfxClips.map((clip) => (
                    <div className="asset-row" key={clip.id}>
                      <AudioLines size={18} />
                      <div>
                        <b>{clip.name}</b>
                        <small>Kenney · CC0</small>
                      </div>
                      <audio controls src={clip.url} preload="none" />
                    </div>
                  ))}
                </div>
              </details>
              <h2 className="subheading">
                我的音频 <span>{assets.length} 个文件</span>
              </h2>
              {assets.length === 0 ? (
                <p className="muted">暂无素材</p>
              ) : (
                <div className="asset-list">
                  {assets.map((a) => (
                    <div className="asset-row" key={a.id}>
                      <Music2 size={20} />
                      <div>
                        <b>{a.name}</b>
                        <small>{(a.size / 1024 / 1024).toFixed(2)} MB</small>
                      </div>
                      <audio controls src={`/api/assets/${a.id}`} preload="none" />
                      <button
                        className="outline-button compact"
                        onClick={() => {
                          changeConfig('music', `upload:${a.id}`);
                          notify('已应用到当前项目');
                        }}
                      >
                        应用
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`移除素材 ${a.name}`}
                        onClick={() => {
                          setAssets((list) => list.filter((x) => x.id !== a.id));
                          if (config.music === `upload:${a.id}`) changeConfig('music', 'none');
                          // 同时删掉服务端文件，不然上传目录会一直涨。
                          api(`/api/assets/${a.id}`, { method: 'DELETE' }).catch(() => {});
                          notify('素材已移除');
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => void uploadFile(e.target.files?.[0])}
      />
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void importProject(e.target.files?.[0])}
      />
      {toast && (
        <div className="toast" role="status">
          <span>{undoAction ? <Trash2 size={13} /> : <Check size={13} />}</span>
          {toast}
          {undoAction && (
            <button
              className="toast-action"
              onClick={() => {
                undoAction();
                setToast('项目已恢复');
              }}
            >
              撤销
            </button>
          )}
          <button aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={13} />
          </button>
        </div>
      )}

      {modal === 'export' && (
        <ModalFrame title="导出视频" onClose={closeModal} wide>
          <div className="export-layout">
            {job ? (
              <RenderProcess job={job} />
            ) : (
              <div className="export-preview">
                <MiniCanvas project={project} />
                <span>{project.title}</span>
                <div>
                  <b>{project.scenes.length} 个分镜</b>
                  <span>
                    {project.duration}s · {project.aspect}
                  </span>
                </div>
              </div>
            )}
            <div className="export-config">
              <div className="two-fields">
                <div>
                  <label className="field-label" htmlFor="quality">
                    清晰度
                  </label>
                  <select
                    id="quality"
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    disabled={rendering}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="fps">
                    帧率
                  </label>
                  <select
                    id="fps"
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    disabled={rendering}
                  >
                    <option value={30}>30 FPS</option>
                    <option value={24}>24 FPS</option>
                  </select>
                </div>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={teaser}
                  onChange={(e) => setTeaser(e.target.checked)}
                  disabled={rendering}
                />{' '}
                6 秒样片
              </label>

              {error && (
                <div className="error-message" role="alert">
                  {error}
                </div>
              )}
              {job?.status === 'complete' ? (
                <a
                  className="primary-button"
                  href={job.url}
                  download={`${project.title}${teaser ? '_样片' : ''}.mp4`}
                >
                  <Download size={16} /> 下载 MP4 视频
                </a>
              ) : (
                <button className="primary-button" onClick={exportVideo} disabled={rendering}>
                  {rendering ? <LoaderCircle className="spin" size={16} /> : <Film size={16} />}{' '}
                  {rendering ? '正在逐帧制作…' : '开始渲染 MP4'} <ArrowRight size={16} />
                </button>
              )}
              {rendering && (
                <button
                  className="text-button cancel-render"
                  onClick={() =>
                    api<ExportJob>(`/api/render/${job.id}`, { method: 'DELETE' })
                      .then(setJob)
                      .catch((e) => notify(e.message))
                  }
                >
                  取消导出
                </button>
              )}
              {job?.status === 'complete' && (
                <button className="text-button cancel-render" onClick={() => setJob(null)}>
                  重新设置导出
                </button>
              )}
            </div>
          </div>
          <div className="export-extras">
            <h3>其他格式</h3>
            <div>
              <button className="export-extra" onClick={exportHTML}>
                <FileCode2 size={18} />
                <span>
                  <b>动画 HTML</b>
                </span>
                <Download size={14} />
              </button>
              <button
                className="export-extra"
                onClick={() => download(`${project.title}.json`, JSON.stringify(project, null, 2))}
              >
                <FolderOpen size={18} />
                <span>
                  <b>项目 JSON</b>
                </span>
                <Download size={14} />
              </button>
              <button className="export-extra" onClick={exportKeyframes}>
                <Image size={18} />
                <span>
                  <b>九宫格关键帧</b>
                </span>
                <Download size={14} />
              </button>
              <button className="export-extra" onClick={exportSrt}>
                <Clapperboard size={18} />
                <span>
                  <b>字幕 SRT</b>
                </span>
                <Download size={14} />
              </button>
            </div>
          </div>
          <div className="publish-package">
            <div className="label-row">
              <h3>发布文案</h3>
              <button
                className="text-button small"
                onClick={() =>
                  navigator.clipboard
                    .writeText(project.caption)
                    .then(() => notify('发布文案已复制'))
                    .catch(() => notify('无法访问剪贴板，请手动复制'))
                }
              >
                <Copy size={13} /> 复制
              </button>
            </div>
            <textarea
              aria-label="发布文案"
              value={project.caption}
              onChange={(e) => setProject((p) => ({ ...p, caption: e.target.value }))}
              maxLength={3000}
            />
          </div>
          <div className="sources">
            <h3>
              事实与来源 <span>{project.mode === 'demo' ? '参考文献' : '待核实'}</span>
            </h3>
            {project.sources.length === 0 ? (
              <p>暂无来源</p>
            ) : (
              project.sources.map((s) => (
                <a href={s.url} key={s.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} />
                  {s.title}
                  <span>{s.status === 'unverified' ? '待核实' : '参考文献'}</span>
                </a>
              ))
            )}
          </div>
        </ModalFrame>
      )}

      {modal === 'settings' && (
        <ModalFrame title="模型设置" onClose={closeModal} wide>
          <AISettings status={status} onConnected={refreshStatus} />
        </ModalFrame>
      )}
      {modal === 'help' && (
        <ModalFrame title="创作指南" onClose={closeModal}>
          <div className="guide-body">
            {[
              {
                title: '选一个值得问的问题',
                desc: '从反直觉的现象或生活经验切入，先收集可信来源，再设定视觉与节奏。',
              },
              {
                title: '让观点变成分镜',
                desc: '每幕讲清一个观点，用图形解释而不是堆满文字。可以直接编辑每一幕的标题、解释与画面元素。',
              },
              {
                title: '用代码，让画面动起来',
                desc: '预览与导出共用 draw(t)。拖动进度条，就能检查任意时间的确切画面。',
              },
              {
                title: '逐帧渲染，带着来源发布',
                desc: 'Playwright 在浏览器逐帧绘制，FFmpeg 合成 H.264 + AAC 视频。下载 HTML、项目 JSON 和 SRT，继续后期制作。',
              },
            ].map((g, i) => (
              <div className="guide-step" key={g.title}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3>{g.title}</h3>
                  <p>{g.desc}</p>
                </div>
              </div>
            ))}
            <div className="guide-tip">
              <Command size={15} /> ⌘ / Ctrl K 搜索灵感 <span>·</span> 空格播放或暂停 <span>·</span>{' '}
              Esc 关闭弹窗
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setModal(null);
                setPage('create');
              }}
            >
              开始我的创作 <ArrowRight size={16} />
            </button>
          </div>
        </ModalFrame>
      )}
      {modal === 'command' && (
        <ModalFrame title="搜索灵感" onClose={closeModal}>
          <div className="command-body">
            <div className="search-input">
              <Search size={18} />
              <input
                aria-label="搜索灵感主题"
                autoFocus
                placeholder="搜一个主题，或写下你的问题…"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
            </div>

            {[
              defaultConfig.topic,
              '为什么熵总是越来越大？',
              '我们为什么会有控制错觉？',
              '37% 法则：什么时候应该停下？',
            ]
              .filter((t) => !command || t.includes(command))
              .map((t, i) => (
                <button
                  className="command-result"
                  key={t}
                  onClick={() => {
                    changeConfig('topic', t);
                    setPage('create');
                    setStage(0);
                    setModal(null);
                  }}
                >
                  <span>
                    <Sparkles size={15} />
                  </span>
                  <b>{t}</b>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            {command && (
              <button
                className="command-result"
                onClick={() => {
                  changeConfig('topic', command);
                  setPage('create');
                  setStage(0);
                  setModal(null);
                }}
              >
                <span>
                  <Plus size={15} />
                </span>
                <b>创作「{command}」</b>
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </ModalFrame>
      )}
    </div>
  );
}

function CanvasPreview({ project, time }: { project: Project; time: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ratio = project.aspect === '9:16' ? 9 / 16 : project.aspect === '1:1' ? 1 : 16 / 9;
  useEffect(() => {
    if (ref.current) drawFrame(ref.current, project, time);
  }, [project, time]);
  return (
    <canvas
      ref={ref}
      width={ratio < 1 ? 900 : 1600}
      height={Math.round((ratio < 1 ? 900 : 1600) / ratio)}
      className="main-canvas"
      aria-label={`知识动画预览：${project.title}`}
      role="img"
    />
  );
}
function PageTitle({ title }: { title: string }) {
  return (
    <div className="page-heading secondary-heading">
      <h1>{title}</h1>
    </div>
  );
}
