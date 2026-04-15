import { describe, expect, it } from "vitest";

import { buildDesiredMediaRoutes } from "../src/media/routes.js";

describe("buildDesiredMediaRoutes", () => {
  it("creates listener-to-speaker routes for intersecting talk/listen channels", () => {
    const routes = buildDesiredMediaRoutes([
      {
        sessionToken: "sess-listener",
        userId: "usr-listener",
        listenChannelIds: ["ch-audio", "ch-production"],
        talkChannelIds: [],
        hasProducer: false,
        hasRecvTransport: true,
      },
      {
        sessionToken: "sess-speaker",
        userId: "usr-speaker",
        listenChannelIds: ["ch-audio"],
        talkChannelIds: ["ch-production", "ch-video"],
        hasProducer: true,
        hasRecvTransport: true,
      },
    ]);

    expect(routes).toEqual([
      {
        activeChannelIds: ["ch-production"],
        listenerSessionToken: "sess-listener",
        producerSessionToken: "sess-speaker",
        producerUserId: "usr-speaker",
      },
    ]);
  });

  it("skips self-monitor routes for the same user across sessions", () => {
    const routes = buildDesiredMediaRoutes([
      {
        sessionToken: "sess-1",
        userId: "usr-1",
        listenChannelIds: ["ch-production"],
        talkChannelIds: [],
        hasProducer: false,
        hasRecvTransport: true,
      },
      {
        sessionToken: "sess-2",
        userId: "usr-1",
        listenChannelIds: [],
        talkChannelIds: ["ch-production"],
        hasProducer: true,
        hasRecvTransport: true,
      },
    ]);

    expect(routes).toEqual([]);
  });

  it("requires both a listener recv transport and a remote producer", () => {
    const routes = buildDesiredMediaRoutes([
      {
        sessionToken: "sess-listener",
        userId: "usr-listener",
        listenChannelIds: ["ch-production"],
        talkChannelIds: [],
        hasProducer: false,
        hasRecvTransport: false,
      },
      {
        sessionToken: "sess-speaker",
        userId: "usr-speaker",
        listenChannelIds: [],
        talkChannelIds: ["ch-production"],
        hasProducer: false,
        hasRecvTransport: true,
      },
    ]);

    expect(routes).toEqual([]);
  });

  it("sorts routes by listener and producer session tokens for deterministic reconciliation", () => {
    const routes = buildDesiredMediaRoutes([
      {
        sessionToken: "sess-b",
        userId: "usr-b",
        listenChannelIds: ["ch-production"],
        talkChannelIds: [],
        hasProducer: false,
        hasRecvTransport: true,
      },
      {
        sessionToken: "sess-a",
        userId: "usr-a",
        listenChannelIds: [],
        talkChannelIds: ["ch-production"],
        hasProducer: true,
        hasRecvTransport: true,
      },
      {
        sessionToken: "sess-c",
        userId: "usr-c",
        listenChannelIds: ["ch-production"],
        talkChannelIds: [],
        hasProducer: false,
        hasRecvTransport: true,
      },
    ]);

    expect(routes).toEqual([
      {
        activeChannelIds: ["ch-production"],
        listenerSessionToken: "sess-b",
        producerSessionToken: "sess-a",
        producerUserId: "usr-a",
      },
      {
        activeChannelIds: ["ch-production"],
        listenerSessionToken: "sess-c",
        producerSessionToken: "sess-a",
        producerUserId: "usr-a",
      },
    ]);
  });
});
