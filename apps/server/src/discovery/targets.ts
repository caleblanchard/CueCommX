import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import type { DiscoveryMdns, DiscoveryResponse, DiscoveryTarget } from "@cuecommx/protocol";

import type { CueCommXConfig } from "../config.js";

export interface BuildDiscoveryResponseOptions {
  headersHost?: string;
  mdns?: DiscoveryMdns;
  networkInterfacesMap?: Record<string, NetworkInterfaceInfo[] | undefined>;
  protocol?: string;
}

function buildBaseUrl(protocol: "http" | "https", host: string, port: number): string {
  const url = new URL(`${protocol}://localhost:${port}/`);
  url.hostname = host;
  url.port = String(port);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::";
}

function parseHostFromHeader(headersHost?: string): string | undefined {
  if (!headersHost) {
    return undefined;
  }

  try {
    return new URL(`http://${headersHost}`).hostname;
  } catch {
    return undefined;
  }
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function collectLanHosts(
  networkInterfacesMap: Record<string, NetworkInterfaceInfo[] | undefined>,
): Array<{ address: string; name: string }> {
  const hosts: Array<{ address: string; name: string }> = [];

  for (const [name, entries] of Object.entries(networkInterfacesMap).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) {
        continue;
      }

      hosts.push({
        address: entry.address,
        name,
      });
    }
  }

  return hosts;
}

export function resolveMediaAnnouncedHost(
  config: CueCommXConfig,
  networkInterfacesMap: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces(),
): string | undefined {
  if (config.announcedIp) {
    return config.announcedIp;
  }

  if (!isWildcardHost(config.host) && !isLoopbackHost(config.host)) {
    return config.host;
  }

  return collectLanHosts(networkInterfacesMap)[0]?.address;
}

export function buildDiscoveryResponse(
  config: CueCommXConfig,
  options: BuildDiscoveryResponseOptions = {},
): DiscoveryResponse {
  const protocol = options.protocol === "https" ? "https" : "http";
  const browserHost = parseHostFromHeader(options.headersHost);
  const targets: DiscoveryTarget[] = [];
  const seenUrls = new Set<string>();

  const addTarget = (
    host: string,
    kind: DiscoveryTarget["kind"],
    label: string,
    idPrefix: string,
  ): void => {
    const url = buildBaseUrl(protocol, host, config.port);

    if (seenUrls.has(url)) {
      return;
    }

    seenUrls.add(url);
    targets.push({
      id: `${idPrefix}-${sanitizeId(host)}`,
      kind,
      label,
      url,
    });
  };

  if (config.announcedIp) {
    addTarget(config.announcedIp, "announced", "Primary LAN URL", "announced");
  }

  if (browserHost && !isWildcardHost(browserHost) && !isLoopbackHost(browserHost)) {
    addTarget(browserHost, "browser", "Current browser origin", "browser");
  }

  if (!browserHost && !isWildcardHost(config.host)) {
    addTarget(
      config.host,
      isLoopbackHost(config.host) ? "loopback" : "lan",
      isLoopbackHost(config.host) ? "Configured local URL" : "Configured host URL",
      "configured",
    );
  }

  const lanHosts = collectLanHosts(options.networkInterfacesMap ?? networkInterfaces());
  const detectedInterfaces = lanHosts.map((host) => ({
    address: host.address,
    name: host.name,
    url: buildBaseUrl(protocol, host.address, config.port),
  }));

  for (const host of lanHosts) {
    addTarget(host.address, "lan", `LAN URL (${host.name})`, "lan");
  }

  if (browserHost && isLoopbackHost(browserHost)) {
    addTarget(browserHost, "loopback", "Current browser origin", "browser");
  }

  addTarget("localhost", "loopback", "This machine only", "loopback");

  if (targets.length === 0) {
    throw new Error("CueCommX discovery could not determine any connect targets.");
  }

  return {
    announcedHost: config.announcedIp,
    detectedInterfaces,
    mdns: options.mdns,
    primaryUrl: targets[0].url,
    primaryTargetId: targets[0].id,
    connectTargets: targets,
  };
}
