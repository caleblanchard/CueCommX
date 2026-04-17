import { describe, expect, it, vi } from "vitest";

import { deferMobileOperation } from "./mobile-feedback.js";

describe("deferMobileOperation", () => {
  it("does not start the operation until the scheduler runs it", async () => {
    let scheduledTask: (() => void) | undefined;
    const scheduler = vi.fn((task: () => void) => {
      scheduledTask = task;
    });
    const operation = vi.fn(async () => undefined);
    const onError = vi.fn();

    deferMobileOperation(operation, onError, scheduler);

    expect(operation).not.toHaveBeenCalled();
    expect(scheduler).toHaveBeenCalledOnce();

    scheduledTask?.();
    await Promise.resolve();

    expect(operation).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("forwards deferred operation failures to the error handler", async () => {
    let scheduledTask: (() => void) | undefined;
    const failure = new Error("haptics unavailable");
    const scheduler = (task: () => void) => {
      scheduledTask = task;
    };
    const onError = vi.fn();

    deferMobileOperation(async () => {
      throw failure;
    }, onError, scheduler);

    scheduledTask?.();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(failure);
  });
});
