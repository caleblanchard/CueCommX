import { useEffect, useRef, useState } from "react";

export interface DiscoveredServer {
  id: string;
  name: string;
  url: string;
}

interface ZeroconfService {
  host: string;
  port: number;
  name: string;
  fullName?: string;
  txt?: Record<string, string>;
}

interface ZeroconfInstance {
  scan(type: string, protocol: string, domain: string): void;
  stop(): void;
  on(event: "resolved", handler: (service: ZeroconfService) => void): void;
  on(event: "remove", handler: (name: string) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  removeDeviceListeners(): void;
}

export function buildDiscoveredServerUrl(host: string, port: number): string {
  const normalizedHost = host.endsWith(".") ? host.slice(0, -1) : host;
  return `http://${normalizedHost}:${port}`;
}

export function makeDiscoveredServerId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
}

/**
 * Scans the local network for CueCommX servers via mDNS (_cuecommx._tcp).
 * Returns a live list of discovered servers. Safe to call on platforms where
 * react-native-zeroconf is unavailable — returns empty list with no errors.
 */
export function useServerDiscovery(): {
  servers: DiscoveredServer[];
  scanning: boolean;
  error: string | undefined;
} {
  const [servers, setServers] = useState<DiscoveredServer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const zeroconfRef = useRef<ZeroconfInstance | null>(null);

  useEffect(() => {
    let active = true;

    const start = async () => {
      let ZeroconfClass: new () => ZeroconfInstance;

      try {
        const mod = await import("react-native-zeroconf" as string) as {
          default: new () => ZeroconfInstance;
        };
        ZeroconfClass = mod.default;
      } catch {
        return;
      }

      if (!active) return;

      let zeroconf: ZeroconfInstance;
      try {
        zeroconf = new ZeroconfClass();
      } catch {
        return;
      }

      zeroconfRef.current = zeroconf;

      zeroconf.on("resolved", (service: ZeroconfService) => {
        if (!active) return;

        const url = buildDiscoveredServerUrl(service.host, service.port);
        const name = service.txt?.serverName ?? service.name;
        const id = makeDiscoveredServerId(service.name);

        setServers((prev) => {
          const filtered = prev.filter((s) => s.id !== id);
          return [...filtered, { id, name, url }];
        });
      });

      zeroconf.on("remove", (name: string) => {
        if (!active) return;
        const id = makeDiscoveredServerId(name);
        setServers((prev) => prev.filter((s) => s.id !== id));
      });

      zeroconf.on("error", (err: Error) => {
        if (!active) return;
        setError(err.message);
        setScanning(false);
      });

      try {
        zeroconf.scan("cuecommx", "tcp", "local.");
        if (active) setScanning(true);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "mDNS scan failed");
          setScanning(false);
        }
      }
    };

    void start();

    return () => {
      active = false;
      const zc = zeroconfRef.current;
      zeroconfRef.current = null;

      if (zc) {
        try {
          zc.removeDeviceListeners();
          zc.stop();
        } catch {
          // ignore cleanup errors
        }
      }

      setScanning(false);
    };
  }, []);

  return { servers, scanning, error };
}
