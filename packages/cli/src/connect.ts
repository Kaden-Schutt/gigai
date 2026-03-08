import type { ConnectResponse } from "@gigai/shared";
import { readConfig, writeConfig, getActiveEntry, updateServerSession } from "./config.js";
import { getOrgUUID } from "./identity.js";
import { createHttpClient } from "./http.js";

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

  return { serverUrl: entry.server, sessionToken: res.sessionToken };
}
