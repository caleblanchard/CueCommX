import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionStore } from "../src/auth/session-store.js";
import { DatabaseService } from "../src/db/database.js";
import {
  type OperatorSessionProjectionSession,
  type OperatorSessionCoordinationResult,
  type OperatorSessionCoordinationStep,
  OperatorSessionCoordination,
} from "../src/realtime/operator-session-coordination.js";

function transportMessages(
  result: OperatorSessionCoordinationResult,
  type: string,
): Array<{ payload?: unknown; sessionToken: string; type: string }> {
  return result.steps
    .filter((step): step is Extract<OperatorSessionCoordinationStep, { adapter: "transport"; kind: "send" }> =>
      step.adapter === "transport" && step.kind === "send" && step.message.type === type
    )
    .map((step) => ({
      payload: step.message.payload,
      sessionToken: step.sessionToken,
      type: step.message.type,
    }));
}

function mediaSteps(
  result: OperatorSessionCoordinationResult,
  kind: "reconcile" | "register" | "unregister",
): Array<Extract<OperatorSessionCoordinationStep, { adapter: "media-routing"; kind: typeof kind }>> {
  return result.steps.filter(
    (step): step is Extract<OperatorSessionCoordinationStep, { adapter: "media-routing"; kind: typeof kind }> =>
      step.adapter === "media-routing" && step.kind === kind,
  );
}

function projectionSession(
  coordinator: OperatorSessionCoordination,
  sessionToken: string,
): OperatorSessionProjectionSession | undefined {
  return coordinator.readProjectionSnapshot().sessions.find((session) => session.sessionToken === sessionToken);
}

describe("OperatorSessionCoordination", () => {
  let database: DatabaseService;
  let sessionStore: SessionStore;
  let workingDirectory: string;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), "cuecommx-operator-session-"));
    database = new DatabaseService({
      dbPath: join(workingDirectory, "cuecommx.db"),
    });
    sessionStore = new SessionStore();
  });

  afterEach(() => {
    database.close();
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  function createCoordinator(): OperatorSessionCoordination {
    return new OperatorSessionCoordination({
      database,
      maxUsers: 30,
      sessionStore,
    });
  }

  function createSessionToken(userId: string): string {
    return sessionStore.createSession(userId).token;
  }

  function attach(
    coordinator: OperatorSessionCoordination,
    sessionToken: string,
    connectHost: string = "127.0.0.1",
  ): OperatorSessionCoordinationResult {
    return coordinator.lifecycle({
      at: Date.now(),
      change: {
        type: "session.attach",
        sessionToken,
        connectHost,
      },
    });
  }

  it("attaches a session and emits ready, presence, and media registration steps", () => {
    const operatorId = database.createUser({
      username: "Director",
      role: "operator",
    });
    database.grantChannelPermissions(operatorId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
      { channelId: "ch-audio", canTalk: false, canListen: true },
    ]);

    const coordinator = createCoordinator();
    const sessionToken = createSessionToken(operatorId);

    const result = attach(coordinator, sessionToken, "cuecommx.local");

    expect(result.decision).toBe("accepted");
    expect(coordinator.getConnectedUserIds()).toEqual([operatorId]);
    expect(mediaSteps(result, "register")).toEqual([
      expect.objectContaining({ sessionToken }),
    ]);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ adapter: "projection", projection: "admin-dashboard" }),
        expect.objectContaining({ adapter: "projection", projection: "public-state" }),
      ]),
    );

    const [ready] = transportMessages(result, "session:ready");
    expect(ready).toMatchObject({
      sessionToken,
      payload: {
        connectedUsers: 1,
        operatorState: {
          talking: false,
          talkChannelIds: [],
          listenChannelIds: ["ch-audio", "ch-production"],
        },
        user: {
          id: operatorId,
          username: "Director",
        },
      },
    });

    expect(transportMessages(result, "presence:update")).toEqual([
      {
        sessionToken,
        type: "presence:update",
        payload: { connectedUsers: 1 },
      },
    ]);
    expect(transportMessages(result, "online:users")).toEqual([
      {
        sessionToken,
        type: "online:users",
        payload: { users: [{ id: operatorId, username: "Director" }] },
      },
    ]);
  });

  it("restores other operators when the all-page initiator disconnects", () => {
    const pagerId = database.createUser({
      username: "Director",
      role: "operator",
    });
    database.grantChannelPermissions(pagerId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
      { channelId: "ch-audio", canTalk: true, canListen: true },
    ]);

    const listenerId = database.createUser({
      username: "Camera 1",
      role: "operator",
    });
    database.grantChannelPermissions(listenerId, [
      { channelId: "ch-production", canTalk: false, canListen: true },
      { channelId: "ch-stage", canTalk: false, canListen: true },
    ]);

    const coordinator = createCoordinator();
    const pagerSessionToken = createSessionToken(pagerId);
    const listenerSessionToken = createSessionToken(listenerId);
    attach(coordinator, pagerSessionToken);
    attach(coordinator, listenerSessionToken);

    coordinator.command({
      at: Date.now(),
      actorSessionToken: listenerSessionToken,
      command: { type: "listen.set", channelId: "ch-stage", listening: false },
    });

    coordinator.command({
      at: Date.now(),
      actorSessionToken: pagerSessionToken,
      command: { type: "all-page.start" },
    });

    const result = coordinator.lifecycle({
      at: Date.now(),
      change: {
        type: "session.detach",
        reason: "disconnect",
        sessionToken: pagerSessionToken,
      },
    });

    const listenerState = projectionSession(coordinator, listenerSessionToken);
    expect(listenerState?.state).toEqual({
      talking: false,
      talkChannelIds: [],
      listenChannelIds: ["ch-production"],
    });
    expect(coordinator.readProjectionSnapshot().allPage).toBeNull();
    expect(transportMessages(result, "allpage:inactive")).toEqual([
      {
        sessionToken: listenerSessionToken,
        type: "allpage:inactive",
        payload: {},
      },
    ]);
  });

  it("routes channel signals to listeners and clears them on acknowledgment", () => {
    const senderId = database.createUser({
      username: "Director",
      role: "operator",
    });
    database.grantChannelPermissions(senderId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const listenerId = database.createUser({
      username: "Camera 1",
      role: "operator",
    });
    database.grantChannelPermissions(listenerId, [
      { channelId: "ch-production", canTalk: false, canListen: true },
    ]);

    const coordinator = createCoordinator();
    const senderSessionToken = createSessionToken(senderId);
    const listenerSessionToken = createSessionToken(listenerId);
    attach(coordinator, senderSessionToken);
    attach(coordinator, listenerSessionToken);

    const sendResult = coordinator.command({
      at: Date.now(),
      actorSessionToken: senderSessionToken,
      command: {
        type: "signal.send",
        signalType: "call",
        targetChannelId: "ch-production",
      },
    });

    const [incoming] = transportMessages(sendResult, "signal:incoming");
    expect(incoming).toMatchObject({
      sessionToken: listenerSessionToken,
      payload: {
        fromUsername: "Director",
        signalType: "call",
        targetChannelId: "ch-production",
      },
    });
    expect(transportMessages(sendResult, "signal:incoming")).toHaveLength(1);
    expect(sendResult.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "timer",
          kind: "schedule",
          timerType: "signal-expire",
        }),
      ]),
    );

    const signalId = (incoming?.payload as { signalId: string }).signalId;
    const ackResult = coordinator.command({
      at: Date.now(),
      actorSessionToken: listenerSessionToken,
      command: {
        type: "signal.ack",
        signalId,
      },
    });

    expect(transportMessages(ackResult, "signal:cleared")).toEqual(
      expect.arrayContaining([
        {
          sessionToken: senderSessionToken,
          type: "signal:cleared",
          payload: { signalId },
        },
        {
          sessionToken: listenerSessionToken,
          type: "signal:cleared",
          payload: { signalId },
        },
      ]),
    );
    expect(ackResult.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapter: "timer",
          kind: "cancel",
          key: signalId,
          timerType: "signal-expire",
        }),
      ]),
    );
  });

  it("handles direct call request, accept, and end while updating media context", () => {
    const initiatorId = database.createUser({
      username: "Director",
      role: "operator",
    });
    database.grantChannelPermissions(initiatorId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const targetId = database.createUser({
      username: "A2",
      role: "operator",
    });
    database.grantChannelPermissions(targetId, [
      { channelId: "ch-audio", canTalk: true, canListen: true },
    ]);

    const coordinator = createCoordinator();
    const initiatorSessionToken = createSessionToken(initiatorId);
    const targetSessionToken = createSessionToken(targetId);
    attach(coordinator, initiatorSessionToken);
    attach(coordinator, targetSessionToken);

    const requestResult = coordinator.command({
      at: Date.now(),
      actorSessionToken: initiatorSessionToken,
      command: {
        type: "direct-call.request",
        targetUserId: targetId,
      },
    });

    const [incoming] = transportMessages(requestResult, "direct:incoming");
    const callId = (incoming?.payload as { callId: string }).callId;
    expect(incoming).toMatchObject({
      sessionToken: targetSessionToken,
      payload: {
        fromUserId: initiatorId,
        fromUsername: "Director",
      },
    });

    const acceptResult = coordinator.command({
      at: Date.now(),
      actorSessionToken: targetSessionToken,
      command: {
        type: "direct-call.accept",
        callId,
      },
    });

    expect(transportMessages(acceptResult, "direct:active")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionToken: initiatorSessionToken }),
        expect.objectContaining({ sessionToken: targetSessionToken }),
      ]),
    );
    expect(mediaSteps(acceptResult, "reconcile")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "direct-call", sessionToken: initiatorSessionToken }),
        expect.objectContaining({ reason: "direct-call", sessionToken: targetSessionToken }),
      ]),
    );
    expect(coordinator.readMediaRoutingContext(initiatorSessionToken)?.directCallPeerSessionToken).toBe(
      targetSessionToken,
    );
    expect(coordinator.readMediaRoutingContext(targetSessionToken)?.directCallPeerSessionToken).toBe(
      initiatorSessionToken,
    );

    const endResult = coordinator.command({
      at: Date.now(),
      actorSessionToken: initiatorSessionToken,
      command: {
        type: "direct-call.end",
        callId,
      },
    });

    expect(transportMessages(endResult, "direct:ended")).toEqual(
      expect.arrayContaining([
        {
          sessionToken: initiatorSessionToken,
          type: "direct:ended",
          payload: { callId, reason: "ended" },
        },
        {
          sessionToken: targetSessionToken,
          type: "direct:ended",
          payload: { callId, reason: "ended" },
        },
      ]),
    );
    expect(coordinator.readMediaRoutingContext(initiatorSessionToken)?.directCallPeerSessionToken).toBeUndefined();
    expect(coordinator.readMediaRoutingContext(targetSessionToken)?.directCallPeerSessionToken).toBeUndefined();
  });

  it("starts and stops IFB, then supports force-mute and unlatch admin actions", () => {
    const directorId = database.createUser({
      username: "Director",
      role: "admin",
    });
    database.grantChannelPermissions(directorId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const operatorId = database.createUser({
      username: "Camera 1",
      role: "operator",
    });
    database.grantChannelPermissions(operatorId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
      { channelId: "ch-audio", canTalk: true, canListen: true },
    ]);

    const coordinator = createCoordinator();
    const directorSessionToken = createSessionToken(directorId);
    const operatorSessionToken = createSessionToken(operatorId);
    attach(coordinator, directorSessionToken);
    attach(coordinator, operatorSessionToken);

    const ifbStartResult = coordinator.command({
      at: Date.now(),
      actorSessionToken: directorSessionToken,
      command: {
        type: "ifb.start",
        targetUserId: operatorId,
      },
    });

    expect(transportMessages(ifbStartResult, "ifb:active")).toEqual([
      {
        sessionToken: operatorSessionToken,
        type: "ifb:active",
        payload: {
          fromUserId: directorId,
          fromUsername: "Director",
          duckLevel: 0.1,
        },
      },
    ]);
    expect(coordinator.readMediaRoutingContext(operatorSessionToken)?.ifbPeerSessionToken).toBe(
      directorSessionToken,
    );

    const ifbStopResult = coordinator.command({
      at: Date.now(),
      actorSessionToken: directorSessionToken,
      command: { type: "ifb.stop" },
    });

    expect(transportMessages(ifbStopResult, "ifb:inactive")).toEqual([
      {
        sessionToken: operatorSessionToken,
        type: "ifb:inactive",
        payload: {},
      },
    ]);
    expect(coordinator.readMediaRoutingContext(operatorSessionToken)?.ifbPeerSessionToken).toBeUndefined();

    coordinator.command({
      at: Date.now(),
      actorSessionToken: operatorSessionToken,
      command: {
        type: "talk.start",
        channelIds: ["ch-production", "ch-audio"],
      },
    });

    const forceMuteResult = coordinator.admin({
      at: Date.now(),
      actorSessionToken: directorSessionToken,
      command: {
        type: "force-mute-user",
        targetUserId: operatorId,
      },
    });

    expect(transportMessages(forceMuteResult, "force-muted")).toEqual([
      {
        sessionToken: operatorSessionToken,
        type: "force-muted",
        payload: { reason: "user" },
      },
    ]);
    expect(projectionSession(coordinator, operatorSessionToken)?.state.talkChannelIds).toEqual([]);

    coordinator.command({
      at: Date.now(),
      actorSessionToken: operatorSessionToken,
      command: {
        type: "talk.start",
        channelIds: ["ch-production", "ch-audio"],
      },
    });

    const unlatchResult = coordinator.admin({
      at: Date.now(),
      actorSessionToken: directorSessionToken,
      command: {
        type: "unlatch-channel",
        channelId: "ch-production",
      },
    });

    expect(transportMessages(unlatchResult, "force-muted")).toEqual([
      {
        sessionToken: operatorSessionToken,
        type: "force-muted",
        payload: { reason: "channel", channelId: "ch-production" },
      },
    ]);
    expect(projectionSession(coordinator, operatorSessionToken)?.state).toEqual({
      talking: true,
      talkChannelIds: ["ch-audio"],
      listenChannelIds: ["ch-audio", "ch-production"],
    });
  });
});
