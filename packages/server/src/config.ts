import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GigaiConfigSchema, type GigaiConfig } from "@gigai/shared";

const DEFAULT_CONFIG_PATH = "gigai.config.json";

export async function loadConfig(path?: string): Promise<GigaiConfig> {
  const configPath = resolve(path ?? DEFAULT_CONFIG_PATH);
  const raw = await readFile(configPath, "utf8");
  const json = JSON.parse(raw);
  return GigaiConfigSchema.parse(json);
}
