import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClientConfig, ServerEntry } from "./config.js";

const SKILL_MD = `---
name: gigai
description: Access tools on the user's machine via the gigai CLI
---

# gigai

You have access to tools running on the user's local machine through the gigai CLI. This CLI proxies commands over HTTPS to a server on the user's machine.

## Setup (run once per conversation)

\`\`\`bash
npm install -g @schuttdev/gigai 2>/dev/null
mkdir -p ~/.gigai
cp /mnt/skills/user/gigai/config.json ~/.gigai/config.json
gigai connect
\`\`\`

If \`gigai connect\` succeeds, you are ready to use tools. If it fails, tell the user.

## Usage

### List available tools
\`\`\`bash
gigai list
\`\`\`

### Run a tool
\`\`\`bash
gigai <tool-name> [args...]
\`\`\`

Examples:
\`\`\`bash
gigai shell date
gigai fs list Documents
gigai shell whoami
\`\`\`

### Get help for a tool
\`\`\`bash
gigai help <tool-name>
\`\`\`

### Switch server (if multiple are configured)
\`\`\`bash
gigai connect <server-name>
\`\`\`

### File transfer
\`\`\`bash
gigai upload <file>
gigai download <id> <dest>
\`\`\`

## Important

- Always run the setup block before first use in a new conversation
- All commands execute on the **user's machine**, not in this sandbox
- If you get auth errors, run \`gigai connect\` to refresh the session
- Tools are scoped to what the user has configured — if a tool is missing, tell the user
`;

export async function hasExistingSkill(): Promise<boolean> {
  try {
    await readFile("/mnt/skills/user/gigai/config.json", "utf8");
    return true;
  } catch {
    return false;
  }
}

interface SkillConfig {
  activeServer?: string;
  servers: Record<string, { server: string; token: string }>;
}

export async function generateSkillZip(
  serverName: string,
  serverUrl: string,
  token: string,
): Promise<Buffer> {
  // Build the skill config, merging with existing if available
  let skillConfig: SkillConfig = { servers: {} };

  // Check for existing skill config (Claude code exec with skill installed)
  try {
    const raw = await readFile("/mnt/skills/user/gigai/config.json", "utf8");
    const existing = JSON.parse(raw) as SkillConfig;
    if (existing.servers) {
      skillConfig = existing;
    }
  } catch {
    // No existing skill — fresh config
  }

  // Merge: check if URL matches existing entry
  let merged = false;
  for (const [name, entry] of Object.entries(skillConfig.servers)) {
    if (normalizeHost(entry.server) === normalizeHost(serverUrl)) {
      skillConfig.servers[name] = { server: serverUrl, token };
      skillConfig.activeServer = name;
      merged = true;
      break;
    }
  }

  if (!merged) {
    skillConfig.servers[serverName] = { server: serverUrl, token };
    skillConfig.activeServer = serverName;
  }

  const configJson = JSON.stringify(skillConfig, null, 2) + "\n";

  return createZip([
    { path: "gigai/SKILL.md", data: Buffer.from(SKILL_MD, "utf8") },
    { path: "gigai/config.json", data: Buffer.from(configJson, "utf8") },
  ]);
}

export async function writeSkillZip(zip: Buffer): Promise<string> {
  // Inside Claude code exec: write to outputs dir
  const outputsDir = "/mnt/user-data/outputs";
  try {
    await mkdir(outputsDir, { recursive: true });
    const outPath = `${outputsDir}/gigai.zip`;
    await writeFile(outPath, zip);
    return outPath;
  } catch {
    // Not in Claude code exec — write to cwd
    const outPath = "gigai.zip";
    await writeFile(outPath, zip);
    return outPath;
  }
}

function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// --- Minimal ZIP creator (STORE, no compression) ---

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crc32Table[i] = c >>> 0;
}

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (const byte of data) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

interface ZipEntry {
  path: string;
  data: Buffer;
}

function createZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const checksum = crc32(entry.data);

    // Local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    parts.push(local, name, entry.data);

    // Central directory entry
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, name);
    offset += 30 + name.length + entry.data.length;
  }

  const centralDir = Buffer.concat(centralParts);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, centralDir, eocd]);
}
