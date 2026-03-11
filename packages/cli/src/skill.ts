import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { ToolSummary, HealthResponse } from "@gigai/shared";

function platformLabel(p?: string): string {
  if (!p) return "unknown";
  if (p === "darwin") return "macOS";
  if (p === "linux") return "Linux";
  if (p === "win32") return "Windows";
  return p;
}

export function generateSkillMd(
  health: HealthResponse,
  tools: ToolSummary[],
  serverCount: number,
): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("name: kon");
  lines.push("description: Access tools on the user's machine via kon (kond client)");
  lines.push("---");
  lines.push("");
  lines.push("# kon");
  lines.push("");
  lines.push(`Connected to **${health.hostname}** (${platformLabel(health.platform)}, kond v${health.version})`);
  lines.push("");

  // Setup
  lines.push("## Setup (run once per conversation)");
  lines.push("");
  lines.push("```bash");
  lines.push("curl -fsSL https://kon.schutt.dev | sh");
  lines.push("mkdir -p ~/.kon");
  lines.push("cp /mnt/skills/user/kon/config.json ~/.kon/config.json");
  lines.push("kon connect");
  lines.push("```");
  lines.push("");

  // Tool index
  lines.push("## Available tools");
  lines.push("");
  lines.push("| Tool | Type | Description |");
  lines.push("|------|------|-------------|");
  for (const t of tools) {
    lines.push(`| ${t.name} | ${t.type} | ${t.description} |`);
  }
  lines.push("");

  // Usage hint
  lines.push("Run `kon help <tool-name>` to get full usage, arguments, and schemas before calling unfamiliar tools. Builtins (bash, read, write, edit, glob, grep) follow standard Claude Code conventions and generally don't need help lookup.");
  lines.push("");

  // Multi-server
  if (serverCount > 1) {
    lines.push("## Multiple servers");
    lines.push("");
    lines.push("```bash");
    lines.push("kon status                    # show all servers + active");
    lines.push("kon connect <server-name>     # switch to a different server");
    lines.push("```");
    lines.push("");
    lines.push("Switch servers when a task requires a specific platform (e.g. iMessage requires macOS, systemd requires Linux).");
    lines.push("");
  }

  // Important
  lines.push("## Important");
  lines.push("");
  lines.push("- Always run the setup block before first use in a new conversation");
  lines.push("- All commands execute on the **user's machine**, not in this sandbox");
  lines.push("- If you get auth errors, run `kon connect` to refresh the session");
  lines.push("");

  return lines.join("\n");
}

// --- Skill zip generation ---

interface SkillConfig {
  activeServer?: string;
  servers: Record<string, { server: string; token: string }>;
}

export async function generateSkillZip(
  serverName: string,
  serverUrl: string,
  token: string,
  tools: ToolSummary[],
  health: HealthResponse,
  serverCount: number,
): Promise<Buffer> {
  let skillConfig: SkillConfig = { servers: {} };

  try {
    const raw = await readFile("/mnt/skills/user/kon/config.json", "utf8");
    const existing = JSON.parse(raw) as SkillConfig;
    if (existing.servers) {
      skillConfig = existing;
    }
  } catch {}

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
  const skillMd = generateSkillMd(health, tools, serverCount);

  const entries: ZipEntry[] = [
    { path: "kon/SKILL.md", data: Buffer.from(skillMd, "utf8") },
    { path: "kon/config.json", data: Buffer.from(configJson, "utf8") },
  ];

  return createZip(entries);
}

export async function writeSkillZip(zip: Buffer): Promise<string> {
  const outputsDir = "/mnt/user-data/outputs";
  try {
    await mkdir(outputsDir, { recursive: true });
    const outPath = `${outputsDir}/kon.zip`;
    await writeFile(outPath, zip);
    return outPath;
  } catch {
    const outPath = "kon.zip";
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
