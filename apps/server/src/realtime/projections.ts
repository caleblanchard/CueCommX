import type {
  AdminDashboardSnapshot,
  ConnectionQuality,
  PreflightStatus,
} from "@cuecommx/protocol";

import type { DatabaseService } from "../db/database.js";

import type {
  OperatorSessionProjectionSnapshot,
} from "./operator-session-coordination.js";

export interface StreamDeckUserState {
  id: string;
  online: boolean;
  talkChannelIds: string[];
  talking: boolean;
  username: string;
}

export interface StreamDeckChannelState {
  active: boolean;
  id: string;
  name: string;
  talkers: string[];
}

export interface StreamDeckPublicState {
  allPage: { userId: string; username: string } | null;
  channels: StreamDeckChannelState[];
  timestamp: number;
  users: StreamDeckUserState[];
}

export function buildAdminDashboardSnapshot(
  database: DatabaseService,
  state: OperatorSessionProjectionSnapshot,
): AdminDashboardSnapshot {
  const talkChannelsByUser = new Map<string, Set<string>>();
  const onlineUserIds = new Set<string>();
  const qualityByUser = new Map<string, ConnectionQuality>();
  const preflightByUser = new Map<string, PreflightStatus>();
  const directCallPeerByUser = new Map<string, string>();

  for (const session of state.sessions) {
    const userId = session.user.id;
    const talkChannels = talkChannelsByUser.get(userId) ?? new Set<string>();

    onlineUserIds.add(userId);

    for (const channelId of session.state.talkChannelIds) {
      talkChannels.add(channelId);
    }

    talkChannelsByUser.set(userId, talkChannels);

    if (session.connectionQuality) {
      qualityByUser.set(userId, session.connectionQuality);
    }

    if (session.preflightStatus) {
      preflightByUser.set(userId, session.preflightStatus);
    }
  }

  for (const call of state.directCalls) {
    if (call.state !== "active") {
      continue;
    }

    directCallPeerByUser.set(call.initiatorUserId, call.targetUsername);
    directCallPeerByUser.set(call.targetUserId, call.initiatorUsername);
  }

  return {
    allPageActive: state.allPage
      ? { userId: state.allPage.userId, username: state.allPage.username }
      : undefined,
    channels: database.listChannels(),
    groups: database.listGroups(),
    users: database.listUsers().map((user) => {
      const activeTalkChannelIds = [...(talkChannelsByUser.get(user.id) ?? new Set<string>())].sort(
        (left, right) => left.localeCompare(right),
      );

      return {
        ...user,
        activeTalkChannelIds,
        connectionQuality: qualityByUser.get(user.id),
        directCallPeer: directCallPeerByUser.get(user.id),
        groupIds: database.getUserGroupIds(user.id),
        online: onlineUserIds.has(user.id),
        preflightStatus: preflightByUser.get(user.id),
        talking: activeTalkChannelIds.length > 0,
      };
    }),
  };
}

export function buildStreamDeckPublicState(
  database: DatabaseService,
  state: OperatorSessionProjectionSnapshot,
): StreamDeckPublicState {
  const channels = database.listChannels();
  const channelNameById = new Map(channels.map((channel) => [channel.id, channel.name]));
  const usersMap = new Map<string, StreamDeckUserState>();

  for (const session of state.sessions) {
    usersMap.set(session.user.id, {
      id: session.user.id,
      online: true,
      talkChannelIds: [...session.state.talkChannelIds],
      talking: session.state.talking,
      username: session.user.username,
    });
  }

  const channelStates: StreamDeckChannelState[] = channels.map((channel) => {
    const talkers: string[] = [];

    for (const session of state.sessions) {
      if (session.state.talkChannelIds.includes(channel.id)) {
        talkers.push(session.user.id);
      }
    }

    return {
      active: talkers.length > 0,
      id: channel.id,
      name: channelNameById.get(channel.id) ?? channel.id,
      talkers,
    };
  });

  return {
    allPage: state.allPage
      ? { userId: state.allPage.userId, username: state.allPage.username }
      : null,
    channels: channelStates,
    timestamp: Date.now(),
    users: [...usersMap.values()],
  };
}
