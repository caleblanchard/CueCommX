import * as React from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.js";

interface RecordingEvent {
  timestamp: number;
  event: string;
  userId?: string;
  username?: string;
  channelId?: string;
  channelIds?: string[];
  detail?: string;
}

interface ParsedRecording {
  channelName: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  events: RecordingEvent[];
  participants: string[];
  talkSegments: { username: string; startMs: number; durationMs: number | null }[];
}

function parseRecording(lines: string[]): ParsedRecording {
  const events: RecordingEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as RecordingEvent);
    } catch {
      // skip malformed lines
    }
  }

  const startEvent = events.find((e) => e.event === "recording:start");
  const stopEvent = events.find((e) => e.event === "recording:stop");
  const startedAt = startEvent?.timestamp ?? events[0]?.timestamp ?? 0;
  const endedAt = stopEvent?.timestamp ?? null;

  const channelName = startEvent?.detail ?? "Unknown";
  const participantSet = new Set<string>();
  const talkSegments: ParsedRecording["talkSegments"] = [];
  const openTalks = new Map<string, number>();

  for (const ev of events) {
    if (ev.event === "talk:start" && ev.username) {
      participantSet.add(ev.username);
      openTalks.set(ev.username, ev.timestamp);
    } else if (ev.event === "talk:stop" && ev.username) {
      const start = openTalks.get(ev.username);
      if (start !== undefined) {
        talkSegments.push({
          username: ev.username,
          startMs: start - startedAt,
          durationMs: ev.timestamp - start,
        });
        openTalks.delete(ev.username);
      }
    }
  }

  // Close any open talks at end
  for (const [username, start] of openTalks) {
    talkSegments.push({
      username,
      startMs: start - startedAt,
      durationMs: endedAt ? endedAt - start : null,
    });
  }

  return {
    channelName,
    startedAt,
    endedAt,
    durationMs: endedAt ? endedAt - startedAt : null,
    events,
    participants: [...participantSet],
    talkSegments,
  };
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTime(absTimestamp: number): string {
  const d = new Date(absTimestamp);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatRelativeMs(ms: number): string {
  return `+${formatDuration(ms)}`;
}

interface RecordingViewerProps {
  filename: string;
  sessionToken: string;
  onClose: () => void;
}

export function RecordingViewer({ filename, sessionToken, onClose }: RecordingViewerProps) {
  const [data, setData] = React.useState<ParsedRecording | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/recordings/${encodeURIComponent(filename)}`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        const parsed = parseRecording(text.split("\n"));
        setData(parsed);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filename, sessionToken]);

  const totalTalkMs = data?.talkSegments.reduce((sum, s) => sum + (s.durationMs ?? 0), 0) ?? 0;

  return (
    <Dialog defaultOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <DialogTitle>{data?.channelName ?? "Recording"}</DialogTitle>
              <DialogDescription className="mt-0.5 truncate">{filename}</DialogDescription>
            </div>
            <DialogClose className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground">
              ✕
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto px-6 pb-6">
          {loading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          )}

          {error && (
            <p className="py-8 text-center text-sm text-destructive">Error: {error}</p>
          )}

          {data && !loading && (
            <div className="space-y-5">
              {/* Summary row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border/40 bg-background/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-foreground">
                    {data.durationMs ? formatDuration(data.durationMs) : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Total talk time</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-foreground">
                    {totalTalkMs > 0 ? formatDuration(totalTalkMs) : "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">Participants</p>
                  <p className="mt-0.5 font-mono text-sm font-medium text-foreground">
                    {data.participants.length}
                  </p>
                </div>
              </div>

              {/* Talk segments */}
              {data.talkSegments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Talk log
                  </h4>
                  <div className="space-y-1.5">
                    {data.talkSegments.map((seg, i) => (
                      <div
                        className="flex items-center justify-between rounded-md border border-border/30 bg-background/20 px-3 py-1.5 text-sm"
                        key={i}
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                          <span className="font-medium text-foreground">{seg.username}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-mono">
                            {formatRelativeMs(seg.startMs)}
                          </span>
                          {seg.durationMs !== null && (
                            <span className="font-mono text-foreground/70">
                              {formatDuration(seg.durationMs)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw event timeline */}
              <details className="group">
                <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  Raw event log ({data.events.length} events)
                </summary>
                <div className="mt-2 space-y-1">
                  {data.events.map((ev, i) => (
                    <div
                      className="flex items-start gap-3 rounded px-2 py-1 font-mono text-xs even:bg-muted/20"
                      key={i}
                    >
                      <span className="shrink-0 text-muted-foreground">
                        {formatTime(ev.timestamp)}
                      </span>
                      <span className={
                        ev.event === "talk:start" ? "text-primary" :
                        ev.event === "talk:stop" ? "text-muted-foreground" :
                        "text-foreground/60"
                      }>
                        {ev.event}
                      </span>
                      {ev.username && (
                        <span className="text-foreground">{ev.username}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
