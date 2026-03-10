import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClientConfig, ServerEntry } from "./config.js";
import type { ToolDetail, McpToolInfo } from "@gigai/shared";

const SKILL_MD = `---
name: kon
description: Access tools on the user's machine via kon (kond client)
---

# kon

You have access to tools running on the user's local machine through kon, the kond client CLI. It proxies commands over HTTPS to a server on the user's machine.

## Setup (run once per conversation)

\`\`\`bash
curl -fsSL https://kon.schutt.dev | sh
mkdir -p ~/.kon
cp /mnt/skills/user/kon/config.json ~/.kon/config.json
kon connect
\`\`\`

If \`kon connect\` succeeds, you are ready to use tools. If it fails, tell the user.

## Discovering tools

List all available tools:
\`\`\`bash
kon list
\`\`\`

Get detailed help for a specific tool:
\`\`\`bash
kon help <tool-name>
\`\`\`

## Core tools

These tools may be available depending on the server's configuration. Run \`kon list\` to see what's enabled.

### read — Read file contents
\`\`\`bash
kon read <file> [offset] [limit]
\`\`\`
- \`offset\`: start from this line number (0-based)
- \`limit\`: max number of lines to return

### write — Write content to a file
\`\`\`bash
kon write <file> <content>
\`\`\`

### edit — Replace text in a file
\`\`\`bash
kon edit <file> <old_string> <new_string> [--all]
\`\`\`
- Without \`--all\`: fails if old_string matches multiple locations (provide more context)
- With \`--all\`: replaces every occurrence

### glob — Find files by pattern
\`\`\`bash
kon glob <pattern> [path]
\`\`\`
- Supports \`*\`, \`**\`, \`?\`, \`{a,b}\` syntax
- Example: \`kon glob "**/*.ts" ~/projects/myapp\`

### grep — Search file contents
\`\`\`bash
kon grep <pattern> [path] [--glob <filter>] [-i] [-n] [-C <num>]
\`\`\`
- Uses ripgrep if available, falls back to built-in search
- Example: \`kon grep "TODO" ~/projects --glob "*.ts"\`

### bash — Execute shell commands
\`\`\`bash
kon bash <command> [args...]
\`\`\`
- Execute shell commands on the user's machine
- Example: \`kon bash git status\`

### File transfer
\`\`\`bash
kon upload <file>
kon download <id> <dest>
\`\`\`

## Other tools

The server may have additional tools registered (CLI commands, MCP servers, scripts). Any unknown subcommand is treated as a tool name:

\`\`\`bash
kon <tool-name> [args...]
\`\`\`

For MCP tools, the first arg is the MCP tool name:
\`\`\`bash
kon <mcp-tool> <mcp-action> [json-args]
\`\`\`

## Scheduling tasks

Schedule any tool execution on the server:
\`\`\`bash
kon cron add "0 9 * * *" bash git pull              # daily at 9am
kon cron add --at "9:00 AM tomorrow" bash git pull   # one-shot
kon cron add --at "in 30 minutes" read ~/log.txt     # relative time
kon cron list                                        # list scheduled jobs
kon cron remove <id>                                 # remove a job
\`\`\`

## Multiple servers

The user may have multiple servers configured (e.g. a Mac and a Linux machine). Use \`kon status\` to see all servers and which is active.

\`\`\`bash
kon status                    # show all servers + active
kon connect <server-name>     # switch to a different server
kon list                      # list tools on the current server
\`\`\`

**Routing between servers:** When a tool is not available on the current server, or when a task requires a specific platform (e.g. iMessage requires macOS), switch to the appropriate server:

1. Run \`kon status\` to see available servers
2. Run \`kon connect <server-name>\` to switch
3. Run \`kon list\` to verify the tool is available
4. Execute the command

Platform-specific capabilities:
- **iMessage**: only available on macOS servers
- **macOS apps** (Shortcuts, AppleScript): only on macOS servers
- **systemd, apt, etc.**: only on Linux servers

The \`kon list\` response includes the server's platform. Use this to determine which server to route a request to.

## Important

- Always run the setup block before first use in a new conversation
- All commands execute on the **user's machine**, not in this sandbox
- If you get auth errors, run \`kon connect\` to refresh the session
- Tools are scoped to what the user has configured — if a tool is missing, tell the user
- If you have multiple servers, check which server has the tool you need before executing
`;

export async function hasExistingSkill(): Promise<boolean> {
  try {
    await readFile("/mnt/skills/user/kon/config.json", "utf8");
    return true;
  } catch {
    return false;
  }
}

interface SkillConfig {
  activeServer?: string;
  servers: Record<string, { server: string; token: string }>;
}

export function generateToolMarkdown(tool: ToolDetail): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push("---");
  lines.push(`name: ${tool.name}`);
  lines.push(`description: ${tool.description}`);
  lines.push("---");
  lines.push("");

  // Header
  lines.push(`# ${tool.name}`);
  lines.push("");
  lines.push(`**Type:** ${tool.type}`);
  lines.push("");
  lines.push(tool.description);
  lines.push("");

  // Usage section
  lines.push("## Usage");
  lines.push("");

  if (tool.type === "builtin") {
    // Builtin tools have specific usage patterns
    switch (tool.name) {
      case "read":
        lines.push("```bash");
        lines.push("kon read <file> [offset] [limit]");
        lines.push("```");
        break;
      case "write":
        lines.push("```bash");
        lines.push("kon write <file> <content>");
        lines.push("```");
        break;
      case "edit":
        lines.push("```bash");
        lines.push("kon edit <file> <old_string> <new_string> [--all]");
        lines.push("```");
        break;
      case "glob":
        lines.push("```bash");
        lines.push('kon glob <pattern> [path]');
        lines.push("```");
        break;
      case "grep":
        lines.push("```bash");
        lines.push("kon grep <pattern> [path] [--glob <filter>] [-i] [-n] [-C <num>]");
        lines.push("```");
        break;
      case "bash":
        lines.push("```bash");
        lines.push("kon bash <command> [args...]");
        lines.push("```");
        break;
      default:
        lines.push("```bash");
        lines.push(`kon ${tool.name} [args...]`);
        lines.push("```");
    }
  } else if (tool.type === "mcp") {
    lines.push("```bash");
    lines.push(`kon ${tool.name} <mcp-tool-name> [json-args]`);
    lines.push("```");
  } else {
    // CLI and script tools
    lines.push("```bash");
    lines.push(`kon ${tool.name} [args...]`);
    lines.push("```");
  }

  lines.push("");

  // Arguments section (if present)
  if (tool.args && tool.args.length > 0) {
    lines.push("## Arguments");
    lines.push("");
    for (const arg of tool.args) {
      const req = arg.required ? " *(required)*" : "";
      const def = arg.default ? ` (default: \`${arg.default}\`)` : "";
      lines.push(`- \`${arg.name}\`${req}: ${arg.description}${def}`);
    }
    lines.push("");
  }

  // MCP tools section
  if (tool.type === "mcp" && tool.mcpTools && tool.mcpTools.length > 0) {
    lines.push("## Available MCP Tools");
    lines.push("");
    for (const mcpTool of tool.mcpTools) {
      lines.push(`### ${mcpTool.name}`);
      lines.push("");
      lines.push(mcpTool.description);
      lines.push("");
      lines.push("**Input Schema:**");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(mcpTool.inputSchema, null, 2));
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function generateSkillZip(
  serverName: string,
  serverUrl: string,
  token: string,
  tools?: ToolDetail[],
): Promise<Buffer> {
  // Build the skill config, merging with existing if available
  let skillConfig: SkillConfig = { servers: {} };

  // Check for existing skill config (Claude code exec with skill installed)
  try {
    const raw = await readFile("/mnt/skills/user/kon/config.json", "utf8");
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

  const entries: ZipEntry[] = [
    { path: "kon/SKILL.md", data: Buffer.from(SKILL_MD, "utf8") },
    { path: "kon/config.json", data: Buffer.from(configJson, "utf8") },
  ];

  // Generate per-tool markdown files
  if (tools && tools.length > 0) {
    for (const tool of tools) {
      const md = generateToolMarkdown(tool);
      entries.push({
        path: `kon/tools/${tool.name}.md`,
        data: Buffer.from(md, "utf8"),
      });
    }
  }

  return createZip(entries);
}

export async function writeSkillZip(zip: Buffer): Promise<string> {
  // Inside Claude code exec: write to outputs dir
  const outputsDir = "/mnt/user-data/outputs";
  try {
    await mkdir(outputsDir, { recursive: true });
    const outPath = `${outputsDir}/kon.zip`;
    await writeFile(outPath, zip);
    return outPath;
  } catch {
    // Not in Claude code exec — write to cwd
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
