import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import Database from "better-sqlite3";

import type {
  ChannelInfo,
  ChannelPermission,
  GroupInfo,
  UserInfo,
  UserRole,
} from "@cuecommx/protocol";

export interface DatabaseOptions {
  dbPath: string;
}

interface UserRow {
  id: string;
  pinHash: string | null;
  role: UserRole;
  username: string;
}

interface UsernameConflictRow {
  normalizedUsername: string;
  usernames: string;
}

function toChannelSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || randomUUID().slice(0, 8);
}

export class DatabaseService {
  readonly connection: Database.Database;

  constructor(private readonly options: DatabaseOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.connection = new Database(options.dbPath);
    this.connection.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.connection.close();
  }

  getChannelCount(): number {
    const row = this.connection.prepare("SELECT COUNT(*) as count FROM channels").get() as {
      count: number;
    };

    return row.count;
  }

  listChannels(): ChannelInfo[] {
    const rows = this.connection
      .prepare("SELECT id, name, color, COALESCE(is_global, 0) as isGlobal FROM channels ORDER BY sort_order ASC, name ASC")
      .all() as Array<{ id: string; name: string; color: string; isGlobal: number }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      isGlobal: row.isGlobal === 1,
    }));
  }

  getChannel(channelId: string): ChannelInfo | undefined {
    const row = this.connection
      .prepare(
        `
          SELECT id, name, color, COALESCE(is_global, 0) as isGlobal
          FROM channels
          WHERE id = ?
        `,
      )
      .get(channelId) as { id: string; name: string; color: string; isGlobal: number } | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      name: row.name,
      color: row.color,
      isGlobal: row.isGlobal === 1,
    };
  }

  findChannelByName(name: string): ChannelInfo | undefined {
    const row = this.connection
      .prepare(
        `
          SELECT id, name, color, COALESCE(is_global, 0) as isGlobal
          FROM channels
          WHERE lower(name) = lower(?)
        `,
      )
      .get(name) as { id: string; name: string; color: string; isGlobal: number } | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      name: row.name,
      color: row.color,
      isGlobal: row.isGlobal === 1,
    };
  }

  hasAdminUser(): boolean {
    const row = this.connection
      .prepare("SELECT EXISTS(SELECT 1 FROM users WHERE role = 'admin') as has_admin")
      .get() as { has_admin: 0 | 1 };

    return row.has_admin === 1;
  }

  countAdminUsers(): number {
    const row = this.connection
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
      .get() as { count: number };

    return row.count;
  }

  createUser(input: { username: string; role: UserRole; pinHash?: string }): string {
    const userId = `usr-${randomUUID()}`;

    this.connection
      .prepare(
        `
          INSERT INTO users (id, username, pin_hash, role)
          VALUES (@id, @username, @pinHash, @role)
        `,
      )
      .run({
        id: userId,
        username: input.username,
        pinHash: input.pinHash ?? null,
        role: input.role,
      });

    return userId;
  }

  findUserByUsername(username: string): UserRow | undefined {
    const row = this.connection
      .prepare(
        `
          SELECT id, username, role, pin_hash as pinHash
          FROM users
          WHERE username = ? COLLATE NOCASE
          ORDER BY username COLLATE NOCASE ASC
          LIMIT 1
        `,
      )
      .get(username) as UserRow | undefined;

    return row;
  }

  getUser(userId: string): UserInfo | undefined {
    const row = this.connection
      .prepare(
        `
          SELECT id, username, role
          FROM users
          WHERE id = ?
        `,
      )
      .get(userId) as Omit<UserInfo, "channelPermissions"> | undefined;

    if (!row) {
      return undefined;
    }

    return {
      ...row,
      channelPermissions: this.listUserChannelPermissions(userId),
    };
  }

  listUsers(): UserInfo[] {
    const rows = this.connection
      .prepare(
        `
          SELECT id
          FROM users
          ORDER BY username COLLATE NOCASE ASC
        `,
      )
      .all() as Array<{ id: string }>;

    return rows
      .map((row) => this.getUser(row.id))
      .filter((user): user is UserInfo => Boolean(user));
  }

  createChannel(input: { color: string; name: string; isGlobal?: boolean }): ChannelInfo {
    const baseChannelId = `ch-${toChannelSlug(input.name)}`;
    let channelId = baseChannelId;
    let suffix = 2;

    while (this.getChannel(channelId)) {
      channelId = `${baseChannelId}-${suffix}`;
      suffix += 1;
    }

    const row = this.connection
      .prepare("SELECT COALESCE(MAX(sort_order), 0) as maxSortOrder FROM channels")
      .get() as { maxSortOrder: number };

    this.connection
      .prepare(
        `
          INSERT INTO channels (id, name, color, sort_order, is_global)
          VALUES (@id, @name, @color, @sortOrder, @isGlobal)
        `,
      )
      .run({
        id: channelId,
        name: input.name,
        color: input.color,
        sortOrder: row.maxSortOrder + 1,
        isGlobal: input.isGlobal ? 1 : 0,
      });

    const channel = this.getChannel(channelId);

    if (!channel) {
      throw new Error(`Created channel ${channelId} was not found.`);
    }

    return channel;
  }

  grantChannelPermissions(userId: string, permissions: ChannelPermission[]): void {
    const statement = this.connection.prepare(
      `
        INSERT INTO channel_permissions (user_id, channel_id, can_talk, can_listen)
        VALUES (@userId, @channelId, @canTalk, @canListen)
        ON CONFLICT(user_id, channel_id) DO UPDATE SET
          can_talk = excluded.can_talk,
          can_listen = excluded.can_listen
      `,
    );

    const transaction = this.connection.transaction((items: ChannelPermission[]) => {
      for (const permission of items) {
        statement.run({
          userId,
          channelId: permission.channelId,
          canTalk: permission.canTalk ? 1 : 0,
          canListen: permission.canListen ? 1 : 0,
        });
      }
    });

    transaction(permissions);
  }

  listAssignedChannels(userId: string): ChannelInfo[] {
    const rows = this.connection
      .prepare(
        `
          SELECT DISTINCT channels.id, channels.name, channels.color,
                 COALESCE(channels.is_global, 0) as isGlobal
          FROM channels
          INNER JOIN channel_permissions
            ON channel_permissions.channel_id = channels.id
          WHERE channel_permissions.user_id = ?
            AND (channel_permissions.can_talk = 1 OR channel_permissions.can_listen = 1)
          ORDER BY channels.sort_order ASC, channels.name ASC
        `,
      )
      .all(userId) as Array<{ id: string; name: string; color: string; isGlobal: number }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      isGlobal: row.isGlobal === 1,
    }));
  }

  replaceChannelPermissions(userId: string, permissions: ChannelPermission[]): void {
    const deleteStatement = this.connection.prepare(
      `
        DELETE FROM channel_permissions
        WHERE user_id = ?
      `,
    );
    const insertStatement = this.connection.prepare(
      `
        INSERT INTO channel_permissions (user_id, channel_id, can_talk, can_listen)
        VALUES (@userId, @channelId, @canTalk, @canListen)
      `,
    );

    const transaction = this.connection.transaction((items: ChannelPermission[]) => {
      deleteStatement.run(userId);

      for (const permission of items) {
        insertStatement.run({
          userId,
          channelId: permission.channelId,
          canTalk: permission.canTalk ? 1 : 0,
          canListen: permission.canListen ? 1 : 0,
        });
      }
    });

    transaction(permissions);
  }

  updateUser(
    userId: string,
    input: {
      pinHash?: string | null;
      role: UserRole;
      username: string;
    },
  ): void {
    if (input.pinHash === undefined) {
      this.connection
        .prepare(
          `
            UPDATE users
            SET username = @username,
                role = @role,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = @id
          `,
        )
        .run({
          id: userId,
          username: input.username,
          role: input.role,
        });

      return;
    }

    this.connection
      .prepare(
        `
          UPDATE users
          SET username = @username,
              role = @role,
              pin_hash = @pinHash,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = @id
        `,
      )
      .run({
        id: userId,
        username: input.username,
        role: input.role,
        pinHash: input.pinHash,
      });
  }

  updateChannel(
    channelId: string,
    input: {
      color: string;
      name: string;
      isGlobal?: boolean;
    },
  ): void {
    this.connection
      .prepare(
        `
          UPDATE channels
          SET name = @name,
              color = @color,
              is_global = @isGlobal
          WHERE id = @id
        `,
      )
      .run({
        id: channelId,
        name: input.name,
        color: input.color,
        isGlobal: input.isGlobal ? 1 : 0,
      });
  }

  deleteUser(userId: string): void {
    this.connection
      .prepare(
        `
          DELETE FROM users
          WHERE id = ?
        `,
      )
      .run(userId);
  }

  deleteChannel(channelId: string): void {
    this.connection
      .prepare(
        `
          DELETE FROM channels
          WHERE id = ?
        `,
      )
      .run(channelId);
  }

  // --- Group CRUD ---

  listGroups(): GroupInfo[] {
    const rows = this.connection
      .prepare("SELECT id, name FROM groups ORDER BY sort_order ASC, name ASC")
      .all() as Array<{ id: string; name: string }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      channelIds: this.getGroupChannelIds(row.id),
    }));
  }

  getGroup(groupId: string): GroupInfo | undefined {
    const row = this.connection
      .prepare("SELECT id, name FROM groups WHERE id = ?")
      .get(groupId) as { id: string; name: string } | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      name: row.name,
      channelIds: this.getGroupChannelIds(row.id),
    };
  }

  findGroupByName(name: string): GroupInfo | undefined {
    const row = this.connection
      .prepare("SELECT id, name FROM groups WHERE lower(name) = lower(?)")
      .get(name) as { id: string; name: string } | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      name: row.name,
      channelIds: this.getGroupChannelIds(row.id),
    };
  }

  createGroup(input: { name: string; channelIds: string[] }): GroupInfo {
    const groupId = `grp-${randomUUID()}`;

    const row = this.connection
      .prepare("SELECT COALESCE(MAX(sort_order), 0) as maxSortOrder FROM groups")
      .get() as { maxSortOrder: number };

    this.connection
      .prepare("INSERT INTO groups (id, name, sort_order) VALUES (@id, @name, @sortOrder)")
      .run({ id: groupId, name: input.name, sortOrder: row.maxSortOrder + 1 });

    this.replaceGroupChannels(groupId, input.channelIds);

    return this.getGroup(groupId)!;
  }

  updateGroup(groupId: string, input: { name: string; channelIds: string[] }): void {
    this.connection
      .prepare("UPDATE groups SET name = @name WHERE id = @id")
      .run({ id: groupId, name: input.name });

    this.replaceGroupChannels(groupId, input.channelIds);
  }

  deleteGroup(groupId: string): void {
    this.connection.prepare("DELETE FROM groups WHERE id = ?").run(groupId);
  }

  // --- User-Group assignment ---

  getUserGroupIds(userId: string): string[] {
    const rows = this.connection
      .prepare("SELECT group_id FROM user_groups WHERE user_id = ? ORDER BY group_id ASC")
      .all(userId) as Array<{ group_id: string }>;

    return rows.map((row) => row.group_id);
  }

  replaceUserGroups(userId: string, groupIds: string[]): void {
    const deleteStatement = this.connection.prepare("DELETE FROM user_groups WHERE user_id = ?");
    const insertStatement = this.connection.prepare(
      "INSERT INTO user_groups (user_id, group_id) VALUES (@userId, @groupId)",
    );

    const transaction = this.connection.transaction((items: string[]) => {
      deleteStatement.run(userId);

      for (const groupId of items) {
        insertStatement.run({ userId, groupId });
      }
    });

    transaction(groupIds);
  }

  private getGroupChannelIds(groupId: string): string[] {
    const rows = this.connection
      .prepare("SELECT channel_id FROM group_channels WHERE group_id = ? ORDER BY channel_id ASC")
      .all(groupId) as Array<{ channel_id: string }>;

    return rows.map((row) => row.channel_id);
  }

  private replaceGroupChannels(groupId: string, channelIds: string[]): void {
    const deleteStatement = this.connection.prepare("DELETE FROM group_channels WHERE group_id = ?");
    const insertStatement = this.connection.prepare(
      "INSERT INTO group_channels (group_id, channel_id) VALUES (@groupId, @channelId)",
    );

    const transaction = this.connection.transaction((items: string[]) => {
      deleteStatement.run(groupId);

      for (const channelId of items) {
        insertStatement.run({ groupId, channelId });
      }
    });

    transaction(channelIds);
  }

  private listUserChannelPermissions(userId: string): ChannelPermission[] {
    const rows = this.connection
      .prepare(
        `
          SELECT channel_id as channelId, can_talk as canTalk, can_listen as canListen
          FROM channel_permissions
          WHERE user_id = ?
          ORDER BY channel_id ASC
        `,
      )
      .all(userId) as Array<{
      canListen: 0 | 1;
      canTalk: 0 | 1;
      channelId: string;
    }>;

    return rows.map((row) => ({
      channelId: row.channelId,
      canTalk: row.canTalk === 1,
      canListen: row.canListen === 1,
    }));
  }

  private migrate(): void {
    const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
    this.connection.exec(schema);

    // Safe migration: add is_global column if it doesn't exist yet
    const columns = this.connection.pragma("table_info(channels)") as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "is_global")) {
      this.connection.exec("ALTER TABLE channels ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT 0");
    }

    this.ensureCaseInsensitiveUsernameUniqueness();
    this.connection.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS users_username_nocase_idx ON users(username COLLATE NOCASE)",
    );
  }

  private ensureCaseInsensitiveUsernameUniqueness(): void {
    const conflicts = this.connection
      .prepare(
        `
          SELECT lower(username) as normalizedUsername,
                 group_concat(username, ', ') as usernames
          FROM users
          GROUP BY lower(username)
          HAVING COUNT(*) > 1
          ORDER BY normalizedUsername ASC
        `,
      )
      .all() as UsernameConflictRow[];

    if (conflicts.length === 0) {
      return;
    }

    const examples = conflicts
      .slice(0, 3)
      .map((conflict) => conflict.usernames)
      .join("; ");

    throw new Error(
      `CueCommX found usernames that differ only by letter case. Rename the conflicting users before continuing: ${examples}.`,
    );
  }
}
