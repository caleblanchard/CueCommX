import { describe, expect, it } from "vitest";

import {
  AdminDashboardSnapshotSchema,
  ChannelMutationResponseSchema,
  ChannelsListResponseSchema,
  CreateChannelRequestSchema,
  CreateUserRequestSchema,
  DiscoveryResponseSchema,
  LoginResponseSchema,
  MediaCapabilitiesMessageSchema,
  MediaCapabilitiesRequestMessageSchema,
  MediaConsumerAvailableMessageSchema,
  ManagedUserSchema,
  OperatorStateSchema,
  PROTOCOL_VERSION,
  SetupAdminRequestSchema,
  StatusResponseSchema,
  UpdateChannelRequestSchema,
  UpdateUserRequestSchema,
  UsersListResponseSchema,
  parseClientSignalingMessage,
  parseServerSignalingMessage,
  parseSignalingMessage,
} from "../src/index.js";

const sampleRouterRtpCapabilities = {
  codecs: [
    {
      kind: "audio" as const,
      mimeType: "audio/opus",
      clockRate: 48_000,
      channels: 1,
      preferredPayloadType: 111,
      parameters: {
        useinbandfec: 1,
      },
      rtcpFeedback: [{ type: "transport-cc" }],
    },
  ],
  headerExtensions: [
    {
      kind: "audio" as const,
      preferredEncrypt: false,
      preferredId: 1,
      uri: "urn:ietf:params:rtp-hdrext:sdes:mid",
    },
  ],
};

const sampleRtpParameters = {
  codecs: [
    {
      mimeType: "audio/opus",
      payloadType: 111,
      clockRate: 48_000,
      channels: 1,
      parameters: {
        minptime: 10,
        useinbandfec: 1,
      },
      rtcpFeedback: [{ type: "transport-cc" }],
    },
  ],
  encodings: [
    {
      ssrc: 123_456,
      dtx: true,
      maxBitrate: 64_000,
    },
  ],
  headerExtensions: [
    {
      id: 1,
      uri: "urn:ietf:params:rtp-hdrext:sdes:mid",
      encrypt: false,
    },
  ],
  mid: "0",
  rtcp: {
    cname: "cuecommx",
    mux: true,
    reducedSize: true,
  },
};

describe("parseSignalingMessage", () => {
  it("accepts a valid auth request", () => {
    const message = parseSignalingMessage({
      type: "auth",
      payload: {
        username: "Chuck",
      },
    });

    expect(message.type).toBe("auth");
  });

  it("rejects an auth request without a username", () => {
    expect(() =>
      parseSignalingMessage({
        type: "auth",
        payload: {
          username: "",
        },
      }),
    ).toThrowError();
  });

  it("accepts a listen toggle request", () => {
    const message = parseSignalingMessage({
      type: "listen:toggle",
      payload: {
        channelId: "ch-production",
        listening: true,
      },
    });

    expect(message.type).toBe("listen:toggle");
  });

  it("accepts a session authenticate request", () => {
    const message = parseClientSignalingMessage({
      type: "session:authenticate",
      payload: {
        sessionToken: "sess-123",
      },
    });

    expect(message.type).toBe("session:authenticate");
  });

  it("accepts a server session-ready response", () => {
    const message = parseServerSignalingMessage({
      type: "session:ready",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        connectedUsers: 2,
        user: {
          id: "usr-1",
          username: "Chuck",
          role: "operator",
          channelPermissions: [
            {
              channelId: "ch-production",
              canTalk: true,
              canListen: true,
            },
          ],
        },
        channels: [{ id: "ch-production", name: "Production", color: "#EF4444" }],
        operatorState: {
          talkChannelIds: [],
          listenChannelIds: ["ch-production"],
          talking: false,
        },
      },
    });

    expect(message.type).toBe("session:ready");
  });

  it("accepts a media transport-create request with requestId correlation", () => {
    const message = parseClientSignalingMessage({
      type: "media:transport:create",
      payload: {
        requestId: "req-transport-send",
        direction: "send",
      },
    });

    expect(message.type).toBe("media:transport:create");
  });

  it("accepts a media consumer-available server event", () => {
    const message = parseServerSignalingMessage({
      type: "media:consumer:available",
      payload: {
        consumerId: "consumer-1",
        producerId: "producer-1",
        producerUserId: "usr-2",
        producerUsername: "Audio",
        kind: "audio",
        activeChannelIds: ["ch-audio"],
        rtpParameters: sampleRtpParameters,
      },
    });

    expect(message.type).toBe("media:consumer:available");
  });
});

describe("StatusResponseSchema", () => {
  it("accepts the MVP status response shape", () => {
    const response = StatusResponseSchema.parse({
      name: "Main Church",
      version: "0.1.0",
      uptime: 12,
      connectedUsers: 0,
      maxUsers: 30,
      channels: 5,
      needsAdminSetup: true,
      protocolVersion: PROTOCOL_VERSION,
    });

    expect(response.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});

describe("discovery API schemas", () => {
  it("accepts discovery targets for QR and manual connect handoff", () => {
    const response = DiscoveryResponseSchema.parse({
      announcedHost: "10.0.0.25",
      detectedInterfaces: [
        {
          address: "10.0.0.25",
          name: "en0",
          url: "http://10.0.0.25:3000/",
        },
      ],
      mdns: {
        enabled: true,
        name: "Main Church",
        port: 3000,
        protocol: "tcp",
        serviceType: "_cuecommx._tcp",
      },
      primaryUrl: "http://10.0.0.25:3000/",
      primaryTargetId: "announced-10.0.0.25",
      connectTargets: [
        {
          id: "announced-10.0.0.25",
          kind: "announced",
          label: "Primary LAN URL",
          url: "http://10.0.0.25:3000/",
        },
        {
          id: "loopback-localhost",
          kind: "loopback",
          label: "This machine only",
          url: "http://localhost:3000/",
        },
      ],
    });

    expect(response.primaryUrl).toBe("http://10.0.0.25:3000/");
    expect(response.mdns?.serviceType).toBe("_cuecommx._tcp");
    expect(response.connectTargets).toHaveLength(2);
  });
});

describe("media negotiation schemas", () => {
  it("accepts router RTP capabilities for mediasoup negotiation", () => {
    const message = MediaCapabilitiesMessageSchema.parse({
      type: "media:capabilities",
      payload: {
        requestId: "req-capabilities",
        routerRtpCapabilities: sampleRouterRtpCapabilities,
      },
    });

    expect(message.payload.routerRtpCapabilities.codecs[0]?.mimeType).toBe("audio/opus");
  });

  it("rejects blank media request ids", () => {
    expect(() =>
      MediaCapabilitiesRequestMessageSchema.parse({
        type: "media:capabilities:get",
        payload: {
          requestId: "   ",
        },
      }),
    ).toThrowError();
  });

  it("accepts consumer-ready payloads for remote talkers", () => {
    const message = MediaConsumerAvailableMessageSchema.parse({
      type: "media:consumer:available",
      payload: {
        consumerId: "consumer-2",
        producerId: "producer-2",
        producerUserId: "usr-camera",
        producerUsername: "Camera 1",
        kind: "audio",
        activeChannelIds: ["ch-production", "ch-audio"],
        rtpParameters: sampleRtpParameters,
      },
    });

    expect(message.payload.activeChannelIds).toEqual(["ch-production", "ch-audio"]);
  });
});

describe("auth API schemas", () => {
  it("normalizes setup-admin credentials", () => {
    const request = SetupAdminRequestSchema.parse({
      username: "  Chuck  ",
      pin: " 1234 ",
    });

    expect(request).toEqual({
      username: "Chuck",
      pin: "1234",
    });
  });

  it("accepts a successful login response", () => {
    const response = LoginResponseSchema.parse({
      success: true,
      protocolVersion: PROTOCOL_VERSION,
      sessionToken: "sess-123",
      user: {
        id: "usr-1",
        username: "Chuck",
        role: "admin",
        channelPermissions: [
          {
            channelId: "ch-production",
            canTalk: true,
            canListen: true,
          },
        ],
      },
      channels: [{ id: "ch-production", name: "Production", color: "#EF4444" }],
    });

    expect(response.success).toBe(true);
  });

  it("rejects a failed login response without an error message", () => {
    expect(() =>
      LoginResponseSchema.parse({
        success: false,
        protocolVersion: PROTOCOL_VERSION,
      }),
    ).toThrowError();
  });
});

describe("OperatorStateSchema", () => {
  it("accepts a valid operator state payload", () => {
    const state = OperatorStateSchema.parse({
      talkChannelIds: ["ch-production"],
      listenChannelIds: ["ch-production", "ch-audio"],
      talking: true,
    });

    expect(state.talking).toBe(true);
  });
});

describe("user management schemas", () => {
  it("accepts a create-user request with trimmed credentials", () => {
    const request = CreateUserRequestSchema.parse({
      username: "  Camera 1 ",
      role: "operator",
      pin: " 4321 ",
      channelPermissions: [
        {
          channelId: "ch-video",
          canTalk: true,
          canListen: true,
        },
      ],
    });

    expect(request).toEqual({
      username: "Camera 1",
      role: "operator",
      pin: "4321",
      channelPermissions: [
        {
          channelId: "ch-video",
          canTalk: true,
          canListen: true,
        },
      ],
    });
  });

  it("rejects update requests that try to set and clear a pin simultaneously", () => {
    expect(() =>
      UpdateUserRequestSchema.parse({
        username: "A2",
        role: "operator",
        pin: "1234",
        clearPin: true,
        channelPermissions: [],
      }),
    ).toThrowError();
  });

  it("accepts a managed user list response", () => {
    const users = UsersListResponseSchema.parse([
      {
        id: "usr-1",
        username: "Chuck",
        role: "admin",
        online: true,
        channelPermissions: [
          {
            channelId: "ch-production",
            canTalk: true,
            canListen: true,
          },
        ],
      },
    ]);

    expect(users[0]).toEqual(
      ManagedUserSchema.parse({
        id: "usr-1",
        username: "Chuck",
        role: "admin",
        online: true,
        channelPermissions: [
          {
            channelId: "ch-production",
            canTalk: true,
            canListen: true,
          },
        ],
      }),
    );
  });
});

describe("channel management schemas", () => {
  it("accepts a create-channel request with trimmed values", () => {
    const request = CreateChannelRequestSchema.parse({
      name: "  Front of House  ",
      color: " #22C55E ",
    });

    expect(request).toEqual({
      name: "Front of House",
      color: "#22C55E",
    });
  });

  it("rejects an invalid channel color", () => {
    expect(() =>
      UpdateChannelRequestSchema.parse({
        name: "Lighting",
        color: "green",
      }),
    ).toThrowError();
  });

  it("accepts channel list and mutation responses", () => {
    const channels = ChannelsListResponseSchema.parse([
      {
        id: "ch-production",
        name: "Production",
        color: "#EF4444",
      },
      {
        id: "ch-foh",
        name: "Front of House",
        color: "#22C55E",
      },
    ]);

    expect(channels).toHaveLength(2);
    expect(
      ChannelMutationResponseSchema.parse({
        id: "ch-foh",
        name: "Front of House",
        color: "#22C55E",
      }),
    ).toMatchObject({
      id: "ch-foh",
      name: "Front of House",
      color: "#22C55E",
    });
  });
});

describe("admin monitoring schemas", () => {
  it("accepts a live admin dashboard snapshot", () => {
    const snapshot = AdminDashboardSnapshotSchema.parse({
      channels: [
        {
          id: "ch-production",
          name: "Production",
          color: "#EF4444",
        },
      ],
      users: [
        {
          id: "usr-1",
          username: "Chuck",
          role: "admin",
          online: true,
          talking: true,
          activeTalkChannelIds: ["ch-production"],
          channelPermissions: [
            {
              channelId: "ch-production",
              canTalk: true,
              canListen: true,
            },
          ],
        },
      ],
    });

    expect(snapshot.users[0]?.activeTalkChannelIds).toEqual(["ch-production"]);
  });

  it("accepts an admin dashboard realtime message", () => {
    const message = parseServerSignalingMessage({
      type: "admin:dashboard",
      payload: {
        channels: [
          {
            id: "ch-production",
            name: "Production",
            color: "#EF4444",
          },
        ],
        users: [
          {
            id: "usr-1",
            username: "Chuck",
            role: "admin",
            online: true,
            talking: false,
            activeTalkChannelIds: [],
            channelPermissions: [],
          },
        ],
      },
    });

    expect(message.type).toBe("admin:dashboard");
  });

  it("accepts a quality:report client message", () => {
    const message = parseClientSignalingMessage({
      type: "quality:report",
      payload: {
        grade: "good",
        roundTripTimeMs: 45,
        packetLossPercent: 0.3,
        jitterMs: 8,
      },
    });

    expect(message.type).toBe("quality:report");
  });

  it("accepts a preflight:result client message", () => {
    const message = parseClientSignalingMessage({
      type: "preflight:result",
      payload: {
        status: "passed",
      },
    });

    expect(message.type).toBe("preflight:result");
  });

  it("accepts admin dashboard with quality and preflight fields", () => {
    const message = parseServerSignalingMessage({
      type: "admin:dashboard",
      payload: {
        channels: [],
        users: [
          {
            id: "usr-1",
            username: "Alice",
            role: "operator",
            online: true,
            talking: false,
            activeTalkChannelIds: [],
            channelPermissions: [],
            connectionQuality: {
              grade: "excellent",
              roundTripTimeMs: 12,
              packetLossPercent: 0,
              jitterMs: 2,
            },
            preflightStatus: "passed",
          },
        ],
      },
    });

    expect(message.type).toBe("admin:dashboard");
    if (message.type === "admin:dashboard") {
      expect(message.payload.users[0]?.connectionQuality?.grade).toBe("excellent");
      expect(message.payload.users[0]?.preflightStatus).toBe("passed");
    }
  });
});
