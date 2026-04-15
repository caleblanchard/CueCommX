export type MobileTalkMode = "latched" | "momentary";

export type TalkGesturePhase = "press-in" | "press-out" | "tap";

export function resolveTalkGesture(input: {
  isTalking: boolean;
  mode: MobileTalkMode;
  phase: TalkGesturePhase;
}): "start" | "stop" | undefined {
  if (input.mode === "momentary") {
    if (input.phase === "press-in") {
      return "start";
    }

    if (input.phase === "press-out") {
      return "stop";
    }

    return undefined;
  }

  if (input.phase !== "tap") {
    return undefined;
  }

  return input.isTalking ? "stop" : "start";
}
