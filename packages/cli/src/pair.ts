import type { PairResponse } from "@gigai/shared";
import { addServer } from "./config.js";
import { getOrgUUID } from "./identity.js";
import { createHttpClient } from "./http.js";
import { generateSkillZip, writeSkillZip, hasExistingSkill } from "./skill.js";

export async function pair(code: string, serverUrl: string): Promise<void> {
  const orgUuid = getOrgUUID();
  const http = createHttpClient(serverUrl);

  const res = await http.post<PairResponse>("/auth/pair", {
    pairingCode: code,
    orgUuid,
  });

  await addServer(res.serverName, serverUrl, res.encryptedToken);
  console.log(`Paired with "${res.serverName}" successfully!`);

  // Generate skill zip
  const existing = await hasExistingSkill();
  const zip = await generateSkillZip(res.serverName, serverUrl, res.encryptedToken);
  const outPath = await writeSkillZip(zip);

  console.log(`\nSkill zip written to: ${outPath}`);
  if (existing) {
    console.log("Skill file updated. Download and re-upload to Claude.");
  } else {
    console.log("Upload this file as a skill in Claude (Settings → Customize → Upload Skill).");
  }
}
