import type { OperatorSessionCoordinationStep } from "./types.js";

export class StepBuilder {
  private readonly projectionKeys = new Set<string>();
  readonly steps: OperatorSessionCoordinationStep[] = [];

  push(step: OperatorSessionCoordinationStep): void {
    if (step.adapter === "projection") {
      const key = step.projection;

      if (this.projectionKeys.has(key)) {
        return;
      }

      this.projectionKeys.add(key);
    }

    this.steps.push(step);
  }
}
