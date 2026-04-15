import { Bonjour, type ServiceConfig } from "bonjour-service";

import { PROTOCOL_VERSION, type DiscoveryMdns } from "@cuecommx/protocol";

import type { CueCommXConfig } from "../config.js";

const SERVICE_TYPE = "cuecommx";
const SERVICE_TYPE_LABEL = "_cuecommx._tcp";

interface BonjourServiceLike {
  start?: CallableFunction;
  stop?: CallableFunction;
}

interface BonjourLike {
  destroy(callback?: CallableFunction): void;
  publish(options: ServiceConfig): BonjourServiceLike;
}

export interface MdnsAdvertiser {
  getStatus(): DiscoveryMdns;
  start(): void;
  stop(): Promise<void>;
}

export interface CueCommXMdnsAdvertiserOptions {
  bonjourFactory?: () => BonjourLike;
  config: CueCommXConfig;
}

export class CueCommXMdnsAdvertiser implements MdnsAdvertiser {
  private bonjour: BonjourLike | undefined;

  private service: BonjourServiceLike | undefined;

  private status: DiscoveryMdns;

  constructor(private readonly options: CueCommXMdnsAdvertiserOptions) {
    this.status = {
      enabled: false,
      name: options.config.serverName,
      port: options.config.port,
      protocol: "tcp",
      serviceType: SERVICE_TYPE_LABEL,
    };
  }

  getStatus(): DiscoveryMdns {
    return this.status;
  }

  start(): void {
    if (this.bonjour) {
      return;
    }

    if (this.options.config.port <= 0) {
      this.status = {
        ...this.status,
        enabled: false,
        error: undefined,
      };
      return;
    }

    try {
      const bonjour =
        this.options.bonjourFactory?.() ??
        new Bonjour();
      const service = bonjour.publish({
        name: this.options.config.serverName,
        type: SERVICE_TYPE,
        protocol: "tcp",
        port: this.options.config.port,
        txt: {
          path: "/",
          protocolVersion: PROTOCOL_VERSION,
          serverName: this.options.config.serverName,
        },
      });

      service.start?.();
      this.bonjour = bonjour;
      this.service = service;
      this.status = {
        ...this.status,
        enabled: true,
        error: undefined,
      };
    } catch (error) {
      this.bonjour = undefined;
      this.service = undefined;
      this.status = {
        ...this.status,
        enabled: false,
        error:
          error instanceof Error
            ? error.message
            : "CueCommX could not start the local mDNS broadcast.",
      };
    }
  }

  async stop(): Promise<void> {
    this.service?.stop?.();
    this.service = undefined;

    if (!this.bonjour) {
      this.status = {
        ...this.status,
        enabled: false,
      };
      return;
    }

    const bonjour = this.bonjour;

    this.bonjour = undefined;
    this.status = {
      ...this.status,
      enabled: false,
    };

    await new Promise<void>((resolve) => {
      bonjour.destroy(() => resolve());
    });
  }
}
