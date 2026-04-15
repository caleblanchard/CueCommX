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

export function extractAudioLevelFromStats(stats: unknown): number | undefined {
  const levels = toEntries(stats)
    .map((entry) => toNumericLevel(entry.audioLevel))
    .filter((entry): entry is number => entry !== undefined);

  if (levels.length === 0) {
    return undefined;
  }

  return Math.max(...levels);
}
