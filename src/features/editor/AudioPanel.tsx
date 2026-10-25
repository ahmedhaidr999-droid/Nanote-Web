'use client';
// AudioPanel — record while writing (synced to ink), playback with scrubber,
// sync-highlight / ink-replay modes, import external audio.
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Play, Pause, Trash2, Upload, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { RecordingRow } from '@/lib/nanote/types';
import { uid, fmtDuration, fmtBytes, fmtDate } from '@/lib/nanote/util';
import * as db from '@/lib/nanote/idb';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { Recorder } from './audio';

export function AudioPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, lang } = useT();
  const recordings = useApp((s) => s.editor.recordings);
  const activePageId = useApp((s) => s.editor.activePageId);
  const audioState = useApp((s) => s.editor.audio);
  const activeRecording = useApp((s) => s.editor.activeRecording);
  const notebookId = useApp((s) => s.editor.notebookId);
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (open && activePageId) void useApp.getState().loadRecordings(activePageId);
  }, [open, activePageId]);

  // recording timer + waveform
  useEffect(() => {
    if (!recorder) return;
    let raf = 0;
    const loop = () => {
      setElapsed(recorder.elapsedMs());
      const c = waveRef.current;
      if (c) {
        const levels = recorder.getLevels();
        const ctx = c.getContext('2d')!;
        const w = c.width, h = c.height;
        ctx.clearRect(0, 0, w, h);
        const bw = w / levels.length;
        levels.forEach((v, i) => {
          const bh = Math.max(2, v * h);
          ctx.fillStyle = '#E5484D';
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(i * bw + 1, (h - bh) / 2, bw - 2, bh, 2);
            ctx.fill();
          } else {
            ctx.fillRect(i * bw + 1, (h - bh) / 2, bw - 2, bh);
          }
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [recorder]);

  const startRecording = async () => {
    try {
      const rec = await Recorder.create();
      const id = uid();
      recIdRef.current = id;
      setRecorder(rec);
      setElapsed(0);
      useApp.getState().setActiveRecording({ recId: id, startedAt: performance.now() });
      toast(t('audio.recordingWhile'), { icon: <Radio className="h-4 w-4 text-destructive rec-pulse" /> });
    } catch (e) {
      const msg = String((e as Error).message);
      if (msg === 'mic-denied') toast.error(t('audio.micDenied'));
      else if (msg === 'mic-missing') toast.error(t('audio.micUnavailable'));
      else toast.error(t('error.generic'));
    }
  };

  const stopRecording = async () => {
    if (!recorder || !activePageId) return;
    const { blob, durationMs, mimeType } = await recorder.stop();
    const row: RecordingRow = {
      id: recIdRef.current ?? uid(),
      pageId: activePageId,
      notebookId,
      title: `${t('audio.newTake')} ${new Date().toLocaleTimeString()}`,
      mimeType, durationMs, sizeBytes: blob.size,
      createdAt: Date.now(), imported: false,
    };
    await useApp.getState().addRecording(row, blob);
    useApp.getState().setActiveRecording(null);
    setRecorder(null);
    recIdRef.current = null;
    toast.success(t('audio.recordings'), { description: fmtDuration(durationMs) });
  };

  const play = async (rec: RecordingRow) => {
    const st = useApp.getState();
    if (audioState.recId === rec.id && audioState.playing) {
      audioRef.current?.pause();
      st.setAudioState({ playing: false });
      return;
    }
    let a = audioRef.current;
    const blob = (await db.getAudio(rec.id))?.blob;
    if (!blob) { toast.error(t('error.generic')); return }
    const url = URL.createObjectURL(blob);
    if (!a) {
      a = new Audio();
      audioRef.current = a;
      a.ontimeupdate = () => {
        const s = useApp.getState();
        s.setAudioState({ tMs: (a as HTMLAudioElement).currentTime * 1000 });
      };
      a.onended = () => useApp.getState().setAudioState({ playing: false });
    }
    if (audioState.recId !== rec.id) {
      a.src = url;
    }
    a.currentTime = (useApp.getState().editor.audio.tMs && audioState.recId === rec.id) ? useApp.getState().editor.audio.tMs / 1000 : 0;
    st.setAudioState({ recId: rec.id, playing: true, tMs: a.currentTime * 1000 });
    await a.play().catch(() => toast.error(t('error.generic')));
  };

  const scrub = (ms: number) => {
    const a = audioRef.current;
    useApp.getState().setAudioState({ tMs: ms });
    if (a && audioState.recId) a.currentTime = ms / 1000;
  };

  const importAudio = async (file: File) => {
    if (!activePageId) return;
    const a = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const duration = await new Promise<number>((res) => {
      a.onloadedmetadata = () => res(a.duration * 1000);
      a.onerror = () => res(0);
      a.src = url;
    });
    URL.revokeObjectURL(url);
    const row: RecordingRow = {
      id: uid(), pageId: activePageId, notebookId,
      title: file.name, mimeType: file.type || 'audio/*',
      durationMs: Math.round(duration) || 0, sizeBytes: file.size,
      createdAt: Date.now(), imported: true,
    };
    await useApp.getState().addRecording(row, file);
    toast.success(t('audio.imported'));
  };

  const mode = audioState.playing ? (audioState.replay ? 'replay' : audioState.sync ? 'highlight' : 'off') : 'off';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto nanote-scroll rounded-t-2xl p-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Mic className="h-4 w-4" />
            {t('audio.recordings')}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 p-4">
          {/* record row */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => (recorder ? void stopRecording() : void startRecording())}
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-full press-scale',
                recorder ? 'bg-destructive text-white rec-pulse' : 'bg-primary text-primary-foreground',
              )}
              aria-label={recorder ? t('audio.stop') : t('audio.record')}
            >
              {recorder ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <div className="flex-1">
              <div className="text-sm font-semibold tabular-nums">
                {recorder ? `${t('audio.rec')} · ${fmtDuration(elapsed)}` : t('audio.record')}
              </div>
              <canvas ref={waveRef} width={520} height={36} className="mt-1 h-9 w-full max-w-md" aria-hidden />
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-variant press-scale"
              aria-label={t('audio.import')}
            >
              <Upload className="h-4 w-4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importAudio(f) }}
            />
          </div>

          {/* sync mode */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">{t('audio.sync')}</span>
            <div className="flex gap-1 rounded-full bg-surface-variant p-1">
              {(['off', 'highlight', 'replay'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => useApp.getState().setAudioState({ sync: m === 'highlight', replay: m === 'replay' })}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium press-scale',
                    mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {m === 'off' ? t('common.none') : m === 'highlight' ? t('audio.sync') : t('audio.replay')}
                </button>
              ))}
            </div>
          </div>

          {/* list */}
          {recordings.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('audio.noRecordings')}</p>
          ) : (
            <ul className="space-y-2">
              {recordings.map((rec) => {
                const isCurrent = audioState.recId === rec.id;
                return (
                  <li key={rec.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void play(rec)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground press-scale"
                        aria-label={isCurrent && audioState.playing ? t('audio.pause') : t('audio.play')}
                      >
                        {isCurrent && audioState.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{rec.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtDuration(rec.durationMs)} · {fmtBytes(rec.sizeBytes, lang)} · {fmtDate(rec.createdAt, lang)}
                          {rec.imported ? ` · ${t('audio.imported')}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void useApp.getState().removeRecording(rec.id)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-destructive hover:bg-destructive/10 press-scale"
                        aria-label={t('audio.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {isCurrent && (
                      <div className="mt-2 px-1">
                        <Slider
                          value={[audioState.tMs]}
                          max={Math.max(1000, rec.durationMs)}
                          step={100}
                          onValueChange={(v) => scrub(v[0])}
                          aria-label={t('audio.play')}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
