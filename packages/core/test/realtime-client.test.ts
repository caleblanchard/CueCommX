import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CueCommXRealtimeClient, buildRealtimeWebSocketUrl } from "../src/index.js";

type EventMap = Record<string, Array<(event: any) => void>>;

class FakeWebSocket {
  static readonly CLOSED = 3;
  static readonly OPEN = 1;

  readonly listeners: EventMap = {};

  readyState = 0;

  readonly sent: string[] = [];

  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  emit(type: string, event: any): void {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", { type: "open" });
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((entry) => entry !== listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

describe("buildRealtimeWebSocketUrl", () => {
  it("converts HTTP origins to WebSocket URLs", () => {
    expect(buildRealtimeWebSocketUrl("http://127.0.0.1:3000")).toBe("ws://127.0.0.1:3000/ws");
    expect(buildRealtimeWebSocketUrl("https://cuecommx.local/app", "/signal")).toBe(
      "wss://cuecommx.local/signal",
    );
  });
});

describe("CueCommXRealtimeClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("authenticates and forwards parsed server messages", () => {
    const socket = new FakeWebSocket();
    const messages: string[] = [];
    const states: string[] = [];

    const client = new CueCommXRealtimeClient({
      baseUrl: "http://127.0.0.1:3000",
      createWebSocket: () => socket as never,
      onConnectionStateChange: (state) => states.push(state),
      onMessage: (message) => messages.push(message.type),
      sessionToken: "sess-123",
    });

    client.connect();
    socket.open();
    socket.emit("message", {
      data: JSON.stringify({
        type: "presence:update",
        payload: {
          connectedUsers: 3,
        },
      }),
    });

    client.toggleListen("ch-production", true);
    client.startTalk(["ch-production"]);
    client.stopTalk(["ch-production"]);

    expect(states).toEqual(["connecting", "connected"]);
    expect(socket.sent.map((entry) => JSON.parse(entry))).toEqual([
      {
        type: "session:authenticate",
        payload: {
          sessionToken: "sess-123",
        },
      },
      {
        type: "listen:toggle",
        payload: {
          channelId: "ch-production",
          listening: true,
        },
      },
      {
        type: "talk:start",
        payload: {
          channelIds: ["ch-production"],
        },
      },
      {
        type: "talk:stop",
        payload: {
          channelIds: ["ch-production"],
        },
      },
    ]);
    expect(messages).toEqual(["presence:update"]);
  });

  it("reconnects with backoff after an unexpected close", () => {
    const sockets = [new FakeWebSocket(), new FakeWebSocket()];
    const states: string[] = [];
    let createCount = 0;

    const client = new CueCommXRealtimeClient({
      baseUrl: "http://127.0.0.1:3000",
      createWebSocket: () => sockets[createCount++] as never,
      onConnectionStateChange: (state) => states.push(state),
      reconnect: {
        baseDelayMs: 100,
        jitterMs: 0,
        maxDelayMs: 500,
      },
      sessionToken: "sess-123",
    });

    client.connect();
    sockets[0].open();
    sockets[0].emit("close", { type: "close" });

    expect(states).toEqual(["connecting", "connected", "reconnecting"]);

    vi.advanceTimersByTime(100);

    expect(createCount).toBe(2);
    sockets[1].open();
    expect(states).toEqual(["connecting", "connected", "reconnecting", "reconnecting", "connected"]);
  });

  it("does not open duplicate sockets and emits a closed state on manual disconnect", () => {
    const socket = new FakeWebSocket();
    const states: string[] = [];
    let createCount = 0;

    const client = new CueCommXRealtimeClient({
      baseUrl: "http://127.0.0.1:3000",
      createWebSocket: () => {
        createCount += 1;
        return socket as never;
      },
      onConnectionStateChange: (state) => states.push(state),
      sessionToken: "sess-123",
    });

    client.connect();
    client.connect();
    socket.open();
    client.disconnect();

    expect(createCount).toBe(1);
    expect(states).toEqual(["connecting", "connected", "closed"]);
  });

  it("surfaces signaling errors, parse errors, and send-while-closed failures", async () => {
    const socket = new FakeWebSocket();
    const errors: string[] = [];

    const client = new CueCommXRealtimeClient({
      baseUrl: "http://127.0.0.1:3000",
      createWebSocket: () => socket as never,
      onError: (error) => errors.push(error.message),
      sessionToken: "sess-123",
    });

    client.connect();
    expect(() => client.startTalk(["ch-production"])).toThrow("CueCommX realtime connection is not open.");

    socket.open();
    socket.emit("message", {
      data: JSON.stringify({
        type: "signal:error",
        payload: {
          code: "capacity-reached",
          message: "CueCommX is at capacity.",
        },
      }),
    });
    socket.emit("message", {
      data: "{invalid-json",
    });
    client.disconnect();

    await expect(client.closeMediaProducer("producer-1")).rejects.toThrow(
      "CueCommX realtime connection is not open.",
    );
    expect(errors[0]).toBe("CueCommX is at capacity.");
    expect(errors[1]).toBeTruthy();
  });

  it("correlates media requests with their requestId-based server responses", async () => {
    const socket = new FakeWebSocket();

    const client = new CueCommXRealtimeClient({
      baseUrl: "http://127.0.0.1:3000",
      createWebSocket: () => socket as never,
      sessionToken: "sess-123",
    });

    client.connect();
    socket.open();

    const capabilitiesPromise = client.requestMediaCapabilities();
    const capabilitiesRequest = JSON.parse(socket.sent[1] ?? "{}");

    expect(capabilitiesRequest.type).toBe("media:capabilities:get");
    expect(capabilitiesRequest.payload.requestId).toMatch(/^cuecommx-request-/);

    socket.emit("message", {
      data: JSON.stringify({
        type: "media:capabilities",
        payload: {
          requestId: capabilitiesRequest.payload.requestId,
          routerRtpCapabilities: {
            codecs: [
              {
                kind: "audio",
                mimeType: "audio/opus",
                clockRate: 48_000,
                channels: 2,
                rtcpFeedback: [{ type: "transport-cc" }],
              },
            ],
            headerExtensions: [],
          },
        },
      }),
    });

    await expect(capabilitiesPromise).resolves.toMatchObject({
      codecs: [expect.objectContaining({ mimeType: "audio/opus" })],
    });

    const transportPromise = client.createMediaTransport("send");
    const transportRequest = JSON.parse(socket.sent[2] ?? "{}");

    expect(transportRequest).toMatchObject({
      type: "media:transport:create",
      payload: {
        direction: "send",
      },
    });

    socket.emit("message", {
      data: JSON.stringify({
        type: "media:transport:created",
        payload: {
          requestId: transportRequest.payload.requestId,
          transport: {
            direction: "send",
            id: "transport-1",
            iceParameters: {
              usernameFragment: "abc",
              password: "def",
              iceLite: true,
            },
            iceCandidates: [
              {
                foundation: "foundation",
                priority: 1,
                ip: "10.0.0.25",
                address: "10.0.0.25",
                protocol: "udp",
                port: 40_000,
                type: "host",
              },
            ],
            dtlsParameters: {
              fingerprints: [
                {
                  algorithm: "sha-256",
                  value: "AA:BB:CC",
                },
              ],
              role: "auto",
            },
          },
        },
      }),
    });

    await expect(transportPromise).resolves.toMatchObject({
      direction: "send",
      id: "transport-1",
    });
  });

  it("handles the transport, producer, and consumer media request helpers", async () => {
    const socket = new FakeWebSocket();

    const client = new CueCommXRealtimeClient({
      baseUrl: "http://127.0.0.1:3000",
      createWebSocket: () => socket as never,
      sessionToken: "sess-123",
    });

    client.connect();
    socket.open();

    const connectTransportPromise = client.connectMediaTransport("transport-1", {
      fingerprints: [
        {
          algorithm: "sha-256",
          value: "AA:BB:CC",
        },
      ],
      role: "auto",
    });
    const connectTransportRequest = JSON.parse(socket.sent[1] ?? "{}");

    expect(connectTransportRequest).toMatchObject({
      type: "media:transport:connect",
      payload: {
        transportId: "transport-1",
      },
    });

    socket.emit("message", {
      data: JSON.stringify({
        type: "media:transport:connected",
        payload: {
          requestId: connectTransportRequest.payload.requestId,
          transportId: "transport-1",
        },
      }),
    });

    await expect(connectTransportPromise).resolves.toBeUndefined();

    const createProducerPromise = client.createMediaProducer("transport-1", {
      codecs: [
        {
          mimeType: "audio/opus",
          payloadType: 100,
          clockRate: 48_000,
          channels: 2,
          parameters: {
            useinbandfec: 1,
          },
          rtcpFeedback: [],
        },
      ],
      encodings: [
        {
          ssrc: 12345,
        },
      ],
      headerExtensions: [],
      mid: "0",
      rtcp: {
        cname: "cuecommx",
        mux: true,
        reducedSize: true,
      },
    });
    const createProducerRequest = JSON.parse(socket.sent[2] ?? "{}");

    expect(createProducerRequest).toMatchObject({
      type: "media:producer:create",
      payload: {
        kind: "audio",
        transportId: "transport-1",
      },
    });

    socket.emit("message", {
      data: JSON.stringify({
        type: "media:producer:created",
        payload: {
          producerId: "producer-1",
          requestId: createProducerRequest.payload.requestId,
        },
      }),
    });

    await expect(createProducerPromise).resolves.toBe("producer-1");

    const closeProducerPromise = client.closeMediaProducer("producer-1");
    const closeProducerRequest = JSON.parse(socket.sent[3] ?? "{}");

    expect(closeProducerRequest).toMatchObject({
      type: "media:producer:close",
      payload: {
        producerId: "producer-1",
      },
    });

    socket.emit("message", {
      data: JSON.stringify({
        type: "media:producer:closed",
        payload: {
          producerId: "producer-1",
          requestId: closeProducerRequest.payload.requestId,
        },
      }),
    });

    await expect(closeProducerPromise).resolves.toBeUndefined();

    const resumeConsumerPromise = client.resumeMediaConsumer("consumer-1");
    const resumeConsumerRequest = JSON.parse(socket.sent[4] ?? "{}");

    expect(resumeConsumerRequest).toMatchObject({
      type: "media:consumer:resume",
      payload: {
        consumerId: "consumer-1",
      },
    });

    socket.emit("message", {
      data: JSON.stringify({
        type: "media:consumer:resumed",
        payload: {
          consumerId: "consumer-1",
          requestId: resumeConsumerRequest.payload.requestId,
        },
      }),
    });

    await expect(resumeConsumerPromise).resolves.toBeUndefined();
  });

  it("times out pending media requests when the server never responds", async () => {
    const socket = new FakeWebSocket();

    const client = new CueCommXRealtimeClient({
      baseUrl: "http://127.0.0.1:3000",
      createWebSocket: () => socket as never,
      requestTimeoutMs: 250,
      sessionToken: "sess-123",
    });

    client.connect();
    socket.open();

    const transportPromise = client.createMediaTransport("recv");

    vi.advanceTimersByTime(250);

    await expect(transportPromise).rejects.toThrow(
      "CueCommX realtime request timed out: media:transport:created.",
    );
  });

  it("rejects pending media requests when the realtime socket closes", async () => {
    const socket = new FakeWebSocket();

    const client = new CueCommXRealtimeClient({
      baseUrl: "http://127.0.0.1:3000",
      createWebSocket: () => socket as never,
      sessionToken: "sess-123",
    });

    client.connect();
    socket.open();

    const capabilitiesPromise = client.requestMediaCapabilities();
    socket.emit("close", { type: "close" });

    await expect(capabilitiesPromise).rejects.toThrow("CueCommX realtime connection closed.");
  });
});
