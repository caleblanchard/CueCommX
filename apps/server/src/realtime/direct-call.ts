import type { StepBuilder } from "./steps.js";
import type {
  CoordinationSession,
  DirectCall,
  FeatureContext,
  OperatorSessionCoordinationResult,
} from "./types.js";

export class DirectCallFeature {
  private readonly calls = new Map<string, DirectCall>();

  private sequence = 0;

  constructor(private readonly context: FeatureContext) {}

  snapshot(): DirectCall[] {
    return [...this.calls.values()].map((call) => ({ ...call }));
  }

  forSession(sessionToken: string): DirectCall | undefined {
    return [...this.calls.values()].find(
      (call) => call.initiatorSessionToken === sessionToken || call.targetSessionToken === sessionToken,
    );
  }

  peerSessionTokenFor(sessionToken: string): string | undefined {
    const call = this.forSession(sessionToken);

    if (!call || call.state !== "active") {
      return undefined;
    }

    return call.initiatorSessionToken === sessionToken ? call.targetSessionToken : call.initiatorSessionToken;
  }

  request(session: CoordinationSession, targetUserId: string): OperatorSessionCoordinationResult {
    if (targetUserId === session.user.id) {
      return this.context.reject("invalid-message", "Cannot call yourself.", session.sessionToken);
    }

    if (this.forSession(session.sessionToken)) {
      return this.context.reject("conflict", "You are already in a direct call.", session.sessionToken);
    }

    const target = this.context.findSessionByUserId(targetUserId);

    if (!target) {
      return this.context.accept((steps) => {
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: session.sessionToken,
          message: {
            type: "direct:ended",
            payload: { callId: "", reason: "unavailable" },
          },
        });
      });
    }

    if (this.forSession(target.sessionToken)) {
      return this.context.accept((steps) => {
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: session.sessionToken,
          message: {
            type: "direct:ended",
            payload: { callId: "", reason: "busy" },
          },
        });
      });
    }

    return this.context.accept((steps) => {
      this.sequence += 1;
      const callId = `dc-${this.sequence}-${Date.now()}`;

      this.calls.set(callId, {
        callId,
        initiatorSessionToken: session.sessionToken,
        initiatorUserId: session.user.id,
        initiatorUsername: session.user.username,
        state: "ringing",
        targetSessionToken: target.sessionToken,
        targetUserId,
        targetUsername: target.user.username,
      });

      steps.push({
        adapter: "timer",
        delayMs: 30_000,
        key: callId,
        kind: "schedule",
        timerType: "direct-call-timeout",
      });
      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: target.sessionToken,
        message: {
          type: "direct:incoming",
          payload: {
            callId,
            fromUserId: session.user.id,
            fromUsername: session.user.username,
          },
        },
      });
    });
  }

  accept(session: CoordinationSession, callId: string): OperatorSessionCoordinationResult {
    const call = this.calls.get(callId);

    if (!call || call.state !== "ringing") {
      return this.context.reject("invalid-state", "No ringing call found with that ID.", session.sessionToken);
    }

    if (call.targetSessionToken !== session.sessionToken) {
      return this.context.reject("forbidden", "Only the call target can accept.", session.sessionToken);
    }

    return this.context.accept((steps) => {
      call.state = "active";
      steps.push({
        adapter: "timer",
        key: callId,
        kind: "cancel",
        timerType: "direct-call-timeout",
      });

      if (this.context.sessions.has(call.initiatorSessionToken)) {
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: call.initiatorSessionToken,
          message: {
            type: "direct:active",
            payload: {
              callId,
              peerUserId: session.user.id,
              peerUsername: session.user.username,
            },
          },
        });
        this.context.appendMediaRefresh(steps, call.initiatorSessionToken, "direct-call");
      }

      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: session.sessionToken,
        message: {
          type: "direct:active",
          payload: {
            callId,
            peerUserId: call.initiatorUserId,
            peerUsername: call.initiatorUsername,
          },
        },
      });
      this.context.appendMediaRefresh(steps, session.sessionToken, "direct-call");
      this.context.refreshProjections(steps);
    });
  }

  end(session: CoordinationSession, callId: string): OperatorSessionCoordinationResult {
    const call = this.calls.get(callId);

    if (!call) {
      return this.context.reject("invalid-state", "No call found with that ID.", session.sessionToken);
    }

    if (call.initiatorSessionToken !== session.sessionToken && call.targetSessionToken !== session.sessionToken) {
      return this.context.reject("forbidden", "You are not part of this call.", session.sessionToken);
    }

    return this.context.accept((steps) => {
      this.endCall(callId, "ended", steps);
    });
  }

  reject(session: CoordinationSession, callId: string): OperatorSessionCoordinationResult {
    const call = this.calls.get(callId);

    if (!call || call.state !== "ringing") {
      return this.context.reject("invalid-state", "No ringing call found with that ID.", session.sessionToken);
    }

    if (call.targetSessionToken !== session.sessionToken) {
      return this.context.reject("forbidden", "Only the call target can reject.", session.sessionToken);
    }

    return this.context.accept((steps) => {
      this.endCall(callId, "rejected", steps);
    });
  }

  timeout(callId: string): OperatorSessionCoordinationResult {
    const call = this.calls.get(callId);

    if (!call || call.state !== "ringing") {
      return this.context.noop();
    }

    return this.context.accept((steps) => {
      this.endCall(callId, "unavailable", steps);
    });
  }

  endForSession(sessionToken: string, steps: StepBuilder): void {
    const call = this.forSession(sessionToken);

    if (call) {
      this.endCall(call.callId, "ended", steps);
    }
  }

  private endCall(
    callId: string,
    reason: "busy" | "ended" | "rejected" | "unavailable",
    steps: StepBuilder,
  ): void {
    const call = this.calls.get(callId);

    if (!call) {
      return;
    }

    const wasActive = call.state === "active";
    this.calls.delete(callId);
    steps.push({
      adapter: "timer",
      key: callId,
      kind: "cancel",
      timerType: "direct-call-timeout",
    });

    const sessionTokens = [call.initiatorSessionToken, call.targetSessionToken];
    for (const sessionToken of sessionTokens) {
      if (!this.context.sessions.has(sessionToken)) {
        continue;
      }

      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken,
        message: {
          type: "direct:ended",
          payload: { callId, reason },
        },
      });
    }

    if (wasActive) {
      for (const sessionToken of sessionTokens) {
        this.context.appendMediaRefresh(steps, sessionToken, "direct-call");
      }

      this.context.refreshProjections(steps);
    }
  }
}
