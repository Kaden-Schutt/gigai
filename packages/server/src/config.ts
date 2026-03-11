import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { KondConfigSchema, type KondConfig } from "@gigai/shared";

export function getKondDir(): string {
  return process.env.KOND_CONFIG_DIR ?? join(homedir(), ".kond");
}

export function getDefaultConfigPath(): string {
  return join(getKondDir(), "config.json");
}

export async function loadConfig(path?: string): Promise<KondConfig> {
  const configPath = resolve(path ?? getDefaultConfigPath());
  const raw = await readFile(configPath, "utf8");
  const json = JSON.parse(raw);
  return KondConfigSchema.parse(json);
}
