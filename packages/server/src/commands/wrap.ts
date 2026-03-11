import { input, select } from "@inquirer/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { KondConfig, ToolConfig } from "@gigai/shared";
import { KondConfigSchema } from "@gigai/shared";
import { getDefaultConfigPath } from "../config.js";

function splitCommand(input: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input.trim()) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  return { command: tokens[0] ?? input.trim(), args: tokens.slice(1) };
}

async function loadConfigFile(path?: string): Promise<{ config: KondConfig; path: string }> {
  const configPath = resolve(path ?? getDefaultConfigPath());
  const raw = await readFile(configPath, "utf8");
  const config = KondConfigSchema.parse(JSON.parse(raw));
  return { config, path: configPath };
}

async function saveConfig(config: KondConfig, path: string): Promise<void> {
  await writeFile(path, JSON.stringify(config, null, 2) + "\n");
}

export async function wrapCli(): Promise<void> {
  const { config, path } = await loadConfigFile();

  const name = await input({ message: "Tool name:", required: true });
  const commandInput = await input({
    message: "Command (as you'd run it in your terminal):",
    required: true,
  });
  const description = await input({ message: "Description:", required: true });
  const timeoutStr = await input({ message: "Timeout in ms (optional):", default: "30000" });

  // Split like a shell: first token is the binary, rest are default args
  const { command, args } = splitCommand(commandInput);

  const tool: ToolConfig = {
    type: "cli",
    name,
    command,
    description,
    ...(args.length > 0 && { args }),
    timeout: parseInt(timeoutStr, 10),
  };

  config.tools.push(tool);
  await saveConfig(config, path);
  console.log(`Added CLI tool: ${name}`);
}

export async function wrapMcp(): Promise<void> {
  const { config, path } = await loadConfigFile();

  const name = await input({ message: "Tool name:", required: true });
  const command = await input({ message: "MCP server command:", required: true });
  const description = await input({ message: "Description:", required: true });
  const argsStr = await input({ message: "Command args (space-separated, optional):" });
  const envStr = await input({
    message: "Environment variables (KEY=VALUE, comma-separated, optional):",
  });

  const env: Record<string, string> = {};
  if (envStr) {
    for (const pair of envStr.split(",")) {
      const [k, ...v] = pair.trim().split("=");
      if (k && v.length > 0) {
        env[k.trim()] = v.join("=").trim();
      }
    }
  }

  const tool: ToolConfig = {
    type: "mcp",
    name,
    command,
    description,
    ...(argsStr && { args: argsStr.split(" ").filter(Boolean) }),
    ...(Object.keys(env).length > 0 && { env }),
  };

  config.tools.push(tool);
  await saveConfig(config, path);
  console.log(`Added MCP tool: ${name}`);
}

export async function wrapScript(): Promise<void> {
  const { config, path } = await loadConfigFile();

  const name = await input({ message: "Tool name:", required: true });
  const scriptPath = await input({ message: "Script path:", required: true });
  const description = await input({ message: "Description:", required: true });
  const interpreter = await input({ message: "Interpreter:", default: "node" });

  const tool: ToolConfig = {
    type: "script",
    name,
    path: scriptPath,
    description,
    interpreter,
  };

  config.tools.push(tool);
  await saveConfig(config, path);
  console.log(`Added script tool: ${name}`);
}

export async function wrapImport(configFilePath: string): Promise<void> {
  const { config, path } = await loadConfigFile();

  const raw = await readFile(resolve(configFilePath), "utf8");
  const desktopConfig = JSON.parse(raw);
  const mcpServers = desktopConfig.mcpServers ?? {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    const sc = serverConfig as {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };

    const tool: ToolConfig = {
      type: "mcp",
      name: serverName,
      command: sc.command,
      description: `Imported MCP server: ${serverName}`,
      ...(sc.args && { args: sc.args }),
      ...(sc.env && { env: sc.env }),
    };

    config.tools.push(tool);
    console.log(`  Imported: ${serverName}`);
  }

  await saveConfig(config, path);
  console.log(`\nImported ${Object.keys(mcpServers).length} MCP servers.`);
}

export async function mcpAdd(
  name: string,
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<void> {
  const { config, path } = await loadConfigFile();

  const existing = config.tools.find((t) => t.name === name);
  if (existing) {
    console.warn(`Warning: a tool named "${name}" already exists — overwriting.`);
    config.tools = config.tools.filter((t) => t.name !== name);
  }

  const tool: ToolConfig = {
    type: "mcp",
    name,
    command,
    description: `MCP server: ${name}`,
    ...(args.length > 0 && { args }),
    ...(env && Object.keys(env).length > 0 && { env }),
  };

  config.tools.push(tool);
  await saveConfig(config, path);
  console.log(`Added MCP server: ${name}`);
}

export async function mcpList(): Promise<void> {
  const { config } = await loadConfigFile();
  const mcpTools = config.tools.filter((t) => t.type === "mcp");

  if (mcpTools.length === 0) {
    console.log("No MCP servers configured.");
    return;
  }

  console.log(`\nMCP servers (${mcpTools.length}):\n`);
  for (const t of mcpTools) {
    const tool = t as { name: string; command: string; args?: string[]; env?: Record<string, string> };
    const cmdLine = [tool.command, ...(tool.args ?? [])].join(" ");
    console.log(`  ${tool.name}`);
    console.log(`    command: ${cmdLine}`);
    if (tool.env && Object.keys(tool.env).length > 0) {
      console.log(`    env: ${Object.keys(tool.env).join(", ")}`);
    }
    console.log();
  }
}

export async function unwrapTool(name: string): Promise<void> {
  const { config, path } = await loadConfigFile();

  const idx = config.tools.findIndex((t) => t.name === name);
  if (idx === -1) {
    console.error(`Tool not found: ${name}`);
    process.exitCode = 1;
    return;
  }

  config.tools.splice(idx, 1);
  await saveConfig(config, path);
  console.log(`Removed tool: ${name}`);
}

export async function generateServerPairingCode(configPath?: string): Promise<void> {
  const { config } = await loadConfigFile(configPath);
  const port = config.server.port;

  try {
    const res = await fetch(`http://localhost:${port}/auth/pair/generate`);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Server returned ${res.status}: ${body}`);
    }
    const data = await res.json() as { code: string; expiresIn: number };
    console.log(`\nPairing code: ${data.code}`);
    console.log(`Expires in ${data.expiresIn / 60} minutes.`);
  } catch (e) {
    if ((e as Error).message.includes("fetch failed") || (e as Error).message.includes("ECONNREFUSED")) {
      console.error("Server is not running. Start it with: kond start");
    } else {
      console.error(`Error: ${(e as Error).message}`);
    }
    process.exitCode = 1;
  }
}
