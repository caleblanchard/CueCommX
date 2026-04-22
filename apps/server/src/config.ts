import { resolve } from "node:path";

import { z } from "zod";

const integerFromEnv = (defaultValue: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") {
      return defaultValue;
    }

    if (typeof value === "string") {
      return Number.parseInt(value, 10);
    }

    return value;
  }, z.number().int().positive());

const optionalStringFromEnv = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return value;
}, z.string().min(1).optional());

const environmentSchema = z.object({
  CUECOMMX_SERVER_NAME: z.string().min(1).default("CueCommX"),
  CUECOMMX_HOST: z.string().min(1).default("0.0.0.0"),
  CUECOMMX_PORT: integerFromEnv(3000),
  CUECOMMX_HTTPS_PORT: integerFromEnv(3443),
  CUECOMMX_TLS_CERT_FILE: optionalStringFromEnv,
  CUECOMMX_TLS_KEY_FILE: optionalStringFromEnv,
  CUECOMMX_RTC_MIN_PORT: integerFromEnv(40000),
  CUECOMMX_RTC_MAX_PORT: integerFromEnv(41000),
  CUECOMMX_ANNOUNCED_IP: optionalStringFromEnv,
  CUECOMMX_PRIMARY_HOST: optionalStringFromEnv,
  CUECOMMX_DATA_DIR: z.string().min(1).default("./data"),
  CUECOMMX_DB_FILE: z.string().min(1).default("cuecommx.db"),
  CUECOMMX_MAX_USERS: integerFromEnv(30),
  CUECOMMX_MAX_CHANNELS: integerFromEnv(16),
  CUECOMMX_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface CueCommXConfig {
  serverName: string;
  host: string;
  port: number;
  httpsPort: number;
  tls?: {
    certPath: string;
    keyPath: string;
  };
  rtcMinPort: number;
  rtcMaxPort: number;
  announcedIp?: string;
  /** Explicit host/domain for the web UI QR code and primary connect URL. */
  primaryHost?: string;
  dataDir: string;
  dbFile: string;
  dbPath: string;
  maxUsers: number;
  maxChannels: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { cwd?: string } = {},
): CueCommXConfig {
  const cwd = options.cwd ?? process.cwd();
  const parsed = environmentSchema.parse(env);

  if (parsed.CUECOMMX_RTC_MAX_PORT <= parsed.CUECOMMX_RTC_MIN_PORT) {
    throw new Error("CUECOMMX_RTC_MAX_PORT must be greater than CUECOMMX_RTC_MIN_PORT.");
  }

  if (
    (parsed.CUECOMMX_TLS_CERT_FILE && !parsed.CUECOMMX_TLS_KEY_FILE) ||
    (!parsed.CUECOMMX_TLS_CERT_FILE && parsed.CUECOMMX_TLS_KEY_FILE)
  ) {
    throw new Error(
      "CUECOMMX_TLS_CERT_FILE and CUECOMMX_TLS_KEY_FILE must both be set to enable HTTPS.",
    );
  }

  const dataDir = resolve(cwd, parsed.CUECOMMX_DATA_DIR);
  const dbPath = resolve(dataDir, parsed.CUECOMMX_DB_FILE);

  return {
    serverName: parsed.CUECOMMX_SERVER_NAME,
    host: parsed.CUECOMMX_HOST,
    port: parsed.CUECOMMX_PORT,
    httpsPort: parsed.CUECOMMX_HTTPS_PORT,
    tls:
      parsed.CUECOMMX_TLS_CERT_FILE && parsed.CUECOMMX_TLS_KEY_FILE
        ? {
            certPath: resolve(cwd, parsed.CUECOMMX_TLS_CERT_FILE),
            keyPath: resolve(cwd, parsed.CUECOMMX_TLS_KEY_FILE),
          }
        : undefined,
    rtcMinPort: parsed.CUECOMMX_RTC_MIN_PORT,
    rtcMaxPort: parsed.CUECOMMX_RTC_MAX_PORT,
    announcedIp: parsed.CUECOMMX_ANNOUNCED_IP,
    primaryHost: parsed.CUECOMMX_PRIMARY_HOST,
    dataDir,
    dbFile: parsed.CUECOMMX_DB_FILE,
    dbPath,
    maxUsers: parsed.CUECOMMX_MAX_USERS,
    maxChannels: parsed.CUECOMMX_MAX_CHANNELS,
    logLevel: parsed.CUECOMMX_LOG_LEVEL,
  };
}
