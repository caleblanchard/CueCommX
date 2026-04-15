import { describe, expect, it } from "vitest";

import { designTokens, getCssColorVariable } from "../src/index.js";

describe("designTokens", () => {
  it("exports the approved channel palette for the MVP defaults", () => {
    expect(designTokens.channelPalette.production).toBe("#EF4444");
    expect(designTokens.channelPalette.videoCamera).toBe("#10B981");
  });

  it("keeps the primary talk target large enough for touch-first UI", () => {
    expect(designTokens.spacing.touchTarget).toBeGreaterThanOrEqual(60);
  });

  it("maps semantic token names to CSS variables", () => {
    expect(getCssColorVariable("primary")).toBe("hsl(var(--primary))");
    expect(getCssColorVariable("muted-foreground")).toBe("hsl(var(--muted-foreground))");
  });
});
