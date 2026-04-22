import { type FormEvent, type ReactNode } from "react";

import { type RealtimeConnectionState } from "@cuecommx/core";
import * as Separator from "@radix-ui/react-separator";
import {
  AlertTriangle,
  Megaphone,
  QrCode,
  RadioTower,
  ShieldCheck,
  Users,
  Waypoints,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  type AdminDashboardUser,
  type AuthSuccessResponse,
  type ChannelInfo,
  type DiscoveryResponse,
  type StatusResponse,
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

interface DashboardPageProps {
  status?: StatusResponse;
  loading: boolean;
  error?: string;
  session?: AuthSuccessResponse;
  discovery?: DiscoveryResponse;
  adminRealtimeState: RealtimeConnectionState;
  users: AdminDashboardUser[];
  channels: ChannelInfo[];
  allPageActive?: { userId: string; username: string };
  unlatchPendingChannelId?: string;
  setupPending: boolean;
  setupError?: string;
  loginPending: boolean;
  loginError?: string;
  setupUsername: string;
  setupPin: string;
  loginUsername: string;
  loginPin: string;
  onSetupUsernameChange: (v: string) => void;
  onSetupPinChange: (v: string) => void;
  onLoginUsernameChange: (v: string) => void;
  onLoginPinChange: (v: string) => void;
  onSetupAdmin: (e: FormEvent<HTMLFormElement>) => void;
  onAdminLogin: (e: FormEvent<HTMLFormElement>) => void;
  onUnlatchChannel: (channelId: string) => void;
}

function MetricCard({
  detail,
  title,
  value,
}: {
  detail: string;
  title: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {title}
        </p>
        <p className="text-3xl font-semibold tracking-tight text-foreground">{value}</p>
        <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function ReadinessItem({
  body,
  icon,
  title,
}: {
  title: string;
  body: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex gap-4 rounded-2xl border border-border/60 bg-background/35 p-4">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
        {icon}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export function DashboardPage({
  status,
  loading,
  error,
  session,
  discovery,
  adminRealtimeState,
  users,
  channels,
  allPageActive,
  unlatchPendingChannelId,
  setupPending,
  setupError,
  loginPending,
  loginError,
  setupUsername,
  setupPin,
  loginUsername,
  loginPin,
  onSetupUsernameChange,
  onSetupPinChange,
  onLoginUsernameChange,
  onLoginPinChange,
  onSetupAdmin,
  onAdminLogin,
  onUnlatchChannel,
}: DashboardPageProps) {
  const primaryDiscoveryTarget =
    discovery?.connectTargets.find((t) => t.id === discovery?.primaryTargetId) ??
    discovery?.connectTargets.find((t) => t.url === discovery?.primaryUrl);
  const multipleDetectedInterfaces = (discovery?.detectedInterfaces.length ?? 0) > 1;
  const suggestedAnnouncedHost =
    discovery?.announcedHost ?? discovery?.detectedInterfaces[0]?.address;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            CueCommX Admin
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            {status ? (
              <span className="text-sm text-muted-foreground">{status.name}</span>
            ) : null}
            {status ? (
              <Badge variant="accent">Protocol v{status.protocolVersion}</Badge>
            ) : null}
            {session ? (
              <Badge variant={adminRealtimeState === "connected" ? "success" : "warning"}>
                {adminRealtimeState === "connected" ? "Live sync connected" : "Live sync reconnecting"}
              </Badge>
            ) : null}
          </div>
        </div>

        {loading ? (
          <Card>
            <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
              <RadioTower className="h-4 w-4 text-primary" />
              Loading server status...
            </CardContent>
          </Card>
        ) : null}

        {error ? (
          <Card className="border-danger/50">
            <CardContent className="flex items-center gap-3 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </CardContent>
          </Card>
        ) : null}

        {status ? (
          <>
            {!session ? (
              <Card>
                <CardHeader>
                  <CardDescription>
                    {status.needsAdminSetup ? "First-run onboarding" : "Admin sign-in"}
                  </CardDescription>
                  <CardTitle>
                    {status.needsAdminSetup ? "Create the first admin" : "Sign into admin"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {status.needsAdminSetup ? (
                    <form className="space-y-4" onSubmit={onSetupAdmin}>
                      <p className="text-sm leading-6 text-muted-foreground">
                        The first admin gets access to every seeded channel so they can invite the
                        rest of the crew and start assigning permissions.
                      </p>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="setup-admin-name">
                          Admin name
                        </label>
                        <input
                          autoComplete="username"
                          className={inputClassName}
                          id="setup-admin-name"
                          onChange={(event) => onSetupUsernameChange(event.target.value)}
                          placeholder="Technical Director"
                          value={setupUsername}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="setup-admin-pin">
                          PIN
                        </label>
                        <input
                          autoComplete="new-password"
                          className={inputClassName}
                          id="setup-admin-pin"
                          onChange={(event) => onSetupPinChange(event.target.value)}
                          placeholder="Optional"
                          type="password"
                          value={setupPin}
                        />
                      </div>
                      <Button className="w-full justify-center" disabled={setupPending} size="lg" type="submit">
                        {setupPending ? "Creating admin..." : "Create first admin"}
                      </Button>
                    </form>
                  ) : (
                    <form className="space-y-4" onSubmit={onAdminLogin}>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Sign in with an admin account to manage operators and assign channel access.
                      </p>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="admin-login-name">
                          Admin name
                        </label>
                        <input
                          autoComplete="username"
                          className={inputClassName}
                          id="admin-login-name"
                          onChange={(event) => onLoginUsernameChange(event.target.value)}
                          placeholder="Technical Director"
                          value={loginUsername}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="admin-login-pin">
                          PIN
                        </label>
                        <input
                          autoComplete="current-password"
                          className={inputClassName}
                          id="admin-login-pin"
                          onChange={(event) => onLoginPinChange(event.target.value)}
                          placeholder="Optional"
                          type="password"
                          value={loginPin}
                        />
                      </div>
                      <Button className="w-full justify-center" disabled={loginPending} size="lg" type="submit">
                        {loginPending ? "Signing in..." : "Sign into admin"}
                      </Button>
                    </form>
                  )}

                  {setupError ? (
                    <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                      {setupError}
                    </div>
                  ) : null}

                  {loginError ? (
                    <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                      {loginError}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                detail={`${status.maxUsers} maximum on this server`}
                title="Connected users"
                value={`${status.connectedUsers}`}
              />
              <MetricCard
                detail="Default control-room palette loaded"
                title="Configured channels"
                value={`${status.channels}`}
              />
              <MetricCard
                detail="Users can now be created and assigned from this dashboard"
                title="Managed users"
                value={`${users.length}`}
              />
              <MetricCard
                detail="Strictly local-network, low-latency deployment"
                title="Protocol"
                value={`v${status.protocolVersion}`}
              />
            </div>

            <Card className="w-full">
              <CardHeader>
                <CardDescription>Server identity</CardDescription>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <CardTitle>{status.name ?? "CueCommX"}</CardTitle>
                    <p className="text-sm leading-6 text-muted-foreground">
                      QR-first discovery, manual IP fallback, and local-only deployment stay visible
                      at all times.
                    </p>
                  </div>
                  <Badge variant="accent">Protocol v{status.protocolVersion ?? "—"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
                {discovery ? (
                  <>
                    <div className="mx-auto flex flex-col items-center gap-3">
                      <div className="rounded-[1.75rem] bg-white p-4 shadow-[0_20px_60px_rgba(15,23,42,0.35)]">
                        <QRCodeSVG
                          aria-label="CueCommX connect QR"
                          includeMargin
                          size={148}
                          title="CueCommX connect QR"
                          value={discovery.primaryUrl}
                        />
                      </div>
                      <Badge variant="success">Scan to open server</Badge>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                        <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                          <QrCode className="h-4 w-4 text-primary" />
                          Primary connect URL
                        </div>
                        <a
                          className="mt-3 block break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
                          href={discovery.primaryUrl}
                        >
                          {discovery.primaryUrl}
                        </a>
                      </div>

                      <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                            <Waypoints className="h-4 w-4 text-primary" />
                            Network confirmation
                          </div>
                          <Badge
                            variant={
                              discovery.announcedHost
                                ? "success"
                                : multipleDetectedInterfaces
                                  ? "warning"
                                  : "accent"
                            }
                          >
                            {discovery.announcedHost
                              ? "Pinned by announced IP"
                              : multipleDetectedInterfaces
                                ? "Multiple LAN interfaces"
                                : "Auto-selected LAN target"}
                          </Badge>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                          {discovery.primaryHost
                            ? `CueCommX is using ${discovery.primaryHost} as the primary web URL via CUECOMMX_PRIMARY_HOST.`
                            : discovery.announcedHost
                              ? `CueCommX is pinned to ${discovery.announcedHost} via CUECOMMX_ANNOUNCED_IP.`
                              : multipleDetectedInterfaces
                                ? "CueCommX detected more than one LAN interface. Confirm the primary URL below and pin the correct address before service day if this machine has multiple NICs."
                                : "CueCommX is auto-selecting the available LAN address for QR and manual connect handoff."}
                        </p>
                        {primaryDiscoveryTarget ? (
                          <div className="mt-3 rounded-2xl border border-border/60 bg-background/50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Badge variant="accent">Primary discovery</Badge>
                              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                {primaryDiscoveryTarget.kind}
                              </span>
                            </div>
                            <a
                              className="mt-3 block break-all text-sm text-foreground underline-offset-4 hover:text-primary hover:underline"
                              href={primaryDiscoveryTarget.url}
                            >
                              {primaryDiscoveryTarget.url}
                            </a>
                          </div>
                        ) : null}
                        {discovery.detectedInterfaces.length ? (
                          <div className="mt-3 grid gap-2">
                            {discovery.detectedInterfaces.map((entry) => (
                              <div
                                className="rounded-2xl border border-border/60 bg-background/50 p-3"
                                key={`${entry.name}-${entry.address}`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <Badge
                                    variant={
                                      entry.url === discovery?.primaryUrl ? "success" : "neutral"
                                    }
                                  >
                                    {entry.name}
                                  </Badge>
                                  <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                    {entry.address}
                                  </span>
                                </div>
                                <a
                                  className="mt-3 block break-all text-sm text-foreground underline-offset-4 hover:text-primary hover:underline"
                                  href={entry.url}
                                >
                                  {entry.url}
                                </a>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {suggestedAnnouncedHost ? (
                          <div className="mt-3 rounded-2xl border border-border/60 bg-background/50 p-3 text-sm text-muted-foreground">
                            To pin the web QR/connect URL to a specific host or domain, set{" "}
                            <code>CUECOMMX_PRIMARY_HOST=comms.example.local</code>. To pin WebRTC
                            media routing to a specific IP, set{" "}
                            <code>CUECOMMX_ANNOUNCED_IP={suggestedAnnouncedHost}</code>. Restart the
                            server after changes.
                          </div>
                        ) : null}
                        {discovery.mdns ? (
                          <div className="mt-3 rounded-2xl border border-border/60 bg-background/50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Badge variant={discovery.mdns.enabled ? "success" : "warning"}>
                                {discovery.mdns.enabled
                                  ? "mDNS broadcast active"
                                  : "mDNS broadcast unavailable"}
                              </Badge>
                              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                {discovery.mdns.serviceType}
                              </span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                              Compatible LAN clients can browse {discovery.mdns.serviceType} to
                              discover this server automatically. QR and manual URLs remain the
                              fallback.
                            </p>
                            {discovery.mdns.error ? (
                              <div className="mt-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                                {discovery.mdns.error}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Manual connect fallbacks
                        </p>
                        <div className="grid gap-2">
                          {discovery.connectTargets.map((target) => (
                            <div
                              className="rounded-2xl border border-border/60 bg-background/35 p-3"
                              key={target.id}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <Badge variant={target.url === discovery?.primaryUrl ? "accent" : "neutral"}>
                                  {target.label}
                                </Badge>
                                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                  {target.kind}
                                </span>
                              </div>
                              <a
                                className="mt-3 block break-all text-sm text-foreground underline-offset-4 hover:text-primary hover:underline"
                                href={target.url}
                              >
                                {target.url}
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Loading QR and manual connect targets...
                  </div>
                )}
              </CardContent>
            </Card>

            {session ? (
              <Card>
                <CardHeader>
                  <CardDescription>Live channel activity</CardDescription>
                  <CardTitle>Active talkers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {allPageActive ? (
                    <div className="flex items-center gap-3 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
                      <Megaphone className="h-4 w-4 shrink-0" /> All-Page active by {allPageActive.username}
                    </div>
                  ) : null}
                  {channels.map((channel, index) => {
                    const activeTalkers = users.filter((user) =>
                      user.activeTalkChannelIds.includes(channel.id),
                    );

                    return (
                      <div className="space-y-4" key={channel.id}>
                        <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <span
                                  aria-hidden="true"
                                  className="h-3.5 w-3.5 rounded-full"
                                  style={{ backgroundColor: channel.color }}
                                />
                                <p className="font-medium text-foreground">{channel.name}</p>
                              </div>
                              <p className="text-sm leading-6 text-muted-foreground">
                                {activeTalkers.length > 0
                                  ? activeTalkers.map((user) => user.username).join(", ")
                                  : "No one is talking on this channel right now."}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              {activeTalkers.length > 0 ? (
                                <Button
                                  disabled={unlatchPendingChannelId === channel.id}
                                  onClick={() => onUnlatchChannel(channel.id)}
                                  size="sm"
                                  type="button"
                                  variant="outline"
                                >
                                  {unlatchPendingChannelId === channel.id
                                    ? "Unlatching…"
                                    : "Unlatch all"}
                                </Button>
                              ) : null}
                              <Badge variant={activeTalkers.length > 0 ? "warning" : "neutral"}>
                                {activeTalkers.length > 0
                                  ? `${activeTalkers.length} live`
                                  : "Idle"}
                              </Badge>
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
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardDescription>Operational readiness</CardDescription>
                <CardTitle>Primary discovery and emergency control</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <ReadinessItem
                    body="Show a QR code first, but keep the manual server URL visible so operators can still join when camera access or mDNS is unavailable."
                    icon={<QrCode className="h-4 w-4" />}
                    title="Primary discovery"
                  />
                  <ReadinessItem
                    body="Use operator-grade language and stable layout. Critical states must stay readable at a glance from across the room."
                    icon={<ShieldCheck className="h-4 w-4" />}
                    title="Clear emergency actions"
                  />
                  <ReadinessItem
                    body="All traffic remains on the LAN, with reconnect protection and explicit fallback paths instead of hidden magic."
                    icon={<Waypoints className="h-4 w-4" />}
                    title="Local-first reliability"
                  />
                </div>

                <Separator.Root
                  className="h-px w-full bg-border/60"
                  decorative
                  orientation="horizontal"
                />

                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <Users className="h-4 w-4 text-primary" />
                  <span>{status.connectedUsers} active now.</span>
                  <span className="text-border">•</span>
                  <span>{status.maxUsers} seats planned for the MVP.</span>
                  <span className="text-border">•</span>
                  <span>
                    {status.needsAdminSetup
                      ? "Create the first admin next."
                      : "Admin setup complete."}
                  </span>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}
