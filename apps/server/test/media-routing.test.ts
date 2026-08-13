import { describe, expect, it, vi } from "vitest";

import type {
  MediaRequestMessage,
  RealtimeMediaService,
  TargetedServerMessage,
} from "../src/media/service.js";
import {
  MediaRoutingModule,
  type MediaRoutingResult,
} from "../src/realtime/media-routing.js";
import type { OperatorSessionMediaRoutingContext } from "../src/realtime/types.js";

function transportMessages(
  result: MediaRoutingResult,
  type: string,
): Array<{ payload?: unknown; sessionToken: string; type: string }> {
  return result.steps
    .filter((step) => step.message.type === type)
    .map((step) => ({
      payload: step.message.payload,
      sessionToken: step.sessionToken,
      type: step.message.type,
    }));
}

function buildSession(sessionToken: string = "sess-1"): OperatorSessionMediaRoutingContext {
  return {
    channels: [{
      id: "ch-production",
      name: "Production",
      color: "#112233",
      isGlobal: false,
      channelType: "intercom",
      priority: 5,
    }],
    connectHost: "cuecommx.local",
    sessionToken,
    state: {
      listenChannelIds: ["ch-production"],
      talkChannelIds: [],
      talking: false,
    },
    user: {
      channelPermissions: [{
        canListen: true,
        canTalk: true,
        channelId: "ch-production",
      }],
      id: "user-1",
      role: "operator",
      username: "Director",
    },
  };
}

function buildCapabilitiesRequest(requestId: string = "req-1"): MediaRequestMessage {
  return {
    type: "media:capabilities:get",
    payload: { requestId },
  };
}

describe("MediaRoutingModule", () => {
  it("delegates register, reconcile, and unregister steps to the media service", async () => {
    const registerSession = vi.fn(async (): Promise<TargetedServerMessage[]> => [{
      sessionToken: "sess-1",
      message: {
        type: "media:transport:connected",
        payload: { requestId: "reg-1", transportId: "send-1" },
      },
    }]);
    const updateOperatorState = vi.fn(async (): Promise<TargetedServerMessage[]> => [{
      sessionToken: "sess-1",
      message: {
        type: "media:consumer:state",
        payload: {
          activeChannelIds: ["ch-production"],
          consumerId: "cons-1",
          producerUserId: "user-2",
          producerUsername: "A2",
        },
      },
    }]);
    const refreshSession = vi.fn(async (): Promise<TargetedServerMessage[]> => [{
      sessionToken: "sess-1",
      message: {
        type: "media:consumer:state",
        payload: {
          activeChannelIds: ["ch-production"],
          consumerId: "cons-refresh-1",
          producerUserId: "user-2",
          producerUsername: "A2",
        },
      },
    }]);
    const unregisterSession = vi.fn(async (): Promise<TargetedServerMessage[]> => [{
      sessionToken: "sess-1",
      message: {
        type: "media:producer:closed",
        payload: { producerId: "prod-1", requestId: "unreg-1" },
      },
    }]);

    const module = new MediaRoutingModule({
      mediaService: {
        close: async () => undefined,
        handleRequest: async () => [],
        refreshSession,
        registerSession,
        unregisterSession,
        updateOperatorState,
      } satisfies RealtimeMediaService,
    });

    const session = buildSession();
    const readSession = vi.fn(() => session);

    const registerResult = await module.applyCoordinationStep(
      { adapter: "media-routing", kind: "register", sessionToken: "sess-1" },
      readSession,
    );
    const reconcileResult = await module.applyCoordinationStep(
      { adapter: "media-routing", kind: "reconcile", reason: "refresh", sessionToken: "sess-1" },
      readSession,
    );
    const unregisterResult = await module.applyCoordinationStep(
      { adapter: "media-routing", kind: "unregister", sessionToken: "sess-1" },
      readSession,
    );

    expect(registerSession).toHaveBeenCalledWith(session);
    expect(refreshSession).toHaveBeenCalledWith(session);
    expect(updateOperatorState).not.toHaveBeenCalled();
    expect(unregisterSession).toHaveBeenCalledWith("sess-1");
    expect(transportMessages(registerResult, "media:transport:connected")).toHaveLength(1);
    expect(transportMessages(reconcileResult, "media:consumer:state")).toHaveLength(1);
    expect(transportMessages(unregisterResult, "media:producer:closed")).toHaveLength(1);
  });

  it("rejects media requests when the session cannot be resolved", async () => {
    const module = new MediaRoutingModule({
      mediaService: {
        close: async () => undefined,
        handleRequest: async () => [],
        refreshSession: async () => [],
        registerSession: async () => [],
        unregisterSession: async () => [],
        updateOperatorState: async () => [],
      },
    });

    const result = await module.handleRequest(
      {
        message: buildCapabilitiesRequest("req-unauthorized"),
        sessionToken: "missing-session",
      },
      () => undefined,
    );

    expect(result).toMatchObject({
      decision: "rejected",
      rejection: {
        code: "unauthorized",
        message: "Authenticate the realtime session first.",
      },
    });
    expect(transportMessages(result, "signal:error")).toEqual([{
      sessionToken: "missing-session",
      type: "signal:error",
      payload: {
        code: "unauthorized",
        message: "Authenticate the realtime session first.",
      },
    }]);
  });

  it("returns media errors with the request id preserved", async () => {
    const module = new MediaRoutingModule({
      mediaService: {
        close: async () => undefined,
        handleRequest: async () => {
          throw new Error("Router unavailable.");
        },
        refreshSession: async () => [],
        registerSession: async () => [],
        unregisterSession: async () => [],
        updateOperatorState: async () => [],
      },
    });

    const result = await module.handleRequest(
      {
        message: buildCapabilitiesRequest("req-42"),
        sessionToken: "sess-1",
      },
      () => buildSession(),
    );

    expect(result).toMatchObject({
      decision: "rejected",
      rejection: {
        code: "media-error",
        message: "Router unavailable.",
      },
    });
    expect(transportMessages(result, "signal:error")).toEqual([{
      sessionToken: "sess-1",
      type: "signal:error",
      payload: {
        code: "media-error",
        message: "Router unavailable.",
        requestId: "req-42",
      },
    }]);
  });
});
