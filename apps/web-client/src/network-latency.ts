export interface NavigatorConnectionLike {
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
  rtt?: unknown;
}

export interface NavigatorLike {
  connection?: NavigatorConnectionLike;
}

export function readNetworkRtt(navigatorLike: NavigatorLike | undefined): number | undefined {
  const rtt = navigatorLike?.connection?.rtt;

  if (typeof rtt !== "number" || !Number.isFinite(rtt) || rtt <= 0) {
    return undefined;
  }

  return Math.round(rtt);
}

export function formatLatencyIndicator(rttMs: number | undefined): string {
  return rttMs === undefined ? "LAN-local" : `~${rttMs} ms`;
}
