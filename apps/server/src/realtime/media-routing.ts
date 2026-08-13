import type { ServerSignalingMessage } from "@cuecommx/protocol";

import type {
  MediaRequestMessage,
  RealtimeMediaService,
  TargetedServerMessage,
} from "../media/service.js";

import type {
  OperatorSessionCoordinationStep,
  OperatorSessionMediaRoutingContext,
} from "./operator-session-coordination.js";

type MediaRoutingCoordinationStep = Extract<OperatorSessionCoordinationStep, { adapter: "media-routing" }>;

type MediaRoutingTransportStep = {
  adapter: "transport";
  kind: "send";
  message: ServerSignalingMessage;
  sessionToken: string;
};

export interface MediaRoutingResult {
  decision: "accepted" | "noop" | "rejected";
  rejection?: {
    code: "media-error" | "unauthorized";
    message: string;
  };
  steps: readonly MediaRoutingTransportStep[];
}

export interface MediaRoutingModuleOptions {
  mediaService?: RealtimeMediaService;
}

export class MediaRoutingModule {
  private readonly mediaService?: RealtimeMediaService;

  constructor(options: MediaRoutingModuleOptions) {
    this.mediaService = options.mediaService;
  }

  async applyCoordinationStep(
    step: MediaRoutingCoordinationStep,
    readSession: (sessionToken: string) => OperatorSessionMediaRoutingContext | undefined,
  ): Promise<MediaRoutingResult> {
    if (!this.mediaService) {
      return this.noop();
    }

    try {
      if (step.kind === "unregister") {
        return this.accept(await this.mediaService.unregisterSession(step.sessionToken));
      }

      const session = readSession(step.sessionToken);

      if (!session) {
        return this.noop();
      }

      if (step.kind === "register") {
        return this.accept(await this.mediaService.registerSession(session));
      }

      return this.accept(
        await (step.reason === "refresh"
          ? this.mediaService.refreshSession(session)
          : this.mediaService.updateOperatorState(session)),
      );
    } catch (mediaError) {
      return this.reject(
        "media-error",
        mediaError instanceof Error ? mediaError.message : "Media routing failed.",
        step.sessionToken,
      );
    }
  }

  async handleRequest(
    input: {
      message: MediaRequestMessage;
      sessionToken: string;
    },
    readSession: (sessionToken: string) => OperatorSessionMediaRoutingContext | undefined,
  ): Promise<MediaRoutingResult> {
    const session = readSession(input.sessionToken);

    if (!session) {
      return this.reject("unauthorized", "Authenticate the realtime session first.", input.sessionToken);
    }

    if (!this.mediaService) {
      return this.noop();
    }

    try {
      return this.accept(await this.mediaService.handleRequest(session, input.message));
    } catch (mediaError) {
      const requestId = input.message.payload.requestId;

      return this.reject(
        "media-error",
        mediaError instanceof Error ? mediaError.message : "Media request failed.",
        input.sessionToken,
        requestId,
      );
    }
  }

  private accept(messages: readonly TargetedServerMessage[]): MediaRoutingResult {
    return {
      decision: "accepted",
      steps: messages.map((entry) => ({
        adapter: "transport" as const,
        kind: "send" as const,
        message: entry.message,
        sessionToken: entry.sessionToken,
      })),
    };
  }

  private noop(): MediaRoutingResult {
    return {
      decision: "noop",
      steps: [],
    };
  }

  private reject(
    code: "media-error" | "unauthorized",
    message: string,
    sessionToken: string,
    requestId?: string,
  ): MediaRoutingResult {
    return {
      decision: "rejected",
      rejection: { code, message },
      steps: [{
        adapter: "transport",
        kind: "send",
        sessionToken,
        message: {
          type: "signal:error",
          payload: {
            code,
            message,
            ...(requestId ? { requestId } : {}),
          },
        },
      }],
    };
  }
}
