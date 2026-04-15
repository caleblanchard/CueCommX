import { expect, test } from "@playwright/test";

const readyPayload = {
  payload: {
    channels: [
      { id: "ch-production", name: "Production", color: "#EF4444" },
      { id: "ch-video", name: "Video/Camera", color: "#10B981" },
    ],
    connectedUsers: 2,
    operatorState: {
      listenChannelIds: ["ch-production", "ch-video"],
      talkChannelIds: [],
      talking: false,
    },
    protocolVersion: 1,
    user: {
      channelPermissions: [
        { channelId: "ch-production", canListen: true, canTalk: true },
        { channelId: "ch-video", canListen: true, canTalk: false },
      ],
      id: "usr-1",
      role: "operator",
      username: "Chuck",
    },
  },
  type: "session:ready",
};

test("operator can join the mocked live shell", async ({ page }) => {
  await page.addInitScript((payload) => {
    class FakeCueCommXWebSocket extends EventTarget {
      readyState = 0;
      url: string;

      constructor(url: string) {
        super();
        this.url = url;
        setTimeout(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
        }, 0);
      }

      close(): void {
        this.readyState = 3;
        this.dispatchEvent(new Event("close"));
      }

      send(data: string): void {
        const message = JSON.parse(data);

        if (message.type === "session:authenticate") {
          setTimeout(() => {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify(payload),
              }),
            );
          }, 0);
        }
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: FakeCueCommXWebSocket,
      writable: true,
    });
  }, readyPayload);

  await page.route("**/api/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        name: "Main Church",
        version: "0.1.0",
        uptime: 12,
        connectedUsers: 0,
        maxUsers: 30,
        channels: 5,
        needsAdminSetup: false,
        protocolVersion: 1,
      },
    });
  });

  await page.route("**/api/discovery", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
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
      },
    });
  });

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        success: true,
        protocolVersion: 1,
        sessionToken: "sess-123",
        user: readyPayload.payload.user,
        channels: readyPayload.payload.channels,
      },
    });
  });

  await page.goto("/");

  await expect(page.getByText("Main Church")).toBeVisible();
  await expect(page.getByText("http://10.0.0.25:3000/").first()).toBeVisible();

  await page.getByLabel("Open a different server").fill("10.0.0.50:3000");
  await expect(page.getByRole("link", { name: "Open entered server" })).toHaveAttribute(
    "href",
    "http://10.0.0.50:3000/",
  );

  await page.getByLabel("Operator name").fill("Chuck");
  await page.getByLabel("PIN").fill("1234");
  await page.getByRole("button", { name: "Join local intercom" }).click();

  await expect(page.getByRole("heading", { name: "Signed in as Chuck" })).toBeVisible();
  await expect(page.getByText("Live linked").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Video/Camera" })).toBeVisible();
});
