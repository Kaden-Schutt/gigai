import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { KondConfigSchema, type KondConfig } from "@gigai/shared";

const DEFAULT_CONFIG_PATH = "kon.config.json";

export async function loadConfig(path?: string): Promise<KondConfig> {
  const configPath = resolve(path ?? DEFAULT_CONFIG_PATH);
  const raw = await readFile(configPath, "utf8");
  const json = JSON.parse(raw);
  return KondConfigSchema.parse(json);
}
