import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { WebSocket } from "ws";

import { SessionStore } from "../src/auth/session-store.js";
import { createApp, handleOscMuteUserCommand } from "../src/app.js";
import type { CueCommXConfig } from "../src/config.js";
import { DatabaseService } from "../src/db/database.js";
import type { MediaSessionContext, RealtimeMediaService } from "../src/media/service.js";
import { hashPin } from "../src/auth/pin.js";

function buildConfig(workingDirectory: string, overrides: Partial<CueCommXConfig> = {}): CueCommXConfig {
  return {
    serverName: "Main Church",
    host: "127.0.0.1",
    port: 0,
    httpsPort: 3443,
    rtcMinPort: 40000,
    rtcMaxPort: 41000,
    announcedIp: undefined,
    dataDir: workingDirectory,
    dbFile: "cuecommx.db",
    dbPath: join(workingDirectory, "cuecommx.db"),
    maxUsers: 30,
    maxChannels: 16,
    logLevel: "info",
    ...overrides,
  };
}

function toWebSocketUrl(address: string): string {
  return address.replace("http://", "ws://").replace(/\/$/, "");
}

function createJsonMessageCollector(socket: WebSocket) {
  const queuedMessages: Array<{ payload?: unknown; type: string }> = [];
  const waiters: Array<{
    resolve: (message: { payload?: unknown; type: string }) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    type: string;
  }> = [];

  const handleMessage = (payload: Buffer): void => {
    const parsed = JSON.parse(payload.toString()) as { payload?: unknown; type: string };
    const waiterIndex = waiters.findIndex((waiter) => waiter.type === parsed.type);

    if (waiterIndex !== -1) {
      const [waiter] = waiters.splice(waiterIndex, 1);

      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(parsed);
      }

      return;
    }

    queuedMessages.push(parsed);
  };

  socket.on("message", handleMessage);

  return {
    async next<T>(type: string, timeoutMs: number = 2_000): Promise<T> {
      const existingIndex = queuedMessages.findIndex((message) => message.type === type);

      if (existingIndex !== -1) {
        const [message] = queuedMessages.splice(existingIndex, 1);

        if (!message) {
          throw new Error(`Queued websocket message "${type}" was missing.`);
        }

        return message as T;
      }

      return await new Promise<T>((resolve, reject) => {
        const waiter = {
          resolve: (message: { payload?: unknown; type: string }) => resolve(message as T),
          reject,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);

            if (index !== -1) {
              waiters.splice(index, 1);
            }

            reject(new Error(`Timed out waiting for websocket message "${type}".`));
          }, timeoutMs),
          type,
        };

        waiters.push(waiter);
      });
    },
    stop(): void {
      socket.off("message", handleMessage);

      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Stopped waiting for websocket messages."));
      }
    },
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs: number = 2_000,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out during ${label}.`));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createMediaServiceSpy(updateStates: MediaSessionContext[]): RealtimeMediaService {
  return {
    async close() {
      return;
    },
    async handleRequest() {
      return [];
    },
    async refreshSession() {
      return [];
    },
    async registerSession() {
      return [];
    },
    async unregisterSession() {
      return [];
    },
    async updateOperatorState(session) {
      updateStates.push({
        ...session,
        channels: [...session.channels],
        state: {
          ...session.state,
          listenChannelIds: [...session.state.listenChannelIds],
          talkChannelIds: [...session.state.talkChannelIds],
        },
        user: {
          ...session.user,
          channelPermissions: [...session.user.channelPermissions],
        },
      });
      return [];
    },
  };
}

describe("server regressions", () => {
  let database: DatabaseService;
  let sessionStore: SessionStore;
  let workingDirectory: string;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), "cuecommx-regressions-"));
    database = new DatabaseService({
      dbPath: join(workingDirectory, "cuecommx.db"),
    });
    sessionStore = new SessionStore();
  });

  afterEach(() => {
    if (database) {
      database.close();
    }
    rmSync(workingDirectory, { force: true, recursive: true });
  });

  it("returns stored preferences when resuming an authenticated session", async () => {
    const userId = database.createUser({
      username: "Stage",
      role: "operator",
      pinHash: hashPin("1234"),
    });
    database.grantChannelPermissions(userId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);
    database.saveUserPreferences(userId, {
      channelOrder: ["ch-production"],
      masterVolume: 72,
      talkMode: "latched",
    });

    const app = createApp({
      config: buildConfig(workingDirectory),
      database,
      mediaService: createMediaServiceSpy([]),
      sessionStore,
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Stage", pin: "1234" },
    });
    const sessionToken = (loginResponse.json() as { sessionToken: string }).sessionToken;

    const resumeResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(resumeResponse.statusCode).toBe(200);
    expect(resumeResponse.json()).toMatchObject({
      preferences: {
        channelOrder: ["ch-production"],
        masterVolume: 72,
        talkMode: "latched",
      },
      sessionToken,
      success: true,
    });

    await app.close();
  });

  it("disconnects authenticated realtime sessions when the HTTP session logs out", async () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(userId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const app = createApp({
      config: buildConfig(workingDirectory),
      database,
      mediaService: createMediaServiceSpy([]),
      sessionStore,
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "A2", pin: "2468" },
    });
    const sessionToken = (loginResponse.json() as { sessionToken: string }).sessionToken;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const messages = createJsonMessageCollector(socket);

    await once(socket, "open");
    socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken } }));
    await withTimeout(messages.next("session:ready"), "session ready");

    const closePromise = once(socket, "close");

    const logoutResponse = await app.inject({
      method: "DELETE",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(logoutResponse.statusCode).toBe(204);

    const [code] = await withTimeout(closePromise, "websocket close after logout");
    expect(code).toBe(4403);

    const statusResponse = await app.inject({
      method: "GET",
      url: "/api/status",
    });
    expect(statusResponse.json()).toMatchObject({ connectedUsers: 0 });

    messages.stop();
    await app.close();
  });

  it("closes the session when the media adapter fails during a state transition", async () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(userId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const failingMediaService: RealtimeMediaService = {
      async close() {
        return;
      },
      async handleRequest() {
        return [];
      },
      async refreshSession() {
        return [];
      },
      async registerSession() {
        return [];
      },
      async unregisterSession() {
        return [];
      },
      async updateOperatorState() {
        throw new Error("simulated media adapter failure");
      },
    };

    const app = createApp({
      config: buildConfig(workingDirectory),
      database,
      mediaService: failingMediaService,
      sessionStore,
    });

    const sessionToken = (await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "A2", pin: "2468" },
    })).json().sessionToken as string;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const messages = createJsonMessageCollector(socket);

    await once(socket, "open");
    socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken } }));
    await withTimeout(messages.next("session:ready"), "session ready");

    const closePromise = once(socket, "close");

    socket.send(JSON.stringify({
      type: "talk:start",
      payload: { channelIds: ["ch-production"] },
    }));

    const mediaError = await withTimeout(
      messages.next<{ payload: { code: string }; type: string }>("signal:error"),
      "media error message",
    );
    expect(mediaError.payload.code).toBe("media-error");

    const [code] = await withTimeout(closePromise, "websocket close after media failure");
    expect(code).toBe(1011);

    messages.stop();
    await app.close();
  });

  it("restores the operator listen selection when all-page stops", async () => {
    const mediaUpdates: MediaSessionContext[] = [];
    const mediaService = createMediaServiceSpy(mediaUpdates);

    const op1Id = database.createUser({ username: "Op1", role: "operator", pinHash: hashPin("1111") });
    database.grantChannelPermissions(op1Id, [
      { channelId: "ch-production", canTalk: true, canListen: true },
      { channelId: "ch-audio", canTalk: true, canListen: true },
    ]);

    const op2Id = database.createUser({ username: "Op2", role: "operator", pinHash: hashPin("2222") });
    database.grantChannelPermissions(op2Id, [
      { channelId: "ch-production", canTalk: true, canListen: true },
      { channelId: "ch-audio", canTalk: false, canListen: true },
    ]);

    const app = createApp({
      config: buildConfig(workingDirectory),
      database,
      mediaService,
      sessionStore,
    });

    const op1Token = (await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Op1", pin: "1111" },
    })).json().sessionToken as string;
    const op2Token = (await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Op2", pin: "2222" },
    })).json().sessionToken as string;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const op1Socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const op1Messages = createJsonMessageCollector(op1Socket);
    await once(op1Socket, "open");
    op1Socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: op1Token } }));
    await withTimeout(op1Messages.next("session:ready"), "op1 session ready");

    const op2Socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const op2Messages = createJsonMessageCollector(op2Socket);
    await once(op2Socket, "open");
    op2Socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: op2Token } }));
    await withTimeout(op2Messages.next("session:ready"), "op2 session ready");

    op2Socket.send(JSON.stringify({
      type: "listen:toggle",
      payload: { channelId: "ch-audio", listening: false },
    }));
    const reducedListenState = await withTimeout(
      op2Messages.next<{ payload: { listenChannelIds: string[] }; type: string }>("operator-state"),
      "reduced listen state",
    );
    expect(reducedListenState.payload.listenChannelIds).toEqual(["ch-production"]);

    op1Socket.send(JSON.stringify({ type: "allpage:start", payload: {} }));
    await withTimeout(op1Messages.next("allpage:active"), "op1 allpage active");
    await withTimeout(op2Messages.next("allpage:active"), "op2 allpage active");

    mediaUpdates.length = 0;

    op1Socket.send(JSON.stringify({ type: "allpage:stop", payload: {} }));

    const [inactiveMessage, restoredState] = await Promise.all([
      withTimeout(op2Messages.next<{ type: string }>("allpage:inactive"), "op2 allpage inactive"),
      withTimeout(
        op2Messages.next<{ payload: { listenChannelIds: string[] }; type: string }>("operator-state"),
        "restored listen state after allpage stop",
      ),
    ]);

    expect(inactiveMessage.type).toBe("allpage:inactive");
    expect(restoredState.payload.listenChannelIds).toEqual(["ch-production"]);
    expect(
      mediaUpdates.some(
        (update) =>
          update.sessionToken === op2Token &&
          update.state.listenChannelIds.length === 1 &&
          update.state.listenChannelIds[0] === "ch-production",
      ),
    ).toBe(true);

    op1Socket.close();
    op2Socket.close();
    await Promise.all([once(op1Socket, "close"), once(op2Socket, "close")]);
    op1Messages.stop();
    op2Messages.stop();
    await app.close();
  });

  it("restores other operators after the all-page initiator disconnects", async () => {
    const mediaUpdates: MediaSessionContext[] = [];
    const mediaService = createMediaServiceSpy(mediaUpdates);

    const op1Id = database.createUser({ username: "Op1", role: "operator", pinHash: hashPin("1111") });
    database.grantChannelPermissions(op1Id, [
      { channelId: "ch-production", canTalk: true, canListen: true },
      { channelId: "ch-audio", canTalk: true, canListen: true },
    ]);

    const op2Id = database.createUser({ username: "Op2", role: "operator", pinHash: hashPin("2222") });
    database.grantChannelPermissions(op2Id, [
      { channelId: "ch-production", canTalk: true, canListen: true },
      { channelId: "ch-audio", canTalk: false, canListen: true },
    ]);

    const app = createApp({
      config: buildConfig(workingDirectory),
      database,
      mediaService,
      sessionStore,
    });

    const op1Token = (await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Op1", pin: "1111" },
    })).json().sessionToken as string;
    const op2Token = (await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Op2", pin: "2222" },
    })).json().sessionToken as string;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const op1Socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const op1Messages = createJsonMessageCollector(op1Socket);
    await once(op1Socket, "open");
    op1Socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: op1Token } }));
    await withTimeout(op1Messages.next("session:ready"), "op1 session ready");

    const op2Socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const op2Messages = createJsonMessageCollector(op2Socket);
    await once(op2Socket, "open");
    op2Socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: op2Token } }));
    await withTimeout(op2Messages.next("session:ready"), "op2 session ready");

    op2Socket.send(JSON.stringify({
      type: "listen:toggle",
      payload: { channelId: "ch-audio", listening: false },
    }));
    await withTimeout(op2Messages.next("operator-state"), "reduced listen state");

    op1Socket.send(JSON.stringify({ type: "allpage:start", payload: {} }));
    await withTimeout(op1Messages.next("allpage:active"), "op1 allpage active");
    await withTimeout(op2Messages.next("allpage:active"), "op2 allpage active");

    mediaUpdates.length = 0;

    const op1Closed = once(op1Socket, "close");
    op1Socket.close();
    await withTimeout(op1Closed, "op1 disconnect");

    const [inactiveMessage, restoredState] = await Promise.all([
      withTimeout(op2Messages.next<{ type: string }>("allpage:inactive"), "op2 allpage inactive"),
      withTimeout(
        op2Messages.next<{ payload: { listenChannelIds: string[] }; type: string }>("operator-state"),
        "restored listen state after disconnect",
      ),
    ]);

    expect(inactiveMessage.type).toBe("allpage:inactive");
    expect(restoredState.payload.listenChannelIds).toEqual(["ch-production"]);
    expect(
      mediaUpdates.some(
        (update) =>
          update.sessionToken === op2Token &&
          update.state.listenChannelIds.length === 1 &&
          update.state.listenChannelIds[0] === "ch-production",
      ),
    ).toBe(true);

    op2Socket.close();
    await once(op2Socket, "close");
    op1Messages.stop();
    op2Messages.stop();
    await app.close();
  });

  it("rejects deleting an active recording file", async () => {
    database.createUser({ username: "Admin", role: "admin", pinHash: hashPin("1234") });

    const app = createApp({
      config: buildConfig(workingDirectory),
      database,
      mediaService: createMediaServiceSpy([]),
      sessionStore,
    });

    const adminToken = (await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Admin", pin: "1234" },
    })).json().sessionToken as string;

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/admin/recording/start",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { channelId: "ch-production" },
    });
    expect(startResponse.statusCode).toBe(200);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/admin/recordings",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const filename = (listResponse.json() as Array<{ filename: string }>)[0]?.filename;
    expect(filename).toBeTruthy();

    const deleteWhileActiveResponse = await app.inject({
      method: "DELETE",
      url: `/api/admin/recordings/${encodeURIComponent(filename!)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleteWhileActiveResponse.statusCode).toBe(409);

    const stopResponse = await app.inject({
      method: "POST",
      url: "/api/admin/recording/stop",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { channelId: "ch-production" },
    });
    expect(stopResponse.statusCode).toBe(200);

    const deleteAfterStopResponse = await app.inject({
      method: "DELETE",
      url: `/api/admin/recordings/${encodeURIComponent(filename!)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleteAfterStopResponse.statusCode).toBe(204);

    await app.close();
  });

  it("ignores OSC unmute commands and only force-mutes on mute", () => {
    const realtimeService = {
      forceMuteUser: vi.fn(async () => undefined),
    };

    handleOscMuteUserCommand(realtimeService, "user-1", false);
    expect(realtimeService.forceMuteUser).not.toHaveBeenCalled();

    handleOscMuteUserCommand(realtimeService, "user-1", true);
    expect(realtimeService.forceMuteUser).toHaveBeenCalledWith("user-1");
  });
});
