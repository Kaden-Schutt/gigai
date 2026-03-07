import type { PairResponse } from "@gigai/shared";
import { updateConfig } from "./config.js";
import { getOrgUUID } from "./identity.js";
import { createHttpClient } from "./http.js";

export async function pair(code: string, serverUrl: string): Promise<void> {
  const orgUuid = getOrgUUID();
  const http = createHttpClient(serverUrl);

  const res = await http.post<PairResponse>("/auth/pair", {
    pairingCode: code,
    orgUuid,
  });

  await updateConfig({
    server: serverUrl,
    token: res.encryptedToken,
    sessionToken: undefined,
    sessionExpiresAt: undefined,
  });

  console.log("Paired successfully!");
}
