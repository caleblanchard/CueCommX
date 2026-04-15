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
  timeoutMs: number = 2_000,
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
        { id: "ch-production", name: "Production", color: "#EF4444" },
        { id: "ch-audio", name: "Audio", color: "#3B82F6" },
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
        { id: "ch-production", name: "Production", color: "#EF4444" },
        { id: "ch-video", name: "Video/Camera", color: "#10B981" },
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

    const response = await app.inject({
      method: "GET",
      url: "/api/users",
      headers: {
        authorization: `Bearer ${loginResponse.json().sessionToken as string}`,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      success: false,
      protocolVersion: PROTOCOL_VERSION,
      error: "Admin access is required.",
    });

    await app.close();
  });

  it("prevents demoting the last remaining admin", async () => {
    const app = createApp({
      config: {
        serverName: "Main Church",
        host: "0.0.0.0",
        port: 3000,
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

    await once(socket, "open");
    socket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken: operatorToken,
        },
      }),
    );

    const ready = await waitForJsonMessage<{
      payload: {
        channels: Array<{ id: string }>;
        operatorState: {
          listenChannelIds: string[];
          talkChannelIds: string[];
          talking: boolean;
        };
      };
      type: string;
    }>(socket, "session:ready");

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

    const talkState = await waitForJsonMessage<{
      payload: {
        talkChannelIds: string[];
        talking: boolean;
      };
      type: string;
    }>(socket, "operator-state");

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

    const refreshed = await waitForJsonMessage<{
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
    }>(socket, "session:ready");

    expect(refreshed.payload.channels).toEqual([]);
    expect(refreshed.payload.user.channelPermissions).toEqual([]);
    expect(refreshed.payload.operatorState).toEqual({
      listenChannelIds: [],
      talkChannelIds: [],
      talking: false,
    });

    socket.close();
    await once(socket, "close");
    await app.close();
  });
});
