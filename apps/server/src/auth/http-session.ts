import type { FastifyReply, FastifyRequest } from "fastify";

import { AuthFailureResponseSchema, PROTOCOL_VERSION, type UserInfo } from "@cuecommx/protocol";

import { DatabaseService } from "../db/database.js";
import { SessionStore } from "./session-store.js";

export interface SessionContext {
  sessionToken: string;
  user: UserInfo;
}

export function createFailureResponse(error: string) {
  return AuthFailureResponseSchema.parse({
    success: false,
    protocolVersion: PROTOCOL_VERSION,
    error,
  });
}

function getBearerToken(authorization: FastifyRequest["headers"]["authorization"]): string | undefined {
  if (typeof authorization !== "string") {
    return undefined;
  }

  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return undefined;
  }

  return token;
}

export function requireAdminSession(
  request: FastifyRequest,
  reply: FastifyReply,
  database: DatabaseService,
  sessionStore: SessionStore,
): SessionContext | undefined {
  const sessionToken = getBearerToken(request.headers.authorization);

  if (!sessionToken) {
    void reply.code(401).send(createFailureResponse("Bearer session token is required."));
    return undefined;
  }

  const session = sessionStore.get(sessionToken);

  if (!session) {
    void reply.code(401).send(createFailureResponse("Session token is invalid or expired."));
    return undefined;
  }

  const user = database.getUser(session.userId);

  if (!user) {
    void reply.code(401).send(createFailureResponse("Session user was not found."));
    return undefined;
  }

  if (user.role !== "admin") {
    void reply.code(403).send(createFailureResponse("Admin access is required."));
    return undefined;
  }

  return {
    sessionToken,
    user,
  };
}
