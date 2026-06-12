import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { encryptIfNeeded, decryptMaybe } from "./crypto";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

export type AiProvider = "openai" | "anthropic";

interface AiConfig {
  provider?: AiProvider;
  model?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  updatedAt?: string;
}

/**
 * Read the AI config from disk. Provider API keys are stored encrypted at rest;
 * legacy plaintext keys are transparently decrypted-on-read (passthrough) and
 * migrated to ciphertext on the next write.
 */
export function getAiConfig(): AiConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw: AiConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      // Decrypt for internal use; legacy plaintext passes through unchanged.
      if (raw.openaiApiKey) raw.openaiApiKey = decryptMaybe(raw.openaiApiKey) || undefined;
      if (raw.anthropicApiKey) raw.anthropicApiKey = decryptMaybe(raw.anthropicApiKey) || undefined;
      return raw;
    }
  } catch {
    // ignore
  }
  return {};
}

/**
 * Persist the AI config. Provider API keys are encrypted before they touch disk.
 */
export function setAiConfig(config: AiConfig) {
  const toStore: AiConfig = { ...config, updatedAt: new Date().toISOString() };
  if (toStore.openaiApiKey) toStore.openaiApiKey = encryptIfNeeded(toStore.openaiApiKey) || undefined;
  if (toStore.anthropicApiKey) toStore.anthropicApiKey = encryptIfNeeded(toStore.anthropicApiKey) || undefined;
  writeFileSync(CONFIG_PATH, JSON.stringify(toStore, null, 2));
}

export function getOpenAIKey(): string | undefined {
  // Priority: env var > file config (decrypted by getAiConfig)
  return process.env.OPENAI_API_KEY || getAiConfig().openaiApiKey;
}

export function getAnthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || getAiConfig().anthropicApiKey;
}

/**
 * The active provider. Explicit config wins; otherwise fall back to whichever
 * provider has a usable key (preferring Anthropic when both env keys exist),
 * defaulting to OpenAI so existing single-provider setups are unaffected.
 */
export function getAiProvider(): AiProvider {
  const cfg = getAiConfig();
  if (cfg.provider === "anthropic" || cfg.provider === "openai") return cfg.provider;
  if (getAnthropicKey() && !getOpenAIKey()) return "anthropic";
  return "openai";
}

/**
 * Resolve the active model, allowing env var overrides.
 * OpenAI: AI_MODEL (legacy) or AI_MODEL_OPENAI.
 * Anthropic: AI_MODEL_ANTHROPIC.
 * File-configured model is the fallback when no env var is set.
 */
export function getAiModel(): string {
  const cfg = getAiConfig();
  const provider = getAiProvider();
  if (provider === "anthropic") {
    return process.env.AI_MODEL_ANTHROPIC || cfg.model || "claude-3-5-sonnet-latest";
  }
  return process.env.AI_MODEL_OPENAI || process.env.AI_MODEL || cfg.model || "gpt-4o-mini";
}

/** Resolve the active provider, key, and model, for the chat route. */
export function getActiveAi(): { provider: AiProvider; apiKey: string | undefined; model: string } {
  const provider = getAiProvider();
  return {
    provider,
    apiKey: provider === "anthropic" ? getAnthropicKey() : getOpenAIKey(),
    model: getAiModel(),
  };
}
