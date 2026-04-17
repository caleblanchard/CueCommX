import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROTOCOL_VERSION, type ManagedUser } from "@cuecommx/protocol";

import App from "./App.js";

class MockWebSocket {
  static readonly CLOSED = 3;
  static readonly OPEN = 1;

  static instances: MockWebSocket[] = [];

  readonly listeners = new Map<string, Array<(event: any) => void>>();

  readyState = 0;

  readonly sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  emit(type: string, event: any): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  emitMessage(payload: unknown): void {
    this.emit("message", {
      data: JSON.stringify(payload),
    });
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open", { type: "open" });
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => entry !== listener),
    );
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

const channels = [
  { id: "ch-production", name: "Production", color: "#EF4444" },
  { id: "ch-audio", name: "Audio", color: "#3B82F6" },
];
const discovery = {
  announcedHost: "10.0.0.25",
  detectedInterfaces: [
    {
      address: "10.0.0.25",
      name: "en0",
      url: "http://10.0.0.25:3000/",
    },
    {
      address: "10.0.0.42",
      name: "en7",
      url: "http://10.0.0.42:3000/",
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
  primaryTargetId: "announced-10-0-0-25",
  connectTargets: [
    {
      id: "announced-10-0-0-25",
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
};

describe("Admin App", () => {
  afterEach(() => {
    cleanup();
    MockWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it("renders server info and bootstraps the first admin", async () => {
    const users: ManagedUser[] = [
      {
        id: "usr-1",
        username: "Chuck",
        role: "admin",
        online: false,
        groupIds: [],
        channelPermissions: [
          { channelId: "ch-production", canTalk: true, canListen: true },
          { channelId: "ch-audio", canTalk: true, canListen: true },
        ],
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/api/status")) {
          return new Response(
            JSON.stringify({
              name: "Main Church",
              version: "0.1.0",
              uptime: 4,
              connectedUsers: 0,
              maxUsers: 30,
              channels: 5,
              needsAdminSetup: true,
              protocolVersion: PROTOCOL_VERSION,
            }),
            { status: 200 },
          );
        }

        if (url.endsWith("/api/channels")) {
          return new Response(JSON.stringify(channels), { status: 200 });
        }

        if (url.endsWith("/api/discovery")) {
          return new Response(JSON.stringify(discovery), { status: 200 });
        }

        if (url.endsWith("/api/auth/setup-admin") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              success: true,
              protocolVersion: PROTOCOL_VERSION,
              sessionToken: "sess-123",
              user: {
                id: "usr-1",
                username: "Chuck",
                role: "admin",
                channelPermissions: [
                  { channelId: "ch-production", canTalk: true, canListen: true },
                  { channelId: "ch-audio", canTalk: true, canListen: true },
                ],
              },
              channels,
            }),
            { status: 201 },
          );
        }

        if (url.endsWith("/api/users")) {
          return new Response(JSON.stringify(users), { status: 200 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    render(<App />);

    expect(await screen.findByText("Main Church")).toBeInTheDocument();
    expect(await screen.findByText("Production")).toBeInTheDocument();
    expect(await screen.findAllByText("Primary discovery")).not.toHaveLength(0);
    expect(await screen.findByText("Network confirmation")).toBeInTheDocument();
    expect(await screen.findByText("Pinned by announced IP")).toBeInTheDocument();
    expect(await screen.findByText("mDNS broadcast active")).toBeInTheDocument();
    expect(await screen.findByText("en7")).toBeInTheDocument();
    expect(await screen.findByText("Needs first admin")).toBeInTheDocument();
    expect(await screen.findByLabelText("CueCommX connect QR")).toBeInTheDocument();
    expect(await screen.findAllByText("http://10.0.0.25:3000/")).not.toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Admin name"), {
      target: { value: "Chuck" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create first admin" }));

    expect(await screen.findByText("Signed in as Chuck")).toBeInTheDocument();
    expect(await screen.findByText("1 managed users")).toBeInTheDocument();
    expect(await screen.findByText("Chuck")).toBeInTheDocument();
  });

  it("signs in an admin and manages the local roster", async () => {
    let users: ManagedUser[] = [
      {
        id: "usr-1",
        username: "Chuck",
        role: "admin",
        online: false,
        groupIds: [],
        channelPermissions: [],
      },
    ];

    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/api/status")) {
          return new Response(
            JSON.stringify({
              name: "Main Church",
              version: "0.1.0",
              uptime: 4,
              connectedUsers: 1,
              maxUsers: 30,
              channels: 5,
              needsAdminSetup: false,
              protocolVersion: PROTOCOL_VERSION,
            }),
            { status: 200 },
          );
        }

        if (url.endsWith("/api/channels")) {
          return new Response(JSON.stringify(channels), { status: 200 });
        }

        if (url.endsWith("/api/discovery")) {
          return new Response(JSON.stringify(discovery), { status: 200 });
        }

        if (url.endsWith("/api/auth/login") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              success: true,
              protocolVersion: PROTOCOL_VERSION,
              sessionToken: "sess-admin",
              user: {
                id: "usr-1",
                username: "Chuck",
                role: "admin",
                channelPermissions: [],
              },
              channels,
            }),
            { status: 200 },
          );
        }

        if (url.endsWith("/api/users") && !init?.method) {
          return new Response(JSON.stringify(users), { status: 200 });
        }

        if (url.endsWith("/api/users") && init?.method === "POST") {
          const payload = JSON.parse(String(init.body)) as {
            username: string;
            role: "admin" | "operator" | "user";
            pin?: string;
            channelPermissions: ManagedUser["channelPermissions"];
          };
          const user: ManagedUser = {
            id: "usr-2",
            username: payload.username,
            role: payload.role,
            online: false,
        groupIds: [],
            channelPermissions: payload.channelPermissions,
          };
          users = [users[0], user];

          return new Response(JSON.stringify(user), { status: 201 });
        }

        if (url.endsWith("/api/users/usr-2") && init?.method === "DELETE") {
          users = users.filter((user) => user.id !== "usr-2");
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sign into admin" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Admin name"), {
      target: { value: "Chuck" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign into admin" }));

    expect(await screen.findByText("Signed in as Chuck")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Camera 1" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "2468" },
    });
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Listen" })[0]);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Talk" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));

    expect(await screen.findByText("Camera 1")).toBeInTheDocument();
    expect(await screen.findByText("Production (L/T)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Camera 1" }));

    await waitFor(() => {
      expect(screen.queryByText("Camera 1")).not.toBeInTheDocument();
    });
  });

  it("shows live talkers and force-mutes an active user", async () => {
    const users: ManagedUser[] = [
      {
        id: "usr-1",
        username: "Chuck",
        role: "admin",
        online: false,
        groupIds: [],
        channelPermissions: [],
      },
      {
        id: "usr-2",
        username: "Camera 1",
        role: "operator",
        online: false,
        groupIds: [],
        channelPermissions: [
          { channelId: "ch-production", canTalk: true, canListen: true },
        ],
      },
    ];

    const fetchMock = vi.fn(async (input: string | URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/api/status")) {
        return new Response(
          JSON.stringify({
            name: "Main Church",
            version: "0.1.0",
            uptime: 4,
            connectedUsers: 0,
            maxUsers: 30,
            channels: channels.length,
            needsAdminSetup: false,
            protocolVersion: PROTOCOL_VERSION,
          }),
          { status: 200 },
        );
      }

      if (url.endsWith("/api/channels") && !init?.method) {
        return new Response(JSON.stringify(channels), { status: 200 });
      }

      if (url.endsWith("/api/discovery")) {
        return new Response(JSON.stringify(discovery), { status: 200 });
      }

      if (url.endsWith("/api/auth/login") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            success: true,
            protocolVersion: PROTOCOL_VERSION,
            sessionToken: "sess-admin",
            user: {
              id: "usr-1",
              username: "Chuck",
              role: "admin",
              channelPermissions: [],
            },
            channels,
          }),
          { status: 200 },
        );
      }

      if (url.endsWith("/api/users") && !init?.method) {
        return new Response(JSON.stringify(users), { status: 200 });
      }

      if (url.endsWith("/api/users/usr-2/force-mute") && init?.method === "POST") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sign into admin" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Admin name"), {
      target: { value: "Chuck" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign into admin" }));

    expect(await screen.findByText("Signed in as Chuck")).toBeInTheDocument();
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

    const socket = MockWebSocket.instances[0];

    socket?.open();

    expect(socket?.sent.map((entry) => JSON.parse(entry))).toEqual([
      {
        type: "session:authenticate",
        payload: {
          sessionToken: "sess-admin",
        },
      },
    ]);

    socket?.emitMessage({
      type: "session:ready",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        connectedUsers: 2,
        user: {
          id: "usr-1",
          username: "Chuck",
          role: "admin",
          channelPermissions: [],
        },
        channels,
        operatorState: {
          talkChannelIds: [],
          listenChannelIds: [],
          talking: false,
        },
      },
    });
    socket?.emitMessage({
      type: "admin:dashboard",
      payload: {
        channels,
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
          {
            id: "usr-2",
            username: "Camera 1",
            role: "operator",
            online: true,
            talking: true,
            activeTalkChannelIds: ["ch-production"],
            channelPermissions: [
              { channelId: "ch-production", canTalk: true, canListen: true },
            ],
          },
        ],
      },
    });

    expect(await screen.findByText("Live on Production.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Force-mute Camera 1" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Force-mute Camera 1" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/users/usr-2/force-mute",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sess-admin",
          }),
          method: "POST",
        }),
      );
    });

    socket?.emitMessage({
      type: "admin:dashboard",
      payload: {
        channels,
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
          {
            id: "usr-2",
            username: "Camera 1",
            role: "operator",
            online: true,
            talking: false,
            activeTalkChannelIds: [],
            channelPermissions: [
              { channelId: "ch-production", canTalk: true, canListen: true },
            ],
          },
        ],
      },
    });

    await waitFor(() => {
      expect(screen.queryByText("Live on Production.")).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("Connected and standing by.")).not.toHaveLength(0);
  });

  it("manages channels from the admin dashboard", async () => {
    let channelList = [...channels];
    const users: ManagedUser[] = [
      {
        id: "usr-1",
        username: "Chuck",
        role: "admin",
        online: false,
        groupIds: [],
        channelPermissions: [],
      },
    ];

    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/api/status")) {
          return new Response(
            JSON.stringify({
              name: "Main Church",
              version: "0.1.0",
              uptime: 4,
              connectedUsers: 1,
              maxUsers: 30,
              channels: channelList.length,
              needsAdminSetup: false,
              protocolVersion: PROTOCOL_VERSION,
            }),
            { status: 200 },
          );
        }

        if (url.endsWith("/api/channels") && !init?.method) {
          return new Response(JSON.stringify(channelList), { status: 200 });
        }

        if (url.endsWith("/api/discovery")) {
          return new Response(JSON.stringify(discovery), { status: 200 });
        }

        if (url.endsWith("/api/auth/login") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              success: true,
              protocolVersion: PROTOCOL_VERSION,
              sessionToken: "sess-admin",
              user: {
                id: "usr-1",
                username: "Chuck",
                role: "admin",
                channelPermissions: [],
              },
              channels: channelList,
            }),
            { status: 200 },
          );
        }

        if (url.endsWith("/api/users") && !init?.method) {
          return new Response(JSON.stringify(users), { status: 200 });
        }

        if (url.endsWith("/api/channels") && init?.method === "POST") {
          const payload = JSON.parse(String(init.body)) as {
            color: string;
            name: string;
          };
          const channel = {
            id: "ch-front-of-house",
            name: payload.name,
            color: payload.color,
          };
          channelList = [...channelList, channel];

          return new Response(JSON.stringify(channel), { status: 201 });
        }

        if (url.endsWith("/api/channels/ch-front-of-house") && init?.method === "PUT") {
          const payload = JSON.parse(String(init.body)) as {
            color: string;
            name: string;
          };
          channelList = channelList.map((channel) =>
            channel.id === "ch-front-of-house"
              ? { ...channel, name: payload.name, color: payload.color }
              : channel,
          );

          return new Response(
            JSON.stringify({
              id: "ch-front-of-house",
              name: payload.name,
              color: payload.color,
            }),
            { status: 200 },
          );
        }

        if (url.endsWith("/api/channels/ch-front-of-house") && init?.method === "DELETE") {
          channelList = channelList.filter((channel) => channel.id !== "ch-front-of-house");
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Sign into admin" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Admin name"), {
      target: { value: "Chuck" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign into admin" }));

    expect(await screen.findByText("Signed in as Chuck")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Channel name"), {
      target: { value: "Front of House" },
    });
    fireEvent.change(screen.getByLabelText("Hex color"), {
      target: { value: "#22C55E" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(
      await screen.findByRole("button", { name: "Edit Front of House" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Front of House" }));
    fireEvent.change(screen.getByLabelText("Channel name"), {
      target: { value: "Broadcast" },
    });
    fireEvent.change(screen.getByLabelText("Hex color"), {
      target: { value: "#0EA5E9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    expect(await screen.findByRole("button", { name: "Edit Broadcast" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Broadcast" }));

    await waitFor(() => {
      expect(screen.queryByText("Broadcast")).not.toBeInTheDocument();
    });
  });
});
