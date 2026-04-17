import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VoxDetector } from "./vox-detector.js";

// Mock Web Audio API
function createMockAnalyser(data: Float32Array) {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    fftSize: 256,
    getFloatTimeDomainData: vi.fn((array: Float32Array) => {
      array.set(data.subarray(0, array.length));
    }),
    smoothingTimeConstant: 0,
  };
}

function createMockAudioContext(analyser: ReturnType<typeof createMockAnalyser>) {
  return {
    createAnalyser: vi.fn(() => analyser),
  } as unknown as AudioContext;
}

const mockSourceNode = {
  connect: vi.fn(),
} as unknown as MediaStreamAudioSourceNode;

describe("VoxDetector", () => {
  let rafCallbacks: Array<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    rafCallbacks = [];
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts in non-triggered state", () => {
    const detector = new VoxDetector({
      onVoxStart: vi.fn(),
      onVoxStop: vi.fn(),
    });

    expect(detector.triggered).toBe(false);
  });

  it("triggers onVoxStart when audio level exceeds threshold", () => {
    const onVoxStart = vi.fn();
    const onVoxStop = vi.fn();

    // Create a loud signal (amplitude 0.5 → ~-6 dB)
    const loud = new Float32Array(256).fill(0.5);
    const analyser = createMockAnalyser(loud);
    const ctx = createMockAudioContext(analyser);

    const detector = new VoxDetector({
      holdTimeMs: 500,
      onVoxStart,
      onVoxStop,
      thresholdDb: -40,
    });

    detector.start(ctx, mockSourceNode);

    // First RAF poll should detect voice
    expect(rafCallbacks.length).toBe(1);
    rafCallbacks[0]();

    expect(onVoxStart).toHaveBeenCalledOnce();
    expect(detector.triggered).toBe(true);
    expect(onVoxStop).not.toHaveBeenCalled();
  });

  it("does not trigger for silence", () => {
    const onVoxStart = vi.fn();
    const onVoxStop = vi.fn();

    const silence = new Float32Array(256).fill(0);
    const analyser = createMockAnalyser(silence);
    const ctx = createMockAudioContext(analyser);

    const detector = new VoxDetector({
      onVoxStart,
      onVoxStop,
      thresholdDb: -40,
    });

    detector.start(ctx, mockSourceNode);
    rafCallbacks[0]();

    expect(onVoxStart).not.toHaveBeenCalled();
    expect(detector.triggered).toBe(false);
  });

  it("fires onVoxStop after hold time elapses with silence", () => {
    const onVoxStart = vi.fn();
    const onVoxStop = vi.fn();

    const loud = new Float32Array(256).fill(0.5);
    const silence = new Float32Array(256).fill(0);
    const analyser = createMockAnalyser(loud);
    const ctx = createMockAudioContext(analyser);

    const detector = new VoxDetector({
      holdTimeMs: 300,
      onVoxStart,
      onVoxStop,
      thresholdDb: -40,
    });

    detector.start(ctx, mockSourceNode);

    // Trigger voice
    rafCallbacks[0]();
    expect(onVoxStart).toHaveBeenCalledOnce();

    // Switch to silence
    analyser.getFloatTimeDomainData = vi.fn((array: Float32Array) => {
      array.set(silence.subarray(0, array.length));
    });

    // Poll again — should start hold timer
    rafCallbacks[1]();
    expect(onVoxStop).not.toHaveBeenCalled();

    // Advance past hold time
    vi.advanceTimersByTime(300);
    expect(onVoxStop).toHaveBeenCalledOnce();
    expect(detector.triggered).toBe(false);
  });

  it("cancels hold timer when voice returns", () => {
    const onVoxStart = vi.fn();
    const onVoxStop = vi.fn();

    const loud = new Float32Array(256).fill(0.5);
    const silence = new Float32Array(256).fill(0);
    const analyser = createMockAnalyser(loud);
    const ctx = createMockAudioContext(analyser);

    const detector = new VoxDetector({
      holdTimeMs: 500,
      onVoxStart,
      onVoxStop,
      thresholdDb: -40,
    });

    detector.start(ctx, mockSourceNode);

    // Trigger
    rafCallbacks[0]();

    // Silence — starts hold timer
    analyser.getFloatTimeDomainData = vi.fn((array: Float32Array) => {
      array.set(silence.subarray(0, array.length));
    });
    rafCallbacks[1]();

    // Voice returns before hold expires
    analyser.getFloatTimeDomainData = vi.fn((array: Float32Array) => {
      array.set(loud.subarray(0, array.length));
    });
    rafCallbacks[2]();

    // Hold timer should have been canceled
    vi.advanceTimersByTime(600);
    expect(onVoxStop).not.toHaveBeenCalled();
    expect(detector.triggered).toBe(true);
  });

  it("stop() calls onVoxStop if currently triggered", () => {
    const onVoxStart = vi.fn();
    const onVoxStop = vi.fn();

    const loud = new Float32Array(256).fill(0.5);
    const analyser = createMockAnalyser(loud);
    const ctx = createMockAudioContext(analyser);

    const detector = new VoxDetector({
      onVoxStart,
      onVoxStop,
      thresholdDb: -40,
    });

    detector.start(ctx, mockSourceNode);
    rafCallbacks[0]();
    expect(detector.triggered).toBe(true);

    detector.stop();
    expect(onVoxStop).toHaveBeenCalledOnce();
    expect(detector.triggered).toBe(false);
  });

  it("stop() is safe when not triggered", () => {
    const onVoxStop = vi.fn();
    const detector = new VoxDetector({
      onVoxStart: vi.fn(),
      onVoxStop,
    });

    detector.stop();
    expect(onVoxStop).not.toHaveBeenCalled();
  });

  it("start() is idempotent while running", () => {
    const analyser = createMockAnalyser(new Float32Array(256));
    const ctx = createMockAudioContext(analyser);

    const detector = new VoxDetector({
      onVoxStart: vi.fn(),
      onVoxStop: vi.fn(),
    });

    detector.start(ctx, mockSourceNode);
    detector.start(ctx, mockSourceNode);

    expect(ctx.createAnalyser).toHaveBeenCalledOnce();
  });

  it("updateSettings changes threshold and holdTime", () => {
    const detector = new VoxDetector({
      holdTimeMs: 500,
      onVoxStart: vi.fn(),
      onVoxStop: vi.fn(),
      thresholdDb: -40,
    });

    detector.updateSettings({ thresholdDb: -20, holdTimeMs: 1000 });

    // Low-amplitude signal that's above -40 but below -20
    const medium = new Float32Array(256).fill(0.05); // ~-26 dB
    const analyser = createMockAnalyser(medium);
    const ctx = createMockAudioContext(analyser);

    detector.start(ctx, mockSourceNode);
    rafCallbacks[0]();

    // Should not trigger at -20 threshold
    expect(detector.triggered).toBe(false);
  });
});
