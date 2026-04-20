import { createSocket } from "node:dgram";
import { EventEmitter } from "node:events";

import OBSWebSocket from "obs-websocket-js";

import type { TallySourceState } from "@cuecommx/protocol";

export interface TallyConfig {
  obsEnabled: boolean;
  obsUrl: string;
  obsPassword: string;
  tslEnabled: boolean;
  tslListenPort: number;
}

export interface TallyServiceEvents {
  update: [sources: TallySourceState[]];
}

export class TallyService extends EventEmitter<TallyServiceEvents> {
  private obs: OBSWebSocket | null = null;
  private tslSocket: ReturnType<typeof createSocket> | null = null;
  private readonly sources: Map<string, TallySourceState> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly config: TallyConfig;

  constructor(config: TallyConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.config.obsEnabled) {
      await this.connectOBS();
    }

    if (this.config.tslEnabled) {
      this.startTSL();
    }
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    await this.obs?.disconnect();
    this.obs = null;

    this.tslSocket?.close();
    this.tslSocket = null;
  }

  getSources(): TallySourceState[] {
    return Array.from(this.sources.values());
  }

  private async connectOBS(): Promise<void> {
    this.obs = new OBSWebSocket();

    this.obs.on("CurrentProgramSceneChanged", ({ sceneName }) => {
      this.updateFromOBSScene(sceneName, null);
    });

    this.obs.on("CurrentPreviewSceneChanged", ({ sceneName }) => {
      this.updateFromOBSScene(null, sceneName);
    });

    this.obs.on("ConnectionClosed", () => {
      console.warn("[Tally] OBS connection closed, will retry in 10s");
      this.reconnectTimer = setTimeout(() => void this.connectOBS(), 10_000);
    });

    try {
      await this.obs.connect(this.config.obsUrl, this.config.obsPassword || undefined);
      const { currentProgramSceneName } = await this.obs.call("GetCurrentProgramScene");
      const { currentPreviewSceneName } = await this.obs.call("GetCurrentPreviewScene");
      this.updateFromOBSScene(currentProgramSceneName, currentPreviewSceneName);
    } catch (err) {
      console.warn("[Tally] OBS connection failed, will retry in 10s:", err);
      this.reconnectTimer = setTimeout(() => void this.connectOBS(), 10_000);
    }
  }

  private updateFromOBSScene(programScene: string | null, previewScene: string | null): void {
    const allSceneNames = new Set([
      ...this.sources.keys(),
      ...(programScene ? [programScene] : []),
      ...(previewScene ? [previewScene] : []),
    ]);

    for (const name of allSceneNames) {
      const state: TallySourceState["state"] =
        name === programScene ? "program" : name === previewScene ? "preview" : "none";
      this.sources.set(name, { sourceId: name, sourceName: name, state });
    }

    this.emit("update", this.getSources());
  }

  private startTSL(): void {
    this.tslSocket = createSocket("udp4");

    this.tslSocket.bind(this.config.tslListenPort, () => {
      console.log(`[Tally] TSL UMD listening on UDP :${this.config.tslListenPort}`);
    });

    this.tslSocket.on("message", (msg) => {
      this.handleTSLPacket(msg);
    });

    this.tslSocket.on("error", (err) => {
      console.warn("[Tally] TSL socket error:", err);
    });
  }

  private handleTSLPacket(buf: Buffer): void {
    if (buf.length < 4) {
      return;
    }

    const address = buf.readUInt16LE(0);
    const control = buf.readUInt16LE(2);
    // TSL UMD v3.1: bits 0-1 = RH tally (program), bits 2-3 = LH tally (preview)
    const rhTally = (control & 0x0003) > 0;
    const lhTally = (control & 0x000c) > 0;
    const label = buf.slice(4, 20).toString("utf8").replace(/\0/g, "").trim();

    const state: TallySourceState["state"] = rhTally ? "program" : lhTally ? "preview" : "none";
    const sourceId = `tsl-${address}`;
    this.sources.set(sourceId, { sourceId, sourceName: label || sourceId, state });

    this.emit("update", this.getSources());
  }
}
