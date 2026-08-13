import type { ClientSignalingMessage } from "@cuecommx/protocol";

import type { OperatorSessionCommand } from "./types.js";

export function toCoordinationCommand(message: ClientSignalingMessage): OperatorSessionCommand | undefined {
  switch (message.type) {
    case "listen:toggle":
      return {
        channelId: message.payload.channelId,
        listening: message.payload.listening,
        type: "listen.set",
      };
    case "talk:start":
      return {
        channelIds: [...message.payload.channelIds],
        type: "talk.start",
      };
    case "talk:stop":
      return {
        channelIds: [...message.payload.channelIds],
        type: "talk.stop",
      };
    case "quality:report":
      return {
        quality: message.payload,
        type: "quality.report",
      };
    case "preflight:result":
      return {
        status: message.payload.status,
        type: "preflight.report",
      };
    case "allpage:start":
      return { type: "all-page.start" };
    case "allpage:stop":
      return { type: "all-page.stop" };
    case "signal:send":
      return {
        signalType: message.payload.signalType,
        targetChannelId: message.payload.targetChannelId,
        targetUserId: message.payload.targetUserId,
        type: "signal.send",
      };
    case "signal:ack":
      return {
        signalId: message.payload.signalId,
        type: "signal.ack",
      };
    case "direct:request":
      return {
        targetUserId: message.payload.targetUserId,
        type: "direct-call.request",
      };
    case "direct:accept":
      return {
        callId: message.payload.callId,
        type: "direct-call.accept",
      };
    case "direct:reject":
      return {
        callId: message.payload.callId,
        type: "direct-call.reject",
      };
    case "direct:end":
      return {
        callId: message.payload.callId,
        type: "direct-call.end",
      };
    case "ifb:start":
      return {
        targetUserId: message.payload.targetUserId,
        type: "ifb.start",
      };
    case "ifb:stop":
      return { type: "ifb.stop" };
    default:
      return undefined;
  }
}
