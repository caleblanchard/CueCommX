import { describe, expect, it } from "vitest";

import {
  ChannelChatModule,
  type ChannelChatResult,
  type ChannelChatStep,
} from "../src/realtime/channel-chat.js";

function transportMessages(
  result: ChannelChatResult,
  type: string,
): Array<{ payload?: unknown; sessionToken: string; type: string }> {
  return result.steps
    .filter((step): step is Extract<ChannelChatStep, { adapter: "transport"; kind: "send" }> =>
      step.adapter === "transport" && step.kind === "send" && step.message.type === type
    )
    .map((step) => ({
      payload: step.message.payload,
      sessionToken: step.sessionToken,
      type: step.message.type,
    }));
}

describe("ChannelChatModule", () => {
  it("broadcasts chat messages to sessions with channel access and records an audit step", () => {
    const chat = new ChannelChatModule();

    chat.syncSession("sess-1", {
      channelIds: ["ch-production"],
      userId: "user-1",
      username: "Director",
    });
    chat.syncSession("sess-2", {
      channelIds: ["ch-production", "ch-audio"],
      userId: "user-2",
      username: "Camera 1",
    });
    chat.syncSession("sess-3", {
      channelIds: ["ch-stage"],
      userId: "user-3",
      username: "Lights",
    });

    const result = chat.command({
      actorSessionToken: "sess-1",
      at: 1234,
      command: {
        type: "chat.send",
        channelId: "ch-production",
        text: "Stand by.",
      },
    });

    expect(result.decision).toBe("accepted");
    expect(transportMessages(result, "chat:message")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionToken: "sess-1",
          payload: expect.objectContaining({
            channelId: "ch-production",
            text: "Stand by.",
            timestamp: 1234,
            userId: "user-1",
            username: "Director",
          }),
        }),
        expect.objectContaining({
          sessionToken: "sess-2",
          payload: expect.objectContaining({
            channelId: "ch-production",
            text: "Stand by.",
            userId: "user-1",
          }),
        }),
      ]),
    );
    expect(transportMessages(result, "chat:message")).toHaveLength(2);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        {
          adapter: "audit",
          channelId: "ch-production",
          eventType: "chat:message",
          userId: "user-1",
          username: "Director",
        },
      ]),
    );
  });

  it("returns chat history only for channels assigned to the session", () => {
    const chat = new ChannelChatModule();

    chat.syncSession("sess-1", {
      channelIds: ["ch-production"],
      userId: "user-1",
      username: "Director",
    });
    chat.syncSession("sess-2", {
      channelIds: ["ch-production", "ch-stage"],
      userId: "user-2",
      username: "Camera 1",
    });

    chat.command({
      actorSessionToken: "sess-1",
      at: 100,
      command: {
        type: "chat.send",
        channelId: "ch-production",
        text: "Ready.",
      },
    });
    chat.command({
      actorSessionToken: "sess-2",
      at: 200,
      command: {
        type: "chat.send",
        channelId: "ch-stage",
        text: "On deck.",
      },
    });

    expect(chat.bootstrap("sess-1")).toEqual([
      {
        adapter: "transport",
        kind: "send",
        sessionToken: "sess-1",
        message: {
          type: "chat:history",
          payload: {
            channelId: "ch-production",
            messages: [
              expect.objectContaining({
                channelId: "ch-production",
                text: "Ready.",
              }),
            ],
          },
        },
      },
    ]);
    expect(chat.bootstrap("sess-2")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionToken: "sess-2",
          message: expect.objectContaining({
            type: "chat:history",
            payload: expect.objectContaining({ channelId: "ch-production" }),
          }),
        }),
        expect.objectContaining({
          sessionToken: "sess-2",
          message: expect.objectContaining({
            type: "chat:history",
            payload: expect.objectContaining({ channelId: "ch-stage" }),
          }),
        }),
      ]),
    );
  });

  it("rejects unauthorized channel chat and prunes old history", () => {
    const chat = new ChannelChatModule({ maxMessagesPerChannel: 2 });

    chat.syncSession("sess-1", {
      channelIds: ["ch-production"],
      userId: "user-1",
      username: "Director",
    });

    const forbidden = chat.command({
      actorSessionToken: "sess-1",
      at: 100,
      command: {
        type: "chat.send",
        channelId: "ch-stage",
        text: "No access.",
      },
    });

    expect(forbidden).toMatchObject({
      decision: "rejected",
      rejection: {
        code: "forbidden",
      },
    });
    expect(transportMessages(forbidden, "signal:error")).toEqual([
      {
        sessionToken: "sess-1",
        type: "signal:error",
        payload: {
          code: "forbidden",
          message: "You do not have access to this channel.",
        },
      },
    ]);

    chat.command({
      actorSessionToken: "sess-1",
      at: 101,
      command: { type: "chat.send", channelId: "ch-production", text: "One" },
    });
    chat.command({
      actorSessionToken: "sess-1",
      at: 102,
      command: { type: "chat.send", channelId: "ch-production", text: "Two" },
    });
    chat.command({
      actorSessionToken: "sess-1",
      at: 103,
      command: { type: "chat.send", channelId: "ch-production", text: "Three" },
    });

    const [history] = chat.bootstrap("sess-1");
    expect(history).toMatchObject({
      sessionToken: "sess-1",
      message: {
        type: "chat:history",
        payload: {
          channelId: "ch-production",
          messages: [
            expect.objectContaining({ text: "Two" }),
            expect.objectContaining({ text: "Three" }),
          ],
        },
      },
    });
  });
});
