import type { PairResponse, ToolSummary, HealthResponse } from "@gigai/shared";
import { addServer, readConfig } from "./config.js";
import { getOrgUUID } from "./identity.js";
import { createHttpClient } from "./http.js";
import { connect } from "./connect.js";
import { fetchTools } from "./discover.js";
import { generateSkillZip, writeSkillZip } from "./skill.js";
import { output, homePath } from "./output.js";

export async function pair(code: string, serverUrl: string): Promise<void> {
  const orgUuid = getOrgUUID();
  const http = createHttpClient(serverUrl);

  const res = await http.post<PairResponse>("/auth/pair", {
    pairingCode: code,
    orgUuid,
  });

  await addServer(res.serverName, serverUrl, res.encryptedToken);

  let tools: ToolSummary[] = [];
  let health: HealthResponse = { status: "ok", version: "unknown", uptime: 0 };
  try {
    const session = await connect();
    const authedHttp = createHttpClient(session.serverUrl, session.sessionToken);
    [health, tools] = await Promise.all([
      authedHttp.get<HealthResponse>("/health"),
      fetchTools(authedHttp),
    ]);
  } catch {
    // Best-effort — skill zip still works without tool list
  }

  const config = await readConfig();
  const serverCount = Object.keys(config.servers).length;

  const zip = await generateSkillZip(res.serverName, serverUrl, res.encryptedToken, tools, health, serverCount);
  const outPath = await writeSkillZip(zip);

  output({ server: res.serverName, skillPath: homePath(outPath) });
}
