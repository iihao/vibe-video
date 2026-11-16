import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  Clock3,
  Download,
  FileCheck2,
  Film,
  Lightbulb,
  LoaderCircle,
  Radio,
  Sparkles,
  X,
} from 'lucide-react';
import type { ExportJob, GenerationRun, Scene } from '../types';
import { drawFrame } from '../../shared/renderer.mjs';
import { styles } from '../../shared/catalog.mjs';

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
function elapsed(start: number, end: number) {
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
function SceneFrame({ scene, run }: { scene: Scene; run: GenerationRun }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const aspect = run.config.aspect;
  const [width, height] =
    aspect === '9:16' ? [180, 320] : aspect === '1:1' ? [240, 240] : [320, 180];
  useEffect(() => {
    if (!canvas.current) return;
    drawFrame(
      canvas.current,
      {
        ...run.config,
        scenes: [{ ...scene, start: 0, end: run.config.duration }],
        title: run.config.topic,
      },
      1.5,
      { text: false },
    );
  }, [scene, run.config]);
  return <canvas ref={canvas} width={width} height={height} aria-hidden="true" />;
}

export function RenderProcess({
  job,
  showPreview = true,
}: {
  job: ExportJob;
  showPreview?: boolean;
}) {
  const active = ['queued', 'rendering', 'encoding'].includes(job.status);
  const now = useNow(active);
  const labels = ['准备引擎', '逐帧绘制', '封装音视频', '成片就绪'];
  const step =
    job.status === 'queued'
      ? 0
      : job.status === 'rendering'
        ? 1
        : job.status === 'encoding'
          ? 2
          : job.status === 'complete'
            ? 3
            : job.framesDone === job.totalFrames
              ? 2
              : job.framesDone > 0
                ? 1
                : 0;
  return (
    <div className={`render-process ${job.status}`} aria-label="视频渲染过程">
      {showPreview && (
        <div className="render-live-frame">
          {job.status === 'complete' && job.url ? (
            <video
              src={job.url}
              controls
              preload="metadata"
              poster={job.previewUrl}
              aria-label="已导出视频预览"
            />
          ) : job.previewUrl ? (
            <img src={job.previewUrl} alt={`实际渲染画面：${job.sceneTitle || job.projectTitle}`} />
          ) : (
            <div className="render-frame-wait">
              <Film size={26} />
              <span>正在准备第一帧</span>
            </div>
          )}
          {job.status !== 'complete' && (
            <span className="frame-label">
              <Radio size={11} /> 实际渲染帧
            </span>
          )}
        </div>
      )}
      <div className="render-process-detail">
        <div className="render-phase-list">
          {labels.map((label, i) => (
            <span
              className={
                i < step || (i === 3 && job.status === 'complete')
                  ? 'done'
                  : i === step
                    ? 'active'
                    : ''
              }
              key={label}
            >
              {i < step || (i === 3 && job.status === 'complete') ? (
                <Check size={12} />
              ) : i === step && active ? (
                <LoaderCircle size={12} className="spin" />
              ) : (
                <i />
              )}
              {label}
            </span>
          ))}
        </div>
        <div className="render-percent">
          <strong>
            {job.progress}
            <small>%</small>
          </strong>
          <span>{job.message}</span>
        </div>
        <progress value={job.progress} max={100} aria-label="视频渲染进度" />
        <div className="render-metrics">
          <span>
            已绘制{' '}
            <b>
              {job.framesDone.toLocaleString()} / {job.totalFrames.toLocaleString()} 帧
            </b>
          </span>
          <span>
            耗时 <b>{elapsed(job.createdAt, job.finishedAt || (active ? now : job.updatedAt))}</b>
          </span>
          <span>
            规格{' '}
            <b>
              {job.width ? `${job.width} × ${job.height}` : '准备中'} · {job.fps} FPS
            </b>
          </span>
          <span>
            画面位置{' '}
            <b>
              {(job.videoTime || 0).toFixed(1)} / {job.duration} 秒
            </b>
          </span>
        </div>
        {job.sceneTitle && (
          <p className="render-current-scene">
            分镜 {(job.sceneIndex || 0) + 1} / {job.sceneCount} · {job.sceneTitle}
          </p>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <p className="process-error">{job.error || '导出已取消，可以重新渲染。'}</p>
        )}
      </div>
    </div>
  );
}

export function GenerationProcess({
  run,
  job,
  onCancel,
  onExport,
  onSelectScene,
}: {
  run: GenerationRun | null;
  job: ExportJob | null;
  onCancel: () => void;
  onExport: () => void;
  onSelectScene: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const active = run?.status === 'running';
  const now = useNow(Boolean(active));
  useEffect(() => {
    if (run || job) setExpanded(true);
  }, [run?.startedAt, job?.id]);
  useEffect(() => {
    if (!run || run.status !== 'running') return;
    const timer = setTimeout(
      () => panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      100,
    );
    return () => clearTimeout(timer);
  }, [run?.startedAt]);
  if (!run && !job) return null;
  const rendering = job && run?.status !== 'running';
  const ready = run?.status === 'complete';
  const halted = rendering
    ? ['failed', 'cancelled'].includes(job.status)
    : run?.status === 'failed' || run?.status === 'cancelled';
  const current = rendering
    ? 4
    : ready
      ? 3
      : !run
        ? 0
        : ['validating', 'repairing'].includes(run.stage)
          ? 2
          : 1;
  const completed = rendering && job.status === 'complete';
  const steps = [
    { label: '主题与风格', sub: '创作起点', icon: Lightbulb },
    { label: 'AI 编写分镜', sub: '脚本逐幕到达', icon: Sparkles },
    { label: '校验与编排', sub: '结构 · 时间轴', icon: FileCheck2 },
    { label: '动画预览', sub: '可编辑 · 可播放', icon: Clapperboard },
    { label: 'MP4 成片', sub: '逐帧渲染 · 合成', icon: Film },
  ];
  return (
    <section
      ref={panel}
      className="generation-process"
      aria-label="生成过程可视化"
      aria-busy={Boolean(active)}
    >
      <div className="process-heading">
        <div>
          <h2>
            生成过程{' '}
            <small>
              {active
                ? '实时进行中'
                : rendering
                  ? completed
                    ? '成片已就绪'
                    : '视频导出'
                  : ready
                    ? '分镜已就绪'
                    : halted
                      ? run?.status === 'cancelled'
                        ? '已取消'
                        : '需要重试'
                      : '待开始'}
            </small>
          </h2>
        </div>
        <div className="process-heading-actions">
          {run && !rendering && (
            <span className="process-elapsed">
              <Clock3 size={12} />
              {elapsed(run.startedAt, run.finishedAt || now)}
            </span>
          )}
          <button
            className="text-button process-toggle"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls="process-details"
          >
            {expanded ? '收起详情' : '展开详情'}
            <ChevronDown size={13} className={expanded ? 'rotated' : ''} />
          </button>
        </div>
      </div>
      <ol className="process-pipeline">
        {steps.map(({ label, icon: Icon }, i) => {
          const state =
            i < current || completed
              ? 'done'
              : i === current
                ? halted
                  ? 'halted'
                  : 'active'
                : 'waiting';
          return (
            <li className={state} key={label} aria-current={i === current ? 'step' : undefined}>
              <span className="pipeline-icon">
                {state === 'done' ? (
                  <Check size={17} />
                ) : state === 'halted' ? (
                  <X size={17} />
                ) : (
                  <Icon size={17} />
                )}
              </span>
              <span>
                <b>{label}</b>
              </span>
              {i < steps.length - 1 && <ArrowRight className="pipeline-arrow" size={13} />}
            </li>
          );
        })}
      </ol>
      {expanded && (
        <div id="process-details" className="process-details">
          {rendering ? (
            <>
              <div className="process-detail-title">
                <span>
                  {completed ? '已导出' : '正在导出'} · {job.projectTitle}
                </span>
                {completed && job.url && (
                  <a href={job.url} download={`${job.projectTitle}.mp4`}>
                    <Download size={12} />
                    下载成片
                  </a>
                )}
              </div>
              <RenderProcess job={job} />
            </>
          ) : run ? (
            <>
              <div className="process-detail-title generation-progress" role="status">
                <span>
                  {active && <i className="live-dot" />}
                  {run.model} · {run.message}
                </span>
                {active && (
                  <button className="text-button" onClick={onCancel}>
                    <X size={12} />
                    取消生成
                  </button>
                )}
                {ready && (
                  <button className="text-button" onClick={onExport}>
                    进入导出
                    <ArrowRight size={12} />
                  </button>
                )}
              </div>
              <div className="generation-live-layout">
                <div className="live-storyboard">
                  <div className="live-storyboard-heading">
                    <b>{ready ? '分镜已编排' : '分镜正在浮现'}</b>
                    <span>
                      {run.scenes.length} 幕
                      {run.chars > 0 && ` · ${run.chars.toLocaleString()} 字符`}
                    </span>
                  </div>
                  {run.scenes.length > 0 ? (
                    <div className="live-scene-grid">
                      {run.scenes.map((scene, index) => (
                        <button
                          key={`${index}-${scene.id}`}
                          className="live-scene-card"
                          onClick={() => onSelectScene(index)}
                          disabled={!ready}
                          aria-label={`查看分镜 ${index + 1}：${scene.title}`}
                        >
                          <div>
                            <SceneFrame scene={scene} run={run} />
                            <span>{String(index + 1).padStart(2, '0')}</span>
                          </div>
                          <b>{scene.title}</b>
                          <small>
                            {scene.label} ·{' '}
                            {ready
                              ? `${scene.start.toFixed(1)}–${scene.end.toFixed(1)}s`
                              : '草稿待编排'}
                          </small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="storyboard-wait">
                      <div className={`storyboard-placeholder ${active ? 'is-active' : ''}`}>
                        <Clapperboard size={23} />
                      </div>
                      <b>{halted ? '本次生成尚未完成' : '等待分镜'}</b>
                    </div>
                  )}
                </div>
                <div className="generation-event-log">
                  <div className="live-storyboard-heading">
                    <b>执行记录</b>
                    <span>{styles.find((style) => style.id === run.config.style)?.name}</span>
                  </div>
                  <ol>
                    {run.events.map((event, i) => (
                      <li
                        key={i}
                        className={active && i === run.events.length - 1 ? 'current' : ''}
                      >
                        <i />
                        <div>
                          <span>{event.message}</span>
                          <time>+{elapsed(run.startedAt, event.at)}</time>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
