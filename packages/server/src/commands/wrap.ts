import { input, select } from "@inquirer/prompts";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GigaiConfig, ToolConfig } from "@gigai/shared";
import { GigaiConfigSchema } from "@gigai/shared";

async function loadConfigFile(path?: string): Promise<{ config: GigaiConfig; path: string }> {
  const configPath = resolve(path ?? "gigai.config.json");
  const raw = await readFile(configPath, "utf8");
  const config = GigaiConfigSchema.parse(JSON.parse(raw));
  return { config, path: configPath };
}

async function saveConfig(config: GigaiConfig, path: string): Promise<void> {
  await writeFile(path, JSON.stringify(config, null, 2) + "\n");
}

export async function wrapCli(): Promise<void> {
  const { config, path } = await loadConfigFile();

  const name = await input({ message: "Tool name:", required: true });
  const command = await input({ message: "Command:", required: true });
  const description = await input({ message: "Description:", required: true });
  const argsStr = await input({ message: "Default args (space-separated, optional):" });
  const timeoutStr = await input({ message: "Timeout in ms (optional):", default: "30000" });

  const tool: ToolConfig = {
    type: "cli",
    name,
    command,
    description,
    ...(argsStr && { args: argsStr.split(" ").filter(Boolean) }),
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

  // Import pairing at runtime to avoid circular deps
  const { AuthStore } = await import("../auth/store.js");
  const { generatePairingCode } = await import("../auth/pairing.js");

  const store = new AuthStore();
  const code = generatePairingCode(store, config.auth.pairingTtlSeconds);
  console.log(`\nPairing code: ${code}`);
  console.log(`Expires in ${config.auth.pairingTtlSeconds / 60} minutes.`);
  console.log(`\nNote: The server must be running for the client to use this code.`);
  console.log(`For a live pairing code, use the server's /auth/pair/generate endpoint.`);
  store.destroy();
}
