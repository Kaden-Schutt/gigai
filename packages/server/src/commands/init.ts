import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { homedir, platform } from "node:os";
import { generateEncryptionKey } from "@gigai/shared";
import type { GigaiConfig, ToolConfig } from "@gigai/shared";

const execFileAsync = promisify(execFile);

async function getTailscaleDnsName(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"]);
    const data = JSON.parse(stdout);
    const dnsName = data?.Self?.DNSName;
    if (dnsName) return dnsName.replace(/\.$/, "");
    return null;
  } catch {
    return null;
  }
}

async function ensureTailscaleFunnel(port: number): Promise<string> {
  const dnsName = await getTailscaleDnsName();
  if (!dnsName) {
    throw new Error("Tailscale is not running or not connected. Install/start Tailscale first.");
  }

  // Try enabling the funnel — this may prompt the user to enable it on their tailnet
  console.log("  Enabling Tailscale Funnel...");
  try {
    const { stdout, stderr } = await execFileAsync("tailscale", ["funnel", "--bg", `${port}`]);
    const output = stdout + stderr;

    if (output.includes("Funnel is not enabled")) {
      // Extract the enable URL
      const urlMatch = output.match(/(https:\/\/login\.tailscale\.com\/\S+)/);
      const enableUrl = urlMatch?.[1] ?? "https://login.tailscale.com/admin/machines";

      console.log(`\n  Funnel is not enabled on your tailnet.`);
      console.log(`  Enable it here: ${enableUrl}\n`);

      await confirm({ message: "I've enabled Funnel in my Tailscale admin. Continue?", default: true });

      // Retry
      const retry = await execFileAsync("tailscale", ["funnel", "--bg", `${port}`]);
      if ((retry.stdout + retry.stderr).includes("Funnel is not enabled")) {
        throw new Error("Funnel is still not enabled. Please enable it in your Tailscale admin and try again.");
      }
    }
  } catch (e) {
    if ((e as Error).message.includes("Funnel is still not enabled")) throw e;
    // execFileAsync may throw if the command returns non-zero but still succeeds
    // (tailscale funnel --bg can print warnings but still work)
  }

  // Verify funnel is active
  try {
    const { stdout } = await execFileAsync("tailscale", ["funnel", "status"]);
    if (stdout.includes("No serve config")) {
      throw new Error("Funnel setup failed. Run 'tailscale funnel --bg " + port + "' manually to debug.");
    }
  } catch {
    // funnel status may not be available on all versions, continue anyway
  }

  console.log(`  Tailscale Funnel active: https://${dnsName}`);
  return `https://${dnsName}`;
}

interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

async function detectClaudeDesktopConfig(): Promise<string | null> {
  try {
    const os = platform();

    if (os === "darwin") {
      const configPath = join(
        homedir(),
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
      const contents = await readFile(configPath, "utf-8");
      if (contents) return configPath;
    }

    if (os === "linux") {
      // Check if running under WSL
      try {
        const procVersion = await readFile("/proc/version", "utf-8");
        const isWsl = /microsoft|wsl/i.test(procVersion);
        if (!isWsl) return null; // Native Linux — no Claude Desktop
      } catch {
        return null;
      }

      // WSL: scan for Windows user directories
      try {
        const usersDir = "/mnt/c/Users";
        const entries = await readdir(usersDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name === "Public" || entry.name === "Default" || entry.name === "Default User") continue;
          const configPath = join(
            usersDir,
            entry.name,
            "AppData",
            "Roaming",
            "Claude",
            "claude_desktop_config.json",
          );
          try {
            const contents = await readFile(configPath, "utf-8");
            if (contents) return configPath;
          } catch {
            // This user directory doesn't have the config, try next
          }
        }
      } catch {
        // Can't read /mnt/c/Users — skip
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function scanMcpServers(
  configPath: string,
): Promise<Record<string, McpServerEntry> | null> {
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as { mcpServers?: Record<string, McpServerEntry> };
    if (!config.mcpServers || typeof config.mcpServers !== "object") return null;
    if (Object.keys(config.mcpServers).length === 0) return null;
    return config.mcpServers;
  } catch {
    return null;
  }
}

export async function runInit(): Promise<void> {
  console.log("\n  gigai server setup\n");

  // 1. HTTPS provider
  const httpsProvider = await select({
    message: "HTTPS provider:",
    choices: [
      { name: "Tailscale Funnel (recommended)", value: "tailscale" },
      { name: "Cloudflare Tunnel", value: "cloudflare" },
      { name: "Manual (provide certs)", value: "manual" },
      { name: "None (dev mode only)", value: "none" },
    ],
  });

  let httpsConfig: GigaiConfig["server"]["https"];

  switch (httpsProvider) {
    case "tailscale":
      httpsConfig = {
        provider: "tailscale" as const,
        funnelPort: 7443,
      };
      break;

    case "cloudflare": {
      const tunnelName = await input({
        message: "Cloudflare tunnel name:",
        default: "gigai",
      });
      const domain = await input({
        message: "Domain (optional):",
      });
      httpsConfig = {
        provider: "cloudflare" as const,
        tunnelName,
        ...(domain && { domain }),
      };
      break;
    }

    case "manual": {
      const certPath = await input({
        message: "Path to TLS certificate:",
        required: true,
      });
      const keyPath = await input({
        message: "Path to TLS private key:",
        required: true,
      });
      httpsConfig = {
        provider: "manual" as const,
        certPath,
        keyPath,
      };
      break;
    }

    case "none":
    default:
      httpsConfig = undefined;
      console.log("  No HTTPS — dev mode only.");
      break;
  }

  // 2. Port
  const portStr = await input({
    message: "Server port:",
    default: "7443",
  });
  const port = parseInt(portStr, 10);

  // 3. Security tier
  const securityTier = await select({
    message: "Security tier:",
    choices: [
      { name: "Strict — allowlist-only, explicit path restrictions (most secure)", value: "strict" as const },
      { name: "Standard — denylist blocks catastrophic commands, home dir open (recommended)", value: "standard" as const },
      { name: "Unrestricted — no restrictions, development only", value: "unrestricted" as const },
    ],
    default: "standard" as const,
  });

  // 4. Tool selection
  const selectedBuiltins = await checkbox({
    message: "Built-in tools to enable:",
    choices: [
      { name: "Filesystem (read/list/search files)", value: "filesystem", checked: true },
      { name: "Shell (execute allowed commands)", value: "shell", checked: true },
    ],
  });

  const tools: ToolConfig[] = [];

  if (selectedBuiltins.includes("filesystem")) {
    const restrictPaths = await confirm({
      message: "Restrict filesystem to specific paths?",
      default: false,
    });
    if (restrictPaths) {
      const pathsStr = await input({
        message: "Allowed paths (comma-separated):",
        default: process.env.HOME ?? "~",
      });
      const allowedPaths = pathsStr.split(",").map((p) => p.trim());
      tools.push({
        type: "builtin",
        name: "fs",
        builtin: "filesystem",
        description: "Read, list, and search files",
        config: { allowedPaths },
      });
    } else {
      tools.push({
        type: "builtin",
        name: "fs",
        builtin: "filesystem",
        description: "Read, list, and search files",
        config: {},
      });
    }
  }

  if (selectedBuiltins.includes("shell")) {
    const restrictCommands = await confirm({
      message: "Restrict shell to a command allowlist?",
      default: false,
    });
    const shellConfig: Record<string, unknown> = {};
    if (restrictCommands) {
      const allowlistStr = await input({
        message: "Allowed commands (comma-separated):",
        default: "ls,cat,head,tail,grep,find,wc,echo,date,whoami,pwd,git,npm,node",
      });
      shellConfig.allowlist = allowlistStr.split(",").map((c) => c.trim());
    }
    const blockSudo = await confirm({
      message: "Block sudo?",
      default: false,
    });
    if (blockSudo) {
      shellConfig.allowSudo = false;
    }
    tools.push({
      type: "builtin",
      name: "shell",
      builtin: "shell",
      description: "Execute shell commands",
      config: shellConfig,
    });
  }

  // 3b. MCP auto-import from Claude Desktop
  const configFilePath = await detectClaudeDesktopConfig();
  if (configFilePath) {
    const mcpServers = await scanMcpServers(configFilePath);
    if (mcpServers) {
      const serverNames = Object.keys(mcpServers);
      console.log(`\n  Found ${serverNames.length} MCP server(s) in Claude Desktop config.`);

      const selectedMcp = await checkbox({
        message: "Import MCP servers:",
        choices: serverNames.map((name) => ({
          name: `${name} (${mcpServers[name].command}${mcpServers[name].args ? " " + mcpServers[name].args!.join(" ") : ""})`,
          value: name,
          checked: true,
        })),
      });

      if (selectedMcp.length > 0) {
        for (const name of selectedMcp) {
          const entry = mcpServers[name];
          const tool: ToolConfig = {
            type: "mcp",
            name,
            command: entry.command,
            ...(entry.args && { args: entry.args }),
            description: `MCP server: ${name}`,
            ...(entry.env && { env: entry.env }),
          };
          tools.push(tool);
        }
        console.log(`  Imported ${selectedMcp.length} MCP server${selectedMcp.length === 1 ? "" : "s"}: ${selectedMcp.join(", ")}`);
      }
    }
  }

  // 3c. Offer iMessage on macOS
  if (platform() === "darwin") {
    const enableIMessage = await confirm({
      message: "Enable iMessage? (lets Claude send and read iMessages)",
      default: false,
    });
    if (enableIMessage) {
      tools.push({
        type: "mcp",
        name: "imessage",
        command: "npx",
        args: ["-y", "@foxychat-mcp/apple-imessages"],
        description: "Send and read iMessages",
      });
      console.log("  iMessage requires Full Disk Access for your terminal. Grant it in System Settings > Privacy & Security > Full Disk Access.");
    }
  }

  // 4. Determine server name
  let serverName: string | undefined;

  if (httpsProvider === "tailscale") {
    const dnsName = await getTailscaleDnsName();
    if (dnsName) {
      serverName = dnsName.split(".")[0];
    }
  } else if (httpsProvider === "cloudflare") {
    serverName = await input({
      message: "Server name (identifies this machine):",
      required: true,
    });
  }

  if (!serverName) {
    const { hostname: osHostname } = await import("node:os");
    serverName = osHostname();
  }

  // 5. Generate config
  const encryptionKey = generateEncryptionKey();

  const config: GigaiConfig = {
    serverName,
    server: {
      port,
      host: "0.0.0.0",
      ...(httpsConfig && { https: httpsConfig }),
    },
    auth: {
      encryptionKey,
      pairingTtlSeconds: 300,
      sessionTtlSeconds: 14400,
    },
    tools,
    security: { default: securityTier, overrides: {} },
  };

  // 6. Write config
  const configPath = resolve("gigai.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  console.log(`\n  Config written to: ${configPath}`);

  // 7. Enable HTTPS and detect server URL
  let serverUrl: string | undefined;

  if (httpsProvider === "tailscale") {
    try {
      serverUrl = await ensureTailscaleFunnel(port);
    } catch (e) {
      console.error(`  ${(e as Error).message}`);
      console.log("  You can enable Funnel later and run 'gigai start' manually.\n");
    }
  } else if (httpsProvider === "cloudflare" && httpsConfig && "domain" in httpsConfig && httpsConfig.domain) {
    serverUrl = `https://${httpsConfig.domain}`;
    console.log(`  Cloudflare URL: ${serverUrl}`);
  }

  if (!serverUrl) {
    serverUrl = await input({
      message: "Server URL (how clients will reach this server):",
      required: true,
    });
  }

  // 8. Start server in background
  console.log("\n  Starting server...");
  const serverArgs = ["start", "--config", configPath];
  if (!httpsConfig) serverArgs.push("--dev");

  const child = spawn("gigai", serverArgs, {
    detached: true,
    stdio: "ignore",
    cwd: resolve("."),
  });
  child.unref();

  // Give the server a moment to start
  await new Promise((r) => setTimeout(r, 1500));

  // Verify server is running
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    if (res.ok) {
      console.log(`  Server running on port ${port} (PID ${child.pid})`);
    }
  } catch {
    console.log(`  Server starting in background (PID ${child.pid})`);
  }

  // 9. Generate pairing code from the running server
  let code: string | undefined;
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/auth/pair/generate`);
      if (res.ok) {
        const data = await res.json() as { code: string; expiresIn: number };
        code = data.code;
        break;
      }
    } catch {
      // Server may still be starting
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (!code) {
    console.log("\n  Server is starting but not ready yet.");
    console.log("  Run 'gigai pair' once it's up to get a pairing code.\n");
    return;
  }

  console.log(`\n  Paste this into Claude to pair:\n`);
  console.log(`  ──────────────────────────────────────────────`);
  console.log(`  Install kon and pair with my server:\n`);
  console.log(`  \`\`\`bash`);
  console.log(`  npm install -g @schuttdev/kon`);
  console.log(`  kon pair ${code} ${serverUrl}`);
  console.log(`  \`\`\`\n`);
  console.log(`  Then show me the skill file output so I can save it.`);
  console.log(`  ──────────────────────────────────────────────`);
  console.log(`\n  Pairing code expires in ${config.auth.pairingTtlSeconds / 60} minutes.`);
  console.log(`  Run 'gigai pair' to generate a new one.\n`);
}
