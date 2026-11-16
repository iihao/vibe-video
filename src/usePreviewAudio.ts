import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Project } from './types';

/** Preload the project mix and use its media clock as the preview clock. */
export function usePreviewAudio(
  project: Project,
  playing: boolean,
  muted: boolean,
  audioRef: RefObject<HTMLAudioElement | null>,
  timeRef: RefObject<number>,
  notify: (message: string) => void,
) {
  const [revision, setRevision] = useState(0);
  const waitingRef = useRef(false);
  const failedRef = useRef(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const hasVoice = project.scenes.some((scene) => scene.voice?.words?.length);
  const enabled = project.music !== 'none' || project.sfxStyle !== 'off' || hasVoice;
  // Text, aspect and visual-style edits do not change the audio mix.
  const key = JSON.stringify({
    id: project.id,
    duration: project.duration,
    music: project.music,
    sfxStyle: project.sfxStyle,
    scenes: project.scenes.map(({ id, start, end, voice }) => ({ id, start, end, voice })),
  });

  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    failedRef.current = false;
    waitingRef.current = enabled;
    if (!enabled) return;
    const controller = new AbortController();
    let disposed = false;
    let objectUrl = '';
    fetch('/api/audio/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 204) return null;
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw Error(data.error || '音频预览生成失败');
        }
        return response.blob();
      })
      .then((blob) => {
        if (disposed) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          const audio = new Audio(objectUrl);
          audio.preload = 'auto';
          audio.volume = 1;
          audioRef.current = audio;
        } else {
          failedRef.current = true;
          waitingRef.current = false;
        }
        setRevision((value) => value + 1);
      })
      .catch((error: Error) => {
        if (disposed || error.name === 'AbortError') return;
        failedRef.current = true;
        waitingRef.current = false;
        if (playingRef.current) notify(error.message || '音频预览生成失败');
        setRevision((value) => value + 1);
      });
    return () => {
      disposed = true;
      controller.abort();
      audioRef.current?.pause();
      audioRef.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // key contains precisely the fields used by the server audio mix.
  }, [key, enabled, audioRef, notify]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!playing || muted || !enabled) {
      audio?.pause();
      waitingRef.current = false;
      return;
    }
    if (!audio) {
      waitingRef.current = !failedRef.current;
      if (failedRef.current) notify('音频预览生成失败，请检查服务端日志。');
      return;
    }
    let disposed = false;
    waitingRef.current = true;
    const start = () => {
      if (disposed) return;
      audio.currentTime = Math.min(timeRef.current, Math.max(0, audio.duration - 0.001));
      audio.play().then(
        () => {
          if (!disposed) waitingRef.current = false;
        },
        (error: Error) => {
          if (disposed || error.name === 'AbortError') return;
          waitingRef.current = false;
          notify('音频无法播放，请检查浏览器声音设置。');
        },
      );
    };
    if (audio.readyState >= 1) start();
    else audio.addEventListener('loadedmetadata', start, { once: true });
    return () => {
      disposed = true;
      audio.removeEventListener('loadedmetadata', start);
      audio.pause();
    };
  }, [playing, muted, enabled, revision, key, audioRef, timeRef, notify]);

  return waitingRef;
}
