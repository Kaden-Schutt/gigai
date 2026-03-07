import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ClientConfig {
  server?: string;
  token?: string;
  sessionToken?: string;
  sessionExpiresAt?: number;
}

function getConfigDir(): string {
  return process.env.GIGAI_CONFIG_DIR ?? join(homedir(), ".gigai");
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export async function readConfig(): Promise<ClientConfig> {
  try {
    const raw = await readFile(getConfigPath(), "utf8");
    return JSON.parse(raw) as ClientConfig;
  } catch {
    return {};
  }
}

export async function writeConfig(config: ClientConfig): Promise<void> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export async function updateConfig(updates: Partial<ClientConfig>): Promise<ClientConfig> {
  const config = await readConfig();
  Object.assign(config, updates);
  await writeConfig(config);
  return config;
}
