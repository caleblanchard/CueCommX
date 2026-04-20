/**
 * GPIO Integration Service
 *
 * Provides an abstraction layer for hardware GPIO (General Purpose Input/Output)
 * devices. Inputs can trigger intercom actions (PTT, call signal, all-page).
 * Outputs can reflect intercom state (user online, channel active).
 *
 * Hardware support is pluggable. The built-in providers are:
 *  - "none"    : No hardware (default). Config and API are available but inactive.
 *  - "hid"     : USB HID devices via node-hid (dynamically imported if available).
 *
 * Environment variables:
 *  CUECOMMX_GPIO_ENABLED       "true" to enable
 *  CUECOMMX_GPIO_PROVIDER      "none" | "hid" (default: "none")
 *  CUECOMMX_GPIO_CONFIG        JSON string with pin/button mappings
 */

export type GpioInputAction =
  | { type: "ptt:start"; channelId: string }
  | { type: "ptt:stop"; channelId: string }
  | { type: "call:signal"; channelId: string }
  | { type: "allpage:start" }
  | { type: "allpage:stop" };

export type GpioOutputTrigger =
  | { type: "user:online"; userId?: string }
  | { type: "channel:active"; channelId?: string }
  | { type: "allpage:active" };

export interface GpioPinConfig {
  pinId: string;
  label: string;
  direction: "input" | "output";
  /** For inputs: what action to trigger */
  action?: GpioInputAction;
  /** For outputs: what state change drives this output */
  trigger?: GpioOutputTrigger;
}

export interface GpioConfig {
  enabled: boolean;
  provider: "none" | "hid";
  pins: GpioPinConfig[];
}

export interface GpioCallbacks {
  onInputAction?: (action: GpioInputAction) => void;
}

export interface GpioDevice {
  id: string;
  name: string;
  vendorId: number;
  productId: number;
}

export class GpioService {
  private running = false;
  private callbacks: GpioCallbacks = {};
  private readonly config: GpioConfig;

  constructor(config: GpioConfig) {
    this.config = config;
  }

  setCallbacks(callbacks: GpioCallbacks): void {
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.config.provider === "none") {
      console.log("[GPIO] Provider is 'none' — GPIO configured but no hardware active.");
      this.running = true;
      return;
    }

    if (this.config.provider === "hid") {
      await this.startHidProvider();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  /** Reflect a state change to configured output pins */
  setOutput(trigger: GpioOutputTrigger, active: boolean): void {
    if (!this.running) return;
    const outputPins = this.config.pins.filter(
      (p) => p.direction === "output" && p.trigger?.type === trigger.type,
    );
    if (outputPins.length === 0) return;
    // In a real implementation this would drive the hardware pin
    for (const pin of outputPins) {
      console.log(`[GPIO] Output pin '${pin.label}' (${pin.pinId}): ${active ? "HIGH" : "LOW"}`);
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  getConfig(): GpioConfig {
    return { ...this.config, pins: [...this.config.pins] };
  }

  /** List enumerated HID devices (requires node-hid). Returns empty if unavailable. */
  static async listHidDevices(): Promise<GpioDevice[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hid = await import("node-hid" as string) as any;
      const devicesFn = hid.devices ?? hid.default?.devices;
      if (typeof devicesFn !== "function") return [];
      return (devicesFn() as Array<{
        path?: string;
        vendorId: number;
        productId: number;
        product?: string;
        manufacturer?: string;
      }>).map((d, idx) => ({
        id: d.path ?? `hid-${idx}`,
        name: [d.manufacturer, d.product].filter(Boolean).join(" ") || `HID ${d.vendorId}:${d.productId}`,
        vendorId: d.vendorId,
        productId: d.productId,
      }));
    } catch {
      return [];
    }
  }

  // --- Private ---

  private async startHidProvider(): Promise<void> {
    try {
      // Dynamic import so the server starts even if node-hid is not installed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await import("node-hid" as string) as any;
      this.running = true;
      console.log("[GPIO] HID provider started. Input pins active.");
      this.logPinConfig();
    } catch {
      console.warn(
        "[GPIO] node-hid not available. Install with: npm install node-hid --workspace=apps/server",
      );
      this.running = false;
    }
  }

  private logPinConfig(): void {
    const inputs = this.config.pins.filter((p) => p.direction === "input");
    const outputs = this.config.pins.filter((p) => p.direction === "output");
    console.log(`[GPIO] ${inputs.length} input pin(s), ${outputs.length} output pin(s) configured`);
  }
}

export function buildGpioConfig(env: NodeJS.ProcessEnv): GpioConfig {
  const enabled = env.CUECOMMX_GPIO_ENABLED === "true";
  const provider = (env.CUECOMMX_GPIO_PROVIDER as GpioConfig["provider"]) ?? "none";

  let pins: GpioPinConfig[] = [];
  if (env.CUECOMMX_GPIO_CONFIG) {
    try {
      const parsed: unknown = JSON.parse(env.CUECOMMX_GPIO_CONFIG);
      if (Array.isArray(parsed)) {
        pins = parsed as GpioPinConfig[];
      }
    } catch {
      console.warn("[GPIO] Invalid CUECOMMX_GPIO_CONFIG JSON, using empty pin list.");
    }
  }

  return { enabled, provider, pins };
}
