import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import {
  CueCommXRealtimeClient,
  type RealtimeConnectionState,
} from "@cuecommx/core";
import * as Separator from "@radix-ui/react-separator";
import {
  AlertTriangle,
  QrCode,
  RadioTower,
  ShieldCheck,
  Users,
  Waypoints,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  type AdminDashboardUser,
  AuthFailureResponseSchema,
  ChannelMutationResponseSchema,
  ChannelsListResponseSchema,
  DiscoveryResponseSchema,
  GroupMutationResponseSchema,
  GroupsListResponseSchema,
  LoginResponseSchema,
  SetupAdminResponseSchema,
  StatusResponseSchema,
  UserMutationResponseSchema,
  UsersListResponseSchema,
  type AuthSuccessResponse,
  type ChannelInfo,
  type ChannelPermission,
  type DiscoveryResponse,
  type GroupInfo,
  type ManagedUser,
  type StatusResponse,
  type UserRole,
} from "@cuecommx/protocol";

import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.js";

interface ViewState {
  allPageActive?: { userId: string; username: string };
  channelActionError?: string;
  channelDeletePendingId?: string;
  channelFormPending: boolean;
  channels: ChannelInfo[];
  deletePendingId?: string;
  discovery?: DiscoveryResponse;
  error?: string;
  forceMutePendingId?: string;
  groupActionError?: string;
  groupDeletePendingId?: string;
  groupFormPending: boolean;
  groups: GroupInfo[];
  loading: boolean;
  loginError?: string;
  loginPending: boolean;
  session?: AuthSuccessResponse;
  setupError?: string;
  setupPending: boolean;
  status?: StatusResponse;
  unlatchPendingChannelId?: string;
  userActionError?: string;
  userFormPending: boolean;
  users: AdminDashboardUser[];
  usersLoading: boolean;
}

const initialState: ViewState = {
  channelFormPending: false,
  channels: [],
  groupFormPending: false,
  groups: [],
  loading: true,
  loginPending: false,
  setupPending: false,
  userFormPending: false,
  users: [],
  usersLoading: false,
};

const inputClassName =
  "h-12 w-full rounded-xl border border-border bg-background/70 px-4 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30";
const selectClassName = `${inputClassName} appearance-none`;

function buildPermissionDraft(
  channels: ChannelInfo[],
  permissions: ChannelPermission[] = [],
): ChannelPermission[] {
  const permissionMap = new Map(permissions.map((permission) => [permission.channelId, permission]));

  return channels.map((channel) => {
    const existing = permissionMap.get(channel.id);

    return {
      channelId: channel.id,
      canTalk: existing?.canTalk ?? false,
      canListen: existing?.canListen ?? false,
    };
  });
}

function formatChannelSummary(user: ManagedUser, channels: ChannelInfo[]): string {
  if (user.channelPermissions.length === 0) {
    return "No channel permissions assigned";
  }

  const nameById = new Map(channels.map((channel) => [channel.id, channel.name]));

  return user.channelPermissions
    .map((permission) => {
      const name = nameById.get(permission.channelId) ?? permission.channelId;
      const modes = [
        permission.canListen ? "L" : null,
        permission.canTalk ? "T" : null,
      ]
        .filter(Boolean)
        .join("/");

      return `${name} (${modes})`;
    })
    .join(", ");
}

function formatLiveTalkSummary(user: AdminDashboardUser, channels: ChannelInfo[]): string {
  if (!user.talking || user.activeTalkChannelIds.length === 0) {
    return user.online ? "Connected and standing by." : "Not currently connected.";
  }

  const channelNameById = new Map(channels.map((channel) => [channel.id, channel.name]));
  const channelNames = user.activeTalkChannelIds.map(
    (channelId) => channelNameById.get(channelId) ?? channelId,
  );

  return `Live on ${channelNames.join(", ")}.`;
}

function sortUsers(users: AdminDashboardUser[]): AdminDashboardUser[] {
  return [...users].sort((left, right) => {
    if (left.talking !== right.talking) {
      return left.talking ? -1 : 1;
    }

    if (left.online !== right.online) {
      return left.online ? -1 : 1;
    }

    return left.username.localeCompare(right.username);
  });
}

function toAdminDashboardUser(user: ManagedUser): AdminDashboardUser {
  return {
    ...user,
    activeTalkChannelIds: [],
    talking: false,
  };
}

function upsertChannelList(channels: ChannelInfo[], channel: ChannelInfo): ChannelInfo[] {
  const existingIndex = channels.findIndex((entry) => entry.id === channel.id);

  if (existingIndex === -1) {
    return [...channels, channel];
  }

  const nextChannels = [...channels];
  nextChannels[existingIndex] = channel;
  return nextChannels;
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

export default function App() {
  const [state, setState] = useState<ViewState>(initialState);
  const [adminRealtimeState, setAdminRealtimeState] =
    useState<RealtimeConnectionState>("idle");
  const [setupUsername, setSetupUsername] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | undefined>();
  const [editingChannelId, setEditingChannelId] = useState<string | undefined>();
  const [userUsername, setUserUsername] = useState("");
  const [userPin, setUserPin] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("operator");
  const [clearUserPin, setClearUserPin] = useState(false);
  const [userPermissions, setUserPermissions] = useState<ChannelPermission[]>([]);
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const [channelName, setChannelName] = useState("");
  const [channelColor, setChannelColor] = useState("#22C55E");
  const [channelIsGlobal, setChannelIsGlobal] = useState(false);
  const [channelType, setChannelType] = useState<"intercom" | "program" | "confidence">("intercom");
  const [channelSourceUserId, setChannelSourceUserId] = useState<string>("");
  const [channelPriority, setChannelPriority] = useState(5);
  const [editingGroupId, setEditingGroupId] = useState<string | undefined>();
  const [groupName, setGroupName] = useState("");
  const [groupChannelIds, setGroupChannelIds] = useState<string[]>([]);
  const [recordingActiveIds, setRecordingActiveIds] = useState<string[]>([]);
  const [recordingPendingId, setRecordingPendingId] = useState<string | undefined>();
  const [savedRecordings, setSavedRecordings] = useState<{ filename: string; channelName: string; date: string; sizeBytes: number }[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [pruneDays, setPruneDays] = useState(30);
  const [tallyExpanded, setTallyExpanded] = useState(false);
  const [tallyStatus, setTallyStatus] = useState<{
    sources: Array<{ sourceId: string; sourceName: string; state: "program" | "preview" | "none" }>;
    config: { obsEnabled: boolean; obsUrl: string; tslEnabled: boolean; tslListenPort: number };
  } | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadDashboard(): Promise<void> {
      try {
        const [statusResponse, channelsResponse, discoveryResponse] = await Promise.all([
          fetch("/api/status", { signal: abortController.signal }),
          fetch("/api/channels", { signal: abortController.signal }),
          fetch("/api/discovery", { signal: abortController.signal }),
        ]);

        if (!statusResponse.ok || !channelsResponse.ok || !discoveryResponse.ok) {
          throw new Error("Unable to load CueCommX admin data.");
        }

        const status = StatusResponseSchema.parse(await statusResponse.json());
        const parsedChannels = ChannelsListResponseSchema.parse(await channelsResponse.json());
        const discovery = DiscoveryResponseSchema.parse(await discoveryResponse.json());

        setUserPermissions(buildPermissionDraft(parsedChannels));
        setState({
          channelFormPending: false,
          channels: parsedChannels,
          discovery,
          groupFormPending: false,
          groups: [],
          loading: false,
          loginPending: false,
          setupPending: false,
          userFormPending: false,
          users: [],
          usersLoading: false,
          status,
        });
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setState({
          channelFormPending: false,
          channels: [],
          error: error instanceof Error ? error.message : "Unknown admin dashboard error.",
          groupFormPending: false,
          groups: [],
          loading: false,
          loginPending: false,
          setupPending: false,
          userFormPending: false,
          users: [],
          usersLoading: false,
        });
      }
    }

    void loadDashboard();

    return () => abortController.abort();
  }, []);

  useEffect(() => {
    if (!state.session || state.session.user.role !== "admin") {
      return;
    }

    let active = true;

    async function loadUsers(): Promise<void> {
      setState((current) => ({
        ...current,
        userActionError: undefined,
        usersLoading: true,
      }));

      try {
        const [usersResponse, groupsResponse] = await Promise.all([
          fetch("/api/users", {
            headers: {
              Authorization: `Bearer ${state.session?.sessionToken}`,
            },
          }),
          fetch("/api/groups", {
            headers: {
              Authorization: `Bearer ${state.session?.sessionToken}`,
            },
          }),
        ]);
        const usersPayload = await usersResponse.json();

        if (!usersResponse.ok) {
          throw new Error(AuthFailureResponseSchema.parse(usersPayload).error);
        }

        const users = sortUsers(UsersListResponseSchema.parse(usersPayload).map(toAdminDashboardUser));
        let groups: GroupInfo[] = [];

        if (groupsResponse.ok) {
          groups = GroupsListResponseSchema.parse(await groupsResponse.json());
        }

        if (!active) {
          return;
        }

        setState((current) => ({
          ...current,
          groups,
          userActionError: undefined,
          users,
          usersLoading: false,
        }));
      } catch (error) {
        if (!active) {
          return;
        }

        setState((current) => ({
          ...current,
          userActionError: error instanceof Error ? error.message : "Unable to load users.",
          usersLoading: false,
        }));
      }
    }

    void loadUsers();

    return () => {
      active = false;
    };
  }, [state.session?.sessionToken]);

  useEffect(() => {
    if (!state.session || state.session.user.role !== "admin") {
      setAdminRealtimeState("idle");
      return;
    }

    const realtimeClient = new CueCommXRealtimeClient({
      baseUrl: window.location.origin,
      onConnectionStateChange: (connectionState) => {
        setAdminRealtimeState(connectionState);
      },
      onMessage: (message) => {
        if (message.type === "presence:update") {
          setState((current) => ({
            ...current,
            status: current.status
              ? {
                  ...current.status,
                  connectedUsers: message.payload.connectedUsers,
                }
              : current.status,
          }));
          return;
        }

        if (message.type === "admin:dashboard") {
          setState((current) => {
            const unlatchCleared =
              current.unlatchPendingChannelId &&
              !message.payload.users.some((user) =>
                user.activeTalkChannelIds.includes(current.unlatchPendingChannelId!),
              );

            return {
              ...current,
              allPageActive: message.payload.allPageActive,
              channels: message.payload.channels,
              groups: message.payload.groups ?? current.groups,
              forceMutePendingId:
                current.forceMutePendingId &&
                message.payload.users.some(
                  (user) => user.id === current.forceMutePendingId && !user.talking,
                )
                  ? undefined
                  : current.forceMutePendingId,
              status: current.status
                ? {
                    ...current.status,
                    channels: message.payload.channels.length,
                    connectedUsers: message.payload.users.filter((user) => user.online).length,
                  }
                : current.status,
              unlatchPendingChannelId: unlatchCleared
                ? undefined
                : current.unlatchPendingChannelId,
              users: sortUsers(message.payload.users),
              usersLoading: false,
            };
          });
          setUserPermissions((current) =>
            buildPermissionDraft(message.payload.channels, current),
          );
          return;
        }

        if (message.type === "session:ready") {
          setState((current) => ({
            ...current,
            status: current.status
              ? {
                  ...current.status,
                  connectedUsers: message.payload.connectedUsers,
                }
              : current.status,
          }));
        }

        if (message.type === "recording:state") {
          setRecordingActiveIds(message.payload.activeChannelIds);
        }
      },
      sessionToken: state.session.sessionToken,
    });

    realtimeClient.connect();

    return () => {
      realtimeClient.disconnect();
    };
  }, [state.session?.sessionToken, state.session?.user.role]);

  useEffect(() => {
    if (!tallyExpanded || !state.session) {
      return;
    }

    let active = true;

    async function fetchTallyStatus(): Promise<void> {
      try {
        const response = await fetch("/api/tally/status", {
          headers: { Authorization: `Bearer ${state.session!.sessionToken}` },
        });

        if (response.ok && active) {
          setTallyStatus(await response.json());
        }
      } catch {
        // ignore network errors
      }
    }

    void fetchTallyStatus();
    const intervalId = setInterval(() => void fetchTallyStatus(), 2_000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [tallyExpanded, state.session]);

  function resetUserForm(): void {
    setEditingUserId(undefined);
    setUserUsername("");
    setUserPin("");
    setUserRole("operator");
    setClearUserPin(false);
    setUserPermissions(buildPermissionDraft(state.channels));
    setUserGroupIds([]);
  }

  function resetChannelForm(): void {
    setEditingChannelId(undefined);
    setChannelName("");
    setChannelColor("#22C55E");
    setChannelIsGlobal(false);
    setChannelType("intercom");
    setChannelSourceUserId("");
    setChannelPriority(5);
  }

  function resetGroupForm(): void {
    setEditingGroupId(undefined);
    setGroupName("");
    setGroupChannelIds([]);
  }

  function setPermissionValue(
    channelId: string,
    key: "canListen" | "canTalk",
    value: boolean,
  ): void {
    setUserPermissions((current) =>
      current.map((permission) =>
        permission.channelId === channelId ? { ...permission, [key]: value } : permission,
      ),
    );
  }

  async function handleChannelSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!state.session) {
      return;
    }

    setState((current) => ({
      ...current,
      channelActionError: undefined,
      channelFormPending: true,
    }));

    try {
      const response = await fetch(
        editingChannelId ? `/api/channels/${editingChannelId}` : "/api/channels",
        {
          method: editingChannelId ? "PUT" : "POST",
          headers: {
            Authorization: `Bearer ${state.session.sessionToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: channelName,
            color: channelColor,
            isGlobal: channelIsGlobal,
            channelType,
            priority: channelPriority,
            ...(channelType === "program" && channelSourceUserId
              ? { sourceUserId: channelSourceUserId }
              : {}),
          }),
        },
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(AuthFailureResponseSchema.parse(payload).error);
      }

      const channel = ChannelMutationResponseSchema.parse(payload);

      setState((current) => {
        const nextChannels = upsertChannelList(current.channels, channel);

        return {
          ...current,
          channelActionError: undefined,
          channelFormPending: false,
          channels: nextChannels,
          status: current.status
            ? {
                ...current.status,
                channels: nextChannels.length,
              }
            : current.status,
        };
      });
      setUserPermissions((current) =>
        buildPermissionDraft(upsertChannelList(state.channels, channel), current),
      );
      resetChannelForm();
    } catch (error) {
      setState((current) => ({
        ...current,
        channelActionError: error instanceof Error ? error.message : "Unable to save channel.",
        channelFormPending: false,
      }));
    }
  }

  async function handleSetupAdmin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    setState((current) => ({
      ...current,
      setupError: undefined,
      setupPending: true,
      userActionError: undefined,
    }));

    try {
      const response = await fetch("/api/auth/setup-admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: setupUsername,
          pin: setupPin || undefined,
        }),
      });
      const payload = SetupAdminResponseSchema.parse(await response.json());

      if (!response.ok || !payload.success) {
        throw new Error(payload.success ? "Unable to create the first admin." : payload.error);
      }

      setLoginUsername(payload.user.username);
      setState((current) => ({
        ...current,
        session: payload,
        setupError: undefined,
        setupPending: false,
        status: current.status
          ? {
              ...current.status,
              needsAdminSetup: false,
            }
          : current.status,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        setupError: error instanceof Error ? error.message : "Unknown setup error.",
        setupPending: false,
      }));
    }
  }

  async function handleAdminLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    setState((current) => ({
      ...current,
      loginError: undefined,
      loginPending: true,
      userActionError: undefined,
    }));

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: loginUsername,
          pin: loginPin || undefined,
        }),
      });
      const payload = LoginResponseSchema.parse(await response.json());

      if (!response.ok || !payload.success) {
        throw new Error(payload.success ? "Unable to sign in to admin." : payload.error);
      }

      if (payload.user.role !== "admin") {
        throw new Error("Admin access is required.");
      }

      setState((current) => ({
        ...current,
        loginError: undefined,
        loginPending: false,
        session: payload,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loginError: error instanceof Error ? error.message : "Unknown admin login error.",
        loginPending: false,
      }));
    }
  }

  async function handleUserSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!state.session) {
      return;
    }

    setState((current) => ({
      ...current,
      userActionError: undefined,
      userFormPending: true,
    }));

    try {
      const response = await fetch(editingUserId ? `/api/users/${editingUserId}` : "/api/users", {
        method: editingUserId ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${state.session.sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: userUsername,
          role: userRole,
          pin: userPin || undefined,
          clearPin: editingUserId ? clearUserPin || undefined : undefined,
          channelPermissions: userPermissions.filter(
            (permission) => permission.canListen || permission.canTalk,
          ),
          groupIds: userGroupIds,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(AuthFailureResponseSchema.parse(payload).error);
      }

      const user = toAdminDashboardUser(UserMutationResponseSchema.parse(payload));

      setState((current) => ({
        ...current,
        userActionError: undefined,
        userFormPending: false,
        users: sortUsers([
          ...current.users.filter((entry) => entry.id !== user.id),
          user,
        ]),
      }));
      resetUserForm();
    } catch (error) {
      setState((current) => ({
        ...current,
        userActionError: error instanceof Error ? error.message : "Unable to save user.",
        userFormPending: false,
      }));
    }
  }

  async function handleForceMute(user: AdminDashboardUser): Promise<void> {
    if (!state.session) {
      return;
    }

    setState((current) => ({
      ...current,
      forceMutePendingId: user.id,
      userActionError: undefined,
    }));

    try {
      const response = await fetch(`/api/users/${user.id}/force-mute`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.session.sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(AuthFailureResponseSchema.parse(await response.json()).error);
      }

      setState((current) => ({
        ...current,
        forceMutePendingId: undefined,
        users: sortUsers(
          current.users.map((entry) =>
            entry.id === user.id
              ? {
                  ...entry,
                  activeTalkChannelIds: [],
                  talking: false,
                }
              : entry,
          ),
        ),
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        forceMutePendingId: undefined,
        userActionError: error instanceof Error ? error.message : "Unable to force-mute user.",
      }));
    }
  }

  async function handleUnlatchChannel(channelId: string): Promise<void> {
    if (!state.session) {
      return;
    }

    setState((current) => ({
      ...current,
      unlatchPendingChannelId: channelId,
      channelActionError: undefined,
    }));

    try {
      const response = await fetch(`/api/channels/${channelId}/unlatch`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${state.session.sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(AuthFailureResponseSchema.parse(await response.json()).error);
      }

      setState((current) => ({
        ...current,
        unlatchPendingChannelId: undefined,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        unlatchPendingChannelId: undefined,
        channelActionError:
          error instanceof Error ? error.message : "Unable to unlatch channel.",
      }));
    }
  }

  async function handleDeleteUser(user: ManagedUser): Promise<void> {
    if (!state.session) {
      return;
    }

    if (!window.confirm(`Delete ${user.username}? This removes their local access.`)) {
      return;
    }

    setState((current) => ({
      ...current,
      deletePendingId: user.id,
      userActionError: undefined,
    }));

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${state.session.sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(AuthFailureResponseSchema.parse(await response.json()).error);
      }

      setState((current) => ({
        ...current,
        deletePendingId: undefined,
        users: current.users.filter((entry) => entry.id !== user.id),
      }));

      if (editingUserId === user.id) {
        resetUserForm();
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        deletePendingId: undefined,
        userActionError: error instanceof Error ? error.message : "Unable to delete user.",
      }));
    }
  }

  async function handleDeleteChannel(channel: ChannelInfo): Promise<void> {
    if (!state.session) {
      return;
    }

    if (!window.confirm(`Delete ${channel.name}? This removes it from assigned permissions.`)) {
      return;
    }

    setState((current) => ({
      ...current,
      channelActionError: undefined,
      channelDeletePendingId: channel.id,
    }));

    try {
      const response = await fetch(`/api/channels/${channel.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${state.session.sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(AuthFailureResponseSchema.parse(await response.json()).error);
      }

      setState((current) => {
        const nextChannels = current.channels.filter((entry) => entry.id !== channel.id);

        return {
          ...current,
          channelDeletePendingId: undefined,
          channels: nextChannels,
          status: current.status
            ? {
                ...current.status,
                channels: nextChannels.length,
              }
            : current.status,
          users: current.users.map((user) => ({
            ...user,
            channelPermissions: user.channelPermissions.filter(
              (permission) => permission.channelId !== channel.id,
            ),
          })),
        };
      });
      setUserPermissions((current) =>
        buildPermissionDraft(
          state.channels.filter((entry) => entry.id !== channel.id),
          current.filter((permission) => permission.channelId !== channel.id),
        ),
      );

      if (editingChannelId === channel.id) {
        resetChannelForm();
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        channelActionError:
          error instanceof Error ? error.message : "Unable to delete channel.",
        channelDeletePendingId: undefined,
      }));
    }
  }

  function handleEditUser(user: ManagedUser): void {
    setEditingUserId(user.id);
    setUserUsername(user.username);
    setUserPin("");
    setUserRole(user.role);
    setClearUserPin(false);
    setUserPermissions(buildPermissionDraft(state.channels, user.channelPermissions));
    setUserGroupIds(user.groupIds ?? []);
  }

  function handleEditChannel(channel: ChannelInfo): void {
    setEditingChannelId(channel.id);
    setChannelName(channel.name);
    setChannelColor(channel.color);
    setChannelIsGlobal(channel.isGlobal ?? false);
    setChannelType(channel.channelType ?? "intercom");
    setChannelSourceUserId(channel.sourceUserId ?? "");
    setChannelPriority(channel.priority ?? 5);
  }

  function handleEditGroup(group: GroupInfo): void {
    setEditingGroupId(group.id);
    setGroupName(group.name);
    setGroupChannelIds([...group.channelIds]);
  }

  async function handleGroupSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!state.session) {
      return;
    }

    setState((current) => ({
      ...current,
      groupActionError: undefined,
      groupFormPending: true,
    }));

    try {
      const response = await fetch(
        editingGroupId ? `/api/groups/${editingGroupId}` : "/api/groups",
        {
          method: editingGroupId ? "PUT" : "POST",
          headers: {
            Authorization: `Bearer ${state.session.sessionToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: groupName,
            channelIds: groupChannelIds,
          }),
        },
      );
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(AuthFailureResponseSchema.parse(payload).error);
      }

      const group = GroupMutationResponseSchema.parse(payload);

      setState((current) => {
        const existingIndex = current.groups.findIndex((g) => g.id === group.id);
        const nextGroups =
          existingIndex === -1
            ? [...current.groups, group]
            : current.groups.map((g) => (g.id === group.id ? group : g));

        return {
          ...current,
          groupActionError: undefined,
          groupFormPending: false,
          groups: nextGroups,
        };
      });
      resetGroupForm();
    } catch (error) {
      setState((current) => ({
        ...current,
        groupActionError: error instanceof Error ? error.message : "Unable to save group.",
        groupFormPending: false,
      }));
    }
  }

  async function handleDeleteGroup(group: GroupInfo): Promise<void> {
    if (!state.session) {
      return;
    }

    if (!window.confirm(`Delete group "${group.name}"? Users will lose this group assignment.`)) {
      return;
    }

    setState((current) => ({
      ...current,
      groupActionError: undefined,
      groupDeletePendingId: group.id,
    }));

    try {
      const response = await fetch(`/api/groups/${group.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${state.session.sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(AuthFailureResponseSchema.parse(await response.json()).error);
      }

      setState((current) => ({
        ...current,
        groupDeletePendingId: undefined,
        groups: current.groups.filter((g) => g.id !== group.id),
      }));

      if (editingGroupId === group.id) {
        resetGroupForm();
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        groupActionError:
          error instanceof Error ? error.message : "Unable to delete group.",
        groupDeletePendingId: undefined,
      }));
    }
  }

  const primaryDiscoveryTarget =
    state.discovery?.connectTargets.find((target) => target.id === state.discovery?.primaryTargetId) ??
    state.discovery?.connectTargets.find((target) => target.url === state.discovery?.primaryUrl);
  const multipleDetectedInterfaces = (state.discovery?.detectedInterfaces.length ?? 0) > 1;
  const suggestedAnnouncedHost =
    state.discovery?.announcedHost ?? state.discovery?.detectedInterfaces[0]?.address;

  async function handleStartRecording(channelId: string): Promise<void> {
    if (!state.session) return;
    setRecordingPendingId(channelId);
    try {
      await fetch("/api/admin/recording/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.session.sessionToken}`,
        },
        body: JSON.stringify({ channelId }),
      });
    } catch { /* never crash */ }
    setRecordingPendingId(undefined);
  }

  async function handleStopRecording(channelId: string): Promise<void> {
    if (!state.session) return;
    setRecordingPendingId(channelId);
    try {
      await fetch("/api/admin/recording/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.session.sessionToken}`,
        },
        body: JSON.stringify({ channelId }),
      });
    } catch { /* never crash */ }
    setRecordingPendingId(undefined);
  }

  async function loadSavedRecordings(): Promise<void> {
    if (!state.session) return;
    setRecordingsLoading(true);
    try {
      const response = await fetch("/api/admin/recordings", {
        headers: { Authorization: `Bearer ${state.session.sessionToken}` },
      });
      if (response.ok) {
        setSavedRecordings(await response.json());
      }
    } catch { /* never crash */ }
    setRecordingsLoading(false);
  }

  async function handleDeleteRecording(filename: string): Promise<void> {
    if (!state.session) return;
    try {
      await fetch(`/api/admin/recordings/${encodeURIComponent(filename)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${state.session.sessionToken}` },
      });
      await loadSavedRecordings();
    } catch { /* never crash */ }
  }

  async function handlePruneRecordings(): Promise<void> {
    if (!state.session) return;
    try {
      await fetch("/api/admin/recordings", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.session.sessionToken}`,
        },
        body: JSON.stringify({ olderThanDays: pruneDays }),
      });
      await loadSavedRecordings();
    } catch { /* never crash */ }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 sm:px-8 lg:px-10">
        <header className="space-y-6">
          <div className="max-w-3xl space-y-4">
            <Badge variant={state.status?.needsAdminSetup ? "warning" : "success"}>
              {state.status?.needsAdminSetup ? "Needs first admin" : "Configured"}
            </Badge>
            <div className="space-y-3">
              <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                CueCommX Admin
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                A premium, dark-first operations dashboard for onboarding crews, surfacing local
                network discovery, and turning the approved MVP workflows into something teams can
                actually run.
              </p>
            </div>
          </div>

          <Card className="w-full">
            <CardHeader>
              <CardDescription>Server identity</CardDescription>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <CardTitle>{state.status?.name ?? "CueCommX"}</CardTitle>
                  <p className="text-sm leading-6 text-muted-foreground">
                    QR-first discovery, manual IP fallback, and local-only deployment stay visible
                    at all times.
                  </p>
                </div>
                <Badge variant="accent">Protocol v{state.status?.protocolVersion ?? "\u2014"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
              {state.discovery ? (
                <>
                  <div className="mx-auto flex flex-col items-center gap-3">
                    <div className="rounded-[1.75rem] bg-white p-4 shadow-[0_20px_60px_rgba(15,23,42,0.35)]">
                      <QRCodeSVG
                        aria-label="CueCommX connect QR"
                        includeMargin
                        size={148}
                        title="CueCommX connect QR"
                        value={state.discovery.primaryUrl}
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
                        href={state.discovery.primaryUrl}
                      >
                        {state.discovery.primaryUrl}
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
                              state.discovery.announcedHost
                                ? "success"
                                : multipleDetectedInterfaces
                                  ? "warning"
                                  : "accent"
                            }
                          >
                            {state.discovery.announcedHost
                              ? "Pinned by announced IP"
                              : multipleDetectedInterfaces
                                ? "Multiple LAN interfaces"
                                : "Auto-selected LAN target"}
                          </Badge>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                          {state.discovery.announcedHost
                            ? `CueCommX is pinned to ${state.discovery.announcedHost} via CUECOMMX_ANNOUNCED_IP.`
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
                        {state.discovery.detectedInterfaces.length ? (
                          <div className="mt-3 grid gap-2">
                            {state.discovery.detectedInterfaces.map((entry) => (
                              <div
                                className="rounded-2xl border border-border/60 bg-background/50 p-3"
                                key={`${entry.name}-${entry.address}`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <Badge
                                    variant={
                                      entry.url === state.discovery?.primaryUrl ? "success" : "neutral"
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
                            To override the primary discovery target, set{" "}
                            <code>CUECOMMX_ANNOUNCED_IP={suggestedAnnouncedHost}</code> and restart
                            the server.
                          </div>
                        ) : null}
                        {state.discovery.mdns ? (
                          <div className="mt-3 rounded-2xl border border-border/60 bg-background/50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Badge variant={state.discovery.mdns.enabled ? "success" : "warning"}>
                                {state.discovery.mdns.enabled
                                  ? "mDNS broadcast active"
                                  : "mDNS broadcast unavailable"}
                              </Badge>
                              <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                {state.discovery.mdns.serviceType}
                              </span>
                            </div>
                            <p className="mt-3 text-sm leading-6 text-muted-foreground">
                              Compatible LAN clients can browse {state.discovery.mdns.serviceType} to
                              discover this server automatically. QR and manual URLs remain the
                              fallback.
                            </p>
                            {state.discovery.mdns.error ? (
                              <div className="mt-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                                {state.discovery.mdns.error}
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
                        {state.discovery.connectTargets.map((target) => (
                          <div
                            className="rounded-2xl border border-border/60 bg-background/35 p-3"
                            key={target.id}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Badge variant={target.url === state.discovery?.primaryUrl ? "accent" : "neutral"}>
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
        </header>

        {state.loading ? (
          <Card>
            <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
              <RadioTower className="h-4 w-4 text-primary" />
              Loading server status...
            </CardContent>
          </Card>
        ) : null}

        {state.error ? (
          <Card className="border-danger/50">
            <CardContent className="flex items-center gap-3 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" />
              {state.error}
            </CardContent>
          </Card>
        ) : null}

        {state.status ? (
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] xl:items-start">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardDescription>
                    {state.status.needsAdminSetup
                      ? "First-run onboarding"
                      : state.session
                        ? "Admin session"
                        : "Admin sign-in"}
                  </CardDescription>
                  <CardTitle>
                    {state.status.needsAdminSetup
                      ? "Create the first admin"
                      : state.session
                        ? `Signed in as ${state.session.user.username}`
                        : "Sign into admin"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {state.status.needsAdminSetup ? (
                    <form className="space-y-4" onSubmit={(event) => void handleSetupAdmin(event)}>
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
                          onChange={(event) => setSetupUsername(event.target.value)}
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
                          onChange={(event) => setSetupPin(event.target.value)}
                          placeholder="Optional"
                          type="password"
                          value={setupPin}
                        />
                      </div>
                      <Button className="w-full justify-center" disabled={state.setupPending} size="lg" type="submit">
                        {state.setupPending ? "Creating admin..." : "Create first admin"}
                      </Button>
                    </form>
                  ) : state.session ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-3">
                        <Badge variant="success">{state.session.user.role}</Badge>
                        <Badge variant="accent">{state.users.length} managed users</Badge>
                        <Badge variant="neutral">
                          {state.users.filter((user) => user.online).length} online right now
                        </Badge>
                        <Badge
                          variant={adminRealtimeState === "connected" ? "success" : "warning"}
                        >
                          {adminRealtimeState === "connected"
                            ? "Live sync connected"
                            : "Live sync reconnecting"}
                        </Badge>
                      </div>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Live roster updates, active channel indicators, emergency force-mute, and
                        network confirmation are now wired in. mDNS discovery remains the last
                        admin-side discovery slice.
                      </p>
                    </div>
                  ) : (
                    <form className="space-y-4" onSubmit={(event) => void handleAdminLogin(event)}>
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
                          onChange={(event) => setLoginUsername(event.target.value)}
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
                          onChange={(event) => setLoginPin(event.target.value)}
                          placeholder="Optional"
                          type="password"
                          value={loginPin}
                        />
                      </div>
                      <Button className="w-full justify-center" disabled={state.loginPending} size="lg" type="submit">
                        {state.loginPending ? "Signing in..." : "Sign into admin"}
                      </Button>
                    </form>
                  )}

                  {state.setupError ? (
                    <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                      {state.setupError}
                    </div>
                  ) : null}

                  {state.loginError ? (
                    <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                      {state.loginError}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                  detail={`${state.status.maxUsers} maximum on this server`}
                  title="Connected users"
                  value={`${state.status.connectedUsers}`}
                />
                <MetricCard
                  detail="Default control-room palette loaded"
                  title="Configured channels"
                  value={`${state.status.channels}`}
                />
                <MetricCard
                  detail="Users can now be created and assigned from this dashboard"
                  title="Managed users"
                  value={`${state.users.length}`}
                />
                <MetricCard
                  detail="Strictly local-network, low-latency deployment"
                  title="Protocol"
                  value={`v${state.status.protocolVersion}`}
                />
              </div>

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
                    className="h-px w-full bg-border/70"
                    decorative
                    orientation="horizontal"
                  />

                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <Users className="h-4 w-4 text-primary" />
                    <span>{state.status.connectedUsers} active now.</span>
                    <span className="text-border">\u2022</span>
                    <span>{state.status.maxUsers} seats planned for the MVP.</span>
                    <span className="text-border">\u2022</span>
                    <span>
                      {state.status.needsAdminSetup
                        ? "Create the first admin next."
                        : "Admin setup complete."}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {state.session ? (
                <Card>
                  <CardHeader>
                    <CardDescription>User management</CardDescription>
                    <CardTitle>
                      {editingUserId ? "Edit operator permissions" : "Create an operator"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <form className="space-y-5" onSubmit={(event) => void handleUserSubmit(event)}>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground" htmlFor="user-name">
                            Display name
                          </label>
                          <input
                            className={inputClassName}
                            id="user-name"
                            onChange={(event) => setUserUsername(event.target.value)}
                            placeholder="Front of House"
                            value={userUsername}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground" htmlFor="user-role">
                            Role
                          </label>
                          <select
                            className={selectClassName}
                            id="user-role"
                            onChange={(event) => setUserRole(event.target.value as UserRole)}
                            value={userRole}
                          >
                            <option value="admin">Admin</option>
                            <option value="operator">Operator</option>
                            <option value="user">User</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground" htmlFor="user-pin">
                            {editingUserId ? "New PIN" : "PIN"}
                          </label>
                          <input
                            className={inputClassName}
                            id="user-pin"
                            onChange={(event) => setUserPin(event.target.value)}
                            placeholder={editingUserId ? "Leave blank to keep current PIN" : "Optional"}
                            type="password"
                            value={userPin}
                          />
                        </div>
                        {editingUserId ? (
                          <label className="mt-8 inline-flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground">
                            <input
                              checked={clearUserPin}
                              onChange={(event) => setClearUserPin(event.target.checked)}
                              type="checkbox"
                            />
                            Clear existing PIN
                          </label>
                        ) : null}
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Channel permissions
                          </h3>
                          <p className="text-sm leading-6 text-muted-foreground">
                            Assign only the channels this user should hear or transmit on.
                          </p>
                        </div>

                        <div className="grid gap-3">
                          {state.channels.map((channel) => {
                            const permission = userPermissions.find(
                              (entry) => entry.channelId === channel.id,
                            ) ?? {
                              channelId: channel.id,
                              canListen: false,
                              canTalk: false,
                            };

                            return (
                              <div
                                className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/35 p-4 sm:flex-row sm:items-center sm:justify-between"
                                key={channel.id}
                              >
                                <div className="flex items-center gap-3">
                                  <span
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5 rounded-full"
                                    style={{ backgroundColor: channel.color }}
                                  />
                                  <div>
                                    <p className="font-medium text-foreground">{channel.name}</p>
                                    <p className="text-sm text-muted-foreground">{channel.id}</p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-3 text-sm text-foreground">
                                  <label className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-2">
                                    <input
                                      checked={permission.canListen}
                                      onChange={(event) =>
                                        setPermissionValue(
                                          channel.id,
                                          "canListen",
                                          event.target.checked,
                                        )
                                      }
                                      type="checkbox"
                                    />
                                    Listen
                                  </label>
                                  <label className="inline-flex items-center gap-2 rounded-full border border-border/70 px-3 py-2">
                                    <input
                                      checked={permission.canTalk}
                                      onChange={(event) =>
                                        setPermissionValue(
                                          channel.id,
                                          "canTalk",
                                          event.target.checked,
                                        )
                                      }
                                      type="checkbox"
                                    />
                                    Talk
                                  </label>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {state.groups.length > 0 ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                              Group assignments
                            </h3>
                            <p className="text-sm leading-6 text-muted-foreground">
                              Users with no groups see all their permitted channels. Assigning groups limits visible channels to the active group plus global channels.
                            </p>
                          </div>

                          <div className="grid gap-3">
                            {state.groups.map((group) => (
                              <label
                                className="inline-flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground"
                                key={group.id}
                              >
                                <input
                                  checked={userGroupIds.includes(group.id)}
                                  onChange={(event) =>
                                    setUserGroupIds((current) =>
                                      event.target.checked
                                        ? [...current, group.id]
                                        : current.filter((id) => id !== group.id),
                                    )
                                  }
                                  type="checkbox"
                                />
                                {group.name}
                                <span className="text-muted-foreground">
                                  ({group.channelIds.length} channel{group.channelIds.length !== 1 ? "s" : ""})
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-3">
                        <Button disabled={state.userFormPending} type="submit">
                          {state.userFormPending
                            ? editingUserId
                              ? "Saving..."
                              : "Creating..."
                            : editingUserId
                              ? "Save changes"
                              : "Create user"}
                        </Button>
                        {editingUserId ? (
                          <Button onClick={resetUserForm} type="button" variant="outline">
                            Cancel editing
                          </Button>
                        ) : null}
                      </div>
                    </form>

                    {state.userActionError ? (
                      <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                        {state.userActionError}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardDescription>Live channel activity</CardDescription>
                  <CardTitle>Active talkers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {state.allPageActive ? (
                    <div className="flex items-center gap-3 rounded-xl border border-warning/50 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
                      📢 All-Page active by {state.allPageActive.username}
                    </div>
                  ) : null}
                  {state.session ? (
                    state.channels.map((channel, index) => {
                      const activeTalkers = state.users.filter((user) =>
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
                                    disabled={state.unlatchPendingChannelId === channel.id}
                                    onClick={() => handleUnlatchChannel(channel.id)}
                                    size="sm"
                                    type="button"
                                    variant="outline"
                                  >
                                    {state.unlatchPendingChannelId === channel.id
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

                          {index < state.channels.length - 1 ? (
                            <Separator.Root
                              className="h-px w-full bg-border/60"
                              decorative
                              orientation="horizontal"
                            />
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm leading-6 text-muted-foreground">
                      Sign in as an admin to see live talkers and channel activity.
                    </div>
                  )}
                </CardContent>
              </Card>

              {state.session ? (
                <Card>
                  <CardHeader>
                    <CardDescription>Session logging</CardDescription>
                    <CardTitle>Recording</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      {state.channels.map((channel) => {
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
                                onClick={() => void handleStopRecording(channel.id)}
                                size="sm"
                                type="button"
                                variant="danger"
                              >
                                {isPending ? "Stopping…" : "Stop"}
                              </Button>
                            ) : (
                              <Button
                                disabled={isPending}
                                onClick={() => void handleStartRecording(channel.id)}
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
                          onClick={() => void loadSavedRecordings()}
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
                                <a
                                  className="inline-flex h-7 items-center rounded-md border border-border px-2 text-xs font-medium text-foreground hover:bg-muted"
                                  download={rec.filename}
                                  href={`/api/admin/recordings/${encodeURIComponent(rec.filename)}`}
                                >
                                  ↓
                                </a>
                                <Button
                                  onClick={() => void handleDeleteRecording(rec.filename)}
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
                          onChange={(event) => setPruneDays(Number(event.target.value) || 30)}
                          type="number"
                          value={pruneDays}
                        />
                        <span className="text-xs text-muted-foreground">days</span>
                        <Button
                          onClick={() => void handlePruneRecordings()}
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
              ) : null}

              {state.session ? (
                <Card>
                  <CardHeader>
                    <CardDescription>Video switcher tally</CardDescription>
                    <div className="flex items-center justify-between">
                      <CardTitle>Tally Integration</CardTitle>
                      <Button
                        onClick={() => setTallyExpanded((v) => !v)}
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
              ) : null}

              <Card>
                <CardHeader>
                  <CardDescription>User roster</CardDescription>
                  <CardTitle>Operators and admins</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {state.session ? (
                    state.usersLoading ? (
                      <div className="text-sm text-muted-foreground">Loading users...</div>
                    ) : state.users.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        No users have been created yet.
                      </div>
                    ) : (
                      state.users.map((user, index) => (
                        <div className="space-y-4" key={user.id}>
                          <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-3">
                                  <p className="text-lg font-semibold text-foreground">
                                    {user.username}
                                  </p>
                                  <Badge variant={user.online ? "success" : "neutral"}>
                                    {user.online ? "Online" : "Offline"}
                                  </Badge>
                                  <Badge variant={user.talking ? "warning" : "neutral"}>
                                    {user.talking ? "Talking" : "Standing by"}
                                  </Badge>
                                  <Badge variant={user.role === "admin" ? "accent" : "neutral"}>
                                    {user.role}
                                  </Badge>
                                  {user.online && user.connectionQuality ? (
                                    <Badge
                                      variant={
                                        user.connectionQuality.grade === "poor"
                                          ? "danger"
                                          : user.connectionQuality.grade === "fair"
                                            ? "warning"
                                            : "success"
                                      }
                                    >
                                      {user.connectionQuality.grade === "excellent"
                                        ? "🟢"
                                        : user.connectionQuality.grade === "good"
                                          ? "🟢"
                                          : user.connectionQuality.grade === "fair"
                                            ? "🟡"
                                            : "🔴"}{" "}
                                      {user.connectionQuality.roundTripTimeMs}ms
                                    </Badge>
                                  ) : null}
                                  {user.preflightStatus === "passed" ? (
                                    <Badge variant="success">✓ Audio OK</Badge>
                                  ) : user.preflightStatus === "failed" ? (
                                    <Badge variant="danger">✗ Audio fail</Badge>
                                  ) : null}
                                </div>
                                <p className="text-sm leading-6 text-muted-foreground">
                                  {formatChannelSummary(user, state.channels)}
                                </p>
                                <p
                                  className={`text-sm leading-6 ${
                                    user.talking ? "text-warning" : "text-muted-foreground"
                                  }`}
                                >
                                  {formatLiveTalkSummary(user, state.channels)}
                                </p>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <Button
                                  aria-label={`Force-mute ${user.username}`}
                                  disabled={
                                    state.forceMutePendingId === user.id ||
                                    !user.online ||
                                    !user.talking
                                  }
                                  onClick={() => void handleForceMute(user)}
                                  type="button"
                                  variant="secondary"
                                >
                                  {state.forceMutePendingId === user.id
                                    ? "Muting..."
                                    : "Force-mute"}
                                </Button>
                                <Button
                                  aria-label={`Edit ${user.username}`}
                                  onClick={() => handleEditUser(user)}
                                  type="button"
                                  variant="outline"
                                >
                                  Edit
                                </Button>
                                <Button
                                  aria-label={`Delete ${user.username}`}
                                  disabled={
                                    state.deletePendingId === user.id ||
                                    state.session?.user.id === user.id
                                  }
                                  onClick={() => void handleDeleteUser(user)}
                                  type="button"
                                  variant="danger"
                                >
                                  {state.deletePendingId === user.id ? "Deleting..." : "Delete"}
                                </Button>
                              </div>
                            </div>
                          </div>

                          {index < state.users.length - 1 ? (
                            <Separator.Root
                              className="h-px w-full bg-border/60"
                              decorative
                              orientation="horizontal"
                            />
                          ) : null}
                        </div>
                      ))
                    )
                  ) : (
                    <div className="text-sm leading-6 text-muted-foreground">
                      Sign in as an admin to manage the local roster.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="h-fit">
                <CardHeader>
                  <CardDescription>
                    {state.session ? "Channel management" : "Default channels"}
                  </CardDescription>
                  <CardTitle>
                    {editingChannelId
                      ? "Edit channel"
                      : state.session
                        ? "Create a channel"
                        : "Control-room palette"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {state.session ? (
                    <form className="space-y-4" onSubmit={(event) => void handleChannelSubmit(event)}>
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground" htmlFor="channel-name">
                            Channel name
                          </label>
                          <input
                            className={inputClassName}
                            id="channel-name"
                            onChange={(event) => setChannelName(event.target.value)}
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
                            onChange={(event) => setChannelColor(event.target.value)}
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
                          onChange={(event) => setChannelIsGlobal(event.target.checked)}
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
                              onChange={() => setChannelType("intercom")}
                              type="radio"
                            />
                            Intercom (two-way talk)
                          </label>
                          <label className="inline-flex items-center gap-2 text-sm text-foreground">
                            <input
                              checked={channelType === "program"}
                              name="channelType"
                              onChange={() => setChannelType("program")}
                              type="radio"
                            />
                            📡 Program (one-way feed)
                          </label>
                          <label className="inline-flex items-center gap-2 text-sm text-foreground">
                            <input
                              checked={channelType === "confidence"}
                              name="channelType"
                              onChange={() => setChannelType("confidence")}
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
                            onChange={(event) => setChannelSourceUserId(event.target.value)}
                            value={channelSourceUserId}
                          >
                            <option value="">— Select a source user —</option>
                            {state.users.map((user) => (
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
                          onChange={(event) => setChannelPriority(Number(event.target.value))}
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
                        <Button disabled={state.channelFormPending} type="submit">
                          {state.channelFormPending
                            ? editingChannelId
                              ? "Saving..."
                              : "Creating..."
                            : editingChannelId
                              ? "Save channel"
                              : "Create channel"}
                        </Button>
                        {editingChannelId ? (
                          <Button onClick={resetChannelForm} type="button" variant="outline">
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

                  {state.channelActionError ? (
                    <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                      {state.channelActionError}
                    </div>
                  ) : null}

                  <Separator.Root
                    className="h-px w-full bg-border/60"
                    decorative
                    orientation="horizontal"
                  />

                  <div className="space-y-4">
                    {state.channels.map((channel, index) => (
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
                              {state.session ? (
                                <>
                                  <Button
                                    aria-label={`Edit ${channel.name}`}
                                    onClick={() => handleEditChannel(channel)}
                                    type="button"
                                    variant="outline"
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    aria-label={`Delete ${channel.name}`}
                                    disabled={state.channelDeletePendingId === channel.id}
                                    onClick={() => void handleDeleteChannel(channel)}
                                    type="button"
                                    variant="danger"
                                  >
                                    {state.channelDeletePendingId === channel.id
                                      ? "Deleting..."
                                      : "Delete"}
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        {index < state.channels.length - 1 ? (
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

              {state.session ? (
                <Card className="h-fit">
                  <CardHeader>
                    <CardDescription>Group management</CardDescription>
                    <CardTitle>
                      {editingGroupId ? "Edit group" : "Create a group"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <form className="space-y-4" onSubmit={(event) => void handleGroupSubmit(event)}>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="group-name">
                          Group name
                        </label>
                        <input
                          className={inputClassName}
                          id="group-name"
                          onChange={(event) => setGroupName(event.target.value)}
                          placeholder="Sunday Morning"
                          value={groupName}
                        />
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Channels in group
                          </h3>
                          <p className="text-sm leading-6 text-muted-foreground">
                            Select which channels appear when this group is active. Global channels always appear regardless.
                          </p>
                        </div>

                        <div className="grid gap-3">
                          {state.channels.map((channel) => (
                            <label
                              className="inline-flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground"
                              key={channel.id}
                            >
                              <input
                                checked={groupChannelIds.includes(channel.id)}
                                onChange={(event) =>
                                  setGroupChannelIds((current) =>
                                    event.target.checked
                                      ? [...current, channel.id]
                                      : current.filter((id) => id !== channel.id),
                                  )
                                }
                                type="checkbox"
                              />
                              <span
                                aria-hidden="true"
                                className="h-3 w-3 rounded-full"
                                style={{ backgroundColor: channel.color }}
                              />
                              {channel.name}
                              {channel.isGlobal ? (
                                <span className="text-xs text-muted-foreground">(Global)</span>
                              ) : null}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Button disabled={state.groupFormPending} type="submit">
                          {state.groupFormPending
                            ? editingGroupId
                              ? "Saving..."
                              : "Creating..."
                            : editingGroupId
                              ? "Save group"
                              : "Create group"}
                        </Button>
                        {editingGroupId ? (
                          <Button onClick={resetGroupForm} type="button" variant="outline">
                            Cancel editing
                          </Button>
                        ) : null}
                      </div>
                    </form>

                    {state.groupActionError ? (
                      <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                        {state.groupActionError}
                      </div>
                    ) : null}

                    {state.groups.length > 0 ? (
                      <>
                        <Separator.Root
                          className="h-px w-full bg-border/60"
                          decorative
                          orientation="horizontal"
                        />

                        <div className="space-y-4">
                          {state.groups.map((group, index) => (
                            <div className="space-y-4" key={group.id}>
                              <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                  <div className="space-y-1">
                                    <p className="font-medium text-foreground">{group.name}</p>
                                    <p className="text-sm text-muted-foreground">
                                      {group.channelIds.length} channel{group.channelIds.length !== 1 ? "s" : ""}{" "}
                                      • {group.channelIds
                                        .map((id) => state.channels.find((ch) => ch.id === id)?.name ?? id)
                                        .join(", ")}
                                    </p>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                      aria-label={`Edit ${group.name}`}
                                      onClick={() => handleEditGroup(group)}
                                      type="button"
                                      variant="outline"
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      aria-label={`Delete ${group.name}`}
                                      disabled={state.groupDeletePendingId === group.id}
                                      onClick={() => void handleDeleteGroup(group)}
                                      type="button"
                                      variant="danger"
                                    >
                                      {state.groupDeletePendingId === group.id
                                        ? "Deleting..."
                                        : "Delete"}
                                    </Button>
                                  </div>
                                </div>
                              </div>

                              {index < state.groups.length - 1 ? (
                                <Separator.Root
                                  className="h-px w-full bg-border/60"
                                  decorative
                                  orientation="horizontal"
                                />
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
