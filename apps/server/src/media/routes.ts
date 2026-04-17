export interface MediaRoutingSession {
  directCallPeerSessionToken?: string;
  hasProducer: boolean;
  hasRecvTransport: boolean;
  listenChannelIds: string[];
  sessionToken: string;
  talkChannelIds: string[];
  userId: string;
}

export interface DesiredMediaRoute {
  activeChannelIds: string[];
  listenerSessionToken: string;
  producerSessionToken: string;
  producerUserId: string;
}

export const DIRECT_CALL_CHANNEL_ID = "__direct_call__";

export function buildDesiredMediaRoutes(
  sessions: readonly MediaRoutingSession[],
): DesiredMediaRoute[] {
  const routes: DesiredMediaRoute[] = [];
  const sessionByToken = new Map(sessions.map((s) => [s.sessionToken, s]));

  for (const listener of sessions) {
    if (!listener.hasRecvTransport) {
      continue;
    }

    const listenableChannelIds = new Set(listener.listenChannelIds);

    // Channel-based routes
    if (listenableChannelIds.size > 0) {
      for (const speaker of sessions) {
        if (!speaker.hasProducer) {
          continue;
        }

        if (speaker.userId === listener.userId) {
          continue;
        }

        const activeChannelIds = speaker.talkChannelIds
          .filter((channelId) => listenableChannelIds.has(channelId))
          .sort((left, right) => left.localeCompare(right));

        if (activeChannelIds.length === 0) {
          continue;
        }

        routes.push({
          activeChannelIds,
          listenerSessionToken: listener.sessionToken,
          producerSessionToken: speaker.sessionToken,
          producerUserId: speaker.userId,
        });
      }
    }

    // Direct call route: if this listener is in a direct call, add a route from the peer
    if (listener.directCallPeerSessionToken) {
      const peer = sessionByToken.get(listener.directCallPeerSessionToken);

      if (peer && peer.hasProducer && peer.userId !== listener.userId) {
        const existing = routes.find(
          (r) =>
            r.listenerSessionToken === listener.sessionToken &&
            r.producerSessionToken === peer.sessionToken,
        );

        if (existing) {
          // Merge direct call channel into existing route
          if (!existing.activeChannelIds.includes(DIRECT_CALL_CHANNEL_ID)) {
            existing.activeChannelIds = [
              ...existing.activeChannelIds,
              DIRECT_CALL_CHANNEL_ID,
            ].sort((left, right) => left.localeCompare(right));
          }
        } else {
          routes.push({
            activeChannelIds: [DIRECT_CALL_CHANNEL_ID],
            listenerSessionToken: listener.sessionToken,
            producerSessionToken: peer.sessionToken,
            producerUserId: peer.userId,
          });
        }
      }
    }
  }

  return routes.sort((left, right) => {
    const listenerOrder = left.listenerSessionToken.localeCompare(right.listenerSessionToken);

    if (listenerOrder !== 0) {
      return listenerOrder;
    }

    return left.producerSessionToken.localeCompare(right.producerSessionToken);
  });
}
