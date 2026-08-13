import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

export interface RecordingEvent {
  timestamp: number;
  event: string;
  userId?: string;
  username?: string;
  channelId?: string;
  channelIds?: string[];
  detail?: string;
}

export interface RecordingSession {
  channelId: string;
  channelName: string;
  startedAt: number;
  filename: string;
  filePath: string;
  writeStream: WriteStream;
}

export interface RecordingFileInfo {
  filename: string;
  channelName: string;
  date: string;
  sizeBytes: number;
}

export interface StopRecordingResult {
  filePath: string;
  durationMs: number;
}

export type DeleteRecordingResult = "active" | "deleted" | "invalid" | "not-found";

export type RecordingErrorHandler = (channelId: string, error: Error) => void | Promise<void>;

export interface RecordingServiceOptions {
  createWriteStream?: (filePath: string) => WriteStream;
  onError?: RecordingErrorHandler;
  recordingsDir?: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd}_${HH}-${mm}-${ss}`;
}

function parseFilenameDate(filename: string): Date | undefined {
  const match = filename.match(/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
  if (!match) return undefined;
  const iso = match[1].replace("_", "T").replace(/-/g, (m, offset: number) =>
    offset > 4 && offset < 10 ? m : "-",
  );
  const parts = match[1].split("_");
  if (!parts[0] || !parts[1]) return undefined;
  const dateStr = `${parts[0]}T${parts[1].replace(/-/g, ":")}`;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function isValidRecordingFilename(filename: string): boolean {
  return filename.endsWith(".jsonl") && !filename.includes("..") && !filename.includes("/");
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class RecordingService {
  private readonly recordings = new Map<string, RecordingSession>();
  private readonly recordingsDir: string;
  private readonly createWriteStream: (filePath: string) => WriteStream;
  private readonly onError?: RecordingErrorHandler;

  constructor(recordingsDirOrOptions?: string | RecordingServiceOptions, options: RecordingServiceOptions = {}) {
    const resolved = typeof recordingsDirOrOptions === "string"
      ? { recordingsDir: recordingsDirOrOptions, ...options }
      : recordingsDirOrOptions ?? {};

    this.recordingsDir = resolved.recordingsDir ?? path.join(process.cwd(), "data", "recordings");
    this.createWriteStream = resolved.createWriteStream ?? ((filePath) =>
      createWriteStream(filePath, { flags: "a", encoding: "utf-8" }));
    this.onError = resolved.onError;
  }

  async ensureDirectory(): Promise<void> {
    await mkdir(this.recordingsDir, { recursive: true });
  }

  getRecordingsDir(): string {
    return this.recordingsDir;
  }

  async startRecording(channelId: string, channelName: string): Promise<void> {
    if (this.recordings.has(channelId)) {
      return;
    }

    await this.ensureDirectory();

    const now = Date.now();
    const safeName = sanitizeFilename(channelName);
    const filename = `${safeName}_${formatTimestamp(now)}.jsonl`;
    const filePath = path.join(this.recordingsDir, filename);

    const writeStream = this.createWriteStream(filePath);
    let errorReported = false;
    writeStream.on("error", (error) => {
      if (errorReported) {
        return;
      }

      errorReported = true;

      if (this.recordings.get(channelId)?.writeStream === writeStream) {
        this.recordings.delete(channelId);
      }

      console.error(`[Recording] Stream error for channel ${channelId}:`, error);

      if (this.onError) {
        void Promise.resolve(this.onError(channelId, error)).catch((callbackError) => {
          console.error(`[Recording] Error handler failed for channel ${channelId}:`, callbackError);
        });
      }
    });

    const session: RecordingSession = {
      channelId,
      channelName,
      startedAt: now,
      filename,
      filePath,
      writeStream,
    };

    this.recordings.set(channelId, session);

    this.writeEvent(channelId, {
      timestamp: now,
      event: "recording:start",
      channelId,
      detail: channelName,
    });
  }

  async stopRecording(channelId: string): Promise<StopRecordingResult | undefined> {
    const session = this.recordings.get(channelId);
    if (!session) return undefined;

    const now = Date.now();
    this.writeEvent(channelId, {
      timestamp: now,
      event: "recording:stop",
      channelId,
    });

    this.recordings.delete(channelId);

    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => {
        session.writeStream.off("error", handleError);
        reject(error);
      };

      session.writeStream.once("error", handleError);
      session.writeStream.end(() => {
        session.writeStream.off("error", handleError);
        resolve();
      });
    });

    return {
      filePath: session.filePath,
      durationMs: now - session.startedAt,
    };
  }

  writeEvent(channelId: string, event: RecordingEvent): void {
    const session = this.recordings.get(channelId);
    if (!session) return;

    try {
      session.writeStream.write(JSON.stringify(event) + "\n");
    } catch {
      // Never crash the server on recording I/O errors
    }
  }

  logTalkEvent(
    mode: "start" | "stop",
    userId: string,
    username: string,
    channelIds: string[],
  ): void {
    for (const channelId of channelIds) {
      if (!this.recordings.has(channelId)) continue;

      this.writeEvent(channelId, {
        timestamp: Date.now(),
        event: mode === "start" ? "talk:start" : "talk:stop",
        userId,
        username,
        channelId,
        channelIds,
      });
    }
  }

  getActiveRecordings(): { channelId: string; channelName: string; startedAt: number }[] {
    return [...this.recordings.values()].map((session) => ({
      channelId: session.channelId,
      channelName: session.channelName,
      startedAt: session.startedAt,
    }));
  }

  getActiveChannelIds(): string[] {
    return [...this.recordings.keys()];
  }

  isRecording(channelId: string): boolean {
    return this.recordings.has(channelId);
  }

  isActiveRecordingFilename(filename: string): boolean {
    return [...this.recordings.values()].some((session) => session.filename === filename);
  }

  async listRecordings(): Promise<RecordingFileInfo[]> {
    try {
      await this.ensureDirectory();
      const entries = await readdir(this.recordingsDir);
      const results: RecordingFileInfo[] = [];

      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;

        try {
          const filePath = path.join(this.recordingsDir, entry);
          const fileStat = await stat(filePath);
          const parts = entry.replace(".jsonl", "").split("_");
          const channelName = parts[0] ?? "unknown";
          const dateMatch = entry.match(/(\d{4}-\d{2}-\d{2})/);

          results.push({
            filename: entry,
            channelName,
            date: dateMatch?.[1] ?? "unknown",
            sizeBytes: fileStat.size,
          });
        } catch {
          // Skip files we can't stat
        }
      }

      results.sort((a, b) => b.filename.localeCompare(a.filename));
      return results;
    } catch {
      return [];
    }
  }

  async deleteRecording(filename: string): Promise<DeleteRecordingResult> {
    if (!isValidRecordingFilename(filename)) {
      return "invalid";
    }

    if (this.isActiveRecordingFilename(filename)) {
      return "active";
    }

    try {
      const filePath = path.join(this.recordingsDir, filename);
      await unlink(filePath);
      return "deleted";
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return "not-found";
      }

      throw error;
    }
  }

  async pruneOlderThan(days: number): Promise<number> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let pruned = 0;

    try {
      await this.ensureDirectory();
      const entries = await readdir(this.recordingsDir);
      const activeFilenames = new Set(
        [...this.recordings.values()].map((session) => session.filename),
      );

      for (const entry of entries) {
        if (!entry.endsWith(".jsonl") || activeFilenames.has(entry)) continue;

        try {
          const filePath = path.join(this.recordingsDir, entry);
          const fileStat = await stat(filePath);

          if (fileStat.mtimeMs < cutoff) {
            await unlink(filePath);
            pruned++;
          }
        } catch {
          // Skip files we can't process
        }
      }
    } catch {
      // Directory doesn't exist or is inaccessible
    }

    return pruned;
  }

  async closeAll(): Promise<void> {
    const channelIds = [...this.recordings.keys()];
    for (const channelId of channelIds) {
      await this.stopRecording(channelId);
    }
  }

  // Future enhancement: mediasoup PlainTransport + pipe could forward RTP
  // to a recording process for actual audio capture. For MVP, this service
  // logs talk events as a "who said what when" session log.
}
