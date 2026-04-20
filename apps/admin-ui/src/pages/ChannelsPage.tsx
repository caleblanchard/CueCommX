import { type FormEvent } from "react";

import * as Separator from "@radix-ui/react-separator";
import {
  type AdminDashboardUser,
  type AuthSuccessResponse,
  type ChannelInfo,
} from "@cuecommx/protocol";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";
import { inputClassName } from "../lib/form-styles.js";

interface ChannelsPageProps {
  session?: AuthSuccessResponse;
  channels: ChannelInfo[];
  users: AdminDashboardUser[];
  channelActionError?: string;
  channelDeletePendingId?: string;
  channelFormPending: boolean;
  editingChannelId?: string;
  channelName: string;
  channelColor: string;
  channelIsGlobal: boolean;
  channelType: "intercom" | "program" | "confidence";
  channelSourceUserId: string;
  channelPriority: number;
  onChannelNameChange: (v: string) => void;
  onChannelColorChange: (v: string) => void;
  onChannelIsGlobalChange: (v: boolean) => void;
  onChannelTypeChange: (v: "intercom" | "program" | "confidence") => void;
  onChannelSourceUserIdChange: (v: string) => void;
  onChannelPriorityChange: (v: number) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancelEdit: () => void;
  onEditChannel: (channel: ChannelInfo) => void;
  onDeleteChannel: (channel: ChannelInfo) => void;
}

export function ChannelsPage({
  session,
  channels,
  users,
  channelActionError,
  channelDeletePendingId,
  channelFormPending,
  editingChannelId,
  channelName,
  channelColor,
  channelIsGlobal,
  channelType,
  channelSourceUserId,
  channelPriority,
  onChannelNameChange,
  onChannelColorChange,
  onChannelIsGlobalChange,
  onChannelTypeChange,
  onChannelSourceUserIdChange,
  onChannelPriorityChange,
  onSubmit,
  onCancelEdit,
  onEditChannel,
  onDeleteChannel,
}: ChannelsPageProps) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Configure intercom channels, program feeds, and confidence monitors.
          </p>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardDescription>
              {session ? "Channel management" : "Default channels"}
            </CardDescription>
            <CardTitle>
              {editingChannelId
                ? "Edit channel"
                : session
                  ? "Create a channel"
                  : "Control-room palette"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {session ? (
              <form className="space-y-4" onSubmit={onSubmit}>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground" htmlFor="channel-name">
                      Channel name
                    </label>
                    <input
                      className={inputClassName}
                      id="channel-name"
                      onChange={(event) => onChannelNameChange(event.target.value)}
                      placeholder="Front of House"
                      value={channelName}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground" htmlFor="channel-color">
                      Hex color
                    </label>
                    <input
                      className={inputClassName}
                      id="channel-color"
                      onChange={(event) => onChannelColorChange(event.target.value)}
                      placeholder="#22C55E"
                      value={channelColor}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background/35 px-4 py-3">
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 rounded-full shadow-[0_0_0_4px_rgba(148,163,184,0.08)]"
                    style={{ backgroundColor: channelColor }}
                  />
                  <p className="text-sm text-muted-foreground">
                    Preview the live channel swatch before saving it to the control surface.
                  </p>
                </div>

                <label className="inline-flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground">
                  <input
                    checked={channelIsGlobal}
                    onChange={(event) => onChannelIsGlobalChange(event.target.checked)}
                    type="checkbox"
                  />
                  Global channel (always visible regardless of active group)
                </label>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Channel type</label>
                  <div className="flex gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-foreground">
                      <input
                        checked={channelType === "intercom"}
                        name="channelType"
                        onChange={() => onChannelTypeChange("intercom")}
                        type="radio"
                      />
                      Intercom (two-way talk)
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-foreground">
                      <input
                        checked={channelType === "program"}
                        name="channelType"
                        onChange={() => onChannelTypeChange("program")}
                        type="radio"
                      />
                      📡 Program (one-way feed)
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-foreground">
                      <input
                        checked={channelType === "confidence"}
                        name="channelType"
                        onChange={() => onChannelTypeChange("confidence")}
                        type="radio"
                      />
                      🎧 Confidence (always-on monitor)
                    </label>
                  </div>
                </div>

                {channelType === "confidence" ? (
                  <p className="text-xs text-muted-foreground">
                    Confidence channels are listen-only, always-on, and exempt from ducking.
                  </p>
                ) : null}

                {channelType === "program" ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground" htmlFor="sourceUser">
                      Source user (who produces audio on this feed)
                    </label>
                    <select
                      className="w-full rounded-xl border border-border/70 bg-background/60 px-4 py-2.5 text-sm text-foreground"
                      id="sourceUser"
                      onChange={(event) => onChannelSourceUserIdChange(event.target.value)}
                      value={channelSourceUserId}
                    >
                      <option value="">— Select a source user —</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.username} ({user.role})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="channelPriority">
                    Priority (1 = lowest, 10 = highest)
                  </label>
                  <select
                    className="w-full rounded-xl border border-border/70 bg-background/60 px-4 py-2.5 text-sm text-foreground"
                    id="channelPriority"
                    onChange={(event) => onChannelPriorityChange(Number(event.target.value))}
                    value={channelPriority}
                  >
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={p}>
                        {p}{p === 5 ? " (default)" : p >= 8 ? " (high)" : p <= 2 ? " (low)" : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Higher-priority channels duck (reduce volume of) lower-priority channels when active.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button disabled={channelFormPending} type="submit">
                    {channelFormPending
                      ? editingChannelId
                        ? "Saving..."
                        : "Creating..."
                      : editingChannelId
                        ? "Save channel"
                        : "Create channel"}
                  </Button>
                  {editingChannelId ? (
                    <Button onClick={onCancelEdit} type="button" variant="outline">
                      Cancel editing
                    </Button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="text-sm leading-6 text-muted-foreground">
                Sign in as an admin to create, rename, or remove channels.
              </div>
            )}

            {channelActionError ? (
              <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                {channelActionError}
              </div>
            ) : null}

            <Separator.Root
              className="h-px w-full bg-border/60"
              decorative
              orientation="horizontal"
            />

            <div className="space-y-4">
              {channels.map((channel, index) => (
                <div className="space-y-4" key={channel.id}>
                  <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="h-3.5 w-3.5 rounded-full shadow-[0_0_0_4px_rgba(148,163,184,0.08)]"
                          style={{ backgroundColor: channel.color }}
                        />
                        <div>
                          <p className="font-medium text-foreground">{channel.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {channel.id} • Color-coded for faster scanning
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="neutral">{channel.color}</Badge>
                        {channel.isGlobal ? (
                          <Badge variant="accent">Global</Badge>
                        ) : null}
                        {channel.channelType === "program" ? (
                          <Badge variant="accent">📡 Program</Badge>
                        ) : null}
                        {channel.channelType === "confidence" ? (
                          <Badge variant="accent">🎧 Confidence</Badge>
                        ) : null}
                        {session ? (
                          <>
                            <Button
                              aria-label={`Edit ${channel.name}`}
                              onClick={() => onEditChannel(channel)}
                              type="button"
                              variant="outline"
                            >
                              Edit
                            </Button>
                            <Button
                              aria-label={`Delete ${channel.name}`}
                              disabled={channelDeletePendingId === channel.id}
                              onClick={() => onDeleteChannel(channel)}
                              type="button"
                              variant="danger"
                            >
                              {channelDeletePendingId === channel.id
                                ? "Deleting..."
                                : "Delete"}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {index < channels.length - 1 ? (
                    <Separator.Root
                      className="h-px w-full bg-border/60"
                      decorative
                      orientation="horizontal"
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
