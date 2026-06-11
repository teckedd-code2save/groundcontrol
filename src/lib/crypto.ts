import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join, dirname } from "path";

/**
 * AES-256-GCM encryption-at-rest for GroundControl secrets
 * (VPS private keys / passwords, OpenAI API key).
 *
 * Key resolution order:
 *   1. process.env.GROUNDCONTROL_SECRET — a 32-byte key. Accepts:
 *        - 64-char hex
 *        - 44-char base64 (32 raw bytes)
 *        - any other string => SHA-256 hashed down to 32 bytes (so a
 *          passphrase of any length works, documented as acceptable).
 *   2. A generated key file under the data dir (`prisma/.groundcontrol-key`),
 *      chmod 600. A WARNING is emitted because a key living next to the DB is
 *      less secure than an externally-managed env var.
 *
 * Ciphertext envelope (base64): iv(12) || authTag(16) || ciphertext.
 * Prefixed with "enc:v1:" so we can detect already-encrypted values and
 * transparently migrate legacy plaintext on read.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = "enc:v1:";

const KEY_FILE = join(process.cwd(), "prisma", ".groundcontrol-key");

let cachedKey: Buffer | null = null;
let warnedAboutFileKey = false;

function deriveKeyFromString(value: string): Buffer {
  const trimmed = value.trim();
  // 64-char hex
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  // 44-char base64 decoding to exactly 32 bytes
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 32) return buf;
  }
  // Fallback: hash any passphrase to a stable 32-byte key.
  return createHash("sha256").update(trimmed, "utf8").digest();
}

function loadOrCreateFileKey(): Buffer {
  if (existsSync(KEY_FILE)) {
    const raw = readFileSync(KEY_FILE, "utf8").trim();
    return deriveKeyFromString(raw);
  }
  // Generate a fresh 32-byte key, store as hex, chmod 600.
  const key = randomBytes(32);
  const dir = dirname(KEY_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(KEY_FILE, key.toString("hex"), { mode: 0o600 });
  try {
    chmodSync(KEY_FILE, 0o600);
  } catch {
    // best effort on platforms without chmod semantics
  }
  return key;
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.GROUNDCONTROL_SECRET;
  if (envKey && envKey.trim().length > 0) {
    cachedKey = deriveKeyFromString(envKey);
    return cachedKey;
  }

  if (!warnedAboutFileKey) {
    console.warn(
      "[groundcontrol] GROUNDCONTROL_SECRET is not set. Falling back to a generated key " +
        "file at prisma/.groundcontrol-key (chmod 600). This works out-of-the-box but is " +
        "less secure than supplying a 32-byte key via the GROUNDCONTROL_SECRET env var. " +
        "Set GROUNDCONTROL_SECRET in production and keep it out of the repo."
    );
    warnedAboutFileKey = true;
  }
  cachedKey = loadOrCreateFileKey();
  return cachedKey;
}

/** True if the value is one of our encrypted envelopes. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Encrypt plaintext into a base64 "enc:v1:" envelope. */
export function encrypt(plaintext: string): string {
  if (plaintext == null) return plaintext as unknown as string;
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([iv, tag, encrypted]).toString("base64");
  return PREFIX + envelope;
}

/** Decrypt an "enc:v1:" envelope back to plaintext. */
export function decrypt(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) {
    // Not encrypted (legacy plaintext) — return as-is so reads stay safe.
    return ciphertext;
  }
  const key = getKey();
  const raw = Buffer.from(ciphertext.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * Encrypt only if not already encrypted. Used on write so we never
 * double-encrypt. Null/empty passes through unchanged.
 */
export function encryptIfNeeded(
  value: string | null | undefined
): string | null | undefined {
  if (value == null || value === "") return value;
  if (isEncrypted(value)) return value;
  return encrypt(value);
}

/**
 * Decrypt if encrypted, otherwise return plaintext untouched.
 * Used at read time to transparently support legacy plaintext values.
 */
export function decryptMaybe(
  value: string | null | undefined
): string | null | undefined {
  if (value == null || value === "") return value;
  if (isEncrypted(value)) return decrypt(value);
  return value;
}
