describe("CueCommX mobile shell", () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
    });
  });

  it("shows the local server handoff shell", async () => {
    await expect(element(by.text("CueCommX Mobile"))).toBeVisible();
    await expect(element(by.text("Check local server"))).toBeVisible();
    await expect(element(by.text("Join local intercom"))).toBeVisible();
  });
});
