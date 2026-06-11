import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { encryptIfNeeded, decryptMaybe } from "./crypto";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

interface AiConfig {
  openaiApiKey?: string;
  updatedAt?: string;
}

/**
 * Read the AI config from disk. The OpenAI key is stored encrypted at rest;
 * legacy plaintext keys are transparently decrypted-on-read (passthrough) and
 * migrated to ciphertext on the next write.
 */
export function getAiConfig(): AiConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw: AiConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      if (raw.openaiApiKey) {
        // Decrypt for internal use; legacy plaintext passes through unchanged.
        raw.openaiApiKey = decryptMaybe(raw.openaiApiKey) || undefined;
      }
      return raw;
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * Persist the AI config. The OpenAI key is encrypted before it touches disk.
 */
export function setAiConfig(config: AiConfig) {
  const toStore: AiConfig = { ...config, updatedAt: new Date().toISOString() };
  if (toStore.openaiApiKey) {
    toStore.openaiApiKey = encryptIfNeeded(toStore.openaiApiKey) || undefined;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(toStore, null, 2));
}

export function getOpenAIKey(): string | undefined {
  // Priority: env var > file config (decrypted by getAiConfig)
  return process.env.OPENAI_API_KEY || getAiConfig().openaiApiKey;
}
