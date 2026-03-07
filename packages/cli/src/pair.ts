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

  console.log("Paired successfully!\n");

  // Output the skill file for the user to save
  const tokenStr = JSON.stringify(res.encryptedToken);
  const skillMd = generateSkill(serverUrl, tokenStr);
  console.log("Save the following as a Claude Desktop skill:\n");
  console.log("─".repeat(50));
  console.log(skillMd);
  console.log("─".repeat(50));
}

function generateSkill(serverUrl: string, token: string): string {
  return `---
name: gigai
description: Access tools on the user's machine via the gigai CLI
---

# gigai

You have access to tools running on the user's local machine through the gigai CLI. This CLI proxies commands over HTTPS to a server on the user's machine.

## Setup (run once per session)

Before using any gigai commands, you must install and configure the CLI in your code execution environment. Run this setup block:

\`\`\`bash
npm install -g @schuttdev/gigai 2>/dev/null

mkdir -p ~/.gigai
cat > ~/.gigai/config.json << 'GIGAI_EOF'
{
  "server": "${serverUrl}",
  "token": ${token}
}
GIGAI_EOF

gigai connect
\`\`\`

If \`gigai connect\` succeeds, you are ready to use tools. If it fails, tell the user.

## Usage

### List available tools
\`\`\`bash
gigai list
\`\`\`

### Get help for a tool
\`\`\`bash
gigai help <tool-name>
\`\`\`

### Run a tool
\`\`\`bash
gigai <tool-name> [args...]
\`\`\`

### File transfer
\`\`\`bash
gigai upload <file>
gigai download <id> <dest>
\`\`\`

## Important

- Always run the setup block before first use in a new session
- All commands execute on the **user's machine**, not in this sandbox
- If you get auth errors, run \`gigai connect\` to refresh the session
- Tools are scoped to what the user has configured — if a tool is missing, tell the user
`;
}
