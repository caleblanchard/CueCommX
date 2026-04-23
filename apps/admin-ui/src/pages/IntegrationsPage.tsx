import * as Separator from "@radix-ui/react-separator";
import {
  type AuthSuccessResponse,
  type ChannelInfo,
} from "@cuecommx/protocol";
import * as React from "react";

import { RecordingViewer } from "../components/RecordingViewer.js";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";

interface TallyStatus {
  sources: Array<{ sourceId: string; sourceName: string; state: "program" | "preview" | "none" }>;
  config: { obsEnabled: boolean; obsUrl: string; tslEnabled: boolean; tslListenPort: number };
}

interface IntegrationsPageProps {
  session?: AuthSuccessResponse;
  channels: ChannelInfo[];
  recordingActiveIds: string[];
  recordingPendingId?: string;
  savedRecordings: { filename: string; channelName: string; date: string; sizeBytes: number }[];
  recordingsLoading: boolean;
  pruneDays: number;
  tallyExpanded: boolean;
  tallyStatus: TallyStatus | null;
  onStartRecording: (channelId: string) => void;
  onStopRecording: (channelId: string) => void;
  onLoadSavedRecordings: () => void;
  onDeleteRecording: (filename: string) => void;
  onPruneRecordings: () => void;
  onPruneDaysChange: (days: number) => void;
  onTallyExpandedChange: (expanded: boolean) => void;
  formatFileSize: (bytes: number) => string;
}

export function IntegrationsPage({
  session,
  channels,
  recordingActiveIds,
  recordingPendingId,
  savedRecordings,
  recordingsLoading,
  pruneDays,
  tallyExpanded,
  tallyStatus,
  onStartRecording,
  onStopRecording,
  onLoadSavedRecordings,
  onDeleteRecording,
  onPruneRecordings,
  onPruneDaysChange,
  onTallyExpandedChange,
  formatFileSize,
}: IntegrationsPageProps) {
  const [viewingFilename, setViewingFilename] = React.useState<string | null>(null);

  async function handleDownloadRecording(filename: string): Promise<void> {
    const token = session?.sessionToken;
    if (!token) {
      alert("Not authenticated. Please reload and log in again.");
      return;
    }
    const response = await fetch(`/api/admin/recordings/${encodeURIComponent(filename)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      alert(`Download failed: ${response.status} ${response.statusText}`);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Delay revoke so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Recording, tally, OSC, StreamDeck, and GPIO.
          </p>
        </div>

        {!session ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              Sign in as admin to access integrations.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardDescription>Session logging</CardDescription>
                <CardTitle>Recording</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {channels.map((channel) => {
                    const isActive = recordingActiveIds.includes(channel.id);
                    const isPending = recordingPendingId === channel.id;

                    return (
                      <div
                        className="flex items-center justify-between rounded-xl border border-border/60 bg-background/35 px-4 py-3"
                        key={channel.id}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: channel.color }}
                          />
                          <span className="text-sm font-medium text-foreground">
                            {channel.name}
                          </span>
                          {isActive ? (
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />
                              REC
                            </span>
                          ) : null}
                        </div>
                        {isActive ? (
                          <Button
                            disabled={isPending}
                            onClick={() => onStopRecording(channel.id)}
                            size="sm"
                            type="button"
                            variant="danger"
                          >
                            {isPending ? "Stopping…" : "Stop"}
                          </Button>
                        ) : (
                          <Button
                            disabled={isPending}
                            onClick={() => onStartRecording(channel.id)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {isPending ? "Starting…" : "⏺ Record"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <Separator.Root
                  className="h-px w-full bg-border/60"
                  decorative
                  orientation="horizontal"
                />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-foreground">Saved recordings</h4>
                    <Button
                      onClick={onLoadSavedRecordings}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {recordingsLoading ? "Loading…" : "Refresh"}
                    </Button>
                  </div>

                  {savedRecordings.length > 0 ? (
                    <div className="space-y-2">
                      {savedRecordings.map((rec) => (
                        <div
                          className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-2 text-sm"
                          key={rec.filename}
                        >
                          <div className="min-w-0 space-y-0.5">
                            <p className="truncate font-medium text-foreground">
                              {rec.channelName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {rec.date} • {formatFileSize(rec.sizeBytes)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium text-foreground hover:bg-muted"
                              onClick={() => setViewingFilename(rec.filename)}
                              type="button"
                            >
                              View
                            </button>
                            <button
                              className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium text-foreground hover:bg-muted"
                              onClick={() => void handleDownloadRecording(rec.filename)}
                              type="button"
                            >
                              ↓
                            </button>
                            <Button
                              onClick={() => onDeleteRecording(rec.filename)}
                              size="sm"
                              type="button"
                              variant="danger"
                            >
                              ×
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {recordingsLoading
                        ? "Loading recordings…"
                        : "No saved recordings. Click Refresh to load."}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground" htmlFor="prune-days">
                      Prune older than
                    </label>
                    <input
                      className="h-8 w-16 rounded-md border border-border bg-background/70 px-2 text-center text-sm text-foreground"
                      id="prune-days"
                      min={1}
                      onChange={(event) => onPruneDaysChange(Number(event.target.value) || 30)}
                      type="number"
                      value={pruneDays}
                    />
                    <span className="text-xs text-muted-foreground">days</span>
                    <Button
                      onClick={onPruneRecordings}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Prune
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Video switcher tally</CardDescription>
                <div className="flex items-center justify-between">
                  <CardTitle>Tally Integration</CardTitle>
                  <Button
                    onClick={() => onTallyExpandedChange(!tallyExpanded)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {tallyExpanded ? "Collapse" : "Expand"}
                  </Button>
                </div>
              </CardHeader>
              {tallyExpanded ? (
                <CardContent className="space-y-4">
                  {tallyStatus ? (
                    <>
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-foreground">Configuration</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <span className="text-muted-foreground">OBS WebSocket</span>
                          <span className={tallyStatus.config.obsEnabled ? "text-success font-medium" : "text-muted-foreground"}>
                            {tallyStatus.config.obsEnabled ? `Enabled — ${tallyStatus.config.obsUrl}` : "Disabled"}
                          </span>
                          <span className="text-muted-foreground">TSL UMD v3.1</span>
                          <span className={tallyStatus.config.tslEnabled ? "text-success font-medium" : "text-muted-foreground"}>
                            {tallyStatus.config.tslEnabled ? `Enabled — UDP :${tallyStatus.config.tslListenPort}` : "Disabled"}
                          </span>
                        </div>
                      </div>
                      {tallyStatus.sources.length > 0 ? (
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold text-foreground">Live Tally Sources</h4>
                          <div className="space-y-1.5">
                            {tallyStatus.sources.map((source) => (
                              <div
                                className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-2 text-sm"
                                key={source.sourceId}
                              >
                                <span className="font-medium text-foreground">{source.sourceName}</span>
                                <span
                                  className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                                    source.state === "program"
                                      ? "bg-destructive text-destructive-foreground"
                                      : source.state === "preview"
                                        ? "bg-success text-success-foreground"
                                        : "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {source.state === "program"
                                    ? "PROGRAM"
                                    : source.state === "preview"
                                      ? "PREVIEW"
                                      : "NONE"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No tally sources detected. Configure OBS WebSocket or TSL UMD via environment variables.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading tally status…</p>
                  )}
                  <div className="rounded-lg border border-border/40 bg-background/20 p-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Environment variables</p>
                    <p><code>CUECOMMX_TALLY_OBS_ENABLED=true</code></p>
                    <p><code>CUECOMMX_TALLY_OBS_URL=ws://localhost:4455</code></p>
                    <p><code>CUECOMMX_TALLY_OBS_PASSWORD=yourpassword</code></p>
                    <p><code>CUECOMMX_TALLY_TSL_ENABLED=true</code></p>
                    <p><code>CUECOMMX_TALLY_TSL_PORT=8900</code></p>
                  </div>
                </CardContent>
              ) : null}
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Open Sound Control</CardDescription>
                <CardTitle>OSC Integration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  CueCommX can send and receive OSC messages to integrate with lighting consoles,
                  video switchers, and other OSC-capable equipment.
                </p>
                <div className="rounded border border-border bg-muted/30 p-3 text-xs font-mono space-y-1">
                  <p className="text-foreground font-semibold mb-2">Environment variables:</p>
                  <p><code>CUECOMMX_OSC_ENABLED=true</code> — enable OSC (default: false)</p>
                  <p><code>CUECOMMX_OSC_LISTEN_PORT=8765</code> — UDP port for incoming OSC</p>
                  <p><code>CUECOMMX_OSC_SEND_HOST=127.0.0.1</code> — host to send OSC to</p>
                  <p><code>CUECOMMX_OSC_SEND_PORT=9000</code> — UDP port to send OSC to</p>
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">Outgoing OSC addresses:</p>
                  <ul className="text-muted-foreground space-y-0.5 text-xs font-mono ml-2">
                    <li>/cuecommx/user/&#123;id&#125;/online — 1 when user connects, 0 on disconnect</li>
                    <li>/cuecommx/user/&#123;id&#125;/talking — 1 when talking, 0 when stopped</li>
                    <li>/cuecommx/channel/&#123;id&#125;/active — 1 when any talker is active</li>
                    <li>/cuecommx/allpage/active — 1 on all-page start, 0 on stop</li>
                  </ul>
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">Incoming OSC commands:</p>
                  <ul className="text-muted-foreground space-y-0.5 text-xs font-mono ml-2">
                    <li>/cuecommx/user/&#123;id&#125;/mute 1 — force-mute a user</li>
                    <li>/cuecommx/allpage/start — trigger all-page broadcast</li>
                    <li>/cuecommx/allpage/stop — stop all-page broadcast</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>HTTP API for hardware controllers</CardDescription>
                <CardTitle>StreamDeck / Companion Integration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Use the CueCommX HTTP API with Bitfocus Companion or any HTTP-capable controller
                  to read intercom state and trigger actions from physical buttons.
                </p>
                <div className="rounded border border-border bg-muted/30 p-3 text-xs font-mono space-y-1">
                  <p className="text-foreground font-semibold mb-2">API endpoints (require X-Api-Key header):</p>
                  <p><code>GET /api/stream-deck/state</code> — current users, channels, and all-page state</p>
                  <p><code>POST /api/stream-deck/action</code> — trigger mute or disconnect actions</p>
                  <p><code>GET /api/stream-deck/events</code> — SSE stream of state changes</p>
                </div>
                <div className="rounded border border-border bg-muted/30 p-3 text-xs font-mono space-y-1">
                  <p className="text-foreground font-semibold mb-2">API key configuration:</p>
                  <p><code>CUECOMMX_STREAMDECK_API_KEY=your-key</code> — set a persistent key</p>
                  <p className="text-muted-foreground">If not set, a random key is generated on each startup and logged to the server console.</p>
                </div>
                <div className="space-y-1 text-sm">
                  <p className="font-semibold">Example Companion HTTP action:</p>
                  <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto">{`POST /api/stream-deck/action
X-Api-Key: your-key
Content-Type: application/json

{ "action": "mute", "userId": "<user-id>" }`}</pre>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardDescription>Hardware button and indicator control</CardDescription>
                <CardTitle>GPIO Integration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  GPIO support allows USB HID devices (relay boards, button panels) to trigger
                  intercom actions and reflect intercom state via output pins.
                </p>
                <div className="rounded border border-border bg-muted/30 p-3 text-xs font-mono space-y-1">
                  <p className="text-foreground font-semibold mb-2">Environment variables:</p>
                  <p><code>CUECOMMX_GPIO_ENABLED=true</code> — enable GPIO (default: false)</p>
                  <p><code>CUECOMMX_GPIO_PROVIDER=hid</code> — hardware provider (default: none)</p>
                  <p><code>CUECOMMX_GPIO_CONFIG=[...]</code> — JSON array of pin mappings</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  HID provider requires <code>node-hid</code> to be installed on the server.
                  Install via: <code>npm install node-hid --workspace=apps/server</code>
                </p>
                <p className="text-xs text-muted-foreground">
                  Use <code>GET /api/gpio/devices</code> (admin auth) to enumerate connected HID devices.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {viewingFilename && session?.sessionToken && (
        <RecordingViewer
          filename={viewingFilename}
          sessionToken={session.sessionToken}
          onClose={() => setViewingFilename(null)}
        />
      )}
    </div>
  );
}
