export interface ChannelStateSnapshot {
  talkChannelIds: string[];
  listenChannelIds: string[];
  volumes: Record<string, number>;
  masterVolume: number;
}

function sortIds(ids: Iterable<string>): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function toggleChannelId(channelIds: string[], channelId: string, enabled: boolean): string[] {
  const next = new Set(channelIds);

  if (enabled) {
    next.add(channelId);
  } else {
    next.delete(channelId);
  }

  return sortIds(next);
}

export function setChannelVolume(
  state: ChannelStateSnapshot,
  channelId: string,
  volume: number,
): ChannelStateSnapshot {
  if (volume < 0 || volume > 1) {
    throw new Error("Channel volume must be between 0 and 1.");
  }

  return {
    ...state,
    volumes: {
      ...state.volumes,
      [channelId]: volume,
    },
  };
}
