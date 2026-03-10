import type { PairResponse, ToolDetail } from "@gigai/shared";
import { addServer } from "./config.js";
import { getOrgUUID } from "./identity.js";
import { createHttpClient } from "./http.js";
import { connect } from "./connect.js";
import { fetchTools, fetchToolDetail } from "./discover.js";
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

  // Connect to get a session, then fetch tool details for the skill zip
  let toolDetails: ToolDetail[] | undefined;
  try {
    const session = await connect();
    const authedHttp = createHttpClient(session.serverUrl, session.sessionToken);
    const tools = await fetchTools(authedHttp);
    toolDetails = await Promise.all(
      tools.map(async (t) => {
        const { tool } = await fetchToolDetail(authedHttp, t.name);
        return tool;
      }),
    );
  } catch {
    // Tool fetching is best-effort — skill zip still works without tool files
  }

  // Generate skill zip
  const zip = await generateSkillZip(res.serverName, serverUrl, res.encryptedToken, toolDetails);
  const outPath = await writeSkillZip(zip);

  output({ server: res.serverName, skillPath: homePath(outPath) });
}
