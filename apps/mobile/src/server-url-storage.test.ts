import { describe, expect, it, vi } from "vitest";

import { loadPersistedServerUrl, persistServerUrl } from "./server-url-storage.js";

interface FakeStorage {
  getItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
}

function createStorage(initialValue: string | null = null): FakeStorage {
  let storedValue = initialValue;

  return {
    getItem: vi.fn(async () => storedValue),
    removeItem: vi.fn(async () => {
      storedValue = null;
    }),
    setItem: vi.fn(async (_key: string, value: string) => {
      storedValue = value;
    }),
  };
}

describe("loadPersistedServerUrl", () => {
  it("returns the previously stored manual target", async () => {
    const storage = createStorage("https://cuecommx.local:3443/");

    await expect(loadPersistedServerUrl(storage)).resolves.toBe("https://cuecommx.local:3443/");
    expect(storage.getItem).toHaveBeenCalledOnce();
  });

  it("treats blank stored values as missing", async () => {
    const storage = createStorage("   ");

    await expect(loadPersistedServerUrl(storage)).resolves.toBeUndefined();
  });
});

describe("persistServerUrl", () => {
  it("stores a trimmed manual target", async () => {
    const storage = createStorage();

    await persistServerUrl("  192.168.0.235:3000  ", storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      "cuecommx.mobile.last-server-url",
      "192.168.0.235:3000",
    );
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("removes the stored target when the input is blank", async () => {
    const storage = createStorage("https://cuecommx.local:3443/");

    await persistServerUrl("   ", storage);

    expect(storage.removeItem).toHaveBeenCalledWith("cuecommx.mobile.last-server-url");
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
