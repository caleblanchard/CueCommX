import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROTOCOL_VERSION } from "@cuecommx/protocol";

import { WEB_CLIENT_PREFERENCES_KEY } from "./preferences.js";

const mediaControllerState = vi.hoisted(() => {
  const created: Array<{
    close: ReturnType<typeof vi.fn>;
    handleServerMessage: ReturnType<typeof vi.fn>;
    options: {
      onInputDevicesChange?: (devices: Array<{ deviceId: string; label: string }>) => void;
      onLocalLevelChange?: (level: number) => void;
      onRemoteTalkersChange?: (
        talkers: Array<{
          activeChannelIds: string[];
          consumerId: string;
          producerUserId: string;
          producerUsername: string;
        }>,
      ) => void;
    };
    resetConnection: ReturnType<typeof vi.fn>;
    setAudioProcessing: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    switchInputDevice: ReturnType<typeof vi.fn>;
    updateMix: ReturnType<typeof vi.fn>;
  }> = [];

  return { created };
});

vi.mock("./media/web-media-controller.js", () => ({
  createWebMediaController: (options: {
    onConnectionQualityChange?: (quality: unknown) => void;
    onInputDevicesChange?: (devices: Array<{ deviceId: string; label: string }>) => void;
    onLocalLevelChange?: (level: number) => void;
    onRemoteTalkersChange?: (
      talkers: Array<{
        activeChannelIds: string[];
        consumerId: string;
        producerUserId: string;
        producerUsername: string;
      }>,
    ) => void;
  }) => {
    const controller = {
      close: vi.fn(async () => undefined),
      handleServerMessage: vi.fn(async () => undefined),
      options,
      resetConnection: vi.fn(),
      setAudioProcessing: vi.fn(),
      start: vi.fn(async () => {
        options.onInputDevicesChange?.([
          { deviceId: "mic-1", label: "Built-in Mic" },
          { deviceId: "mic-2", label: "USB Console" },
        ]);
        options.onLocalLevelChange?.(38);
      }),
      switchInputDevice: vi.fn(async () => undefined),
      updateMix: vi.fn(),
    };

    mediaControllerState.created.push(controller);

    return controller;
  },
}));

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

const discovery = {
  primaryUrl: "http://10.0.0.25:3000/",
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

describe("Web Client App", () => {
  afterEach(() => {
    cleanup();
    MockWebSocket.instances = [];
    mediaControllerState.created.length = 0;
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("shows only join-relevant information before the operator signs in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | RequestInfo) => {
        const url = String(input);

        if (url.endsWith("/api/status")) {
          return new Response(
            JSON.stringify({
              name: "Main Church",
              version: "0.1.0",
              uptime: 2,
              connectedUsers: 1,
              maxUsers: 30,
              channels: 5,
              needsAdminSetup: false,
              protocolVersion: PROTOCOL_VERSION,
            }),
            { status: 200 },
          );
        }

        if (url.endsWith("/api/discovery")) {
          return new Response(JSON.stringify(discovery), { status: 200 });
        }

        return new Response(JSON.stringify({ error: "Unexpected request" }), { status: 500 });
      }),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Join local intercom" })).toBeInTheDocument();
    expect(screen.getByText("Only the essentials")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Arm audio context" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mic input")).not.toBeInTheDocument();
    expect(screen.queryByText("Live link and monitor state")).not.toBeInTheDocument();
  });

  it("restores saved operator preferences and drives live listen/talk controls", async () => {
    window.localStorage.setItem(
      WEB_CLIENT_PREFERENCES_KEY,
      JSON.stringify({
        channelVolumes: {
          "ch-production": 35,
          "ch-video": 80,
        },
        latchModeChannelIds: ["ch-production"],
        masterVolume: 65,
        preferredListenChannelIds: ["ch-production"],
        selectedInputDeviceId: "mic-2",
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith("/api/status")) {
          return new Response(
            JSON.stringify({
              name: "Main Church",
              version: "0.1.0",
              uptime: 2,
              connectedUsers: 0,
              maxUsers: 30,
              channels: 5,
              needsAdminSetup: false,
              protocolVersion: PROTOCOL_VERSION,
            }),
            { status: 200 },
          );
        }

        if (url.endsWith("/api/discovery")) {
          return new Response(JSON.stringify(discovery), { status: 200 });
        }

        if (url.endsWith("/api/auth/login") && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              success: true,
              protocolVersion: PROTOCOL_VERSION,
              sessionToken: "sess-123",
              user: {
                id: "usr-1",
                username: "Chuck",
                role: "operator",
                channelPermissions: [
                  { channelId: "ch-production", canTalk: true, canListen: true },
                  { channelId: "ch-video", canTalk: false, canListen: true },
                ],
              },
              channels: [
                { id: "ch-production", name: "Production", color: "#EF4444" },
                { id: "ch-video", name: "Video/Camera", color: "#10B981" },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response(JSON.stringify({ error: "Unexpected request" }), { status: 500 });
      }),
    );
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    render(<App />);

    expect(await screen.findByText("Main Church")).toBeInTheDocument();
    expect(await screen.findAllByText("http://10.0.0.25:3000/")).not.toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Open a different server"), {
      target: { value: "10.0.0.50:3000" },
    });
    expect(await screen.findByRole("link", { name: "Open entered server" })).toHaveAttribute(
      "href",
      "http://10.0.0.50:3000/",
    );

    fireEvent.change(screen.getByLabelText("Operator name"), {
      target: { value: "Chuck" },
    });
    fireEvent.change(screen.getByLabelText("PIN"), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Join local intercom" }));

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];

    socket?.open();

    expect(socket?.url).toBe("ws://localhost:3000/ws");
    expect(socket?.sent.map((entry) => JSON.parse(entry))).toEqual([
      {
        type: "session:authenticate",
        payload: {
          sessionToken: "sess-123",
        },
      },
    ]);
    expect(screen.getByText("Assigned channels")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arm audio context" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Mic input")).not.toBeInTheDocument();

    socket?.emitMessage({
      type: "session:ready",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        connectedUsers: 2,
        user: {
          id: "usr-1",
          username: "Chuck",
          role: "operator",
          channelPermissions: [
            { channelId: "ch-production", canTalk: true, canListen: true },
            { channelId: "ch-video", canTalk: false, canListen: true },
          ],
        },
        channels: [
          { id: "ch-production", name: "Production", color: "#EF4444" },
          { id: "ch-video", name: "Video/Camera", color: "#10B981" },
        ],
        operatorState: {
          talkChannelIds: [],
          listenChannelIds: ["ch-production", "ch-video"],
          talking: false,
        },
      },
    });

    expect(await screen.findAllByText("Live linked")).not.toHaveLength(0);
    expect(await screen.findByText("2 live operators on this server.")).toBeInTheDocument();
    await waitFor(() =>
      expect(socket?.sent.map((entry) => JSON.parse(entry))).toContainEqual({
        type: "listen:toggle",
        payload: {
          channelId: "ch-video",
          listening: false,
        },
      }),
    );
    expect(screen.getAllByRole("button", { name: "Listening" })[0]).toBeDisabled();
    expect(screen.queryByLabelText("Master monitor volume")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Arm audio context" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Arm audio context" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Audio armed for comms")).toBeInTheDocument();
    expect(await screen.findByText("38%")).toBeInTheDocument();
    expect(screen.getByLabelText("Mic input")).toHaveValue("mic-2");
    expect(screen.getByLabelText("Master monitor volume")).toHaveValue("65");
    expect(screen.getAllByLabelText("Monitor volume")[0]).toHaveValue("35");

    const controller = mediaControllerState.created[0];
    expect(controller?.start).toHaveBeenCalledWith("mic-2");

    fireEvent.click(screen.getAllByRole("button", { name: "Listening" })[0]!);
    expect(socket?.sent.map((entry) => JSON.parse(entry)).at(-1)).toEqual({
      type: "listen:toggle",
      payload: {
        channelId: "ch-production",
        listening: false,
      },
    });

    socket?.emitMessage({
      type: "operator-state",
      payload: {
        talkChannelIds: [],
        listenChannelIds: ["ch-video"],
        talking: false,
      },
    });

    expect(await screen.findByText("Listen off")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Talk" }));
    expect(socket?.sent.map((entry) => JSON.parse(entry)).at(-1)).toEqual({
      type: "talk:start",
      payload: {
        channelIds: ["ch-production"],
      },
    });

    socket?.emitMessage({
      type: "operator-state",
      payload: {
        talkChannelIds: ["ch-production"],
        listenChannelIds: ["ch-video"],
        talking: true,
      },
    });

    expect(await screen.findAllByText("Talking")).not.toHaveLength(0);

    fireEvent.pointerUp(screen.getByRole("button", { name: "Talking" }));
    expect(socket?.sent.map((entry) => JSON.parse(entry)).at(-1)).toEqual({
      type: "talk:stop",
      payload: {
        channelIds: ["ch-production"],
      },
    });

    fireEvent.change(screen.getByLabelText("Mic input"), {
      target: { value: "mic-2" },
    });

    await waitFor(() => expect(controller?.switchInputDevice).toHaveBeenCalledWith("mic-2"));
  });
});
