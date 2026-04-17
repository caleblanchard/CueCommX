export type PreflightStep = "idle" | "tone" | "recording" | "playback" | "done";

export interface PreflightState {
  error?: string;
  micLevel: number;
  passed: boolean | undefined;
  step: PreflightStep;
}

export type PreflightStateListener = (state: PreflightState) => void;

const TONE_FREQUENCY_HZ = 440;
const TONE_DURATION_MS = 1_500;
const RECORD_DURATION_MS = 3_000;
const METER_INTERVAL_MS = 100;

export class PreflightAudioTest {
  private audioContext: AudioContext | undefined;
  private cancelled = false;
  private listener: PreflightStateListener | undefined;
  private meterTimer: number | undefined;
  private localStream: MediaStream | undefined;

  private state: PreflightState = {
    micLevel: 0,
    passed: undefined,
    step: "idle",
  };

  onStateChange(listener: PreflightStateListener): void {
    this.listener = listener;
  }

  async run(): Promise<void> {
    this.cancelled = false;
    this.audioContext = new AudioContext();

    try {
      // Step 1: Play test tone
      this.emit({ step: "tone", micLevel: 0, passed: undefined });
      await this.playTestTone();

      if (this.cancelled) return;

      // Step 2: Record mic audio
      this.emit({ step: "recording", micLevel: 0, passed: undefined });
      const recording = await this.recordMicAudio();

      if (this.cancelled) return;

      // Step 3: Play back recording and meter
      this.emit({ step: "playback", micLevel: 0, passed: undefined });
      await this.playbackRecording(recording);

      if (this.cancelled) return;

      this.emit({ step: "done", micLevel: 0, passed: true });
    } catch (error) {
      if (!this.cancelled) {
        this.emit({
          step: "done",
          micLevel: 0,
          passed: false,
          error: error instanceof Error ? error.message : "Preflight test failed.",
        });
      }
    } finally {
      this.cleanup();
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.cleanup();
    this.emit({ step: "idle", micLevel: 0, passed: undefined });
  }

  private emit(next: PreflightState): void {
    this.state = next;
    this.listener?.(this.state);
  }

  private async playTestTone(): Promise<void> {
    const ctx = this.audioContext!;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(TONE_FREQUENCY_HZ, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    // Fade out at the end
    gain.gain.setValueAtTime(0.3, ctx.currentTime + TONE_DURATION_MS / 1_000 - 0.1);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + TONE_DURATION_MS / 1_000);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();

    await this.delay(TONE_DURATION_MS);
    oscillator.stop();
    oscillator.disconnect();
    gain.disconnect();
  }

  private async recordMicAudio(): Promise<AudioBuffer> {
    const ctx = this.audioContext!;
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const source = ctx.createMediaStreamSource(this.localStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const sampleRate = ctx.sampleRate;
    const totalSamples = Math.ceil(sampleRate * (RECORD_DURATION_MS / 1_000));
    const chunks: Float32Array[] = [];
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    let collected = 0;

    const recordPromise = new Promise<AudioBuffer>((resolve) => {
      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (this.cancelled) return;

        const input = event.inputBuffer.getChannelData(0);
        const remaining = totalSamples - collected;

        if (remaining <= 0) return;

        const slice = input.slice(0, Math.min(input.length, remaining));
        chunks.push(new Float32Array(slice));
        collected += slice.length;

        if (collected >= totalSamples) {
          processor.disconnect();
          source.disconnect();

          const buffer = ctx.createBuffer(1, collected, sampleRate);
          const channelData = buffer.getChannelData(0);
          let offset = 0;

          for (const chunk of chunks) {
            channelData.set(chunk, offset);
            offset += chunk.length;
          }

          resolve(buffer);
        }
      };
    });

    source.connect(processor);
    processor.connect(ctx.destination);

    // Meter mic level during recording
    const sampleBuffer = new Uint8Array(analyser.fftSize);

    this.meterTimer = window.setInterval(() => {
      analyser.getByteTimeDomainData(sampleBuffer);
      let sumSquares = 0;

      for (const sample of sampleBuffer) {
        const normalized = sample / 128 - 1;
        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / sampleBuffer.length);
      const level = Math.min(100, Math.round(rms * 180));
      this.emit({ ...this.state, micLevel: level });
    }, METER_INTERVAL_MS);

    const result = await recordPromise;
    this.stopMeter();
    this.stopLocalStream();
    return result;
  }

  private async playbackRecording(buffer: AudioBuffer): Promise<void> {
    const ctx = this.audioContext!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();

    await this.delay(buffer.duration * 1_000);
    source.disconnect();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private stopMeter(): void {
    if (this.meterTimer) {
      window.clearInterval(this.meterTimer);
      this.meterTimer = undefined;
    }
  }

  private stopLocalStream(): void {
    for (const track of this.localStream?.getTracks() ?? []) {
      track.stop();
    }

    this.localStream = undefined;
  }

  private cleanup(): void {
    this.stopMeter();
    this.stopLocalStream();

    if (this.audioContext && this.audioContext.state !== "closed") {
      void this.audioContext.close();
    }

    this.audioContext = undefined;
  }
}
