/** Microphone capture with one owner, cancellable permission and released tracks. */
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private startPending: Promise<void> | null = null;
  private recordingResult: Promise<Blob> | null = null;
  private finishRecording: ((error?: Error) => void) | null = null;
  private revision = 0;
  private stopping = false;
  private stopTimer: number | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;

  constructor() {
    window.addEventListener('pagehide', () => this.release());
  }

  start(): Promise<void> {
    if (this.startPending) return this.startPending;
    if (this.stopping) return Promise.reject(new Error('Recording is finishing; try again shortly.'));
    if (this.isRecording()) return Promise.resolve();
    const revision = ++this.revision;
    this.recordingResult = null;
    const pending = this.beginRecording(revision);
    this.startPending = pending;
    // A cancelled attempt must not clear a newer attempt's pending guard.
    void pending.then(() => {
      if (this.startPending === pending) this.startPending = null;
    }, () => {
      if (this.startPending === pending) this.startPending = null;
    });
    return pending;
  }

  private async beginRecording(revision: number): Promise<void> {
    let acquired: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('Microphone recording is unavailable in this browser or context.');
      }
      acquired = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (revision !== this.revision) throw new DOMException('Recording start cancelled', 'AbortError');
      this.stream = acquired;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(acquired, {
        ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000,
      });
      const chunks: Blob[] = [];
      let settled = false;
      let resolveResult!: (value: Blob) => void;
      let rejectResult!: (error: Error) => void;
      this.recordingResult = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
      // Recording errors can arrive before the caller presses Stop.
      void this.recordingResult.catch(() => undefined);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch { /* Track shutdown still proceeds. */ }
        }
        if (this.mediaRecorder === recorder) {
          if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
          this.stopTimer = null;
          this.mediaRecorder = null;
          this.finishRecording = null;
          this.stopping = false;
          this.releaseMedia();
        }
        if (error) rejectResult(error);
        else if (!chunks.length) rejectResult(new Error('No audio recorded. Please try speaking again.'));
        else resolveResult(new Blob(chunks, { type: recorder.mimeType || chunks[0].type }));
      };
      this.mediaRecorder = recorder;
      this.finishRecording = finish;
      recorder.ondataavailable = event => {
        if (!settled && event.data?.size) chunks.push(event.data);
      };
      recorder.onerror = event => finish((event as Event & { error?: Error }).error || new Error('Microphone recording failed.'));
      // MediaRecorder delivers its final dataavailable event before stop.
      recorder.onstop = () => finish();
      recorder.start();
      this.setupAudioLevelDetection();
    } catch (error) {
      if (revision === this.revision) {
        this.finishRecording?.(error as Error);
        this.releaseMedia();
      }
      if (acquired && acquired !== this.stream) this.stopTracks(acquired);
      if (revision !== this.revision) throw new DOMException('Recording start cancelled', 'AbortError');
      if ((error as Error).name === 'AbortError') throw error;
      if ((error as Error).name === 'NotAllowedError') throw new Error('Microphone permission denied. Allow access in browser settings.');
      if ((error as Error).name === 'NotFoundError') throw new Error('No microphone found. Connect a microphone and try again.');
      throw new Error('Recording failed: ' + (error as Error).message);
    }
  }

  stop(): Promise<Blob> {
    if (this.startPending && !this.mediaRecorder) {
      this.release();
      return Promise.reject(new DOMException('Recording cancelled before microphone access was ready', 'AbortError'));
    }
    const recorder = this.mediaRecorder;
    const result = this.recordingResult;
    if (!result) return Promise.reject(new Error('No active recording'));
    if (recorder && !this.stopping) {
      this.stopping = true;
      this.stopTimer = window.setTimeout(() => this.finishRecording?.(new Error('Microphone did not finish recording. Please retry.')), 2000);
      try { if (recorder.state !== 'inactive') recorder.stop(); }
      catch (error) { this.finishRecording?.(error as Error); }
    }
    return result; // Duplicate Stop shares the same final chunk and result.
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording' && !this.stopping;
  }

  getAudioLevel(): number {
    if (!this.analyser || !this.dataArray || !this.isRecording()) return 0;
    try { this.analyser.getByteTimeDomainData(this.dataArray); }
    catch { return 0; }
    let sum = 0;
    for (const value of this.dataArray) sum += Math.abs(value - 128);
    return Math.min(1, Math.max(0, sum / this.dataArray.length / 128));
  }

  private setupAudioLevelDetection(): void {
    if (!this.stream) return;
    try {
      const Context = window.AudioContext || (window as any).webkitAudioContext;
      if (!Context) return;
      this.audioContext = new Context();
      if (this.audioContext!.state === 'suspended') void this.audioContext!.resume().catch(() => undefined);
      this.analyser = this.audioContext!.createAnalyser();
      this.analyser.fftSize = 256;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.audioSource = this.audioContext!.createMediaStreamSource(this.stream);
      this.audioSource.connect(this.analyser);
    } catch { /* Level visualization is optional; the recorder still works. */ }
  }

  private stopTracks(stream: MediaStream): void {
    stream.getTracks().forEach(track => { try { if (track.readyState !== 'ended') track.stop(); } catch { /* Best effort. */ } });
  }

  private releaseMedia(): void {
    if (this.stream) this.stopTracks(this.stream);
    this.stream = null;
    try { this.audioSource?.disconnect(); this.analyser?.disconnect(); } catch { /* Best effort. */ }
    this.audioSource = null;
    this.analyser = null;
    this.dataArray = null;
    try { if (this.audioContext) void this.audioContext.close().catch(() => undefined); } catch { /* Best effort. */ }
    this.audioContext = null;
  }

  release(): void {
    ++this.revision;
    this.startPending = null;
    this.finishRecording?.(new DOMException('Recording released', 'AbortError'));
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.releaseMedia();
    this.mediaRecorder = null;
    this.recordingResult = null;
    this.finishRecording = null;
    this.stopping = false;
  }
}
