import { Client, Server } from "node-osc";

export interface OscConfig {
  enabled: boolean;
  listenPort: number;
  sendHost: string;
  sendPort: number;
}

export interface OscCallbacks {
  onMuteUser?: (userId: string, muted: boolean) => void;
  onAllPageStart?: () => void;
  onAllPageStop?: () => void;
}

export class OscService {
  private server: Server | undefined;
  private client: Client | undefined;
  private readonly config: OscConfig;
  private callbacks: OscCallbacks = {};

  constructor(config: OscConfig) {
    this.config = config;
  }

  setCallbacks(callbacks: OscCallbacks): void {
    this.callbacks = callbacks;
  }

  start(): void {
    if (!this.config.enabled) return;

    this.client = new Client(this.config.sendHost, this.config.sendPort);

    this.server = new Server(this.config.listenPort, "0.0.0.0", () => {
      console.log(`[OSC] Listening on UDP :${this.config.listenPort}`);
    });

    this.server.on("message", (msg: unknown[]) => {
      const address = msg[0] as string;
      const args = msg.slice(1);
      this.handleIncoming(address, args);
    });

    this.server.on("error", (err: Error) => {
      console.error("[OSC] Server error:", err.message);
    });
  }

  async stop(): Promise<void> {
    await this.server?.close();
    await this.client?.close();
    this.server = undefined;
    this.client = undefined;
  }

  // --- Outgoing OSC notifications ---

  notifyUserOnline(userId: string, username: string): void {
    this.send(`/cuecommx/user/${userId}/online`, 1);
    this.send(`/cuecommx/user/${userId}/name`, username);
  }

  notifyUserOffline(userId: string, _username: string): void {
    this.send(`/cuecommx/user/${userId}/online`, 0);
    this.send(`/cuecommx/user/${userId}/talking`, 0);
  }

  notifyUserTalking(userId: string, channelId: string): void {
    this.send(`/cuecommx/user/${userId}/talking`, 1);
    this.send(`/cuecommx/channel/${channelId}/active`, 1);
  }

  notifyUserStopped(userId: string, channelIds: string[]): void {
    this.send(`/cuecommx/user/${userId}/talking`, 0);
    for (const channelId of channelIds) {
      this.send(`/cuecommx/channel/${channelId}/active`, 0);
    }
  }

  notifyAllPageStart(username: string): void {
    this.send("/cuecommx/allpage/active", 1);
    this.send("/cuecommx/allpage/user", username);
  }

  notifyAllPageStop(): void {
    this.send("/cuecommx/allpage/active", 0);
  }

  notifyChannelActive(channelId: string, channelName: string): void {
    this.send(`/cuecommx/channel/${channelId}/active`, 1);
    this.send(`/cuecommx/channel/${channelId}/name`, channelName);
  }

  notifyChannelInactive(channelId: string): void {
    this.send(`/cuecommx/channel/${channelId}/active`, 0);
  }

  get isRunning(): boolean {
    return this.server !== undefined;
  }

  getConfig(): OscConfig {
    return { ...this.config };
  }

  // --- Internal ---

  private send(address: string, ...args: (number | string)[]): void {
    if (!this.client) return;
    try {
      void this.client.send(address, ...args);
    } catch (err) {
      console.warn("[OSC] Send error:", err);
    }
  }

  private handleIncoming(address: string, args: unknown[]): void {
    // /cuecommx/user/{userId}/mute  → args[0] = 1 (mute) or 0 (unmute)
    const muteMatch = address.match(/^\/cuecommx\/user\/([^/]+)\/mute$/);
    if (muteMatch) {
      const userId = muteMatch[1];
      const muted = Number(args[0]) !== 0;
      try {
        this.callbacks.onMuteUser?.(userId, muted);
      } catch (err) {
        console.error("[OSC] Error handling mute command:", err);
      }
      return;
    }

    // /cuecommx/allpage/start → trigger all-page
    if (address === "/cuecommx/allpage/start") {
      try {
        this.callbacks.onAllPageStart?.();
      } catch (err) {
        console.error("[OSC] Error handling allpage:start:", err);
      }
      return;
    }

    // /cuecommx/allpage/stop
    if (address === "/cuecommx/allpage/stop") {
      try {
        this.callbacks.onAllPageStop?.();
      } catch (err) {
        console.error("[OSC] Error handling allpage:stop:", err);
      }
      return;
    }
  }
}

export function buildOscConfig(env: NodeJS.ProcessEnv): OscConfig {
  return {
    enabled: env.CUECOMMX_OSC_ENABLED === "true",
    listenPort: parseInt(env.CUECOMMX_OSC_LISTEN_PORT ?? "8765", 10),
    sendHost: env.CUECOMMX_OSC_SEND_HOST ?? "127.0.0.1",
    sendPort: parseInt(env.CUECOMMX_OSC_SEND_PORT ?? "9000", 10),
  };
}
