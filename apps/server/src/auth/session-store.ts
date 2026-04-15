import { randomUUID } from "node:crypto";

export interface SessionRecord {
  createdAt: number;
  token: string;
  userId: string;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  createSession(userId: string): SessionRecord {
    const session: SessionRecord = {
      createdAt: Date.now(),
      token: `sess-${randomUUID()}`,
      userId,
    };

    this.sessions.set(session.token, session);

    return session;
  }

  count(): number {
    return this.sessions.size;
  }

  get(token: string): SessionRecord | undefined {
    return this.sessions.get(token);
  }
}
