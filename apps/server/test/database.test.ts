import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DatabaseService } from "../src/db/database.js";

describe("DatabaseService", () => {
  let workingDirectory: string;
  let database: DatabaseService;

  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), "cuecommx-db-"));
    database = new DatabaseService({
      dbPath: join(workingDirectory, "cuecommx.db"),
    });
  });

  afterEach(() => {
    database.close();
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  it("seeds the default house-of-worship channels", () => {
    expect(database.getChannelCount()).toBe(5);
    expect(database.listChannels().map((channel) => channel.name)).toEqual([
      "Production",
      "Audio",
      "Video/Camera",
      "Lighting",
      "Stage",
    ]);
  });

  it("detects whether an admin account exists", () => {
    expect(database.hasAdminUser()).toBe(false);

    database.createUser({
      username: "Chuck",
      role: "admin",
    });

    expect(database.hasAdminUser()).toBe(true);
  });

  it("finds and enforces usernames case-insensitively", () => {
    database.createUser({
      username: "Chuck",
      role: "admin",
    });

    expect(database.findUserByUsername("chuck")).toMatchObject({
      username: "Chuck",
    });
    expect(() =>
      database.createUser({
        username: "CHUCK",
        role: "operator",
      }),
    ).toThrow();
  });

  it("returns user permissions and assigned channels", () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
    });

    database.grantChannelPermissions(userId, [
      {
        channelId: "ch-production",
        canTalk: true,
        canListen: true,
      },
      {
        channelId: "ch-stage",
        canTalk: false,
        canListen: true,
      },
    ]);

    expect(database.getUser(userId)).toMatchObject({
      username: "A2",
      role: "operator",
      channelPermissions: [
        {
          channelId: "ch-production",
          canTalk: true,
          canListen: true,
        },
        {
          channelId: "ch-stage",
          canTalk: false,
          canListen: true,
        },
      ],
    });
    expect(database.listAssignedChannels(userId).map((channel) => channel.name)).toEqual([
      "Production",
      "Stage",
    ]);
  });

  it("lists, updates, replaces permissions, and deletes users", () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
    });
    database.replaceChannelPermissions(userId, [
      {
        channelId: "ch-audio",
        canTalk: false,
        canListen: true,
      },
    ]);

    expect(database.listUsers().map((user) => user.username)).toContain("A2");

    database.updateUser(userId, {
      username: "Camera 1",
      role: "user",
    });
    database.replaceChannelPermissions(userId, [
      {
        channelId: "ch-video",
        canTalk: true,
        canListen: true,
      },
    ]);

    expect(database.getUser(userId)).toMatchObject({
      username: "Camera 1",
      role: "user",
      channelPermissions: [
        {
          channelId: "ch-video",
          canTalk: true,
          canListen: true,
        },
      ],
    });

    database.deleteUser(userId);

    expect(database.getUser(userId)).toBeUndefined();
  });

  it("creates, updates, and deletes channels while cascading permissions", () => {
    const userId = database.createUser({
      username: "A2",
      role: "operator",
    });
    const createdChannel = database.createChannel({
      name: "Front of House",
      color: "#22C55E",
    });

    expect(createdChannel).toMatchObject({
      id: "ch-front-of-house",
      name: "Front of House",
      color: "#22C55E",
    });
    expect(database.getChannelCount()).toBe(6);
    expect(database.listChannels().at(-1)).toMatchObject({
      id: "ch-front-of-house",
      name: "Front of House",
      color: "#22C55E",
    });

    database.replaceChannelPermissions(userId, [
      {
        channelId: createdChannel.id,
        canTalk: true,
        canListen: true,
      },
    ]);
    database.updateChannel(createdChannel.id, {
      name: "Broadcast",
      color: "#0EA5E9",
    });

    expect(database.getChannel(createdChannel.id)).toMatchObject({
      id: "ch-front-of-house",
      name: "Broadcast",
      color: "#0EA5E9",
    });
    expect(database.getUser(userId)).toMatchObject({
      channelPermissions: [
        {
          channelId: "ch-front-of-house",
          canTalk: true,
          canListen: true,
        },
      ],
    });

    database.deleteChannel(createdChannel.id);

    expect(database.getChannel(createdChannel.id)).toBeUndefined();
    expect(database.getChannelCount()).toBe(5);
    expect(database.getUser(userId)).toMatchObject({
      channelPermissions: [],
    });
  });

  it("stores operator preferences and supports group assignment workflows", () => {
    const userId = database.createUser({
      username: "Stage Manager",
      role: "operator",
    });

    expect(database.getUserPreferences(userId)).toEqual({});

    database.saveUserPreferences(userId, {
      audioInputId: "mic-2",
      monitorVolume: 72,
    });

    expect(database.getUserPreferences(userId)).toEqual({
      audioInputId: "mic-2",
      monitorVolume: 72,
    });

    const group = database.createGroup({
      name: "Weekend Team",
      channelIds: ["ch-production", "ch-stage"],
    });

    expect(database.findGroupByName("weekend team")).toEqual(group);
    expect(database.listGroups()).toEqual([group]);

    database.replaceUserGroups(userId, [group.id]);
    expect(database.getUserGroupIds(userId)).toEqual([group.id]);

    database.updateGroup(group.id, {
      name: "Weekend Broadcast",
      channelIds: ["ch-audio", "ch-video"],
    });

    expect(database.getGroup(group.id)).toEqual({
      id: group.id,
      name: "Weekend Broadcast",
      channelIds: ["ch-audio", "ch-video"],
    });

    database.deleteGroup(group.id);

    expect(database.getGroup(group.id)).toBeUndefined();
    expect(database.getUserGroupIds(userId)).toEqual([]);
  });

  it("filters and prunes the event log", () => {
    const userId = database.createUser({
      username: "Chuck",
      role: "admin",
    });

    database.logEvent({
      event_type: "session.started",
      user_id: userId,
      username: "Chuck",
      severity: "info",
    });
    database.logEvent({
      event_type: "session.error",
      user_id: userId,
      username: "Chuck",
      severity: "error",
      details: "Talk transport dropped",
    });

    database.connection
      .prepare(
        `
          INSERT INTO event_log (timestamp, event_type, user_id, username, severity)
          VALUES (datetime('now', '-10 days'), 'session.old', ?, 'Chuck', 'warn')
        `,
      )
      .run(userId);

    expect(
      database.getEventLog({
        severity: "error",
      }),
    ).toEqual([
      expect.objectContaining({
        event_type: "session.error",
        severity: "error",
        user_id: userId,
      }),
    ]);

    expect(database.pruneEventLog(5)).toBe(1);
    expect(
      database
        .getEventLog({
          limit: 10,
        })
        .map((entry) => entry.event_type),
    ).not.toContain("session.old");
  });

  it("upgrades a legacy channels table before seeding priority-aware defaults", () => {
    database.close();

    const dbPath = join(workingDirectory, "cuecommx-legacy.db");
    const legacyConnection = new Database(dbPath);
    legacyConnection.exec(`
      CREATE TABLE channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#3B82F6',
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO channels (id, name, color, sort_order)
      VALUES ('ch-production', 'Production', '#EF4444', 1);
    `);
    legacyConnection.close();

    database = new DatabaseService({ dbPath });

    expect(database.listChannels()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ch-production",
          name: "Production",
          priority: 8,
        }),
        expect.objectContaining({
          id: "ch-audio",
          name: "Audio",
          priority: 5,
        }),
      ]),
    );
    expect(database.getChannelCount()).toBe(5);
  });
});
