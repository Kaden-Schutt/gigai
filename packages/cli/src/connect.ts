import type { ConnectResponse } from "@gigai/shared";
import { readConfig, updateConfig } from "./config.js";
import { getOrgUUID } from "./identity.js";
import { createHttpClient } from "./http.js";

export async function connect(): Promise<{ serverUrl: string; sessionToken: string }> {
  const config = await readConfig();

  if (!config.server) {
    throw new Error("No server configured. Run 'gigai pair' first.");
  }

  if (!config.token) {
    throw new Error("No auth token found. Run 'gigai pair' first.");
  }

  // Check if existing session is still valid (with 5 min buffer)
  if (config.sessionToken && config.sessionExpiresAt) {
    if (Date.now() < config.sessionExpiresAt - 5 * 60 * 1000) {
      return { serverUrl: config.server, sessionToken: config.sessionToken };
    }
  }

  // Exchange token for session
  const orgUuid = getOrgUUID();
  const http = createHttpClient(config.server);

  const res = await http.post<ConnectResponse>("/auth/connect", {
    encryptedToken: config.token,
    orgUuid,
  });

  await updateConfig({
    sessionToken: res.sessionToken,
    sessionExpiresAt: res.expiresAt,
  });

  return { serverUrl: config.server, sessionToken: res.sessionToken };
}
