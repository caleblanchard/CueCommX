import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RecordingService } from "./service.js";

const TEST_DIR = join(process.cwd(), "test-recordings-temp");

describe("RecordingService", () => {
  let service: RecordingService;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    service = new RecordingService(TEST_DIR);
  });

  afterEach(async () => {
    await service.closeAll();
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates the recordings directory on ensureDirectory", async () => {
    expect(existsSync(TEST_DIR)).toBe(false);
    await service.ensureDirectory();
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it("startRecording creates a .jsonl file and session", async () => {
    await service.startRecording("ch-1", "Production");
    const active = service.getActiveRecordings();

    expect(active).toHaveLength(1);
    expect(active[0]?.channelId).toBe("ch-1");
    expect(active[0]?.channelName).toBe("Production");
    expect(service.isRecording("ch-1")).toBe(true);
    expect(service.getActiveChannelIds()).toContain("ch-1");
  });

  it("does not create duplicate recording for same channel", async () => {
    await service.startRecording("ch-1", "Production");
    await service.startRecording("ch-1", "Production");

    expect(service.getActiveRecordings()).toHaveLength(1);
  });

  it("stopRecording closes file and returns result", async () => {
    await service.startRecording("ch-1", "Production");
    const result = await service.stopRecording("ch-1");

    expect(result).toBeDefined();
    expect(result!.filePath).toContain("Production_");
    expect(result!.filePath).toContain(".jsonl");
    expect(result!.durationMs).toBeGreaterThanOrEqual(0);
    expect(service.isRecording("ch-1")).toBe(false);
    expect(service.getActiveRecordings()).toHaveLength(0);
  });

  it("stopRecording returns undefined for unknown channel", async () => {
    const result = await service.stopRecording("nonexistent");
    expect(result).toBeUndefined();
  });

  it("logTalkEvent writes to active recording files", async () => {
    await service.startRecording("ch-1", "Production");
    service.logTalkEvent("start", "u1", "Alice", ["ch-1"]);
    service.logTalkEvent("stop", "u1", "Alice", ["ch-1"]);

    const result = await service.stopRecording("ch-1");
    expect(result).toBeDefined();

    const content = readFileSync(result!.filePath, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines.length).toBe(4); // start, talk:start, talk:stop, stop
    const startEvent = JSON.parse(lines[0]!);
    expect(startEvent.event).toBe("recording:start");

    const talkStart = JSON.parse(lines[1]!);
    expect(talkStart.event).toBe("talk:start");
    expect(talkStart.userId).toBe("u1");
    expect(talkStart.username).toBe("Alice");

    const talkStop = JSON.parse(lines[2]!);
    expect(talkStop.event).toBe("talk:stop");

    const stopEvent = JSON.parse(lines[3]!);
    expect(stopEvent.event).toBe("recording:stop");
  });

  it("logTalkEvent does nothing for non-recording channels", () => {
    // Should not throw
    service.logTalkEvent("start", "u1", "Alice", ["ch-nonexistent"]);
  });

  it("listRecordings returns saved files", async () => {
    await service.startRecording("ch-1", "Audio");
    service.logTalkEvent("start", "u1", "Bob", ["ch-1"]);
    await service.stopRecording("ch-1");

    const files = await service.listRecordings();
    expect(files.length).toBe(1);
    expect(files[0]?.channelName).toBe("Audio");
    expect(files[0]?.filename).toContain(".jsonl");
    expect(files[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it("listRecordings returns empty array when directory is empty", async () => {
    await service.ensureDirectory();
    const files = await service.listRecordings();
    expect(files).toEqual([]);
  });

  it("deleteRecording removes a file", async () => {
    await service.startRecording("ch-1", "Video");
    const result = await service.stopRecording("ch-1");
    expect(result).toBeDefined();

    const filename = result!.filePath.split("/").pop()!;
    const deleted = await service.deleteRecording(filename);
    expect(deleted).toBe(true);

    const files = await service.listRecordings();
    expect(files).toHaveLength(0);
  });

  it("deleteRecording rejects path traversal", async () => {
    const deleted = await service.deleteRecording("../../../etc/passwd");
    expect(deleted).toBe(false);
  });

  it("deleteRecording rejects non-jsonl files", async () => {
    const deleted = await service.deleteRecording("malicious.sh");
    expect(deleted).toBe(false);
  });

  it("deleteRecording returns false for nonexistent file", async () => {
    await service.ensureDirectory();
    const deleted = await service.deleteRecording("nonexistent.jsonl");
    expect(deleted).toBe(false);
  });

  it("pruneOlderThan removes old files", async () => {
    await service.ensureDirectory();

    // Create a fake old file with a past mtime
    const oldFile = join(TEST_DIR, "OldChannel_2020-01-01_00-00-00.jsonl");
    writeFileSync(oldFile, '{"event":"test"}\n');
    const { utimesSync } = await import("node:fs");
    const pastDate = new Date("2020-01-01T00:00:00Z");
    utimesSync(oldFile, pastDate, pastDate);

    // Create a recent recording
    await service.startRecording("ch-1", "Recent");
    await service.stopRecording("ch-1");

    // Prune files older than 1 day — should remove the old file
    const pruned = await service.pruneOlderThan(1);
    expect(pruned).toBe(1);

    const remaining = await service.listRecordings();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].filename).toContain("Recent");
  });

  it("closeAll stops all active recordings", async () => {
    await service.startRecording("ch-1", "Production");
    await service.startRecording("ch-2", "Audio");
    expect(service.getActiveRecordings()).toHaveLength(2);

    await service.closeAll();
    expect(service.getActiveRecordings()).toHaveLength(0);

    const files = await service.listRecordings();
    expect(files).toHaveLength(2);
  });

  it("sanitizes channel names for filenames", async () => {
    await service.startRecording("ch-1", "Front/Back (Special)");
    const active = service.getActiveRecordings();
    expect(active).toHaveLength(1);

    const result = await service.stopRecording("ch-1");
    expect(result?.filePath).toContain("Front_Back__Special_");
  });

  it("supports multiple simultaneous recordings", async () => {
    await service.startRecording("ch-1", "Production");
    await service.startRecording("ch-2", "Audio");
    await service.startRecording("ch-3", "Video");

    expect(service.getActiveRecordings()).toHaveLength(3);
    expect(service.getActiveChannelIds()).toEqual(
      expect.arrayContaining(["ch-1", "ch-2", "ch-3"]),
    );

    service.logTalkEvent("start", "u1", "Alice", ["ch-1", "ch-2"]);

    await service.stopRecording("ch-2");
    expect(service.getActiveRecordings()).toHaveLength(2);
    expect(service.isRecording("ch-2")).toBe(false);
  });
});
