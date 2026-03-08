import type { PairResponse } from "@gigai/shared";
import { addServer } from "./config.js";
import { getOrgUUID } from "./identity.js";
import { createHttpClient } from "./http.js";
import { generateSkillZip, writeSkillZip } from "./skill.js";

export async function pair(code: string, serverUrl: string): Promise<void> {
  const orgUuid = getOrgUUID();
  const http = createHttpClient(serverUrl);

  const res = await http.post<PairResponse>("/auth/pair", {
    pairingCode: code,
    orgUuid,
  });

  await addServer(res.serverName, serverUrl, res.encryptedToken);
  console.log(`Paired with "${res.serverName}" successfully!\n`);

  // Generate skill zip
  const zip = await generateSkillZip(res.serverName, serverUrl, res.encryptedToken);
  const outPath = await writeSkillZip(zip);
  console.log(`Skill zip written to: ${outPath}`);
  console.log("Upload this file as a skill in Claude Desktop (Settings → Customize → Upload Skill).");
}
