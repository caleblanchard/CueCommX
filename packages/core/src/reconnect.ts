export interface ReconnectOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
}

export function getReconnectDelay(
  attempt: number,
  options: ReconnectOptions = {},
  random: () => number = Math.random,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Reconnect attempt must be a positive integer.");
  }

  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const jitterMs = options.jitterMs ?? 250;

  const exponentialDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  const jitter = Math.floor(random() * jitterMs);

  return Math.min(exponentialDelay + jitter, maxDelayMs);
}
