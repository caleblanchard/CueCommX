import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { SessionStore } from "../src/auth/session-store.js";
import { createApp } from "../src/app.js";
import type { CueCommXConfig } from "../src/config.js";
import { DatabaseService } from "../src/db/database.js";

function buildConfig(workingDirectory: string): CueCommXConfig {
  return {
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
  };
}

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

describe("CueCommX media websocket integration", () => {
  let database: DatabaseService;
  let sessionStore: SessionStore;
  let workingDirectory: string;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), "cuecommx-media-"));
    database = new DatabaseService({
      dbPath: join(workingDirectory, "cuecommx.db"),
    });
    sessionStore = new SessionStore();
  });

  afterEach(() => {
    database.close();
    rmSync(workingDirectory, { force: true, recursive: true });
  });

  it("serves mediasoup capabilities and transport options over the authenticated realtime channel", async () => {
    const userId = database.createUser({
      username: "Audio",
      role: "operator",
    });

    database.replaceChannelPermissions(userId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);

    const sessionToken = sessionStore.createSession(userId).token;
    const app = createApp({
      config: buildConfig(workingDirectory),
      database,
      sessionStore,
    });

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("CueCommX test server did not expose a TCP address.");
    }

    const socket = new WebSocket(`${toWebSocketUrl(`http://127.0.0.1:${address.port}`)}/ws`);
    await once(socket, "open");

    socket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken,
        },
      }),
    );

    await waitForJsonMessage(socket, "session:ready");

    socket.send(
      JSON.stringify({
        type: "media:capabilities:get",
        payload: {
          requestId: "req-caps",
        },
      }),
    );

    const capabilities = await waitForJsonMessage<{
      payload: {
        requestId: string;
        routerRtpCapabilities: {
          codecs: Array<{ kind: string; mimeType: string }>;
        };
      };
      type: "media:capabilities";
    }>(socket, "media:capabilities");

    expect(capabilities.payload.requestId).toBe("req-caps");
    expect(capabilities.payload.routerRtpCapabilities.codecs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "audio",
          mimeType: "audio/opus",
        }),
      ]),
    );

    socket.send(
      JSON.stringify({
        type: "media:transport:create",
        payload: {
          requestId: "req-send",
          direction: "send",
        },
      }),
    );

    const sendTransport = await waitForJsonMessage<{
      payload: {
        requestId: string;
        transport: {
          direction: "send";
          id: string;
          iceCandidates: unknown[];
        };
      };
      type: "media:transport:created";
    }>(socket, "media:transport:created");

    expect(sendTransport.payload.requestId).toBe("req-send");
    expect(sendTransport.payload.transport.direction).toBe("send");
    expect(sendTransport.payload.transport.id).toMatch(/\S/);
    expect(sendTransport.payload.transport.iceCandidates.length).toBeGreaterThan(0);

    socket.send(
      JSON.stringify({
        type: "media:transport:create",
        payload: {
          requestId: "req-recv",
          direction: "recv",
        },
      }),
    );

    const recvTransport = await waitForJsonMessage<{
      payload: {
        requestId: string;
        transport: {
          direction: "recv";
          id: string;
        };
      };
      type: "media:transport:created";
    }>(socket, "media:transport:created");

    expect(recvTransport.payload.requestId).toBe("req-recv");
    expect(recvTransport.payload.transport.direction).toBe("recv");

    socket.close();
    await app.close();
  });

  it("prefers the authenticated websocket host for mediasoup ICE advertisement", async () => {
    const userId = database.createUser({
      username: "Audio",
      role: "operator",
    });

    database.replaceChannelPermissions(userId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
    ]);

    const sessionToken = sessionStore.createSession(userId).token;
    const app = createApp({
      config: buildConfig(workingDirectory),
      database,
      sessionStore,
    });

    await app.listen({
      host: "127.0.0.1",
      port: 0,
    });

    const address = app.server.address();

    if (!address || typeof address === "string") {
      throw new Error("CueCommX test server did not expose a TCP address.");
    }

    const socket = new WebSocket(`${toWebSocketUrl(`http://127.0.0.1:${address.port}`)}/ws`, {
      headers: {
        host: "172.30.178.69:3000",
      },
    });
    await once(socket, "open");

    socket.send(
      JSON.stringify({
        type: "session:authenticate",
        payload: {
          sessionToken,
        },
      }),
    );

    await waitForJsonMessage(socket, "session:ready");

    socket.send(
      JSON.stringify({
        type: "media:transport:create",
        payload: {
          requestId: "req-send",
          direction: "send",
        },
      }),
    );

    const sendTransport = await waitForJsonMessage<{
      payload: {
        requestId: string;
        transport: {
          iceCandidates: Array<{
            address?: string;
            ip: string;
          }>;
        };
      };
      type: "media:transport:created";
    }>(socket, "media:transport:created");

    expect(sendTransport.payload.transport.iceCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: "172.30.178.69",
          ip: "172.30.178.69",
        }),
      ]),
    );

    socket.close();
    await app.close();
  });
});
