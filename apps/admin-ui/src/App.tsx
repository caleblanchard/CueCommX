import { type FormEvent, useEffect, useState } from "react";

import {
  CueCommXRealtimeClient,
  type RealtimeConnectionState,
} from "@cuecommx/core";
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

import { AdminNav } from "./components/AdminNav.js";
import { ChannelsPage } from "./pages/ChannelsPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { GroupsPage } from "./pages/GroupsPage.js";
import { IntegrationsPage } from "./pages/IntegrationsPage.js";
import { UsersPage } from "./pages/UsersPage.js";

export type AdminPage = "dashboard" | "users" | "channels" | "groups" | "integrations";

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

export default function App() {
  const [state, setState] = useState<ViewState>(initialState);
  const [adminRealtimeState, setAdminRealtimeState] =
    useState<RealtimeConnectionState>("idle");
  const [currentPage, setCurrentPage] = useState<AdminPage>("dashboard");
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

  function handleSignOut(): void {
    setState((current) => ({ ...current, session: undefined }));
    setCurrentPage("dashboard");
  }

  return (
    <div className="flex min-h-screen">
      <AdminNav
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        session={state.session}
        onSignOut={handleSignOut}
        adminRealtimeState={adminRealtimeState}
      />
      <div className="flex-1 overflow-auto">
        {currentPage === "dashboard" && (
          <DashboardPage
            status={state.status}
            loading={state.loading}
            error={state.error}
            session={state.session}
            discovery={state.discovery}
            adminRealtimeState={adminRealtimeState}
            users={state.users}
            channels={state.channels}
            allPageActive={state.allPageActive}
            unlatchPendingChannelId={state.unlatchPendingChannelId}
            setupPending={state.setupPending}
            setupError={state.setupError}
            loginPending={state.loginPending}
            loginError={state.loginError}
            setupUsername={setupUsername}
            setupPin={setupPin}
            loginUsername={loginUsername}
            loginPin={loginPin}
            onSetupUsernameChange={setSetupUsername}
            onSetupPinChange={setSetupPin}
            onLoginUsernameChange={setLoginUsername}
            onLoginPinChange={setLoginPin}
            onSetupAdmin={(e) => void handleSetupAdmin(e)}
            onAdminLogin={(e) => void handleAdminLogin(e)}
            onUnlatchChannel={(id) => void handleUnlatchChannel(id)}
          />
        )}
        {currentPage === "users" && state.session && (
          <UsersPage
            session={state.session}
            channels={state.channels}
            groups={state.groups}
            users={state.users}
            usersLoading={state.usersLoading}
            userActionError={state.userActionError}
            deletePendingId={state.deletePendingId}
            forceMutePendingId={state.forceMutePendingId}
            userFormPending={state.userFormPending}
            editingUserId={editingUserId}
            userUsername={userUsername}
            userPin={userPin}
            userRole={userRole}
            clearUserPin={clearUserPin}
            userPermissions={userPermissions}
            userGroupIds={userGroupIds}
            onUsernameChange={setUserUsername}
            onPinChange={setUserPin}
            onRoleChange={setUserRole}
            onClearPinChange={setClearUserPin}
            onPermissionChange={setPermissionValue}
            onGroupIdsChange={setUserGroupIds}
            onSubmit={(e) => void handleUserSubmit(e)}
            onCancelEdit={resetUserForm}
            onEditUser={handleEditUser}
            onDeleteUser={(user) => void handleDeleteUser(user)}
            onForceMute={(user) => void handleForceMute(user)}
            formatChannelSummary={formatChannelSummary}
            formatLiveTalkSummary={formatLiveTalkSummary}
          />
        )}
        {currentPage === "channels" && (
          <ChannelsPage
            session={state.session}
            channels={state.channels}
            users={state.users}
            channelActionError={state.channelActionError}
            channelDeletePendingId={state.channelDeletePendingId}
            channelFormPending={state.channelFormPending}
            editingChannelId={editingChannelId}
            channelName={channelName}
            channelColor={channelColor}
            channelIsGlobal={channelIsGlobal}
            channelType={channelType}
            channelSourceUserId={channelSourceUserId}
            channelPriority={channelPriority}
            onChannelNameChange={setChannelName}
            onChannelColorChange={setChannelColor}
            onChannelIsGlobalChange={setChannelIsGlobal}
            onChannelTypeChange={setChannelType}
            onChannelSourceUserIdChange={setChannelSourceUserId}
            onChannelPriorityChange={setChannelPriority}
            onSubmit={(e) => void handleChannelSubmit(e)}
            onCancelEdit={resetChannelForm}
            onEditChannel={handleEditChannel}
            onDeleteChannel={(ch) => void handleDeleteChannel(ch)}
          />
        )}
        {currentPage === "groups" && state.session && (
          <GroupsPage
            session={state.session}
            channels={state.channels}
            groups={state.groups}
            groupActionError={state.groupActionError}
            groupDeletePendingId={state.groupDeletePendingId}
            groupFormPending={state.groupFormPending}
            editingGroupId={editingGroupId}
            groupName={groupName}
            groupChannelIds={groupChannelIds}
            onGroupNameChange={setGroupName}
            onGroupChannelIdsChange={setGroupChannelIds}
            onSubmit={(e) => void handleGroupSubmit(e)}
            onCancelEdit={resetGroupForm}
            onEditGroup={handleEditGroup}
            onDeleteGroup={(g) => void handleDeleteGroup(g)}
          />
        )}
        {currentPage === "integrations" && (
          <IntegrationsPage
            session={state.session}
            channels={state.channels}
            recordingActiveIds={recordingActiveIds}
            recordingPendingId={recordingPendingId}
            savedRecordings={savedRecordings}
            recordingsLoading={recordingsLoading}
            pruneDays={pruneDays}
            tallyExpanded={tallyExpanded}
            tallyStatus={tallyStatus}
            onStartRecording={(id) => void handleStartRecording(id)}
            onStopRecording={(id) => void handleStopRecording(id)}
            onLoadSavedRecordings={() => void loadSavedRecordings()}
            onDeleteRecording={(f) => void handleDeleteRecording(f)}
            onPruneRecordings={() => void handlePruneRecordings()}
            onPruneDaysChange={setPruneDays}
            onTallyExpandedChange={setTallyExpanded}
            formatFileSize={formatFileSize}
          />
        )}
      </div>
    </div>
  );
}
