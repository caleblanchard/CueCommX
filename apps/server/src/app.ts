import { existsSync, readFileSync } from "node:fs";
import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import {
  AuthSuccessResponseSchema,
  CreateChannelRequestSchema,
  CreateUserRequestSchema,
  DiscoveryResponseSchema,
  LoginRequestSchema,
  ManagedUserSchema,
  PROTOCOL_VERSION,
  SetupAdminRequestSchema,
  type AuthSuccessResponse,
  type ChannelPermission,
  type ManagedUser,
  type StatusResponse,
  UpdateChannelRequestSchema,
  UpdateUserRequestSchema,
  UsersListResponseSchema,
} from "@cuecommx/protocol";

import { createFailureResponse, requireAdminSession } from "./auth/http-session.js";
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
import { RealtimeService } from "./realtime/service.js";

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

  return AuthSuccessResponseSchema.parse({
    success: true,
    protocolVersion: PROTOCOL_VERSION,
    sessionToken: sessionStore.createSession(userId).token,
    user,
    channels: database.listAssignedChannels(userId),
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

  realtimeService = new RealtimeService({
    database,
    maxUsers: options.config.maxUsers,
    mediaService,
    sessionStore,
  });

  const configureApp = <Server extends HttpServer | HttpsServer>(
    configuredApp: FastifyInstance<Server>,
  ) => {
    mdnsAdvertiser.start();

    if (mdnsAdvertiser.getStatus().error) {
      console.warn(`CueCommX mDNS broadcast unavailable: ${mdnsAdvertiser.getStatus().error}`);
    }

    realtimeService.attach(configuredApp.server);

    configuredApp.addHook("onClose", async () => {
      await mdnsAdvertiser.stop();
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
          return reply.code(401).send(createFailureResponse("Invalid username or PIN."));
        }
      }

      return reply.code(200).send(createSuccessResponse(database, sessionStore, user.id));
    });

    configuredApp.get("/api/users", async (request, reply) => {
      const sessionContext = requireAdminSession(request, reply, database, sessionStore);

      if (!sessionContext) {
        return reply;
      }

      return UsersListResponseSchema.parse(
        database.listUsers().map((user) => ({
          ...user,
          online: realtimeService.getConnectedUserIds().includes(user.id),
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
      await realtimeService.refreshUserSessions(userId);

      return reply.code(200).send(createManagedUserResponse(database, realtimeService, userId));
    });

    configuredApp.post("/api/users/:id/force-mute", async (request, reply) => {
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

      if (!database.getUser(userId)) {
        return reply.code(404).send(createFailureResponse("User not found."));
      }

      await realtimeService.forceMuteUser(userId);

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

    return configuredApp;
  };

  if (options.config.tls) {
    return configureApp(
      Fastify<HttpsServer>({
        https: {
          cert: readFileSync(options.config.tls.certPath),
          key: readFileSync(options.config.tls.keyPath),
        },
        logger: false,
      }),
    );
  }

  return configureApp(
    Fastify<HttpServer>({
      logger: false,
    }),
  );
}
