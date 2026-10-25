'use client';
// Audio recording helper — MediaRecorder + live waveform levels.
export class Recorder {
  private media: MediaRecorder;
  private stream: MediaStream;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stopped = false;

  mimeType: string;

  private constructor(stream: MediaStream, media: MediaRecorder) {
    this.stream = stream;
    this.media = media;
    this.mimeType = media.mimeType || 'audio/webm';
    media.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data) };
    this.startedAt = performance.now();
    media.start(250);
  }

  static async create(): Promise<Recorder> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw new Error('mic-denied');
      if (e instanceof DOMException && e.name === 'NotFoundError') throw new Error('mic-missing');
      throw e;
    }
    const options: MediaRecorderOptions[] = [
      { mimeType: 'audio/webm;codecs=opus' },
      { mimeType: 'audio/webm' },
      { mimeType: 'audio/mp4' },
    ];
    let media: MediaRecorder;
    for (const o of options) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(o.mimeType!)) {
        media = new MediaRecorder(stream, o);
        return new Recorder(stream, media);
      }
    }
    media = new MediaRecorder(stream);
    return new Recorder(stream, media);
  }

  private ensureAnalyser() {
    if (this.ctx || !this.stream) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
    } catch { /* analyser optional */ }
  }

  /** 24 normalized bars for the live waveform */
  getLevels(): number[] {
    this.ensureAnalyser();
    if (!this.analyser) return new Array(24).fill(0.04);
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    const bars = 24;
    const out: number[] = [];
    const step = Math.floor(data.length / bars);
    for (let b = 0; b < bars; b++) {
      let peak = 0;
      for (let i = b * step; i < (b + 1) * step; i++) {
        const v = Math.abs(data[i] - 128) / 128;
        if (v > peak) peak = v;
      }
      out.push(Math.min(1, 0.04 + peak * 2.4));
    }
    return out;
  }

  elapsedMs(): number { return performance.now() - this.startedAt }

  async stop(): Promise<{ blob: Blob; durationMs: number; mimeType: string }> {
    if (this.stopped) throw new Error('already stopped');
    this.stopped = true;
    const durationMs = this.elapsedMs();
    const blob = await new Promise<Blob>((resolve) => {
      this.media.onstop = () => resolve(new Blob(this.chunks, { type: this.mimeType }));
      try { this.media.stop() } catch { resolve(new Blob(this.chunks, { type: this.mimeType })) }
    });
    this.stream.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    return { blob, durationMs, mimeType: this.mimeType };
  }
}

export function mimeExt(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}
