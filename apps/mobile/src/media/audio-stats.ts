function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toEntries(stats: unknown): Record<string, unknown>[] {
  if (!stats) {
    return [];
  }

  if (stats instanceof Map) {
    return [...stats.values()].filter(isRecord);
  }

  if (Array.isArray(stats)) {
    return stats.filter(isRecord);
  }

  if (isRecord(stats)) {
    return Object.values(stats).filter(isRecord);
  }

  return [];
}

function toNumericLevel(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);

    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(1, parsed));
    }
  }

  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

export interface AudioEnergySnapshot {
  totalAudioEnergy: number;
  totalSamplesDuration: number;
}

/**
 * Compute RMS audio level from the delta of two energy snapshots.
 * Returns a value in [0, 1] or undefined if the snapshots are unusable.
 */
export function computeRmsLevel(
  previous: AudioEnergySnapshot,
  current: AudioEnergySnapshot,
): number | undefined {
  const durationDelta = current.totalSamplesDuration - previous.totalSamplesDuration;

  if (durationDelta <= 0) {
    return undefined;
  }

  const energyDelta = current.totalAudioEnergy - previous.totalAudioEnergy;
  const rms = Math.sqrt(Math.max(0, energyDelta) / durationDelta);

  return Math.max(0, Math.min(1, rms));
}

/**
 * Extract an energy snapshot from stats. react-native-webrtc exposes
 * `totalAudioEnergy` and `totalSamplesDuration` on `media-source` stats.
 */
export function extractEnergySnapshot(stats: unknown): AudioEnergySnapshot | undefined {
  for (const entry of toEntries(stats)) {
    const energy = toFiniteNumber(entry.totalAudioEnergy);
    const duration = toFiniteNumber(entry.totalSamplesDuration);

    if (energy !== undefined && duration !== undefined && duration > 0) {
      return { totalAudioEnergy: energy, totalSamplesDuration: duration };
    }
  }

  return undefined;
}

/**
 * Extract direct `audioLevel` from stats (works in browsers, may not
 * be present in react-native-webrtc).
 */
export function extractAudioLevelFromStats(stats: unknown): number | undefined {
  const levels = toEntries(stats)
    .map((entry) => toNumericLevel(entry.audioLevel))
    .filter((entry): entry is number => entry !== undefined);

  if (levels.length === 0) {
    return undefined;
  }

  return Math.max(...levels);
}
