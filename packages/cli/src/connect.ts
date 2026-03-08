import type { ConnectResponse, HealthResponse } from "@gigai/shared";
import { readConfig, writeConfig, getActiveEntry, updateServerSession } from "./config.js";
import { getOrgUUID } from "./identity.js";
import { createHttpClient } from "./http.js";
import { VERSION } from "./version.js";

export async function connect(serverName?: string): Promise<{ serverUrl: string; sessionToken: string }> {
  const config = await readConfig();

  // Switch active server if name provided
  if (serverName) {
    if (!config.servers[serverName]) {
      const available = Object.keys(config.servers);
      throw new Error(
        available.length > 0
          ? `Unknown server "${serverName}". Available: ${available.join(", ")}`
          : `No servers configured. Run 'gigai pair' first.`,
      );
    }
    config.activeServer = serverName;
    await writeConfig(config);
  }

  const active = getActiveEntry(config);
  if (!active) {
    throw new Error("No server configured. Run 'gigai pair' first.");
  }

  const { name, entry } = active;

  // Check if existing session is still valid (with 5 min buffer)
  if (entry.sessionToken && entry.sessionExpiresAt) {
    if (Date.now() < entry.sessionExpiresAt - 5 * 60 * 1000) {
      // Check server version even with cached session
      await checkAndUpdateServer(entry.server, entry.sessionToken);
      return { serverUrl: entry.server, sessionToken: entry.sessionToken };
    }
  }

  // Exchange token for session
  const orgUuid = getOrgUUID();
  const http = createHttpClient(entry.server);

  const res = await http.post<ConnectResponse>("/auth/connect", {
    encryptedToken: entry.token,
    orgUuid,
  });

  await updateServerSession(name, res.sessionToken, res.expiresAt);

  // Check server version after connecting
  await checkAndUpdateServer(entry.server, res.sessionToken);

  return { serverUrl: entry.server, sessionToken: res.sessionToken };
}

async function checkAndUpdateServer(serverUrl: string, sessionToken: string): Promise<void> {
  try {
    const http = createHttpClient(serverUrl);
    const health = await http.get<HealthResponse>("/health");

    if (isNewer(VERSION, health.version)) {
      console.log(`Server is outdated (${health.version} → ${VERSION}). Updating...`);

      const authedHttp = createHttpClient(serverUrl, sessionToken);
      const res = await authedHttp.post<{ updated: boolean; restarting?: boolean; error?: string }>("/admin/update");

      if (res.updated) {
        console.log("Server updated and restarting.");
        // Wait for server to restart
        await waitForServer(serverUrl, 15_000);
        console.log("Server is back online.");
      } else {
        console.log(`Server update failed: ${res.error ?? "unknown error"}`);
      }
    }
  } catch {
    // Version check/update is best-effort — don't block connect
  }
}

async function waitForServer(serverUrl: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  const http = createHttpClient(serverUrl);

  // Brief pause to let old server shut down
  await new Promise((r) => setTimeout(r, 2000));

  while (Date.now() - start < timeoutMs) {
    try {
      await http.get<HealthResponse>("/health");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function isNewer(client: string, server: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, "").split("-");
    const parts = core.split(".").map(Number);
    // Release (no pre) is higher than any prerelease
    const preNum = pre ? parseInt(pre.replace(/\D+/g, "")) || 0 : Infinity;
    return [...parts, preNum];
  };

  const c = parse(client);
  const s = parse(server);

  for (let i = 0; i < Math.max(c.length, s.length); i++) {
    const cv = c[i] ?? 0;
    const sv = s[i] ?? 0;
    if (cv > sv) return true;
    if (cv < sv) return false;
  }
  return false;
}
