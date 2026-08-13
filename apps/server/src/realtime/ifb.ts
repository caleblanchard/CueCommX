import type { StepBuilder } from "./steps.js";
import type {
  CoordinationSession,
  FeatureContext,
  IFBState,
  OperatorSessionCoordinationResult,
} from "./types.js";

const DEFAULT_IFB_DUCK_LEVEL = 0.1;

export class IFBFeature {
  private state: IFBState | undefined;

  constructor(private readonly context: FeatureContext) {}

  snapshot(): IFBState | null {
    return this.state ? { ...this.state } : null;
  }

  peerSessionTokenFor(sessionToken: string): string | undefined {
    return this.state?.targetSessionToken === sessionToken ? this.state.directorSessionToken : undefined;
  }

  start(session: CoordinationSession, targetUserId: string): OperatorSessionCoordinationResult {
    if (session.user.role !== "admin" && session.user.role !== "operator") {
      return this.context.reject("forbidden", "Only admins and operators can use IFB.", session.sessionToken);
    }

    if (targetUserId === session.user.id) {
      return this.context.reject("invalid-message", "Cannot IFB yourself.", session.sessionToken);
    }

    if (this.state) {
      return this.context.reject("conflict", "An IFB session is already active.", session.sessionToken);
    }

    const target = this.context.findSessionByUserId(targetUserId);

    if (!target) {
      return this.context.reject("invalid-state", "Target user is not online.", session.sessionToken);
    }

    return this.context.accept((steps) => {
      this.state = {
        directorSessionToken: session.sessionToken,
        directorUserId: session.user.id,
        directorUsername: session.user.username,
        duckLevel: DEFAULT_IFB_DUCK_LEVEL,
        targetSessionToken: target.sessionToken,
        targetUserId,
      };

      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: target.sessionToken,
        message: {
          type: "ifb:active",
          payload: {
            fromUserId: session.user.id,
            fromUsername: session.user.username,
            duckLevel: DEFAULT_IFB_DUCK_LEVEL,
          },
        },
      });
      this.context.appendMediaRefresh(steps, session.sessionToken, "ifb");
      this.context.appendMediaRefresh(steps, target.sessionToken, "ifb");
      this.context.refreshProjections(steps);
    });
  }

  stop(session: CoordinationSession): OperatorSessionCoordinationResult {
    if (!this.state) {
      return this.context.reject("invalid-state", "No IFB session is active.", session.sessionToken);
    }

    if (this.state.directorSessionToken !== session.sessionToken && session.user.role !== "admin") {
      return this.context.reject("forbidden", "Only the IFB director or an admin can stop IFB.", session.sessionToken);
    }

    return this.context.accept((steps) => {
      this.end(steps);
    });
  }

  endForSession(sessionToken: string, steps: StepBuilder): void {
    if (
      this.state &&
      (this.state.directorSessionToken === sessionToken || this.state.targetSessionToken === sessionToken)
    ) {
      this.end(steps);
    }
  }

  private end(steps: StepBuilder): void {
    if (!this.state) {
      return;
    }

    const current = this.state;
    this.state = undefined;

    if (this.context.sessions.has(current.targetSessionToken)) {
      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: current.targetSessionToken,
        message: {
          type: "ifb:inactive",
          payload: {},
        },
      });
      this.context.appendMediaRefresh(steps, current.targetSessionToken, "ifb");
    }

    this.context.appendMediaRefresh(steps, current.directorSessionToken, "ifb");
    this.context.refreshProjections(steps);
  }
}
