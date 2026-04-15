export interface MediaRoutingSession {
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

export function buildDesiredMediaRoutes(
  sessions: readonly MediaRoutingSession[],
): DesiredMediaRoute[] {
  const routes: DesiredMediaRoute[] = [];

  for (const listener of sessions) {
    if (!listener.hasRecvTransport) {
      continue;
    }

    const listenableChannelIds = new Set(listener.listenChannelIds);

    if (listenableChannelIds.size === 0) {
      continue;
    }

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

  return routes.sort((left, right) => {
    const listenerOrder = left.listenerSessionToken.localeCompare(right.listenerSessionToken);

    if (listenerOrder !== 0) {
      return listenerOrder;
    }

    return left.producerSessionToken.localeCompare(right.producerSessionToken);
  });
}
