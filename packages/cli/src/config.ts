import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ServerEntry {
  server: string;
  token: string;
  sessionToken?: string;
  sessionExpiresAt?: number;
}

export interface ClientConfig {
  activeServer?: string;
  servers: Record<string, ServerEntry>;
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
    const parsed = JSON.parse(raw);

    // Migrate legacy single-server format
    if (parsed.server && parsed.token && !parsed.servers) {
      const name = deriveServerName(parsed.server);
      const migrated: ClientConfig = {
        activeServer: name,
        servers: {
          [name]: {
            server: parsed.server,
            token: parsed.token,
            sessionToken: parsed.sessionToken,
            sessionExpiresAt: parsed.sessionExpiresAt,
          },
        },
      };
      await writeConfig(migrated);
      return migrated;
    }

    return { activeServer: parsed.activeServer, servers: parsed.servers ?? {} };
  } catch {
    return { servers: {} };
  }
}

export async function writeConfig(config: ClientConfig): Promise<void> {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getConfigPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function getActiveEntry(config: ClientConfig): { name: string; entry: ServerEntry } | undefined {
  if (!config.activeServer || !config.servers[config.activeServer]) return undefined;
  return { name: config.activeServer, entry: config.servers[config.activeServer] };
}

export async function addServer(name: string, server: string, token: string): Promise<void> {
  const config = await readConfig();

  // Check if a server with this URL already exists (update token)
  for (const [existingName, entry] of Object.entries(config.servers)) {
    if (normalizeUrl(entry.server) === normalizeUrl(server)) {
      config.servers[existingName] = { server, token };
      config.activeServer = existingName;
      await writeConfig(config);
      return;
    }
  }

  config.servers[name] = { server, token };
  config.activeServer = name;
  await writeConfig(config);
}

export async function updateServerSession(
  name: string,
  sessionToken: string,
  sessionExpiresAt: number,
): Promise<void> {
  const config = await readConfig();
  const entry = config.servers[name];
  if (!entry) return;
  entry.sessionToken = sessionToken;
  entry.sessionExpiresAt = sessionExpiresAt;
  await writeConfig(config);
}

export function deriveServerName(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.split(".")[0];
  } catch {
    return "default";
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function getSkillConfigPath(): string | undefined {
  // Inside Claude code exec with skill installed
  try {
    return "/mnt/skills/user/gigai/config.json";
  } catch {
    return undefined;
  }
}
