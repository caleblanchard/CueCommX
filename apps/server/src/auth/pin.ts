import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const hash = scryptSync(pin, salt, KEY_LENGTH).toString("hex");

  return `${HASH_PREFIX}$${salt}$${hash}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  const [prefix, salt, expectedHash] = storedHash.split("$");

  if (prefix !== HASH_PREFIX || !salt || !expectedHash) {
    throw new Error("Invalid stored PIN hash format.");
  }

  const derivedHash = scryptSync(pin, salt, KEY_LENGTH);
  const storedBuffer = Buffer.from(expectedHash, "hex");

  if (derivedHash.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedHash, storedBuffer);
}
