export interface VoxDetectorOptions {
  holdTimeMs: number;
  onVoxStart: () => void;
  onVoxStop: () => void;
  thresholdDb: number;
}

const DEFAULT_THRESHOLD_DB = -40;
const DEFAULT_HOLD_TIME_MS = 500;
const ANALYSER_FFT_SIZE = 256;

export class VoxDetector {
  private analyser: AnalyserNode | undefined;

  private animationFrameId: number | undefined;

  private holdTimer: ReturnType<typeof setTimeout> | undefined;

  private isTriggered = false;

  private running = false;

  private readonly options: VoxDetectorOptions;

  constructor(options: Partial<VoxDetectorOptions> & Pick<VoxDetectorOptions, "onVoxStart" | "onVoxStop">) {
    this.options = {
      holdTimeMs: options.holdTimeMs ?? DEFAULT_HOLD_TIME_MS,
      thresholdDb: options.thresholdDb ?? DEFAULT_THRESHOLD_DB,
      onVoxStart: options.onVoxStart,
      onVoxStop: options.onVoxStop,
    };
  }

  start(audioContext: AudioContext, sourceNode: MediaStreamAudioSourceNode): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = ANALYSER_FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.3;
    sourceNode.connect(this.analyser);
    this.poll();
  }

  stop(): void {
    this.running = false;

    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    if (this.holdTimer !== undefined) {
      clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }

    if (this.isTriggered) {
      this.isTriggered = false;
      this.options.onVoxStop();
    }

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        // already disconnected
      }

      this.analyser = undefined;
    }
  }

  updateSettings(settings: { thresholdDb?: number; holdTimeMs?: number }): void {
    if (settings.thresholdDb !== undefined) {
      this.options.thresholdDb = settings.thresholdDb;
    }

    if (settings.holdTimeMs !== undefined) {
      this.options.holdTimeMs = settings.holdTimeMs;
    }
  }

  get triggered(): boolean {
    return this.isTriggered;
  }

  private poll(): void {
    if (!this.running || !this.analyser) {
      return;
    }

    const dataArray = new Float32Array(this.analyser.fftSize);

    this.analyser.getFloatTimeDomainData(dataArray);

    let sumSquares = 0;

    for (let i = 0; i < dataArray.length; i++) {
      sumSquares += dataArray[i] * dataArray[i];
    }

    const rms = Math.sqrt(sumSquares / dataArray.length);
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    if (db >= this.options.thresholdDb) {
      // Voice detected — trigger or extend hold
      if (this.holdTimer !== undefined) {
        clearTimeout(this.holdTimer);
        this.holdTimer = undefined;
      }

      if (!this.isTriggered) {
        this.isTriggered = true;
        this.options.onVoxStart();
      }
    } else if (this.isTriggered && this.holdTimer === undefined) {
      // Voice dropped — start hold timer
      this.holdTimer = setTimeout(() => {
        this.holdTimer = undefined;
        this.isTriggered = false;
        this.options.onVoxStop();
      }, this.options.holdTimeMs);
    }

    this.animationFrameId = requestAnimationFrame(() => this.poll());
  }
}
