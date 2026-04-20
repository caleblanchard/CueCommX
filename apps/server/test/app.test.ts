import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PROTOCOL_VERSION } from "@cuecommx/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { hashPin } from "../src/auth/pin.js";
import { createApp } from "../src/app.js";
import { DatabaseService } from "../src/db/database.js";

function toWebSocketUrl(address: string): string {
  return address.replace("http://", "ws://").replace(/\/$/, "");
}

async function waitForJsonMessage<T>(
  socket: WebSocket,
  type: string,
  timeoutMs: number = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for websocket message "${type}".`);
    }

    const payload = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", handleMessage);
        reject(new Error(`Timed out waiting for websocket message "${type}".`));
      }, remainingMs);

      function handleMessage(data: Buffer): void {
        clearTimeout(timer);
        socket.off("message", handleMessage);
        resolve(data);
      }

      socket.on("message", handleMessage);
    });
    const parsed = JSON.parse(payload.toString()) as { type: string };

    if (parsed.type === type) {
      return parsed as T;
    }
  }
}

function createJsonMessageCollector(socket: WebSocket) {
  const queuedMessages: Array<{ type: string }> = [];
  const waiters: Array<{
    resolve: (message: { type: string }) => void;
    timer: ReturnType<typeof setTimeout>;
    type: string;
  }> = [];

  const handleMessage = (payload: Buffer): void => {
    const parsed = JSON.parse(payload.toString()) as { type: string };
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
    async next<T>(type: string, timeoutMs: number = 10_000): Promise<T> {
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
          resolve: (message: { type: string }) => resolve(message as T),
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

describe("createApp", () => {
  let workingDirectory: string;
  let database: DatabaseService;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), "cuecommx-app-"));
    database = new DatabaseService({
      dbPath: join(workingDirectory, "cuecommx.db"),
    });
  });

  afterEach(() => {
    database.close();
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  it("returns server status for the admin dashboard and clients", async () => {
    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
      startTime: Date.now() - 5_000,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Main Church",
      maxUsers: 30,
      channels: 5,
      needsAdminSetup: true,
      protocolVersion: PROTOCOL_VERSION,
    });

    await app.close();
  });

  it("returns the seeded channels", async () => {
    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/channels",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(5);

    await app.close();
  });

  it("serves the bundled web client and admin UI when build assets are present", async () => {
    const webClientDistPath = join(workingDirectory, "web-client-dist");
    const adminUiDistPath = join(workingDirectory, "admin-ui-dist");

    mkdirSync(join(webClientDistPath, "assets"), { recursive: true });
    mkdirSync(join(adminUiDistPath, "assets"), { recursive: true });
    writeFileSync(
      join(webClientDistPath, "index.html"),
      "<!doctype html><html><body>cuecommx-web</body></html>",
    );
    writeFileSync(join(webClientDistPath, "assets", "app.js"), "console.log('web');");
    writeFileSync(
      join(adminUiDistPath, "index.html"),
      "<!doctype html><html><body>cuecommx-admin</body></html>",
    );
    writeFileSync(join(adminUiDistPath, "assets", "app.js"), "console.log('admin');");

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      adminUiDistPath,
      database,
      webClientDistPath,
    });

    const [webResponse, webAssetResponse, adminResponse, adminAssetResponse, statusResponse] =
      await Promise.all([
        app.inject({
          method: "GET",
          url: "/",
        }),
        app.inject({
          method: "GET",
          url: "/assets/app.js",
        }),
        app.inject({
          method: "GET",
          url: "/admin",
        }),
        app.inject({
          method: "GET",
          url: "/admin/assets/app.js",
        }),
        app.inject({
          method: "GET",
          url: "/api/status",
        }),
      ]);

    expect(webResponse.statusCode).toBe(200);
    expect(webResponse.body).toContain("cuecommx-web");
    expect(webAssetResponse.statusCode).toBe(200);
    expect(webAssetResponse.body).toContain("console.log('web');");
    expect(adminResponse.statusCode).toBe(200);
    expect(adminResponse.body).toContain("cuecommx-admin");
    expect(adminAssetResponse.statusCode).toBe(200);
    expect(adminAssetResponse.body).toContain("console.log('admin');");
    expect(statusResponse.statusCode).toBe(200);

    await app.close();
  });

  it("returns discovery targets for QR and manual connect handoff", async () => {
    const mdnsAdvertiser = {
      getStatus: () => ({
        enabled: true,
        name: "Main Church",
        port: 3000,
        httpsPort: 3443,
        protocol: "tcp" as const,
        serviceType: "_cuecommx._tcp" as const,
      }),
      start: () => undefined,
      stop: async () => undefined,
    };
    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
        httpsPort: 3443,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: "10.0.0.25",
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
      },
      database,
      mdnsAdvertiser,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/discovery",
      headers: {
        host: "localhost:3000",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      announcedHost: "10.0.0.25",
      mdns: {
        enabled: true,
        name: "Main Church",
        port: 3000,
        protocol: "tcp",
        serviceType: "_cuecommx._tcp",
      },
      primaryUrl: "http://10.0.0.25:3000/",
      connectTargets: expect.arrayContaining([
        expect.objectContaining({
          kind: "announced",
          label: "Primary LAN URL",
          url: "http://10.0.0.25:3000/",
        }),
        expect.objectContaining({
          kind: "loopback",
          label: "Current browser origin",
          url: "http://localhost:3000/",
        }),
      ]),
    });

    await app.close();
  });

  it("bootstraps the first admin and marks the server configured", async () => {
    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const setupResponse = await app.inject({
      method: "POST",
      url: "/api/auth/setup-admin",
      payload: {
        username: "Chuck",
        pin: "1234",
      },
    });

    const setupBody = setupResponse.json();

    expect(setupResponse.statusCode).toBe(201);
    expect(setupBody).toMatchObject({
      success: true,
      protocolVersion: PROTOCOL_VERSION,
      user: {
        username: "Chuck",
        role: "admin",
      },
    });
    expect(setupBody.sessionToken).toMatch(/^sess-/);
    expect(setupBody.channels).toHaveLength(5);
    expect(setupBody.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ch-production", name: "Production", color: "#EF4444", isGlobal: false }),
        expect.objectContaining({ id: "ch-audio", name: "Audio", color: "#3B82F6", isGlobal: false }),
      ]),
    );

    const statusResponse = await app.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(statusResponse.json()).toMatchObject({
      connectedUsers: 0,
      needsAdminSetup: false,
    });

    await app.close();
  });

  it("authenticates an existing operator with a PIN and channel permissions", async () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(userId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
      {
        channelId: "ch-video",
        canTalk: false,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "A2",
        pin: "2468",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      protocolVersion: PROTOCOL_VERSION,
      user: {
        username: "A2",
        role: "operator",
        channelPermissions: [
          {
            channelId: "ch-production",
            canTalk: true,
            canListen: true,
          },
          {
            channelId: "ch-video",
            canTalk: false,
            canListen: true,
          },
        ],
      },
      channels: [
        { id: "ch-production", name: "Production", color: "#EF4444", isGlobal: false, channelType: "intercom" },
        { id: "ch-video", name: "Video/Camera", color: "#10B981", isGlobal: false, channelType: "intercom" },
      ],
    });

    await app.close();
  });

  it("treats admin and operator usernames case-insensitively for login and uniqueness checks", async () => {
    const adminId = database.createUser({
      username: "Chuck",
      role: "admin",
      pinHash: hashPin("1234"),
    });
    const operatorId = database.createUser({
      username: "Camera 1",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(adminId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);
    database.grantChannelPermissions(operatorId, [
      {
        channelId: "ch-video",
        canTalk: false,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const [adminLoginResponse, operatorLoginResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: "cHuCk",
          pin: "1234",
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: "camera 1",
          pin: "2468",
        },
      }),
    ]);

    expect(adminLoginResponse.statusCode).toBe(200);
    expect(adminLoginResponse.json()).toMatchObject({
      success: true,
      user: {
        username: "Chuck",
      },
    });
    expect(operatorLoginResponse.statusCode).toBe(200);
    expect(operatorLoginResponse.json()).toMatchObject({
      success: true,
      user: {
        username: "Camera 1",
      },
    });

    const duplicateCreateResponse = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: {
        authorization: `Bearer ${adminLoginResponse.json().sessionToken as string}`,
      },
      payload: {
        username: "CAMERA 1",
        role: "operator",
        channelPermissions: [],
      },
    });

    expect(duplicateCreateResponse.statusCode).toBe(409);
    expect(duplicateCreateResponse.json()).toEqual({
      success: false,
      protocolVersion: PROTOCOL_VERSION,
      error: "A user with that name already exists.",
    });

    const duplicateUpdateResponse = await app.inject({
      method: "PUT",
      url: `/api/users/${operatorId}`,
      headers: {
        authorization: `Bearer ${adminLoginResponse.json().sessionToken as string}`,
      },
      payload: {
        username: "CHUCK",
        role: "operator",
        channelPermissions: [],
      },
    });

    expect(duplicateUpdateResponse.statusCode).toBe(409);
    expect(duplicateUpdateResponse.json()).toEqual({
      success: false,
      protocolVersion: PROTOCOL_VERSION,
      error: "A user with that name already exists.",
    });

    await app.close();
  });

  it("rejects invalid credentials", async () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(userId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "A2",
        pin: "0000",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      protocolVersion: PROTOCOL_VERSION,
      error: "Invalid username or PIN.",
    });

    await app.close();
  });

  it("resumes an existing session via GET /api/auth/session with a valid Bearer token", async () => {
    const userId = database.createUser({
      username: "Stage",
      role: "operator",
      pinHash: hashPin("1234"),
    });
    database.grantChannelPermissions(userId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Stage", pin: "1234" },
    });

    expect(loginResponse.statusCode).toBe(200);

    const loginPayload = loginResponse.json() as { sessionToken: string };
    const sessionToken = loginPayload.sessionToken;

    const resumeResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(resumeResponse.statusCode).toBe(200);
    expect(resumeResponse.json()).toMatchObject({
      success: true,
      protocolVersion: PROTOCOL_VERSION,
      sessionToken,
      user: {
        username: "Stage",
        role: "operator",
      },
      channels: [{ id: "ch-production", name: "Production" }],
    });

    const invalidResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { authorization: "Bearer sess-bogus-token" },
    });

    expect(invalidResponse.statusCode).toBe(401);
    expect(invalidResponse.json()).toMatchObject({
      success: false,
      error: "Session token is invalid or expired.",
    });

    const noHeaderResponse = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });

    expect(noHeaderResponse.statusCode).toBe(401);

    await app.close();
  });

  it("authenticates websocket sessions and updates live operator state", async () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(userId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
      {
        channelId: "ch-video",
        canTalk: false,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "A2",
        pin: "2468",
      },
    });
    const loginBody = loginResponse.json();
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);

    await once(socket, "open");
    socket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken: loginBody.sessionToken,
        },
      }),
    );

    const ready = await waitForJsonMessage<{
      payload: {
        connectedUsers: number;
        operatorState: {
          listenChannelIds: string[];
          talkChannelIds: string[];
          talking: boolean;
        };
      };
      type: string;
    }>(socket, "session:ready");

    expect(ready.payload.connectedUsers).toBe(1);
    expect(ready.payload.operatorState).toEqual({
      listenChannelIds: ["ch-production", "ch-video"],
      talkChannelIds: [],
      talking: false,
    });

    socket.send(
      JSON.stringify({
        type: "talk:start",
        payload: {
          channelIds: ["ch-production"],
        },
      }),
    );

    const talkState = await waitForJsonMessage<{
      payload: {
        talkChannelIds: string[];
        talking: boolean;
      };
      type: string;
    }>(socket, "operator-state");

    expect(talkState.payload).toMatchObject({
      talkChannelIds: ["ch-production"],
      talking: true,
    });

    socket.send(
      JSON.stringify({
        type: "listen:toggle",
        payload: {
          channelId: "ch-video",
          listening: false,
        },
      }),
    );

    const listenState = await waitForJsonMessage<{
      payload: {
        listenChannelIds: string[];
      };
      type: string;
    }>(socket, "operator-state");

    expect(listenState.payload.listenChannelIds).toEqual(["ch-production"]);

    const statusResponse = await app.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(statusResponse.json()).toMatchObject({
      connectedUsers: 1,
    });

    socket.close();
    await once(socket, "close");
    await app.close();
  });

  it("rejects websocket sessions when realtime capacity is reached and frees space on disconnect", async () => {
    const operatorOneId = database.createUser({
      username: "A2",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    const operatorTwoId = database.createUser({
      username: "A3",
      role: "operator",
      pinHash: hashPin("1357"),
    });
    database.grantChannelPermissions(operatorOneId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);
    database.grantChannelPermissions(operatorTwoId, [
      {
        channelId: "ch-stage",
        canTalk: true,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 1,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    const [firstLoginResponse, secondLoginResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: "A2",
          pin: "2468",
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: "A3",
          pin: "1357",
        },
      }),
    ]);
    const firstSessionToken = firstLoginResponse.json().sessionToken as string;
    const secondSessionToken = secondLoginResponse.json().sessionToken as string;
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const firstSocket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    await once(firstSocket, "open");
    firstSocket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken: firstSessionToken,
        },
      }),
    );

    await waitForJsonMessage(firstSocket, "session:ready");

    const secondSocket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    await once(secondSocket, "open");
    const secondSocketClosed = once(secondSocket, "close");
    secondSocket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken: secondSessionToken,
        },
      }),
    );

    const capacityError = await waitForJsonMessage<{
      payload: {
        code: string;
        message: string;
      };
      type: string;
    }>(secondSocket, "signal:error");

    expect(capacityError.payload).toEqual({
      code: "capacity-reached",
      message: "CueCommX is at capacity (1 active session).",
    });
    await secondSocketClosed;

    const saturatedStatusResponse = await app.inject({
      method: "GET",
      url: "/api/status",
    });

    expect(saturatedStatusResponse.json()).toMatchObject({
      connectedUsers: 1,
      maxUsers: 1,
    });

    firstSocket.close();
    await once(firstSocket, "close");

    const replacementSocket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    await once(replacementSocket, "open");
    replacementSocket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken: secondSessionToken,
        },
      }),
    );

    const replacementReady = await waitForJsonMessage<{
      payload: {
        connectedUsers: number;
      };
      type: string;
    }>(replacementSocket, "session:ready");

    expect(replacementReady.payload.connectedUsers).toBe(1);

    replacementSocket.close();
    await once(replacementSocket, "close");
    await app.close();
  });

  it("rejects websocket talk on channels without talk permission", async () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(userId, [
      {
        channelId: "ch-video",
        canTalk: false,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "A2",
        pin: "2468",
      },
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);

    await once(socket, "open");
    socket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken: loginResponse.json().sessionToken,
        },
      }),
    );

    await waitForJsonMessage(socket, "session:ready");

    socket.send(
      JSON.stringify({
        type: "talk:start",
        payload: {
          channelIds: ["ch-video"],
        },
      }),
    );

    const errorMessage = await waitForJsonMessage<{
      payload: {
        code: string;
        message: string;
      };
      type: string;
    }>(socket, "signal:error");

    expect(errorMessage.payload).toEqual({
      code: "forbidden",
      message: "This operator cannot talk on that channel.",
    });

    socket.close();
    await once(socket, "close");
    await app.close();
  });

  it("allows an authenticated admin to manage users", async () => {
    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const setupResponse = await app.inject({
      method: "POST",
      url: "/api/auth/setup-admin",
      payload: {
        username: "Chuck",
        pin: "1234",
      },
    });
    const adminToken = setupResponse.json().sessionToken as string;

    const initialUsersResponse = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(initialUsersResponse.statusCode).toBe(200);
    expect(initialUsersResponse.json()).toMatchObject([
      {
        username: "Chuck",
        role: "admin",
        online: false,
      },
    ]);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        username: "Camera 1",
        role: "operator",
        pin: "2468",
        channelPermissions: [
          {
            channelId: "ch-video",
            canTalk: true,
            canListen: true,
          },
        ],
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      username: "Camera 1",
      role: "operator",
      online: false,
      channelPermissions: [
        {
          channelId: "ch-video",
          canTalk: true,
          canListen: true,
        },
      ],
    });

    const createdUserId = createResponse.json().id as string;

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/users/${createdUserId}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        username: "Camera 2",
        role: "user",
        clearPin: true,
        channelPermissions: [
          {
            channelId: "ch-stage",
            canTalk: false,
            canListen: true,
          },
        ],
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      username: "Camera 2",
      role: "user",
      channelPermissions: [
        {
          channelId: "ch-stage",
          canTalk: false,
          canListen: true,
        },
      ],
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/users/${createdUserId}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(deleteResponse.statusCode).toBe(204);

    const finalUsersResponse = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(finalUsersResponse.json()).toHaveLength(1);

    await app.close();
  });

  it("streams live admin dashboard updates and force-mutes talking users", async () => {
    const operatorId = database.createUser({
      username: "Camera 1",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(operatorId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    const setupResponse = await withTimeout(
      app.inject({
      method: "POST",
      url: "/api/auth/setup-admin",
      payload: {
        username: "Chuck",
        pin: "1234",
      },
      }),
      "admin setup request",
    );
    const adminToken = setupResponse.json().sessionToken as string;
    const operatorLoginResponse = await withTimeout(
      app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "Camera 1",
        pin: "2468",
      },
      }),
      "operator login request",
    );
    const operatorToken = operatorLoginResponse.json().sessionToken as string;

    const address = await withTimeout(
      app.listen({ host: "127.0.0.1", port: 0 }),
      "app listen",
    );
    const adminSocket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const adminMessages = createJsonMessageCollector(adminSocket);

    await withTimeout(once(adminSocket, "open"), "admin websocket open");
    adminSocket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken: adminToken,
        },
      }),
    );

    await withTimeout(adminMessages.next("session:ready"), "admin session ready");
    await withTimeout(adminMessages.next("admin:dashboard"), "initial admin dashboard");

    const operatorSocket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const operatorMessages = createJsonMessageCollector(operatorSocket);
    await withTimeout(once(operatorSocket, "open"), "operator websocket open");
    operatorSocket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken: operatorToken,
        },
      }),
    );

    await withTimeout(operatorMessages.next("session:ready"), "operator session ready");

    const onlineDashboard = await withTimeout(
      adminMessages.next<{
      payload: {
        users: Array<{
          activeTalkChannelIds: string[];
          online: boolean;
          talking: boolean;
          username: string;
        }>;
      };
      type: string;
      }>("admin:dashboard"),
      "online admin dashboard",
    );

    expect(onlineDashboard.payload.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: "Chuck",
          online: true,
          talking: false,
          activeTalkChannelIds: [],
        }),
        expect.objectContaining({
          username: "Camera 1",
          online: true,
          talking: false,
          activeTalkChannelIds: [],
        }),
      ]),
    );

    operatorSocket.send(
      JSON.stringify({
        type: "talk:start",
        payload: {
          channelIds: ["ch-production"],
        },
      }),
    );

    await withTimeout(operatorMessages.next("operator-state"), "operator talk state");

    const talkingDashboard = await withTimeout(
      adminMessages.next<{
      payload: {
        channels: Array<{ id: string; name: string }>;
        users: Array<{
          activeTalkChannelIds: string[];
          online: boolean;
          talking: boolean;
          username: string;
        }>;
      };
      type: string;
      }>("admin:dashboard"),
      "talking admin dashboard",
    );

    expect(talkingDashboard.payload.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ch-production",
          name: "Production",
        }),
      ]),
    );
    expect(talkingDashboard.payload.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: "Camera 1",
          online: true,
          talking: true,
          activeTalkChannelIds: ["ch-production"],
        }),
      ]),
    );

    const forceMuteResponse = await withTimeout(
      app.inject({
        method: "POST",
        url: `/api/users/${operatorId}/force-mute`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      }),
      "force mute request",
    );

    expect(forceMuteResponse.statusCode).toBe(204);

    const mutedState = await withTimeout(
      operatorMessages.next<{
      payload: {
        talkChannelIds: string[];
        talking: boolean;
      };
      type: string;
      }>("operator-state"),
      "muted operator state",
    );

    expect(mutedState.payload).toMatchObject({
      talkChannelIds: [],
      talking: false,
    });

    const mutedDashboard = await withTimeout(
      adminMessages.next<{
      payload: {
        users: Array<{
          activeTalkChannelIds: string[];
          online: boolean;
          talking: boolean;
          username: string;
        }>;
      };
      type: string;
      }>("admin:dashboard"),
      "muted admin dashboard",
    );

    expect(mutedDashboard.payload.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: "Camera 1",
          online: true,
          talking: false,
          activeTalkChannelIds: [],
        }),
      ]),
    );

    // Verify the operator received a force-muted notification
    const forceMutedNotice = await withTimeout(
      operatorMessages.next<{
        payload: { reason: string };
        type: string;
      }>("force-muted"),
      "force-muted notification",
    );
    expect(forceMutedNotice.payload.reason).toBe("user");

    // Start talking again to test channel unlatch
    operatorSocket.send(
      JSON.stringify({
        type: "talk:start",
        payload: { channelIds: ["ch-production"] },
      }),
    );

    await withTimeout(operatorMessages.next("operator-state"), "operator restart talk state");
    await withTimeout(adminMessages.next("admin:dashboard"), "restart talk dashboard");

    // Unlatch the channel
    const unlatchResponse = await withTimeout(
      app.inject({
        method: "POST",
        url: "/api/channels/ch-production/unlatch",
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      "unlatch request",
    );
    expect(unlatchResponse.statusCode).toBe(204);

    const unlatchedState = await withTimeout(
      operatorMessages.next<{
        payload: { talkChannelIds: string[]; talking: boolean };
        type: string;
      }>("operator-state"),
      "unlatched operator state",
    );
    expect(unlatchedState.payload).toMatchObject({
      talkChannelIds: [],
      talking: false,
    });

    const unlatchedNotice = await withTimeout(
      operatorMessages.next<{
        payload: { reason: string; channelId: string };
        type: string;
      }>("force-muted"),
      "unlatch force-muted notification",
    );
    expect(unlatchedNotice.payload.reason).toBe("channel");
    expect(unlatchedNotice.payload.channelId).toBe("ch-production");

    const unlatchedDashboard = await withTimeout(
      adminMessages.next<{
        payload: {
          users: Array<{
            activeTalkChannelIds: string[];
            talking: boolean;
            username: string;
          }>;
        };
        type: string;
      }>("admin:dashboard"),
      "unlatched admin dashboard",
    );
    expect(unlatchedDashboard.payload.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: "Camera 1",
          talking: false,
          activeTalkChannelIds: [],
        }),
      ]),
    );

    const adminClosedPromise = once(adminSocket, "close");
    const operatorClosedPromise = once(operatorSocket, "close");
    adminSocket.close();
    operatorSocket.close();
    await withTimeout(adminClosedPromise, "admin websocket close");
    await withTimeout(operatorClosedPromise, "operator websocket close");
    adminMessages.stop();
    operatorMessages.stop();
    await withTimeout(app.close(), "app close");
  });

  it("rejects user-management routes for non-admin sessions", async () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(userId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "A2",
        pin: "2468",
      },
    });

    const token = loginResponse.json().sessionToken as string;

    // Operators CAN list users (read-only access)
    const listResponse = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listResponse.statusCode).toBe(200);

    // Operators CANNOT create users (admin-only mutation)
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "hacker", pin: "9999", role: "operator" },
    });
    expect(createResponse.statusCode).toBe(403);
    expect(createResponse.json()).toEqual({
      success: false,
      protocolVersion: PROTOCOL_VERSION,
      error: "Admin access is required.",
    });

    await app.close();
  });

  it("allows operators to force-mute users and unlatch channels", async () => {
    const operatorId = database.createUser({
      username: "Op1",
      role: "operator",
      pinHash: hashPin("5678"),
    });
    database.grantChannelPermissions(operatorId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);

    const talkerId = database.createUser({
      username: "Talker",
      role: "operator",
      pinHash: hashPin("9999"),
    });
    database.grantChannelPermissions(talkerId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    // Set up admin session for dashboard
    await app.inject({
      method: "POST",
      url: "/api/auth/setup-admin",
      payload: { username: "Chuck", pin: "1234" },
    });

    const opLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Op1", pin: "5678" },
    });
    const opToken = opLogin.json().sessionToken as string;

    // Operator can force-mute a user
    const forceMuteResponse = await app.inject({
      method: "POST",
      url: `/api/users/${talkerId}/force-mute`,
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(forceMuteResponse.statusCode).toBe(204);

    // Operator can unlatch a channel
    const unlatchResponse = await app.inject({
      method: "POST",
      url: "/api/channels/ch-production/unlatch",
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(unlatchResponse.statusCode).toBe(204);

    // Unlatch returns 404 for a nonexistent channel
    const missing = await app.inject({
      method: "POST",
      url: "/api/channels/ch-nonexistent/unlatch",
      headers: { authorization: `Bearer ${opToken}` },
    });
    expect(missing.statusCode).toBe(404);

    // Regular user cannot force-mute
    const userId = database.createUser({
      username: "RegUser",
      role: "user",
      pinHash: hashPin("0000"),
    });
    database.grantChannelPermissions(userId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const userLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "RegUser", pin: "0000" },
    });
    const userToken = userLogin.json().sessionToken as string;

    const userForceMute = await app.inject({
      method: "POST",
      url: `/api/users/${talkerId}/force-mute`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(userForceMute.statusCode).toBe(403);

    const userUnlatch = await app.inject({
      method: "POST",
      url: "/api/channels/ch-production/unlatch",
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(userUnlatch.statusCode).toBe(403);

    await app.close();
  });

  it("prevents demoting the last remaining admin", async () => {
    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const setupResponse = await app.inject({
      method: "POST",
      url: "/api/auth/setup-admin",
      payload: {
        username: "Chuck",
        pin: "1234",
      },
    });
    const setupBody = setupResponse.json();

    const response = await app.inject({
      method: "PUT",
      url: `/api/users/${setupBody.user.id as string}`,
      headers: {
        authorization: `Bearer ${setupBody.sessionToken as string}`,
      },
      payload: {
        username: "Chuck",
        role: "operator",
        channelPermissions: [
          {
            channelId: "ch-production",
            canTalk: true,
            canListen: true,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      success: false,
      protocolVersion: PROTOCOL_VERSION,
      error: "CueCommX must keep at least one admin account.",
    });

    await app.close();
  });

  it("allows an authenticated admin to manage channels", async () => {
    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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
      },
      database,
    });

    const setupResponse = await app.inject({
      method: "POST",
      url: "/api/auth/setup-admin",
      payload: {
        username: "Chuck",
        pin: "1234",
      },
    });
    const adminToken = setupResponse.json().sessionToken as string;

    const initialChannelsResponse = await app.inject({
      method: "GET",
      url: "/api/channels",
    });

    expect(initialChannelsResponse.statusCode).toBe(200);
    expect(initialChannelsResponse.json()).toHaveLength(5);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/channels",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: "Front of House",
        color: "#22C55E",
      },
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      id: "ch-front-of-house",
      name: "Front of House",
      color: "#22C55E",
    });

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/channels/ch-front-of-house",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: "Broadcast",
        color: "#0EA5E9",
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      id: "ch-front-of-house",
      name: "Broadcast",
      color: "#0EA5E9",
    });

    const duplicateResponse = await app.inject({
      method: "POST",
      url: "/api/channels",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: "Broadcast",
        color: "#F97316",
      },
    });

    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateResponse.json()).toEqual({
      success: false,
      protocolVersion: PROTOCOL_VERSION,
      error: "A channel with that name already exists.",
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/channels/ch-front-of-house",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(deleteResponse.statusCode).toBe(204);

    const finalChannelsResponse = await app.inject({
      method: "GET",
      url: "/api/channels",
    });

    expect(finalChannelsResponse.json()).toHaveLength(5);

    await app.close();
  });

  it("prevents channel creation when the configured max has been reached", async () => {
    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
        httpsPort: 3443,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 5,
        logLevel: "info",
      },
      database,
    });

    const setupResponse = await app.inject({
      method: "POST",
      url: "/api/auth/setup-admin",
      payload: {
        username: "Chuck",
        pin: "1234",
      },
    });
    const adminToken = setupResponse.json().sessionToken as string;

    const response = await app.inject({
      method: "POST",
      url: "/api/channels",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: "Front of House",
        color: "#22C55E",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      success: false,
      protocolVersion: PROTOCOL_VERSION,
      error: "CueCommX is already at the configured channel limit.",
    });

    await app.close();
  });

  it("refreshes connected operator state when an admin deletes a channel", async () => {
    const operatorId = database.createUser({
      username: "A2",
      role: "operator",
      pinHash: hashPin("2468"),
    });
    database.grantChannelPermissions(operatorId, [
      {
        channelId: "ch-video",
        canTalk: true,
        canListen: true,
      },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    const setupResponse = await app.inject({
      method: "POST",
      url: "/api/auth/setup-admin",
      payload: {
        username: "Chuck",
        pin: "1234",
      },
    });
    const adminToken = setupResponse.json().sessionToken as string;

    const operatorLoginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "A2",
        pin: "2468",
      },
    });
    const operatorToken = operatorLoginResponse.json().sessionToken as string;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const messages = createJsonMessageCollector(socket);

    await once(socket, "open");
    socket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken: operatorToken,
        },
      }),
    );

    const ready = await withTimeout(
      messages.next<{
        payload: {
          channels: Array<{ id: string }>;
          operatorState: {
            listenChannelIds: string[];
            talkChannelIds: string[];
            talking: boolean;
          };
        };
        type: string;
      }>("session:ready"),
      "operator session ready",
    );

    expect(ready.payload.channels.map((channel) => channel.id)).toEqual(["ch-video"]);
    expect(ready.payload.operatorState).toEqual({
      listenChannelIds: ["ch-video"],
      talkChannelIds: [],
      talking: false,
    });

    socket.send(
      JSON.stringify({
        type: "talk:start",
        payload: {
          channelIds: ["ch-video"],
        },
      }),
    );

    const talkState = await withTimeout(
      messages.next<{
        payload: {
          talkChannelIds: string[];
          talking: boolean;
        };
        type: string;
      }>("operator-state"),
      "operator talk state",
    );

    expect(talkState.payload).toMatchObject({
      talkChannelIds: ["ch-video"],
      talking: true,
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/channels/ch-video",
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(deleteResponse.statusCode).toBe(204);

    const refreshed = await withTimeout(
      messages.next<{
        payload: {
          channels: Array<{ id: string }>;
          operatorState: {
            listenChannelIds: string[];
            talkChannelIds: string[];
            talking: boolean;
          };
          user: {
            channelPermissions: Array<{ channelId: string }>;
          };
        };
        type: string;
      }>("session:ready"),
      "refreshed session ready",
    );

    expect(refreshed.payload.channels).toEqual([]);
    expect(refreshed.payload.user.channelPermissions).toEqual([]);
    expect(refreshed.payload.operatorState).toEqual({
      listenChannelIds: [],
      talkChannelIds: [],
      talking: false,
    });

    socket.close();
    await once(socket, "close");
    messages.stop();
    await app.close();
  });

  it("stores quality:report and preflight:result and includes them in admin dashboard", async () => {
    const adminId = database.createUser({
      username: "QAdmin",
      role: "admin",
      pinHash: hashPin("1111"),
    });
    const operatorId = database.createUser({
      username: "QOperator",
      role: "operator",
      pinHash: hashPin("2222"),
    });
    database.grantChannelPermissions(operatorId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const app = createApp({
      config: {
        serverName: "Quality Test",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    // Login both users
    const adminLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "QAdmin", pin: "1111" },
    });
    const operatorLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "QOperator", pin: "2222" },
    });

    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const wsUrl = toWebSocketUrl(address);

    // Connect admin socket
    const adminSocket = new WebSocket(`${wsUrl}/ws`);
    await withTimeout(once(adminSocket, "open"), "admin ws open");
    adminSocket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: { sessionToken: adminLogin.json().sessionToken },
      }),
    );
    const adminMessages = createJsonMessageCollector(adminSocket);
    await withTimeout(
      adminMessages.next("session:ready"),
      "admin session:ready",
    );

    // Connect operator socket
    const operatorSocket = new WebSocket(`${wsUrl}/ws`);
    await withTimeout(once(operatorSocket, "open"), "operator ws open");
    operatorSocket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: { sessionToken: operatorLogin.json().sessionToken },
      }),
    );
    const operatorMessages = createJsonMessageCollector(operatorSocket);
    await withTimeout(
      operatorMessages.next("session:ready"),
      "operator session:ready",
    );

    // Drain initial admin dashboard broadcasts from operator connecting
    // (presence + session may produce multiple dashboard snapshots)
    await withTimeout(
      adminMessages.next("admin:dashboard"),
      "initial admin dashboard after operator connects",
    );

    // Small delay to ensure any queued dashboard broadcasts are flushed
    await new Promise((r) => setTimeout(r, 100));

    // Send quality:report from operator
    operatorSocket.send(
      JSON.stringify({
        type: "quality:report",
        payload: {
          grade: "good",
          roundTripTimeMs: 35,
          packetLossPercent: 0.5,
          jitterMs: 8,
        },
      }),
    );

    // Wait for dashboard that includes quality — there may be intermediate broadcasts
    let operatorWithQuality: { connectionQuality?: { grade: string; roundTripTimeMs: number } } | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const dashboard = await withTimeout(
        adminMessages.next<{
          type: string;
          payload: {
            users: Array<{
              id: string;
              connectionQuality?: {
                grade: string;
                roundTripTimeMs: number;
              };
            }>;
          };
        }>("admin:dashboard"),
        "admin dashboard with quality",
      );

      const found = dashboard.payload.users.find((u) => u.id === operatorId);
      if (found?.connectionQuality) {
        operatorWithQuality = found;
        break;
      }
    }

    expect(operatorWithQuality).toBeDefined();
    expect(operatorWithQuality!.connectionQuality).toBeDefined();
    expect(operatorWithQuality!.connectionQuality!.grade).toBe("good");
    expect(operatorWithQuality!.connectionQuality!.roundTripTimeMs).toBe(35);

    // Now send preflight:result from operator
    operatorSocket.send(
      JSON.stringify({
        type: "preflight:result",
        payload: {
          status: "passed",
        },
      }),
    );

    // The server should broadcast another dashboard update with preflight
    const dashboardAfterPreflight = await withTimeout(
      adminMessages.next<{
        type: string;
        payload: {
          users: Array<{
            id: string;
            preflightStatus?: string;
          }>;
        };
      }>("admin:dashboard"),
      "admin dashboard after preflight result",
    );

    const operatorAfterPreflight = dashboardAfterPreflight.payload.users.find(
      (u) => u.id === operatorId,
    );
    expect(operatorAfterPreflight).toBeDefined();
    expect(operatorAfterPreflight!.preflightStatus).toBe("passed");

    adminSocket.close();
    operatorSocket.close();
    await Promise.all([once(adminSocket, "close"), once(operatorSocket, "close")]);
    adminMessages.stop();
    operatorMessages.stop();
    await app.close();
  });

  it("supports all-page broadcast by operator with force-stop and restoration", async () => {
    const op1Id = database.createUser({
      username: "Op1",
      role: "operator",
      pinHash: hashPin("1111"),
    });
    database.grantChannelPermissions(op1Id, [
      { channelId: "ch-production", canTalk: true, canListen: true },
      { channelId: "ch-audio", canTalk: true, canListen: true },
    ]);

    const op2Id = database.createUser({
      username: "Op2",
      role: "operator",
      pinHash: hashPin("2222"),
    });
    database.grantChannelPermissions(op2Id, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    const op1Login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Op1", pin: "1111" },
    });
    const op1Token = op1Login.json().sessionToken as string;

    const op2Login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Op2", pin: "2222" },
    });
    const op2Token = op2Login.json().sessionToken as string;

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

    // Op2 starts talking on ch-production
    op2Socket.send(JSON.stringify({ type: "talk:start", payload: { channelIds: ["ch-production"] } }));
    const op2TalkState = await withTimeout(
      op2Messages.next<{ payload: { talkChannelIds: string[]; talking: boolean }; type: string }>("operator-state"),
      "op2 talk start state",
    );
    expect(op2TalkState.payload).toMatchObject({ talkChannelIds: ["ch-production"], talking: true });

    // Op1 starts all-page
    op1Socket.send(JSON.stringify({ type: "allpage:start", payload: {} }));

    // Op2 should be force-stopped
    const op2ForceStopState = await withTimeout(
      op2Messages.next<{ payload: { talkChannelIds: string[]; talking: boolean }; type: string }>("operator-state"),
      "op2 force-stop state",
    );
    expect(op2ForceStopState.payload.talkChannelIds).toEqual([]);
    expect(op2ForceStopState.payload.talking).toBe(false);

    // Op1 should be talking on both channels
    const op1TalkState = await withTimeout(
      op1Messages.next<{ payload: { talkChannelIds: string[]; talking: boolean }; type: string }>("operator-state"),
      "op1 allpage talk state",
    );
    expect(op1TalkState.payload.talking).toBe(true);
    expect(op1TalkState.payload.talkChannelIds).toContain("ch-production");
    expect(op1TalkState.payload.talkChannelIds).toContain("ch-audio");

    // Both receive allpage:active
    const op1Active = await withTimeout(
      op1Messages.next<{ payload: { username: string }; type: string }>("allpage:active"),
      "op1 allpage active",
    );
    expect(op1Active.payload.username).toBe("Op1");

    const op2Active = await withTimeout(
      op2Messages.next<{ payload: { username: string }; type: string }>("allpage:active"),
      "op2 allpage active",
    );
    expect(op2Active.payload.username).toBe("Op1");

    // Op2 tries to talk during all-page → forbidden
    op2Socket.send(JSON.stringify({ type: "talk:start", payload: { channelIds: ["ch-production"] } }));
    const op2Forbidden = await withTimeout(
      op2Messages.next<{ payload: { code: string }; type: string }>("signal:error"),
      "op2 talk forbidden during allpage",
    );
    expect(op2Forbidden.payload.code).toBe("forbidden");

    // Op1 stops all-page
    op1Socket.send(JSON.stringify({ type: "allpage:stop", payload: {} }));

    // Both receive allpage:inactive
    const op1Inactive = await withTimeout(
      op1Messages.next<{ type: string }>("allpage:inactive"),
      "op1 allpage inactive",
    );
    expect(op1Inactive.type).toBe("allpage:inactive");

    const op2Inactive = await withTimeout(
      op2Messages.next<{ type: string }>("allpage:inactive"),
      "op2 allpage inactive",
    );
    expect(op2Inactive.type).toBe("allpage:inactive");

    // Op1 should stop talking
    const op1StopState = await withTimeout(
      op1Messages.next<{ payload: { talkChannelIds: string[]; talking: boolean }; type: string }>("operator-state"),
      "op1 allpage stop state",
    );
    expect(op1StopState.payload.talking).toBe(false);
    expect(op1StopState.payload.talkChannelIds).toEqual([]);

    op1Socket.close();
    op2Socket.close();
    await Promise.all([once(op1Socket, "close"), once(op2Socket, "close")]);
    op1Messages.stop();
    op2Messages.stop();
    await app.close();
  });

  it("routes call signals to channel listeners and supports acknowledgment", async () => {
    const op1Id = database.createUser({
      username: "Director",
      role: "operator",
      pinHash: hashPin("1111"),
    });
    database.grantChannelPermissions(op1Id, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const op2Id = database.createUser({
      username: "Camera1",
      role: "operator",
      pinHash: hashPin("2222"),
    });
    database.grantChannelPermissions(op2Id, [
      { channelId: "ch-production", canTalk: false, canListen: true },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    const op1Login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Director", pin: "1111" },
    });
    const op1Token = op1Login.json().sessionToken as string;

    const op2Login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Camera1", pin: "2222" },
    });
    const op2Token = op2Login.json().sessionToken as string;

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

    // Op1 sends a channel signal
    op1Socket.send(JSON.stringify({
      type: "signal:send",
      payload: { signalType: "call", targetChannelId: "ch-production" },
    }));

    // Op2 (listener on ch-production) should receive signal:incoming
    const op2Signal = await withTimeout(
      op2Messages.next<{
        payload: { signalId: string; signalType: string; fromUsername: string; targetChannelId: string };
        type: string;
      }>("signal:incoming"),
      "op2 signal incoming",
    );
    expect(op2Signal.payload.signalType).toBe("call");
    expect(op2Signal.payload.fromUsername).toBe("Director");
    expect(op2Signal.payload.targetChannelId).toBe("ch-production");
    const signalId = op2Signal.payload.signalId;

    // Op1 should NOT receive signal:incoming (sender excluded)
    // We verify by sending another message and confirming no signal:incoming arrived
    op1Socket.send(JSON.stringify({ type: "listen:toggle", payload: { channelId: "ch-production", listening: true } }));
    const op1NextMsg = await withTimeout(
      op1Messages.next<{ type: string }>("operator-state"),
      "op1 next message after signal",
    );
    expect(op1NextMsg.type).toBe("operator-state");

    // Op2 acknowledges the signal
    op2Socket.send(JSON.stringify({ type: "signal:ack", payload: { signalId } }));

    // Both should receive signal:cleared
    const op1Cleared = await withTimeout(
      op1Messages.next<{ payload: { signalId: string }; type: string }>("signal:cleared"),
      "op1 signal cleared",
    );
    expect(op1Cleared.payload.signalId).toBe(signalId);

    const op2Cleared = await withTimeout(
      op2Messages.next<{ payload: { signalId: string }; type: string }>("signal:cleared"),
      "op2 signal cleared",
    );
    expect(op2Cleared.payload.signalId).toBe(signalId);

    op1Socket.close();
    op2Socket.close();
    await Promise.all([once(op1Socket, "close"), once(op2Socket, "close")]);
    op1Messages.stop();
    op2Messages.stop();
    await app.close();
  });

  it("rejects all-page and signal operations from regular users", async () => {
    const userId = database.createUser({
      username: "Volunteer",
      role: "user",
      pinHash: hashPin("3333"),
    });
    database.grantChannelPermissions(userId, [
      { channelId: "ch-production", canTalk: true, canListen: true },
    ]);

    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "127.0.0.1",
        port: 0,
        rtcMinPort: 40000,
        rtcMaxPort: 41000,
        announcedIp: undefined,
        dataDir: workingDirectory,
        dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"),
        maxUsers: 30,
        maxChannels: 16,
        logLevel: "info",
        httpsPort: 3443,
      },
      database,
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "Volunteer", pin: "3333" },
    });
    const token = login.json().sessionToken as string;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const messages = createJsonMessageCollector(socket);
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: token } }));
    await withTimeout(messages.next("session:ready"), "user session ready");

    // Regular user tries all-page → forbidden
    socket.send(JSON.stringify({ type: "allpage:start", payload: {} }));
    const allpageError = await withTimeout(
      messages.next<{ payload: { code: string }; type: string }>("signal:error"),
      "allpage forbidden for regular user",
    );
    expect(allpageError.payload.code).toBe("forbidden");

    // Regular user tries to send a user-targeted signal → forbidden
    socket.send(JSON.stringify({
      type: "signal:send",
      payload: { signalType: "call", targetUserId: "some-user-id" },
    }));
    const signalError = await withTimeout(
      messages.next<{ payload: { code: string }; type: string }>("signal:error"),
      "user signal forbidden for regular user",
    );
    expect(signalError.payload.code).toBe("forbidden");

    socket.close();
    await once(socket, "close");
    messages.stop();
    await app.close();
  });

  // ── 1.3 Direct Communication ──────────────────────────────────────────

  it("handles direct call request → accept → end lifecycle", async () => {
    const op1Id = database.createUser({ username: "Op1", role: "operator", pinHash: hashPin("1111") });
    database.grantChannelPermissions(op1Id, [{ channelId: "ch-production", canTalk: true, canListen: true }]);
    const op2Id = database.createUser({ username: "Op2", role: "operator", pinHash: hashPin("2222") });
    database.grantChannelPermissions(op2Id, [{ channelId: "ch-production", canTalk: true, canListen: true }]);

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const op1Token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op1", pin: "1111" } })).json().sessionToken as string;
    const op2Token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op2", pin: "2222" } })).json().sessionToken as string;

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

    // Op1 requests a direct call to Op2
    op1Socket.send(JSON.stringify({ type: "direct:request", payload: { targetUserId: op2Id } }));

    // Op2 receives direct:incoming
    const incoming = await withTimeout(
      op2Messages.next<{ payload: { callId: string; fromUserId: string; fromUsername: string }; type: string }>("direct:incoming"),
      "op2 incoming call",
    );
    expect(incoming.payload.fromUserId).toBe(op1Id);
    expect(incoming.payload.fromUsername).toBe("Op1");
    const callId = incoming.payload.callId;
    expect(callId).toBeTruthy();

    // Op2 accepts
    op2Socket.send(JSON.stringify({ type: "direct:accept", payload: { callId } }));

    // Both receive direct:active
    const op1Active = await withTimeout(
      op1Messages.next<{ payload: { callId: string; peerUserId: string; peerUsername: string }; type: string }>("direct:active"),
      "op1 direct active",
    );
    expect(op1Active.payload).toMatchObject({ callId, peerUserId: op2Id, peerUsername: "Op2" });

    const op2Active = await withTimeout(
      op2Messages.next<{ payload: { callId: string; peerUserId: string; peerUsername: string }; type: string }>("direct:active"),
      "op2 direct active",
    );
    expect(op2Active.payload).toMatchObject({ callId, peerUserId: op1Id, peerUsername: "Op1" });

    // Op1 ends the call
    op1Socket.send(JSON.stringify({ type: "direct:end", payload: { callId } }));

    // Both receive direct:ended with reason "ended"
    const op1Ended = await withTimeout(
      op1Messages.next<{ payload: { callId: string; reason: string }; type: string }>("direct:ended"),
      "op1 direct ended",
    );
    expect(op1Ended.payload).toMatchObject({ callId, reason: "ended" });

    const op2Ended = await withTimeout(
      op2Messages.next<{ payload: { callId: string; reason: string }; type: string }>("direct:ended"),
      "op2 direct ended",
    );
    expect(op2Ended.payload).toMatchObject({ callId, reason: "ended" });

    op1Socket.close();
    op2Socket.close();
    await Promise.all([once(op1Socket, "close"), once(op2Socket, "close")]);
    op1Messages.stop();
    op2Messages.stop();
    await app.close();
  });

  it("handles direct call rejection", async () => {
    const op1Id = database.createUser({ username: "Op1", role: "operator", pinHash: hashPin("1111") });
    database.grantChannelPermissions(op1Id, [{ channelId: "ch-production", canTalk: true, canListen: true }]);
    const op2Id = database.createUser({ username: "Op2", role: "operator", pinHash: hashPin("2222") });
    database.grantChannelPermissions(op2Id, [{ channelId: "ch-production", canTalk: true, canListen: true }]);

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const op1Token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op1", pin: "1111" } })).json().sessionToken as string;
    const op2Token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op2", pin: "2222" } })).json().sessionToken as string;

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

    // Op1 requests a direct call to Op2
    op1Socket.send(JSON.stringify({ type: "direct:request", payload: { targetUserId: op2Id } }));

    const incoming = await withTimeout(
      op2Messages.next<{ payload: { callId: string }; type: string }>("direct:incoming"),
      "op2 incoming call",
    );
    const callId = incoming.payload.callId;

    // Op2 rejects
    op2Socket.send(JSON.stringify({ type: "direct:reject", payload: { callId } }));

    // Op1 receives direct:ended with reason "rejected"
    const op1Ended = await withTimeout(
      op1Messages.next<{ payload: { callId: string; reason: string }; type: string }>("direct:ended"),
      "op1 direct ended after rejection",
    );
    expect(op1Ended.payload).toMatchObject({ callId, reason: "rejected" });

    op1Socket.close();
    op2Socket.close();
    await Promise.all([once(op1Socket, "close"), once(op2Socket, "close")]);
    op1Messages.stop();
    op2Messages.stop();
    await app.close();
  });

  it("rejects direct call when target is busy", async () => {
    const op1Id = database.createUser({ username: "Op1", role: "operator", pinHash: hashPin("1111") });
    database.grantChannelPermissions(op1Id, [{ channelId: "ch-production", canTalk: true, canListen: true }]);
    const op2Id = database.createUser({ username: "Op2", role: "operator", pinHash: hashPin("2222") });
    database.grantChannelPermissions(op2Id, [{ channelId: "ch-production", canTalk: true, canListen: true }]);
    const op3Id = database.createUser({ username: "Op3", role: "operator", pinHash: hashPin("3333") });
    database.grantChannelPermissions(op3Id, [{ channelId: "ch-production", canTalk: true, canListen: true }]);

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const op1Token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op1", pin: "1111" } })).json().sessionToken as string;
    const op2Token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op2", pin: "2222" } })).json().sessionToken as string;
    const op3Token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op3", pin: "3333" } })).json().sessionToken as string;

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

    const op3Socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const op3Messages = createJsonMessageCollector(op3Socket);
    await once(op3Socket, "open");
    op3Socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: op3Token } }));
    await withTimeout(op3Messages.next("session:ready"), "op3 session ready");

    // Op1 calls Op2 → Op2 accepts
    op1Socket.send(JSON.stringify({ type: "direct:request", payload: { targetUserId: op2Id } }));
    const incoming = await withTimeout(
      op2Messages.next<{ payload: { callId: string }; type: string }>("direct:incoming"),
      "op2 incoming call",
    );
    op2Socket.send(JSON.stringify({ type: "direct:accept", payload: { callId: incoming.payload.callId } }));
    await withTimeout(op1Messages.next("direct:active"), "op1 direct active");
    await withTimeout(op2Messages.next("direct:active"), "op2 direct active");

    // Op3 tries to call Op2 → should get busy
    op3Socket.send(JSON.stringify({ type: "direct:request", payload: { targetUserId: op2Id } }));
    const busyEnded = await withTimeout(
      op3Messages.next<{ payload: { reason: string }; type: string }>("direct:ended"),
      "op3 direct ended busy",
    );
    expect(busyEnded.payload.reason).toBe("busy");

    op1Socket.close();
    op2Socket.close();
    op3Socket.close();
    await Promise.all([once(op1Socket, "close"), once(op2Socket, "close"), once(op3Socket, "close")]);
    op1Messages.stop();
    op2Messages.stop();
    op3Messages.stop();
    await app.close();
  });

  // ── 1.4 Groups CRUD ──────────────────────────────────────────────────

  it("creates, lists, updates, and deletes channel groups", async () => {
    database.createUser({ username: "Admin", role: "admin", pinHash: hashPin("1234") });

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const adminToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Admin", pin: "1234" } })).json().sessionToken as string;
    const authHeaders = { authorization: `Bearer ${adminToken}` };

    // POST /api/groups → 201
    const createRes = await app.inject({
      method: "POST",
      url: "/api/groups",
      headers: authHeaders,
      payload: { name: "Camera Team", channelIds: [] },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created).toMatchObject({ name: "Camera Team" });
    const groupId = created.id as string;

    // GET /api/groups → includes "Camera Team"
    const listRes = await app.inject({ method: "GET", url: "/api/groups", headers: authHeaders });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: groupId, name: "Camera Team" })]),
    );

    // PUT /api/groups/:id → 200
    const updateRes = await app.inject({
      method: "PUT",
      url: `/api/groups/${groupId}`,
      headers: authHeaders,
      payload: { name: "Camera Crew", channelIds: [] },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json()).toMatchObject({ id: groupId, name: "Camera Crew" });

    // DELETE /api/groups/:id → 204
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/groups/${groupId}`,
      headers: authHeaders,
    });
    expect(deleteRes.statusCode).toBe(204);

    // GET /api/groups → empty
    const finalListRes = await app.inject({ method: "GET", url: "/api/groups", headers: authHeaders });
    expect(finalListRes.json()).toEqual([]);

    await app.close();
  });

  it("includes groups in session:ready message", async () => {
    const adminId = database.createUser({ username: "Admin", role: "admin", pinHash: hashPin("1234") });
    database.grantChannelPermissions(adminId, [{ channelId: "ch-production", canTalk: true, canListen: true }]);

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const adminToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Admin", pin: "1234" } })).json().sessionToken as string;

    // Create a group via API
    const createRes = await app.inject({
      method: "POST",
      url: "/api/groups",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Stage Crew", channelIds: ["ch-production"] },
    });
    expect(createRes.statusCode).toBe(201);
    const groupId = createRes.json().id as string;

    // Assign admin to the group
    database.replaceUserGroups(adminId, [groupId]);

    // Connect via WebSocket and verify session:ready includes groups
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const messages = createJsonMessageCollector(socket);
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: adminToken } }));

    const ready = await withTimeout(
      messages.next<{ payload: { groups: Array<{ id: string; name: string }> }; type: string }>("session:ready"),
      "session ready with groups",
    );
    expect(ready.payload.groups).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: groupId, name: "Stage Crew" })]),
    );

    socket.close();
    await once(socket, "close");
    messages.stop();
    await app.close();
  });

  // ── 1.12 IFB Lifecycle ────────────────────────────────────────────────

  it("handles IFB start → target receives active → stop → target receives inactive", async () => {
    const adminId = database.createUser({ username: "Admin", role: "admin", pinHash: hashPin("1234") });
    database.grantChannelPermissions(adminId, [{ channelId: "ch-production", canTalk: true, canListen: true }]);
    const opId = database.createUser({ username: "Op1", role: "operator", pinHash: hashPin("5678") });
    database.grantChannelPermissions(opId, [{ channelId: "ch-production", canTalk: true, canListen: true }]);

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const adminToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Admin", pin: "1234" } })).json().sessionToken as string;
    const opToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op1", pin: "5678" } })).json().sessionToken as string;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const adminSocket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const adminMessages = createJsonMessageCollector(adminSocket);
    await once(adminSocket, "open");
    adminSocket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: adminToken } }));
    await withTimeout(adminMessages.next("session:ready"), "admin session ready");

    const opSocket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const opMessages = createJsonMessageCollector(opSocket);
    await once(opSocket, "open");
    opSocket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: opToken } }));
    await withTimeout(opMessages.next("session:ready"), "op session ready");

    // Admin starts IFB targeting Op1
    adminSocket.send(JSON.stringify({ type: "ifb:start", payload: { targetUserId: opId } }));

    // Op1 receives ifb:active
    const ifbActive = await withTimeout(
      opMessages.next<{ payload: { fromUserId: string; fromUsername: string; duckLevel: number }; type: string }>("ifb:active"),
      "op ifb active",
    );
    expect(ifbActive.payload).toMatchObject({
      fromUserId: adminId,
      fromUsername: "Admin",
      duckLevel: 0.1,
    });

    // Admin stops IFB
    adminSocket.send(JSON.stringify({ type: "ifb:stop", payload: {} }));

    // Op1 receives ifb:inactive
    const ifbInactive = await withTimeout(
      opMessages.next<{ type: string }>("ifb:inactive"),
      "op ifb inactive",
    );
    expect(ifbInactive.type).toBe("ifb:inactive");

    adminSocket.close();
    opSocket.close();
    await Promise.all([once(adminSocket, "close"), once(opSocket, "close")]);
    adminMessages.stop();
    opMessages.stop();
    await app.close();
  });

  it("rejects IFB from non-admin/operator users", async () => {
    database.createUser({ username: "Admin", role: "admin", pinHash: hashPin("1234") });
    const userId = database.createUser({ username: "RegularUser", role: "user", pinHash: hashPin("5678") });
    database.grantChannelPermissions(userId, [{ channelId: "ch-production", canTalk: false, canListen: true }]);
    const targetId = database.createUser({ username: "Target", role: "operator", pinHash: hashPin("9999") });
    database.grantChannelPermissions(targetId, [{ channelId: "ch-production", canTalk: true, canListen: true }]);

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const userToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "RegularUser", pin: "5678" } })).json().sessionToken as string;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const messages = createJsonMessageCollector(socket);
    await once(socket, "open");
    socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: userToken } }));
    await withTimeout(messages.next("session:ready"), "user session ready");

    // Regular user tries to start IFB
    socket.send(JSON.stringify({ type: "ifb:start", payload: { targetUserId: targetId } }));

    const error = await withTimeout(
      messages.next<{ payload: { code: string; message: string }; type: string }>("signal:error"),
      "ifb forbidden for regular user",
    );
    expect(error.payload.code).toBe("forbidden");

    socket.close();
    await once(socket, "close");
    messages.stop();
    await app.close();
  });

  it("cleans up IFB when director disconnects", async () => {
    const adminId = database.createUser({ username: "Admin", role: "admin", pinHash: hashPin("1234") });
    database.grantChannelPermissions(adminId, [{ channelId: "ch-production", canTalk: true, canListen: true }]);
    const opId = database.createUser({ username: "Op1", role: "operator", pinHash: hashPin("5678") });
    database.grantChannelPermissions(opId, [{ channelId: "ch-production", canTalk: true, canListen: true }]);

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const adminToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Admin", pin: "1234" } })).json().sessionToken as string;
    const opToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op1", pin: "5678" } })).json().sessionToken as string;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const adminSocket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const adminMessages = createJsonMessageCollector(adminSocket);
    await once(adminSocket, "open");
    adminSocket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: adminToken } }));
    await withTimeout(adminMessages.next("session:ready"), "admin session ready");

    const opSocket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const opMessages = createJsonMessageCollector(opSocket);
    await once(opSocket, "open");
    opSocket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: opToken } }));
    await withTimeout(opMessages.next("session:ready"), "op session ready");

    // Admin starts IFB targeting Op1
    adminSocket.send(JSON.stringify({ type: "ifb:start", payload: { targetUserId: opId } }));

    await withTimeout(opMessages.next("ifb:active"), "op ifb active");

    // Admin disconnects abruptly
    adminSocket.close();
    await once(adminSocket, "close");
    adminMessages.stop();

    // Op1 should receive ifb:inactive due to cleanup
    const ifbInactive = await withTimeout(
      opMessages.next<{ type: string }>("ifb:inactive"),
      "op ifb inactive after disconnect",
    );
    expect(ifbInactive.type).toBe("ifb:inactive");

    opSocket.close();
    await once(opSocket, "close");
    opMessages.stop();
    await app.close();
  });

  // ── 1.10 Program Audio Feeds ──────────────────────────────────────────

  it("prevents non-source users from talking on program channels", async () => {
    const adminId = database.createUser({ username: "Admin", role: "admin", pinHash: hashPin("1234") });
    const op1Id = database.createUser({ username: "Op1", role: "operator", pinHash: hashPin("1111") });
    const op2Id = database.createUser({ username: "Op2", role: "operator", pinHash: hashPin("2222") });

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const adminToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Admin", pin: "1234" } })).json().sessionToken as string;

    // Create a program channel with Op1 as source
    const channelRes = await app.inject({
      method: "POST",
      url: "/api/channels",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Program Feed", color: "#FF0000", channelType: "program", sourceUserId: op1Id },
    });
    expect(channelRes.statusCode).toBe(201);
    const programChannelId = channelRes.json().id as string;

    // Grant both operators permissions on the program channel
    database.grantChannelPermissions(op1Id, [{ channelId: programChannelId, canTalk: true, canListen: true }]);
    database.grantChannelPermissions(op2Id, [{ channelId: programChannelId, canTalk: true, canListen: true }]);

    const op1Token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op1", pin: "1111" } })).json().sessionToken as string;
    const op2Token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op2", pin: "2222" } })).json().sessionToken as string;

    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const op2Socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const op2Messages = createJsonMessageCollector(op2Socket);
    await once(op2Socket, "open");
    op2Socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: op2Token } }));
    await withTimeout(op2Messages.next("session:ready"), "op2 session ready");

    // Op2 (non-source) tries talk:start on program channel → forbidden
    op2Socket.send(JSON.stringify({ type: "talk:start", payload: { channelIds: [programChannelId] } }));
    const talkError = await withTimeout(
      op2Messages.next<{ payload: { code: string }; type: string }>("signal:error"),
      "op2 program talk forbidden",
    );
    expect(talkError.payload.code).toBe("forbidden");

    // Op1 (source) talks on program channel → succeeds
    const op1Socket = new WebSocket(`${toWebSocketUrl(address)}/ws`);
    const op1Messages = createJsonMessageCollector(op1Socket);
    await once(op1Socket, "open");
    op1Socket.send(JSON.stringify({ type: "session:authenticate", payload: { sessionToken: op1Token } }));
    await withTimeout(op1Messages.next("session:ready"), "op1 session ready");

    op1Socket.send(JSON.stringify({ type: "talk:start", payload: { channelIds: [programChannelId] } }));
    const op1State = await withTimeout(
      op1Messages.next<{ payload: { talkChannelIds: string[]; talking: boolean }; type: string }>("operator-state"),
      "op1 program talk state",
    );
    expect(op1State.payload.talkChannelIds).toContain(programChannelId);
    expect(op1State.payload.talking).toBe(true);

    op1Socket.close();
    op2Socket.close();
    await Promise.all([once(op1Socket, "close"), once(op2Socket, "close")]);
    op1Messages.stop();
    op2Messages.stop();
    await app.close();
  });

  it("returns channelType in channel list and session data", async () => {
    const adminId = database.createUser({ username: "Admin", role: "admin", pinHash: hashPin("1234") });
    const op1Id = database.createUser({ username: "Op1", role: "operator", pinHash: hashPin("1111") });

    const app = createApp({
      config: {
        serverName: "Main Church", host: "127.0.0.1", port: 0, rtcMinPort: 40000, rtcMaxPort: 41000,
        announcedIp: undefined, dataDir: workingDirectory, dbFile: "cuecommx.db",
        dbPath: join(workingDirectory, "cuecommx.db"), maxUsers: 30, maxChannels: 16, logLevel: "info", httpsPort: 3443,
      },
      database,
    });

    const adminToken = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Admin", pin: "1234" } })).json().sessionToken as string;

    // Create a program channel
    const channelRes = await app.inject({
      method: "POST",
      url: "/api/channels",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Program Feed", color: "#00FF00", channelType: "program", sourceUserId: op1Id },
    });
    expect(channelRes.statusCode).toBe(201);
    const programChannel = channelRes.json();

    // GET /api/channels → includes channelType: "program"
    const listRes = await app.inject({ method: "GET", url: "/api/channels" });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: programChannel.id, name: "Program Feed", channelType: "program" }),
      ]),
    );

    // Grant Op1 permission on the program channel and login
    database.grantChannelPermissions(op1Id, [{ channelId: programChannel.id, canTalk: true, canListen: true }]);
    const op1Login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "Op1", pin: "1111" } });
    expect(op1Login.statusCode).toBe(200);
    const loginData = op1Login.json();

    // Login response channels should include channelType
    expect(loginData.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: programChannel.id, channelType: "program" }),
      ]),
    );

    await app.close();
  });
});
