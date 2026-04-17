import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playSignalTone, type SignalToneType } from "./signal-tone.js";

function createMockOscillator() {
  return {
    connect: vi.fn(),
    frequency: { setValueAtTime: vi.fn() },
    start: vi.fn(),
    stop: vi.fn(),
    type: "sine" as OscillatorType,
  };
}

function createMockGainNode() {
  return {
    connect: vi.fn(),
    gain: {
      linearRampToValueAtTime: vi.fn(),
      setValueAtTime: vi.fn(),
      value: 1,
    },
  };
}

describe("playSignalTone", () => {
  let mockOscillators: ReturnType<typeof createMockOscillator>[];
  let mockGainNode: ReturnType<typeof createMockGainNode>;

  beforeEach(() => {
    mockOscillators = [];
    mockGainNode = createMockGainNode();

    const mockAudioContext = {
      createGain: vi.fn(() => mockGainNode),
      createOscillator: vi.fn(() => {
        const osc = createMockOscillator();
        mockOscillators.push(osc);
        return osc;
      }),
      currentTime: 0,
      destination: {},
      resume: vi.fn(),
      state: "running",
    };

    vi.stubGlobal("AudioContext", vi.fn(() => mockAudioContext));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays a double beep for call signals", () => {
    playSignalTone("call");

    expect(mockOscillators).toHaveLength(2);
    expect(mockOscillators[0].type).toBe("sine");
    expect(mockOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(1000, 0);
    expect(mockOscillators[0].start).toHaveBeenCalled();
    expect(mockOscillators[0].stop).toHaveBeenCalled();
    expect(mockOscillators[1].start).toHaveBeenCalled();
    expect(mockOscillators[1].stop).toHaveBeenCalled();
  });

  it("plays a steady fade for standby signals", () => {
    playSignalTone("standby");

    expect(mockOscillators).toHaveLength(1);
    expect(mockOscillators[0].type).toBe("sine");
    expect(mockOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(660, 0);
    expect(mockGainNode.gain.linearRampToValueAtTime).toHaveBeenCalled();
  });

  it("plays a square beep for go signals", () => {
    playSignalTone("go");

    expect(mockOscillators).toHaveLength(1);
    expect(mockOscillators[0].type).toBe("square");
    expect(mockOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(880, 0);
  });

  it("creates gain node connected to destination for all signal types", () => {
    const types: SignalToneType[] = ["call", "standby", "go"];

    for (const type of types) {
      mockOscillators = [];
      playSignalTone(type);
      expect(mockGainNode.connect).toHaveBeenCalled();
      expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.3, 0);
    }
  });
});
