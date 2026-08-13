import { randomUUID } from "node:crypto";

import type {
  ChatMessagePayload,
  ServerSignalingMessage,
} from "@cuecommx/protocol";

import { buildSignalError } from "./signal-error.js";
import type { RejectionCode } from "./types.js";

export interface ChannelChatParticipant {
  channelIds: string[];
  userId: string;
  username: string;
}

type ChannelChatTransportStep = {
  adapter: "transport";
  kind: "send";
  message: ServerSignalingMessage;
  sessionToken: string;
};

type ChannelChatAuditStep = {
  adapter: "audit";
  channelId: string;
  eventType: "chat:message";
  userId: string;
  username: string;
};

export type ChannelChatStep = ChannelChatAuditStep | ChannelChatTransportStep;

export interface ChannelChatResult {
  decision: "accepted" | "noop" | "rejected";
  rejection?: {
    code: RejectionCode;
    message: string;
  };
  steps: readonly ChannelChatStep[];
}

export interface ChannelChatCommand {
  channelId: string;
  text: string;
  type: "chat.send";
}

export interface ChannelChatModuleOptions {
  maxMessagesPerChannel?: number;
}

const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 100;

function cloneParticipant(participant: ChannelChatParticipant): ChannelChatParticipant {
  return {
    ...participant,
    channelIds: [...participant.channelIds],
  };
}

function cloneMessage(message: ChatMessagePayload): ChatMessagePayload {
  return { ...message };
}

export class ChannelChatModule {
  private readonly messagesByChannel = new Map<string, ChatMessagePayload[]>();

  private readonly maxMessagesPerChannel: number;

  private readonly participants = new Map<string, ChannelChatParticipant>();

  constructor(options: ChannelChatModuleOptions = {}) {
    this.maxMessagesPerChannel = options.maxMessagesPerChannel ?? DEFAULT_MAX_MESSAGES_PER_CHANNEL;
  }

  bootstrap(sessionToken: string): readonly ChannelChatTransportStep[] {
    const participant = this.participants.get(sessionToken);

    if (!participant) {
      return [];
    }

    return participant.channelIds.flatMap((channelId) => {
      const messages = this.messagesByChannel.get(channelId);

      if (!messages || messages.length === 0) {
        return [];
      }

      return [{
        adapter: "transport" as const,
        kind: "send" as const,
        sessionToken,
        message: {
          type: "chat:history",
          payload: {
            channelId,
            messages: messages.map(cloneMessage),
          },
        },
      }];
    });
  }

  command(input: {
    actorSessionToken: string;
    at: number;
    command: ChannelChatCommand;
  }): ChannelChatResult {
    const participant = this.participants.get(input.actorSessionToken);

    if (!participant) {
      return this.reject("unauthorized", "Authenticate the realtime session first.", input.actorSessionToken);
    }

    if (!participant.channelIds.includes(input.command.channelId)) {
      return this.reject("forbidden", "You do not have access to this channel.", input.actorSessionToken);
    }

    const chatMessage: ChatMessagePayload = {
      channelId: input.command.channelId,
      id: randomUUID(),
      messageType: "text",
      text: input.command.text,
      timestamp: input.at,
      userId: participant.userId,
      username: participant.username,
    };

    const messages = this.messagesByChannel.get(input.command.channelId) ?? [];
    messages.push(chatMessage);

    if (messages.length > this.maxMessagesPerChannel) {
      messages.splice(0, messages.length - this.maxMessagesPerChannel);
    }

    this.messagesByChannel.set(input.command.channelId, messages);

    const steps: ChannelChatStep[] = [];

    for (const [sessionToken, current] of this.participants.entries()) {
      if (!current.channelIds.includes(input.command.channelId)) {
        continue;
      }

      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken,
        message: {
          type: "chat:message",
          payload: cloneMessage(chatMessage),
        },
      });
    }

    steps.push({
      adapter: "audit",
      channelId: input.command.channelId,
      eventType: "chat:message",
      userId: participant.userId,
      username: participant.username,
    });

    return {
      decision: "accepted",
      steps,
    };
  }

  removeSession(sessionToken: string): void {
    this.participants.delete(sessionToken);
  }

  syncSession(sessionToken: string, participant: ChannelChatParticipant): void {
    this.participants.set(sessionToken, cloneParticipant(participant));
  }

  private reject(
    code: RejectionCode,
    message: string,
    sessionToken?: string,
  ): ChannelChatResult {
    const steps: ChannelChatStep[] = [];

    if (sessionToken) {
      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken,
        message: buildSignalError(code, message),
      });
    }

    return {
      decision: "rejected",
      rejection: { code, message },
      steps,
    };
  }
}
