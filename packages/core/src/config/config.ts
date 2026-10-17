import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { PermissionPolicy } from "../permission/permission.js";

export interface ProviderConfig {
  type: "openai-compatible" | "anthropic" | "ollama" | "openrouter" | "zai" | "custom";
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

export interface Config {
  version: string;
  defaultProvider: string;
  defaultModel: string;
  permissions: PermissionPolicy;
  providers: Record<string, ProviderConfig>;
}

export function configPath(): string {
  return join(homedir(), ".lumpscode", "config.json");
}

export function defaultConfig(): Config {
  return {
    version: "0.0.0",
    defaultProvider: "openai-compatible",
    defaultModel: "gpt-4o",
    permissions: { mode: "ask", allowedGroups: ["read"] },
    providers: {
      "openai-compatible": {
        type: "openai-compatible",
        baseUrl: "http://localhost:20128/v1",
        models: ["gpt-4o", "gpt-4o-mini"],
      },
      ollama: {
        type: "ollama",
        baseUrl: "http://localhost:11434",
        models: ["llama3", "qwen2.5-coder"],
      },
    },
  };
}

export function loadConfig(path: string = configPath()): Config {
  if (!existsSync(path)) return defaultConfig();
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  return { ...defaultConfig(), ...raw };
}

export function saveConfig(config: Config, path: string = configPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}