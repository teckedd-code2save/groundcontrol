import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), "ai-config.json");

interface AiConfig {
  openaiApiKey?: string;
  updatedAt?: string;
}

export function getAiConfig(): AiConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch {
    // ignore
  }
  return {};
}

export function setAiConfig(config: AiConfig) {
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2));
}

export function getOpenAIKey(): string | undefined {
  // Priority: env var > file config
  return process.env.OPENAI_API_KEY || getAiConfig().openaiApiKey;
}
