import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { WebSocket } from "ws";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

export interface ConnectionRecord {
  authenticationAttempted: boolean;
  authenticationPromise?: Promise<void>;
  cleanupPromise?: Promise<void>;
  isAlive: boolean;
  requestHost?: string;
  sessionToken?: string;
  socket: WebSocket;
}

export function parseRequestHost(headersHost?: string): string | undefined {
  if (!headersHost) {
    return undefined;
  }

  try {
    return new URL(`http://${headersHost}`).hostname;
  } catch {
    return undefined;
  }
}

export function isUsableMediaHost(host?: string): host is string {
  if (!host) {
    return false;
  }

  if (host === "localhost" || host === "::1" || host.startsWith("127.")) {
    return false;
  }

  if (host === "0.0.0.0" || host === "::") {
    return false;
  }

  return true;
}

export async function resolveMediaHost(host: string): Promise<string> {
  if (isIP(host) > 0) {
    return host;
  }

  try {
    const result = await lookup(host, { family: 4 });
    return result.address;
  } catch {
    return host;
  }
}

export class ConnectionRegistry {
  private readonly connections = new Map<WebSocket, ConnectionRecord>();

  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly heartbeatIntervalMs: number) {}

  add(socket: WebSocket, requestHost?: string): ConnectionRecord {
    const connection: ConnectionRecord = {
      authenticationAttempted: false,
      isAlive: true,
      requestHost,
      socket,
    };

    this.connections.set(socket, connection);
    return connection;
  }

  get(socket: WebSocket): ConnectionRecord | undefined {
    return this.connections.get(socket);
  }

  has(connection: ConnectionRecord): boolean {
    return this.connections.get(connection.socket) === connection;
  }

  delete(socket: WebSocket): boolean {
    return this.connections.delete(socket);
  }

  clear(): void {
    this.connections.clear();
  }

  values(): ConnectionRecord[] {
    return [...this.connections.values()];
  }

  authenticated(): Array<ConnectionRecord & { sessionToken: string }> {
    return [...this.connections.values()].filter(
      (connection): connection is ConnectionRecord & { sessionToken: string } =>
        connection.sessionToken !== undefined,
    );
  }

  findSocketBySessionToken(sessionToken: string): WebSocket | undefined {
    for (const connection of this.connections.values()) {
      if (connection.sessionToken === sessionToken) {
        return connection.socket;
      }
    }

    return undefined;
  }

  socketsForSession(
    sessionToken: string,
    authContext?: { sessionToken: string; socket: WebSocket },
  ): WebSocket[] {
    const sockets = [...this.connections.values()]
      .filter((connection) => connection.sessionToken === sessionToken)
      .map((connection) => connection.socket);

    if (sockets.length > 0) {
      return sockets;
    }

    if (authContext?.sessionToken === sessionToken) {
      return [authContext.socket];
    }

    return [];
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (!connection.isAlive) {
          connection.socket.terminate();
          continue;
        }

        connection.isAlive = false;
        connection.socket.ping();
      }
    }, this.heartbeatIntervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
