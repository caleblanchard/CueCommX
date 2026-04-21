export interface ServerUrlStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

const LAST_SERVER_URL_STORAGE_KEY = "cuecommx.mobile.last-server-url";
const LAST_USERNAME_STORAGE_KEY = "cuecommx.mobile.last-username";
let defaultServerUrlStoragePromise: Promise<ServerUrlStorage> | undefined;

async function getDefaultServerUrlStorage(): Promise<ServerUrlStorage> {
  if (!defaultServerUrlStoragePromise) {
    defaultServerUrlStoragePromise = import("@react-native-async-storage/async-storage").then(
      ({ default: asyncStorage }) => asyncStorage,
    );
  }

  return defaultServerUrlStoragePromise;
}

export async function loadPersistedServerUrl(
  storage?: ServerUrlStorage,
): Promise<string | undefined> {
  const targetStorage = storage ?? (await getDefaultServerUrlStorage());
  const storedValue = await targetStorage.getItem(LAST_SERVER_URL_STORAGE_KEY);
  const trimmedValue = storedValue?.trim();

  return trimmedValue ? trimmedValue : undefined;
}

export async function persistServerUrl(
  value: string,
  storage?: ServerUrlStorage,
): Promise<void> {
  const targetStorage = storage ?? (await getDefaultServerUrlStorage());
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    await targetStorage.removeItem(LAST_SERVER_URL_STORAGE_KEY);
    return;
  }

  await targetStorage.setItem(LAST_SERVER_URL_STORAGE_KEY, trimmedValue);
}

export async function loadPersistedUsername(
  storage?: ServerUrlStorage,
): Promise<string | undefined> {
  const targetStorage = storage ?? (await getDefaultServerUrlStorage());
  const storedValue = await targetStorage.getItem(LAST_USERNAME_STORAGE_KEY);
  const trimmedValue = storedValue?.trim();

  return trimmedValue ? trimmedValue : undefined;
}

export async function persistUsername(
  value: string,
  storage?: ServerUrlStorage,
): Promise<void> {
  const targetStorage = storage ?? (await getDefaultServerUrlStorage());
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    await targetStorage.removeItem(LAST_USERNAME_STORAGE_KEY);
    return;
  }

  await targetStorage.setItem(LAST_USERNAME_STORAGE_KEY, trimmedValue);
}
