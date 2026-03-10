import type { ConnectResponse, HealthResponse } from "@gigai/shared";
import { readConfig, writeConfig, getActiveEntry, updateServerSession } from "./config.js";
import { getOrgUUID } from "./identity.js";
import { createHttpClient, type HttpClient } from "./http.js";
import { VERSION } from "./version.js";

export interface ConnectResult {
  serverUrl: string;
  sessionToken: string;
  http: HttpClient;
}

export async function connect(serverName?: string): Promise<ConnectResult> {
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

  // Auth refresh callback — used by HttpClient on 401
  const onAuthFailure = async (): Promise<string | undefined> => {
    try {
      const result = await doRefreshSession(name, entry.server, entry.token);
      return result.sessionToken;
    } catch {
      return undefined;
    }
  };

  // Check if existing session is still valid (with 5 min buffer)
  if (entry.sessionToken && entry.sessionExpiresAt) {
    if (Date.now() < entry.sessionExpiresAt - 5 * 60 * 1000) {
      const token = await checkAndUpdateServer(entry.server, entry.sessionToken, name, entry.token);
      const http = createHttpClient(entry.server, token, onAuthFailure);
      return { serverUrl: entry.server, sessionToken: token, http };
    }
  }

  const result = await doRefreshSession(name, entry.server, entry.token);
  const http = createHttpClient(entry.server, result.sessionToken, onAuthFailure);
  return { serverUrl: entry.server, sessionToken: result.sessionToken, http };
}

/**
 * Exchange the stored encrypted token for a fresh session.
 */
export async function refreshSession(
  serverName: string,
  serverUrl: string,
  encryptedToken: string,
): Promise<{ serverUrl: string; sessionToken: string }> {
  return doRefreshSession(serverName, serverUrl, encryptedToken);
}

async function doRefreshSession(
  serverName: string,
  serverUrl: string,
  encryptedToken: string,
): Promise<{ serverUrl: string; sessionToken: string }> {
  const orgUuid = getOrgUUID();
  const http = createHttpClient(serverUrl);

  const res = await http.post<ConnectResponse>("/auth/connect", {
    encryptedToken,
    orgUuid,
  });

  await updateServerSession(serverName, res.sessionToken, res.expiresAt);

  // Check server version after connecting
  const token = await checkAndUpdateServer(serverUrl, res.sessionToken, serverName, encryptedToken);

  return { serverUrl, sessionToken: token };
}

async function checkAndUpdateServer(
  serverUrl: string,
  sessionToken: string,
  serverName?: string,
  encryptedToken?: string,
): Promise<string> {
  try {
    const http = createHttpClient(serverUrl);
    const health = await http.get<HealthResponse>("/health");

    // Cache platform info
    if (health.platform || health.hostname) {
      const config = await readConfig();
      for (const entry of Object.values(config.servers)) {
        if (normalizeUrl(entry.server) === normalizeUrl(serverUrl)) {
          entry.platform = health.platform;
          entry.hostname = health.hostname;
          break;
        }
      }
      await writeConfig(config);
    }

    if (isNewer(VERSION, health.version)) {
      const authedHttp = createHttpClient(serverUrl, sessionToken);
      const res = await authedHttp.post<{ updated: boolean; restarting?: boolean; error?: string }>("/admin/update");

      if (res.updated) {
        await waitForServer(serverUrl, 15_000);

        if (serverName && encryptedToken) {
          const orgUuid = getOrgUUID();
          const unauthHttp = createHttpClient(serverUrl);
          const connectRes = await unauthHttp.post<ConnectResponse>("/auth/connect", {
            encryptedToken,
            orgUuid,
          });
          await updateServerSession(serverName, connectRes.sessionToken, connectRes.expiresAt);
          return connectRes.sessionToken;
        }
      }
    }
  } catch {
    // Version check/update is best-effort — don't block connect
  }
  return sessionToken;
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

function normalizeUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
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
