import type { SignalErrorMessage } from "@cuecommx/protocol";

import type { RejectionCode } from "./types.js";

export function buildSignalError(code: RejectionCode, message: string, requestId?: string): SignalErrorMessage {
  return {
    type: "signal:error",
    payload: {
      code,
      message,
      ...(requestId ? { requestId } : {}),
    },
  };
}
