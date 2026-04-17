import {
  DiscoveryResponseSchema,
  LoginResponseSchema,
  StatusResponseSchema,
  type AuthSuccessResponse,
  type DiscoveryResponse,
  type StatusResponse,
} from "@cuecommx/protocol";

export interface MobileServerShell {
  baseUrl: string;
  discovery: DiscoveryResponse;
  status: StatusResponse;
}

const SERVER_URL_PROTOCOL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;

function buildApiUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function hasExplicitServerProtocol(input: string): boolean {
  return SERVER_URL_PROTOCOL_PATTERN.test(input);
}

export function normalizeMobileServerUrl(
  input: string,
  defaultProtocol: "http:" | "https:" = "http:",
): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Enter a local server URL like 10.0.0.25:3000.");
  }

  const withProtocol = hasExplicitServerProtocol(trimmed) ? trimmed : `${defaultProtocol}//${trimmed}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CueCommX mobile requires an http:// or https:// server URL.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url.toString();
}

export function resolveMobileServerBaseUrls(input: string): string[] {
  const trimmed = input.trim();

  if (hasExplicitServerProtocol(trimmed)) {
    return [normalizeMobileServerUrl(trimmed)];
  }

  return [
    normalizeMobileServerUrl(trimmed, "https:"),
    normalizeMobileServerUrl(trimmed, "http:"),
  ];
}

async function fetchMobileServerShell(
  fetchImpl: typeof fetch,
  baseUrl: string,
  options: { signal?: AbortSignal },
): Promise<MobileServerShell> {
  const [statusResponse, discoveryResponse] = await Promise.all([
    fetchImpl(buildApiUrl(baseUrl, "/api/status"), { signal: options.signal }),
    fetchImpl(buildApiUrl(baseUrl, "/api/discovery"), { signal: options.signal }),
  ]);

  if (!statusResponse.ok || !discoveryResponse.ok) {
    throw new Error("CueCommX could not load status and discovery from that server.");
  }

  return {
    baseUrl,
    discovery: DiscoveryResponseSchema.parse(await discoveryResponse.json()),
    status: StatusResponseSchema.parse(await statusResponse.json()),
  };
}

export async function loadMobileServerShell(
  fetchImpl: typeof fetch,
  serverUrl: string,
  options: { signal?: AbortSignal } = {},
): Promise<MobileServerShell> {
  const baseUrls = resolveMobileServerBaseUrls(serverUrl);
  let lastError: unknown;

  for (const baseUrl of baseUrls) {
    try {
      return await fetchMobileServerShell(fetchImpl, baseUrl, options);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("CueCommX could not load status and discovery from that server.");
}

export async function loginMobileOperator(
  fetchImpl: typeof fetch,
  input: {
    pin?: string;
    serverUrl: string;
    username: string;
  },
): Promise<AuthSuccessResponse> {
  const baseUrl = normalizeMobileServerUrl(input.serverUrl);
  const response = await fetchImpl(buildApiUrl(baseUrl, "/api/auth/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: input.username,
      pin: input.pin || undefined,
    }),
  });
  const payload = LoginResponseSchema.parse(await response.json());

  if (!response.ok || !payload.success) {
    throw new Error(payload.success ? "CueCommX could not sign in." : payload.error);
  }

  return payload;
}
