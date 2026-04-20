import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";

import {
  AuthSuccessResponseSchema,
  CreateChannelRequestSchema,
  CreateGroupRequestSchema,
  CreateUserRequestSchema,
  DiscoveryResponseSchema,
  LoginRequestSchema,
  ManagedUserSchema,
  PROTOCOL_VERSION,
  SavePreferencesRequestSchema,
  SetupAdminRequestSchema,
  type AuthSuccessResponse,
  type ChannelPermission,
  type ManagedUser,
  type StatusResponse,
  UpdateChannelRequestSchema,
  UpdateGroupRequestSchema,
  UpdateUserRequestSchema,
  UsersListResponseSchema,
} from "@cuecommx/protocol";

import { createFailureResponse, requireAdminSession, requireOperatorSession } from "./auth/http-session.js";
import { hashPin, verifyPin } from "./auth/pin.js";
import { SessionStore } from "./auth/session-store.js";
import type { CueCommXConfig } from "./config.js";
import { DatabaseService } from "./db/database.js";
import {
  CueCommXMdnsAdvertiser,
  type MdnsAdvertiser,
} from "./discovery/mdns.js";
import { buildDiscoveryResponse, resolveMediaAnnouncedHost } from "./discovery/targets.js";
import { CueCommXMediaService, type RealtimeMediaService } from "./media/service.js";
import { buildOscConfig, OscService } from "./osc/service.js";
import { buildGpioConfig, GpioService } from "./gpio/service.js";
import { RecordingService } from "./recording/service.js";
import { RealtimeService } from "./realtime/service.js";
import { TallyService } from "./tally/service.js";

const SERVER_VERSION = "0.1.0";

export interface CreateAppOptions {
  config: CueCommXConfig;
  adminUiDistPath?: string;
  database?: DatabaseService;
  mediaService?: RealtimeMediaService;
  mdnsAdvertiser?: MdnsAdvertiser;
  sessionStore?: SessionStore;
  startTime?: number;
  webClientDistPath?: string;
}

function createAdminPermissions(database: DatabaseService): ChannelPermission[] {
  return database.listChannels().map((channel) => ({
    channelId: channel.id,
    canTalk: true,
    canListen: true,
  }));
}

function createSuccessResponse(
  database: DatabaseService,
  sessionStore: SessionStore,
  userId: string,
): AuthSuccessResponse {
  const user = database.getUser(userId);

  if (!user) {
    throw new Error(`Authenticated user ${userId} was not found.`);
  }

  const groups = database.listGroups();

  return AuthSuccessResponseSchema.parse({
    success: true,
    protocolVersion: PROTOCOL_VERSION,
    sessionToken: sessionStore.createSession(userId).token,
    user,
    channels: database.listAssignedChannels(userId),
    groups,
    preferences: database.getUserPreferences(userId),
  });
}

function createManagedUserResponse(
  database: DatabaseService,
  realtimeService: RealtimeService,
  userId: string,
): ManagedUser {
  const user = database.getUser(userId);

  if (!user) {
    throw new Error(`Managed user ${userId} was not found.`);
  }

  return ManagedUserSchema.parse({
    ...user,
    online: realtimeService.getConnectedUserIds().includes(user.id),
    groupIds: database.getUserGroupIds(user.id),
  });
}

function normalizeChannelPermissions(permissions: ChannelPermission[]): ChannelPermission[] {
  return permissions
    .filter((permission) => permission.canTalk || permission.canListen)
    .sort((left, right) => left.channelId.localeCompare(right.channelId));
}

function resolveStaticBundlePath(explicitPath: string | undefined, relativePath: string): string | undefined {
  if (explicitPath) {
    return existsSync(explicitPath) ? explicitPath : undefined;
  }

  const defaultPath = fileURLToPath(new URL(relativePath, import.meta.url));

  return existsSync(defaultPath) ? defaultPath : undefined;
}

export function createApp(options: CreateAppOptions) {
  const database = options.database ?? new DatabaseService({ dbPath: options.config.dbPath });
  const sessionStore = options.sessionStore ?? new SessionStore();
  const startTime = options.startTime ?? Date.now();
  const webClientDistPath = resolveStaticBundlePath(options.webClientDistPath, "../../web-client/dist");
  const adminUiDistPath = resolveStaticBundlePath(options.adminUiDistPath, "../../admin-ui/dist");
  const mediaAnnouncedHost = resolveMediaAnnouncedHost(options.config);
  let realtimeService: RealtimeService;
  const mdnsAdvertiser =
    options.mdnsAdvertiser ??
    new CueCommXMdnsAdvertiser({
      config: options.config,
    });
  const mediaService =
    options.mediaService ??
    new CueCommXMediaService({
      announcedIp: mediaAnnouncedHost,
      logLevel: options.config.logLevel,
      onWorkerDied: () => {
        realtimeService.disconnectAllUsers("CueCommX media worker restarted. Reconnect the client.");
      },
      rtcMaxPort: options.config.rtcMaxPort,
      rtcMinPort: options.config.rtcMinPort,
    });

  const recordingService = new RecordingService();

  const oscConfig = buildOscConfig(process.env);
  const oscService = new OscService(oscConfig);

  const gpioConfig = buildGpioConfig(process.env);
  const gpioService = new GpioService(gpioConfig);

  const streamDeckApiKey =
    process.env.CUECOMMX_STREAMDECK_API_KEY ?? randomBytes(16).toString("hex");

  const sseClients = new Set<{ write: (data: string) => void }>();

  const tallyEnabled =
    process.env.CUECOMMX_TALLY_OBS_ENABLED === "true" ||
    process.env.CUECOMMX_TALLY_TSL_ENABLED === "true";

  const tallyService = tallyEnabled
    ? new TallyService({
        obsEnabled: process.env.CUECOMMX_TALLY_OBS_ENABLED === "true",
        obsUrl: process.env.CUECOMMX_TALLY_OBS_URL ?? "ws://localhost:4455",
        obsPassword: process.env.CUECOMMX_TALLY_OBS_PASSWORD ?? "",
        tslEnabled: process.env.CUECOMMX_TALLY_TSL_ENABLED === "true",
        tslListenPort: process.env.CUECOMMX_TALLY_TSL_PORT
          ? Number(process.env.CUECOMMX_TALLY_TSL_PORT)
          : 8900,
      })
    : undefined;

  realtimeService = new RealtimeService({
    database,
    maxUsers: options.config.maxUsers,
    mediaService,
    oscService,
    recordingService,
    sessionStore,
    tallyService,
    onStateChange: () => {
      const state = realtimeService.getPublicState();
      const payload = `data: ${JSON.stringify(state)}\n\n`;
      for (const client of sseClients) {
        try { client.write(payload); } catch { sseClients.delete(client); }
      }
    },
  });

  oscService.setCallbacks({
    onMuteUser: (userId) => {
      void realtimeService.forceMuteUser(userId);
    },
  });

  const configureApp = <Server extends HttpServer | HttpsServer>(
    configuredApp: FastifyInstance<Server>,
  ) => {
    mdnsAdvertiser.start();

    if (mdnsAdvertiser.getStatus().error) {
      console.warn(`CueCommX mDNS broadcast unavailable: ${mdnsAdvertiser.getStatus().error}`);
    }

    realtimeService.attach(configuredApp.server);

    if (tallyService) {
      void tallyService.start();
    }

    oscService.start();
    void gpioService.start();

    if (!process.env.CUECOMMX_STREAMDECK_API_KEY) {
      console.log(`[StreamDeck] Auto-generated API key: ${streamDeckApiKey}`);
      console.log(`[StreamDeck] Set CUECOMMX_STREAMDECK_API_KEY to use a persistent key.`);
    }

    configuredApp.addHook("onClose", async () => {
      await mdnsAdvertiser.stop();
      await recordingService.closeAll();
      if (tallyService) {
        await tallyService.stop();
      }
      await oscService.stop();
      await gpioService.stop();
      await realtimeService.close();
      database.close();
    });

    configuredApp.get("/api/status", async () => {
      const response: StatusResponse = {
        name: options.config.serverName,
        version: SERVER_VERSION,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        connectedUsers: realtimeService.getConnectedUsersCount(),
        maxUsers: options.config.maxUsers,
        channels: database.getChannelCount(),
        needsAdminSetup: !database.hasAdminUser(),
        protocolVersion: PROTOCOL_VERSION,
      };

      return response;
    });

    configuredApp.get("/api/discovery", async (request) =>
      DiscoveryResponseSchema.parse(
        buildDiscoveryResponse(options.config, {
          headersHost: request.headers.host,
          mdns: mdnsAdvertiser.getStatus(),
          protocol: request.protocol,
        }),
      ),
    );

    configuredApp.get("/api/channels", async () => database.listChannels());

    configuredApp.get("/api/tally/status", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      return {
        sources: tallyService?.getSources() ?? [],
        config: {
          obsEnabled: process.env.CUECOMMX_TALLY_OBS_ENABLED === "true",
          obsUrl: process.env.CUECOMMX_TALLY_OBS_URL ?? "ws://localhost:4455",
          tslEnabled: process.env.CUECOMMX_TALLY_TSL_ENABLED === "true",
          tslListenPort: process.env.CUECOMMX_TALLY_TSL_PORT
            ? Number(process.env.CUECOMMX_TALLY_TSL_PORT)
            : 8900,
        },
      };
    });

    configuredApp.post("/api/auth/setup-admin", async (request, reply) => {
      const parsed = SetupAdminRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send(createFailureResponse(parsed.error.issues[0]?.message ?? "Invalid setup-admin request."));
      }

      if (database.hasAdminUser()) {
        return reply.code(409).send(createFailureResponse("Admin account already exists."));
      }

      const userId = database.createUser({
        username: parsed.data.username,
        role: "admin",
        pinHash: parsed.data.pin ? hashPin(parsed.data.pin) : undefined,
      });

      database.grantChannelPermissions(userId, createAdminPermissions(database));

      return reply.code(201).send(createSuccessResponse(database, sessionStore, userId));
    });

    if (webClientDistPath) {
      configuredApp.register(fastifyStatic, {
        index: false,
        prefix: "/",
        root: webClientDistPath,
      });

      configuredApp.get("/", async (_request, reply) =>
        reply.type("text/html; charset=utf-8").sendFile("index.html", webClientDistPath),
      );
    }

    if (adminUiDistPath) {
      configuredApp.register(fastifyStatic, {
        decorateReply: !webClientDistPath,
        index: false,
        prefix: "/admin/",
        root: adminUiDistPath,
      });

      configuredApp.get("/admin", async (_request, reply) =>
        reply.type("text/html; charset=utf-8").sendFile("index.html", adminUiDistPath),
      );
      configuredApp.get("/admin/", async (_request, reply) =>
        reply.type("text/html; charset=utf-8").sendFile("index.html", adminUiDistPath),
      );
    }

    configuredApp.get("/api/auth/session", async (request, reply) => {
      const authorization = request.headers.authorization;

      if (typeof authorization !== "string") {
        return reply.code(401).send(createFailureResponse("Bearer session token is required."));
      }

      const [scheme, token] = authorization.split(" ");

      if (scheme !== "Bearer" || !token) {
        return reply.code(401).send(createFailureResponse("Bearer session token is required."));
      }

      const session = sessionStore.get(token);

      if (!session) {
        return reply.code(401).send(createFailureResponse("Session token is invalid or expired."));
      }

      const user = database.getUser(session.userId);

      if (!user) {
        return reply.code(401).send(createFailureResponse("Session user was not found."));
      }

      return reply.code(200).send(
        AuthSuccessResponseSchema.parse({
          success: true,
          protocolVersion: PROTOCOL_VERSION,
          sessionToken: token,
          user,
          channels: database.listAssignedChannels(user.id),
          groups: database.listGroups(),
        }),
      );
    });

    configuredApp.post("/api/auth/login", async (request, reply) => {
      const parsed = LoginRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send(createFailureResponse(parsed.error.issues[0]?.message ?? "Invalid login request."));
      }

      const user = database.findUserByUsername(parsed.data.username);

      if (!user) {
        return reply.code(401).send(createFailureResponse("Invalid username or PIN."));
      }

      if (user.pinHash) {
        if (!parsed.data.pin || !verifyPin(parsed.data.pin, user.pinHash)) {
          try { database.logEvent({ event_type: "user:login_failed", username: parsed.data.username, severity: "warn" }); } catch { /* never crash */ }
          return reply.code(401).send(createFailureResponse("Invalid username or PIN."));
        }
      }

      try { database.logEvent({ event_type: "user:login", user_id: user.id, username: user.username }); } catch { /* never crash */ }
      return reply.code(200).send(createSuccessResponse(database, sessionStore, user.id));
    });

    configuredApp.get("/api/preferences", async (request, reply) => {
      const sessionContext = requireOperatorSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      return { preferences: database.getUserPreferences(sessionContext.user.id) };
    });

    configuredApp.put("/api/preferences", async (request, reply) => {
      const sessionContext = requireOperatorSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const parsed = SavePreferencesRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send(createFailureResponse(parsed.error.issues[0]?.message ?? "Invalid preferences."));
      }

      database.saveUserPreferences(sessionContext.user.id, parsed.data);

      return { preferences: database.getUserPreferences(sessionContext.user.id) };
    });

    configuredApp.get("/api/users", async (request, reply) => {
      const sessionContext = requireOperatorSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      return UsersListResponseSchema.parse(
        database.listUsers().map((user) => ({
          ...user,
          online: realtimeService.getConnectedUserIds().includes(user.id),
          groupIds: database.getUserGroupIds(user.id),
        })),
      );
    });

    configuredApp.post("/api/users", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const parsed = CreateUserRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send(createFailureResponse(parsed.error.issues[0]?.message ?? "Invalid create-user request."));
      }

      const existingUser = database.findUserByUsername(parsed.data.username);

      if (existingUser) {
        return reply.code(409).send(createFailureResponse("A user with that name already exists."));
      }

      const userId = database.createUser({
        username: parsed.data.username,
        role: parsed.data.role,
        pinHash: parsed.data.pin ? hashPin(parsed.data.pin) : undefined,
      });
      database.replaceChannelPermissions(userId, normalizeChannelPermissions(parsed.data.channelPermissions));
      database.replaceUserGroups(userId, parsed.data.groupIds);
      try { database.logEvent({ event_type: "user:created", username: parsed.data.username, user_id: userId }); } catch { /* never crash */ }

      return reply.code(201).send(createManagedUserResponse(database, realtimeService, userId));
    });

    configuredApp.put("/api/users/:id", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const userId =
        typeof (request.params as { id?: unknown }).id === "string"
          ? (request.params as { id: string }).id
          : undefined;

      if (!userId) {
        return reply.code(400).send(createFailureResponse("User id is required."));
      }

      const existingUser = database.getUser(userId);

      if (!existingUser) {
        return reply.code(404).send(createFailureResponse("User not found."));
      }

      const parsed = UpdateUserRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send(createFailureResponse(parsed.error.issues[0]?.message ?? "Invalid update-user request."));
      }

      const duplicateUser = database.findUserByUsername(parsed.data.username);

      if (duplicateUser && duplicateUser.id !== userId) {
        return reply.code(409).send(createFailureResponse("A user with that name already exists."));
      }

      if (
        existingUser.role === "admin" &&
        parsed.data.role !== "admin" &&
        database.countAdminUsers() === 1
      ) {
        return reply.code(409).send(createFailureResponse("CueCommX must keep at least one admin account."));
      }

      database.updateUser(userId, {
        username: parsed.data.username,
        role: parsed.data.role,
        pinHash: parsed.data.clearPin
          ? null
          : parsed.data.pin
            ? hashPin(parsed.data.pin)
            : undefined,
      });
      database.replaceChannelPermissions(userId, normalizeChannelPermissions(parsed.data.channelPermissions));
      database.replaceUserGroups(userId, parsed.data.groupIds);
      await realtimeService.refreshUserSessions(userId);

      return reply.code(200).send(createManagedUserResponse(database, realtimeService, userId));
    });

    configuredApp.post("/api/users/:id/force-mute", async (request, reply) => {
      const sessionContext = requireOperatorSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const userId =
        typeof (request.params as { id?: unknown }).id === "string"
          ? (request.params as { id: string }).id
          : undefined;

      if (!userId) {
        return reply.code(400).send(createFailureResponse("User id is required."));
      }

      if (!database.getUser(userId)) {
        return reply.code(404).send(createFailureResponse("User not found."));
      }

      const targetUser = database.getUser(userId);
      await realtimeService.forceMuteUser(userId);
      try { database.logEvent({ event_type: "admin:force_mute", username: targetUser?.username, details: "Force-muted by admin" }); } catch { /* never crash */ }

      return reply.code(204).send();
    });

    configuredApp.post("/api/channels/:id/unlatch", async (request, reply) => {
      const sessionContext = requireOperatorSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const channelId =
        typeof (request.params as { id?: unknown }).id === "string"
          ? (request.params as { id: string }).id
          : undefined;

      if (!channelId) {
        return reply.code(400).send(createFailureResponse("Channel id is required."));
      }

      if (!database.getChannel(channelId)) {
        return reply.code(404).send(createFailureResponse("Channel not found."));
      }

      await realtimeService.unlatchChannel(channelId);

      return reply.code(204).send();
    });

    configuredApp.delete("/api/users/:id", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const userId =
        typeof (request.params as { id?: unknown }).id === "string"
          ? (request.params as { id: string }).id
          : undefined;

      if (!userId) {
        return reply.code(400).send(createFailureResponse("User id is required."));
      }

      const existingUser = database.getUser(userId);

      if (!existingUser) {
        return reply.code(404).send(createFailureResponse("User not found."));
      }

      if (sessionContext.user.id === userId) {
        return reply.code(409).send(createFailureResponse("The active admin session cannot delete itself."));
      }

      if (existingUser.role === "admin" && database.countAdminUsers() === 1) {
        return reply.code(409).send(createFailureResponse("CueCommX must keep at least one admin account."));
      }

      database.deleteUser(userId);
      realtimeService.disconnectUser(userId, "User removed by admin");
      try { database.logEvent({ event_type: "user:deleted", username: existingUser.username, user_id: userId }); } catch { /* never crash */ }

      return reply.code(204).send();
    });

    configuredApp.post("/api/channels", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const parsed = CreateChannelRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            createFailureResponse(
              parsed.error.issues[0]?.message ?? "Invalid create-channel request.",
            ),
          );
      }

      if (database.getChannelCount() >= options.config.maxChannels) {
        return reply
          .code(409)
          .send(
            createFailureResponse("CueCommX is already at the configured channel limit."),
          );
      }

      if (database.findChannelByName(parsed.data.name)) {
        return reply
          .code(409)
          .send(createFailureResponse("A channel with that name already exists."));
      }

      return reply.code(201).send(database.createChannel(parsed.data));
    });

    configuredApp.put("/api/channels/:id", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const channelId =
        typeof (request.params as { id?: unknown }).id === "string"
          ? (request.params as { id: string }).id
          : undefined;

      if (!channelId) {
        return reply.code(400).send(createFailureResponse("Channel id is required."));
      }

      const existingChannel = database.getChannel(channelId);

      if (!existingChannel) {
        return reply.code(404).send(createFailureResponse("Channel not found."));
      }

      const parsed = UpdateChannelRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            createFailureResponse(
              parsed.error.issues[0]?.message ?? "Invalid update-channel request.",
            ),
          );
      }

      const duplicateChannel = database.findChannelByName(parsed.data.name);

      if (duplicateChannel && duplicateChannel.id !== channelId) {
        return reply
          .code(409)
          .send(createFailureResponse("A channel with that name already exists."));
      }

      database.updateChannel(channelId, parsed.data);
      await realtimeService.refreshAllSessions();

      const channel = database.getChannel(channelId);

      if (!channel) {
        throw new Error(`Updated channel ${channelId} was not found.`);
      }

      return reply.code(200).send(channel);
    });

    configuredApp.delete("/api/channels/:id", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const channelId =
        typeof (request.params as { id?: unknown }).id === "string"
          ? (request.params as { id: string }).id
          : undefined;

      if (!channelId) {
        return reply.code(400).send(createFailureResponse("Channel id is required."));
      }

      if (!database.getChannel(channelId)) {
        return reply.code(404).send(createFailureResponse("Channel not found."));
      }

      database.deleteChannel(channelId);
      await realtimeService.refreshAllSessions();

      return reply.code(204).send();
    });

    // --- Event log endpoints ---

    configuredApp.get("/api/admin/event-log", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const query = request.query as Record<string, string | undefined>;

      return database.getEventLog({
        event_type: query.event_type,
        user_id: query.user_id,
        severity: query.severity,
        since: query.since,
        until: query.until,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
    });

    configuredApp.delete("/api/admin/event-log", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const body = (request.body ?? {}) as { olderThanDays?: number };
      const olderThanDays = typeof body.olderThanDays === "number" ? body.olderThanDays : 30;

      const pruned = database.pruneEventLog(olderThanDays);

      return { pruned };
    });

    // --- Recording endpoints ---

    configuredApp.post("/api/admin/recording/start", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;

      const body = (request.body ?? {}) as { channelId?: string };
      if (typeof body.channelId !== "string" || !body.channelId) {
        return reply.code(400).send(createFailureResponse("channelId is required."));
      }

      const channel = database.listChannels().find((ch) => ch.id === body.channelId);
      if (!channel) {
        return reply.code(404).send(createFailureResponse("Channel not found."));
      }

      try {
        await realtimeService.startChannelRecording(body.channelId);
        return { success: true, channelId: body.channelId, channelName: channel.name };
      } catch (error) {
        return reply.code(500).send(createFailureResponse("Failed to start recording."));
      }
    });

    configuredApp.post("/api/admin/recording/stop", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;

      const body = (request.body ?? {}) as { channelId?: string };
      if (typeof body.channelId !== "string" || !body.channelId) {
        return reply.code(400).send(createFailureResponse("channelId is required."));
      }

      try {
        const result = await realtimeService.stopChannelRecording(body.channelId);
        if (!result) {
          return reply.code(404).send(createFailureResponse("No active recording for that channel."));
        }
        return { success: true, filePath: result.filePath, durationMs: result.durationMs };
      } catch (error) {
        return reply.code(500).send(createFailureResponse("Failed to stop recording."));
      }
    });

    configuredApp.get("/api/admin/recording/active", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;

      return recordingService.getActiveRecordings();
    });

    configuredApp.get("/api/admin/recordings", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;

      return recordingService.listRecordings();
    });

    configuredApp.get("/api/admin/recordings/:filename", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;

      const filename =
        typeof (request.params as { filename?: unknown }).filename === "string"
          ? (request.params as { filename: string }).filename
          : undefined;

      if (!filename || !filename.endsWith(".jsonl") || filename.includes("..") || filename.includes("/")) {
        return reply.code(400).send(createFailureResponse("Invalid filename."));
      }

      const { createReadStream, existsSync: fileExists } = await import("node:fs");
      const { join } = await import("node:path");
      const filePath = join(recordingService.getRecordingsDir(), filename);

      if (!fileExists(filePath)) {
        return reply.code(404).send(createFailureResponse("Recording file not found."));
      }

      void reply.header("Content-Type", "application/x-ndjson");
      void reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(createReadStream(filePath));
    });

    configuredApp.delete("/api/admin/recordings/:filename", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;

      const filename =
        typeof (request.params as { filename?: unknown }).filename === "string"
          ? (request.params as { filename: string }).filename
          : undefined;

      if (!filename) {
        return reply.code(400).send(createFailureResponse("Filename is required."));
      }

      const deleted = await recordingService.deleteRecording(filename);
      if (!deleted) {
        return reply.code(404).send(createFailureResponse("Recording not found or could not be deleted."));
      }

      return reply.code(204).send();
    });

    configuredApp.delete("/api/admin/recordings", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;

      const body = (request.body ?? {}) as { olderThanDays?: number };
      const olderThanDays = typeof body.olderThanDays === "number" ? body.olderThanDays : 30;
      const pruned = await recordingService.pruneOlderThan(olderThanDays);

      return { pruned };
    });

    // --- StreamDeck / Companion HTTP API ---

    const requireStreamDeckKey = (request: FastifyRequest, reply: FastifyReply): boolean => {
      const provided =
        (request.headers["x-api-key"] as string | undefined) ??
        (request.query as Record<string, string>)["apiKey"];
      if (provided !== streamDeckApiKey) {
        void reply.code(401).send({ error: "Invalid or missing API key" });
        return false;
      }
      return true;
    };

    configuredApp.get("/api/stream-deck/state", async (request, reply) => {
      if (!requireStreamDeckKey(request, reply)) return reply;
      return realtimeService.getPublicState();
    });

    configuredApp.post("/api/stream-deck/action", async (request, reply) => {
      if (!requireStreamDeckKey(request, reply)) return reply;
      const body = (request.body ?? {}) as {
        action?: string;
        userId?: string;
        channelId?: string;
      };

      if (!body.action) {
        return reply.code(400).send({ error: "action is required" });
      }

      if (body.action === "mute") {
        if (!body.userId) return reply.code(400).send({ error: "userId required for mute" });
        const user = database.getUser(body.userId);
        if (!user) return reply.code(404).send({ error: "User not found" });
        await realtimeService.forceMuteUser(body.userId);
        return { ok: true };
      }

      if (body.action === "disconnect") {
        if (!body.userId) return reply.code(400).send({ error: "userId required for disconnect" });
        const user = database.getUser(body.userId);
        if (!user) return reply.code(404).send({ error: "User not found" });
        realtimeService.disconnectUser(body.userId, "Disconnected via StreamDeck/Companion");
        return { ok: true };
      }

      return reply.code(400).send({ error: `Unknown action: ${body.action}` });
    });

    configuredApp.get("/api/stream-deck/events", async (request, reply) => {
      if (!requireStreamDeckKey(request, reply)) return reply;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const client = {
        write: (data: string) => reply.raw.write(data),
      };

      sseClients.add(client);

      // Send current state immediately
      const initial = `data: ${JSON.stringify(realtimeService.getPublicState())}\n\n`;
      reply.raw.write(initial);

      const keepAlive = setInterval(() => {
        try { reply.raw.write(": keep-alive\n\n"); } catch { /* closed */ }
      }, 20_000);

      reply.raw.on("close", () => {
        clearInterval(keepAlive);
        sseClients.delete(client);
      });

      // Return a never-resolving promise to keep the handler alive
      return new Promise<void>(() => undefined);
    });

    // --- OSC status endpoint ---

    configuredApp.get("/api/osc/status", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;
      return {
        enabled: oscService.getConfig().enabled,
        running: oscService.isRunning,
        config: oscService.getConfig(),
      };
    });

    // --- GPIO status endpoint ---

    configuredApp.get("/api/gpio/status", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;
      return {
        enabled: gpioService.getConfig().enabled,
        running: gpioService.isRunning,
        config: gpioService.getConfig(),
      };
    });

    configuredApp.get("/api/gpio/devices", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);
      if (!sessionContext) return reply;
      const devices = await GpioService.listHidDevices();
      return { devices };
    });

    // --- Group endpoints ---

    configuredApp.get("/api/groups", async (request, reply) => {
      const sessionContext = requireOperatorSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      return database.listGroups();
    });

    configuredApp.post("/api/groups", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const parsed = CreateGroupRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            createFailureResponse(
              parsed.error.issues[0]?.message ?? "Invalid create-group request.",
            ),
          );
      }

      if (database.findGroupByName(parsed.data.name)) {
        return reply
          .code(409)
          .send(createFailureResponse("A group with that name already exists."));
      }

      return reply.code(201).send(database.createGroup(parsed.data));
    });

    configuredApp.put("/api/groups/:id", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const groupId =
        typeof (request.params as { id?: unknown }).id === "string"
          ? (request.params as { id: string }).id
          : undefined;

      if (!groupId) {
        return reply.code(400).send(createFailureResponse("Group id is required."));
      }

      const existingGroup = database.getGroup(groupId);

      if (!existingGroup) {
        return reply.code(404).send(createFailureResponse("Group not found."));
      }

      const parsed = UpdateGroupRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            createFailureResponse(
              parsed.error.issues[0]?.message ?? "Invalid update-group request.",
            ),
          );
      }

      const duplicateGroup = database.findGroupByName(parsed.data.name);

      if (duplicateGroup && duplicateGroup.id !== groupId) {
        return reply
          .code(409)
          .send(createFailureResponse("A group with that name already exists."));
      }

      database.updateGroup(groupId, parsed.data);

      const group = database.getGroup(groupId);

      if (!group) {
        throw new Error(`Updated group ${groupId} was not found.`);
      }

      return reply.code(200).send(group);
    });

    configuredApp.delete("/api/groups/:id", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      const groupId =
        typeof (request.params as { id?: unknown }).id === "string"
          ? (request.params as { id: string }).id
          : undefined;

      if (!groupId) {
        return reply.code(400).send(createFailureResponse("Group id is required."));
      }

      if (!database.getGroup(groupId)) {
        return reply.code(404).send(createFailureResponse("Group not found."));
      }

      database.deleteGroup(groupId);

      return reply.code(204).send();
    });

    return configuredApp;
  };

  const app = configureApp(
    Fastify<HttpServer>({
      logger: false,
    }),
  );

  return Object.assign(app, {
    attachWebSocketServer: (server: HttpServer | HttpsServer) => {
      realtimeService.attach(server);
    },
  });
}
