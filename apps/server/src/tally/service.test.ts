import { describe, expect, it, vi } from "vitest";

import { TallyService, type TallyConfig } from "./service.js";
import type { TallySourceState } from "@cuecommx/protocol";

const baseConfig: TallyConfig = {
  obsEnabled: false,
  obsUrl: "ws://localhost:4455",
  obsPassword: "",
  tslEnabled: false,
  tslListenPort: 8900,
};

describe("TallyService", () => {
  describe("getSources()", () => {
    it("returns empty array initially", () => {
      const service = new TallyService(baseConfig);
      expect(service.getSources()).toEqual([]);
    });
  });

  describe("TSL UMD v3.1 packet parsing", () => {
    it("marks source as program when RH tally bits are set", () => {
      const service = new TallyService(baseConfig);

      // address=1, control=0x0001 (RH tally), label="Camera 1"
      const buf = Buffer.alloc(20);
      buf.writeUInt16LE(1, 0);
      buf.writeUInt16LE(0x0001, 2);
      buf.write("Camera 1", 4, "utf8");

      // Access private method via type casting
      (service as unknown as { handleTSLPacket: (b: Buffer) => void }).handleTSLPacket(buf);

      const sources = service.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        sourceId: "tsl-1",
        sourceName: "Camera 1",
        state: "program",
      });
    });

    it("marks source as preview when LH tally bits are set", () => {
      const service = new TallyService(baseConfig);

      const buf = Buffer.alloc(20);
      buf.writeUInt16LE(2, 0);
      buf.writeUInt16LE(0x0004, 2); // LH tally bit
      buf.write("Camera 2", 4, "utf8");

      (service as unknown as { handleTSLPacket: (b: Buffer) => void }).handleTSLPacket(buf);

      const sources = service.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        sourceId: "tsl-2",
        sourceName: "Camera 2",
        state: "preview",
      });
    });

    it("marks source as none when no tally bits are set", () => {
      const service = new TallyService(baseConfig);

      const buf = Buffer.alloc(20);
      buf.writeUInt16LE(3, 0);
      buf.writeUInt16LE(0x0000, 2);
      buf.write("Camera 3", 4, "utf8");

      (service as unknown as { handleTSLPacket: (b: Buffer) => void }).handleTSLPacket(buf);

      const sources = service.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        sourceId: "tsl-3",
        sourceName: "Camera 3",
        state: "none",
      });
    });

    it("prefers program over preview when both RH and LH bits set", () => {
      const service = new TallyService(baseConfig);

      const buf = Buffer.alloc(20);
      buf.writeUInt16LE(4, 0);
      buf.writeUInt16LE(0x0005, 2); // both RH (0x0001) and LH (0x0004)
      buf.write("Cam 4", 4, "utf8");

      (service as unknown as { handleTSLPacket: (b: Buffer) => void }).handleTSLPacket(buf);

      expect(service.getSources()[0]?.state).toBe("program");
    });

    it("ignores packets shorter than 4 bytes", () => {
      const service = new TallyService(baseConfig);

      (service as unknown as { handleTSLPacket: (b: Buffer) => void }).handleTSLPacket(
        Buffer.alloc(3),
      );

      expect(service.getSources()).toHaveLength(0);
    });

    it("handles unknown address gracefully (no label — uses sourceId as name)", () => {
      const service = new TallyService(baseConfig);

      const buf = Buffer.alloc(4); // minimal packet, no label bytes
      buf.writeUInt16LE(99, 0);
      buf.writeUInt16LE(0x0001, 2);

      (service as unknown as { handleTSLPacket: (b: Buffer) => void }).handleTSLPacket(buf);

      const sources = service.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]?.sourceName).toBe("tsl-99");
      expect(sources[0]?.state).toBe("program");
    });

    it("emits update event with current sources", () => {
      const service = new TallyService(baseConfig);
      const handler = vi.fn();
      service.on("update", handler);

      const buf = Buffer.alloc(20);
      buf.writeUInt16LE(1, 0);
      buf.writeUInt16LE(0x0001, 2);

      (service as unknown as { handleTSLPacket: (b: Buffer) => void }).handleTSLPacket(buf);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0]?.[0]).toHaveLength(1);
    });
  });

  describe("OBS scene change handling", () => {
    it("sets scene to program state", () => {
      const service = new TallyService(baseConfig);

      (service as unknown as { updateFromOBSScene: (p: string | null, v: string | null) => void })
        .updateFromOBSScene("Scene A", null);

      const sources = service.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        sourceId: "Scene A",
        sourceName: "Scene A",
        state: "program",
      });
    });

    it("sets scene to preview state", () => {
      const service = new TallyService(baseConfig);

      (service as unknown as { updateFromOBSScene: (p: string | null, v: string | null) => void })
        .updateFromOBSScene(null, "Scene B");

      const sources = service.getSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        sourceId: "Scene B",
        sourceName: "Scene B",
        state: "preview",
      });
    });

    it("sets program and preview simultaneously", () => {
      const service = new TallyService(baseConfig);

      (service as unknown as { updateFromOBSScene: (p: string | null, v: string | null) => void })
        .updateFromOBSScene("Scene A", "Scene B");

      const sources = service.getSources();
      const program = sources.find((s: TallySourceState) => s.state === "program");
      const preview = sources.find((s: TallySourceState) => s.state === "preview");
      expect(program?.sourceName).toBe("Scene A");
      expect(preview?.sourceName).toBe("Scene B");
    });

    it("demotes previous program to none when scene changes", () => {
      const service = new TallyService(baseConfig);
      const update = (service as unknown as { updateFromOBSScene: (p: string | null, v: string | null) => void }).updateFromOBSScene.bind(service);

      update("Scene A", null);
      update("Scene B", null);

      const sources = service.getSources();
      const sceneA = sources.find((s: TallySourceState) => s.sourceId === "Scene A");
      const sceneB = sources.find((s: TallySourceState) => s.sourceId === "Scene B");
      expect(sceneA?.state).toBe("none");
      expect(sceneB?.state).toBe("program");
    });

    it("emits update event on scene change", () => {
      const service = new TallyService(baseConfig);
      const handler = vi.fn();
      service.on("update", handler);

      (service as unknown as { updateFromOBSScene: (p: string | null, v: string | null) => void })
        .updateFromOBSScene("Scene A", "Scene B");

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("stop()", () => {
    it("clears reconnect timer", async () => {
      const service = new TallyService(baseConfig);
      // Set an internal reconnect timer
      (service as unknown as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer = setTimeout(
        () => { /* no-op */ },
        60_000,
      );
      await service.stop();
      expect(
        (service as unknown as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer,
      ).toBeNull();
    });
  });
});
