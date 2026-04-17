let sharedAudioContext: AudioContext | undefined;

function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext();
  }

  return sharedAudioContext;
}

export type SignalToneType = "call" | "standby" | "go";

const TONE_CONFIGS: Record<SignalToneType, { frequency: number; durationMs: number; pattern: "beep" | "steady" | "double" }> = {
  call: { frequency: 1000, durationMs: 800, pattern: "double" },
  standby: { frequency: 660, durationMs: 600, pattern: "steady" },
  go: { frequency: 880, durationMs: 400, pattern: "beep" },
};

export function playSignalTone(type: SignalToneType): void {
  const config = TONE_CONFIGS[type];
  const ctx = getAudioContext();

  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const gainNode = ctx.createGain();

  gainNode.connect(ctx.destination);
  gainNode.gain.setValueAtTime(0.3, ctx.currentTime);

  if (config.pattern === "double") {
    // Two short beeps
    const osc1 = ctx.createOscillator();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc1.connect(gainNode);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);

    const osc2 = ctx.createOscillator();

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc2.connect(gainNode);
    osc2.start(ctx.currentTime + 0.25);
    osc2.stop(ctx.currentTime + 0.4);
    gainNode.gain.setValueAtTime(0, ctx.currentTime + 0.45);
  } else if (config.pattern === "steady") {
    const osc = ctx.createOscillator();

    osc.type = "sine";
    osc.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc.connect(gainNode);
    osc.start(ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + config.durationMs / 1000);
    osc.stop(ctx.currentTime + config.durationMs / 1000 + 0.05);
  } else {
    const osc = ctx.createOscillator();

    osc.type = "square";
    osc.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc.connect(gainNode);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + config.durationMs / 1000);
    gainNode.gain.setValueAtTime(0, ctx.currentTime + config.durationMs / 1000 + 0.01);
  }
}
