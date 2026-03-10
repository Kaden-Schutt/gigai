import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { readFile, writeFile, readdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { generateEncryptionKey } from "@gigai/shared";
import type { GigaiConfig, ToolConfig } from "@gigai/shared";
import {
  checkAllPrerequisites,
  checkRunningTailscaleApp,
  checkHomebrew,
  checkTailscaleDaemonRunning,
  checkTailscaleAuth,
  checkFunnelStatus,
  installTailscaleFormula,
  installTailscaleCask,
  removeTailscaleApp,
  runTailscaleAuth,
  activateFunnel,
  openUrl,
} from "../prerequisites.js";

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

// --- Tailscale prerequisite setup ---

async function setupTailscalePrerequisites(): Promise<void> {
  let result = await checkAllPrerequisites();

  while (!result.passed) {
    const check = result.checks[0];

    switch (check.id) {
      case "tailscaled-no-funnel": {
        console.log(`\n  \u2717 ${check.label} \u2014 ${check.detail}`);
        console.log(`    \u2192 ${check.action}`);
        console.log("");
        await input({ message: "Fix the issue above, then press Enter to re-check..." });
        break;
      }

      case "tailscaled-stopped": {
        console.log(`\n  \u2717 ${check.label} \u2014 ${check.detail}`);
        console.log(`    \u2192 ${check.action}`);
        console.log("");
        await input({ message: "Start the daemon, then press Enter to re-check..." });
        break;
      }

      case "appstore-tailscale": {
        console.log(
          "\n  Kon detected App Store Tailscale. The standalone version is identical " +
          "but supports more features including Funnel. Your account and devices stay the same.",
        );

        const shouldSwitch = await confirm({
          message: "Would you like to switch to the standalone version?",
          default: true,
        });

        if (!shouldSwitch) {
          console.log("\n  Funnel is required for Kon. Run 'kond init' again when ready.\n");
          process.exit(0);
        }

        // Step 1: Quit Tailscale
        console.log("\n  Step 1: Quit Tailscale from the menu bar.");
        while (await checkRunningTailscaleApp()) {
          await input({ message: "Quit Tailscale, then press Enter..." });
        }
        console.log("  \u2713 Tailscale quit");

        // Step 2: Remove Tailscale.app
        console.log("\n  Step 2: Remove Tailscale.app");
        const autoRemove = await confirm({
          message: "Would you like Kon to remove it?",
          default: true,
        });

        if (autoRemove) {
          await removeTailscaleApp();
          console.log("  \u2713 Removed /Applications/Tailscale.app");
        } else {
          console.log("  Drag /Applications/Tailscale.app to the Trash and empty it.");
          let appExists = true;
          while (appExists) {
            await input({ message: "Press Enter when done..." });
            try {
              await access("/Applications/Tailscale.app");
              console.log("  /Applications/Tailscale.app still exists.");
            } catch {
              appExists = false;
            }
          }
          console.log("  \u2713 Tailscale.app removed");
        }

        // Reboot required
        console.log(
          "\n  A reboot is required to clear the old Tailscale extension. " +
          "Reboot now and run 'kond init' again after.\n",
        );
        process.exit(0);
        break; // unreachable but satisfies linter
      }

      case "homebrew": {
        console.log(`\n  \u2717 ${check.label} \u2014 ${check.detail}`);
        console.log(`    \u2192 ${check.action}`);
        console.log("");
        await input({ message: "Install Homebrew, then press Enter to re-check..." });
        break;
      }

      case "tailscale-missing": {
        console.log("\n  Installing Tailscale via Homebrew...\n");
        await installTailscaleFormula();

        // Daemon health gate: poll until responsive
        console.log("\n  Waiting for Tailscale daemon to start...");
        let daemon = await checkTailscaleDaemonRunning();
        let attempts = 0;
        while (!daemon.running && attempts < 30) {
          await new Promise((r) => setTimeout(r, 1000));
          daemon = await checkTailscaleDaemonRunning();
          attempts++;
        }
        if (!daemon.running) {
          throw new Error("Tailscale daemon failed to start after install. Run 'kond init' again.");
        }
        console.log("  \u2713 Tailscale daemon running");

        // Offer menu bar app
        const wantCask = await confirm({
          message: "Would you also like the Tailscale menu bar app?",
          default: false,
        });
        if (wantCask) {
          console.log("");
          await installTailscaleCask();
          console.log("  \u2713 Tailscale menu bar app installed");
        }

        // Prerequisites now met — re-check will pass
        break;
      }

      default: {
        // Fallback generic gate for any unknown check
        console.log(`\n  \u2717 ${check.label}${check.detail ? ` \u2014 ${check.detail}` : ""}`);
        if (check.action) console.log(`    \u2192 ${check.action}`);
        console.log("");
        await input({ message: "Fix the issue above, then press Enter to re-check..." });
        break;
      }
    }

    result = await checkAllPrerequisites();
  }

  // Show green summary
  console.log("\n  Prerequisites:\n");
  for (const check of result.checks) {
    console.log(`    \u2713 ${check.label}`);
  }
}

// --- Tailscale auth flow ---

async function ensureTailscaleAuth(): Promise<string> {
  const state = await checkTailscaleAuth();
  if (state.authenticated && state.dnsName) {
    console.log(`  Tailscale: logged in (${state.dnsName})`);
    return state.dnsName;
  }

  console.log("\n  Authenticating with Tailscale...");

  await runTailscaleAuth((event) => {
    if (event.type === "auth-url" && event.authUrl) {
      openUrl(event.authUrl);
      console.log(`\n  If your browser didn't open, visit:`);
      console.log(`  ${event.authUrl}\n`);
      console.log("  Waiting for authentication...");
    }
  });

  const final = await checkTailscaleAuth();
  if (!final.authenticated || !final.dnsName) {
    throw new Error("Tailscale authentication failed. Run 'kond init' again.");
  }
  console.log(`  Authenticated: ${final.dnsName}`);
  return final.dnsName;
}

// --- Funnel setup ---

async function setupFunnel(port: number): Promise<string> {
  console.log("  Setting up Tailscale Funnel...");

  const result = await activateFunnel(port);

  if (result.consentUrl) {
    openUrl(result.consentUrl);
    console.log(`\n  Funnel requires approval. If your browser didn't open, visit:`);
    console.log(`  ${result.consentUrl}\n`);
    console.log("  Waiting for approval...");

    // Poll until funnel is active
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await checkFunnelStatus();
      if (status.active) {
        console.log(`  Funnel active: ${result.url}`);
        return result.url;
      }
    }
    throw new Error("Funnel approval timed out. Run 'kond init' again.");
  }

  console.log(`  Funnel active: ${result.url}`);
  return result.url;
}

// --- Main init flow ---

export async function runInit(): Promise<void> {
  console.log("\n  kond server setup\n");

  // 1. HTTPS provider selection
  const httpsProvider = await select({
    message: "HTTPS provider:",
    choices: [
      { name: "Tailscale Funnel (recommended)", value: "tailscale" },
      { name: "Cloudflare Tunnel", value: "cloudflare" },
      { name: "Manual (provide certs)", value: "manual" },
    ],
  });

  let httpsConfig: GigaiConfig["server"]["https"];
  let serverUrl: string | undefined;
  let tailscaleDnsName: string | undefined;
  let port: number;

  switch (httpsProvider) {
    case "tailscale": {
      // a. Software prerequisite gate loop
      await setupTailscalePrerequisites();

      // b. Daemon health gate
      let daemonOk = await checkTailscaleDaemonRunning();
      while (!daemonOk.running) {
        console.log(`\n  Tailscale daemon not responding: ${daemonOk.error}`);
        if (daemonOk.error?.includes("Permission denied")) {
          console.log("  Open System Settings \u2192 Privacy & Security \u2192 Full Disk Access and add tailscaled.");
        }
        await input({ message: "Press Enter to re-check..." });
        daemonOk = await checkTailscaleDaemonRunning();
      }

      // c. Auth flow
      tailscaleDnsName = await ensureTailscaleAuth();

      // d. Port selection
      const portStr = await input({
        message: "Server port:",
        default: "7443",
      });
      port = parseInt(portStr, 10);

      // e. Funnel setup
      serverUrl = await setupFunnel(port);

      httpsConfig = {
        provider: "tailscale" as const,
        funnelPort: port,
      };
      break;
    }

    case "cloudflare": {
      const tunnelName = await input({
        message: "Cloudflare tunnel name:",
        default: "kond",
      });
      const domain = await input({
        message: "Domain (optional):",
      });
      httpsConfig = {
        provider: "cloudflare" as const,
        tunnelName,
        ...(domain && { domain }),
      };

      const portStr = await input({
        message: "Server port:",
        default: "7443",
      });
      port = parseInt(portStr, 10);

      if (domain) {
        serverUrl = `https://${domain}`;
        console.log(`  Cloudflare URL: ${serverUrl}`);
      }
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

      const portStr = await input({
        message: "Server port:",
        default: "7443",
      });
      port = parseInt(portStr, 10);
      break;
    }

    default:
      throw new Error(`Unknown HTTPS provider: ${httpsProvider}`);
  }

  // 2. Security tier
  const securityTier = await select({
    message: "Security tier:",
    choices: [
      { name: "Strict \u2014 allowlist-only, explicit path restrictions (most secure)", value: "strict" as const },
      { name: "Standard \u2014 denylist blocks catastrophic commands, home dir open (recommended)", value: "standard" as const },
      { name: "Unrestricted \u2014 no restrictions, development only", value: "unrestricted" as const },
    ],
    default: "standard" as const,
  });

  // 3. Tool selection
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

  // 4. MCP auto-import from Claude Desktop
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

  // 5. Offer iMessage on macOS
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

  // 6. Determine server name
  let serverName: string | undefined;

  if (httpsProvider === "tailscale" && tailscaleDnsName) {
    serverName = tailscaleDnsName.split(".")[0];
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

  // 7. Generate config
  const encryptionKey = generateEncryptionKey();

  const config: GigaiConfig = {
    serverName,
    server: {
      port,
      host: "0.0.0.0",
      https: httpsConfig,
    },
    auth: {
      encryptionKey,
      pairingTtlSeconds: 300,
      sessionTtlSeconds: 14400,
    },
    tools,
    security: { default: securityTier, overrides: {} },
  };

  // 8. Write config
  const configPath = resolve("kon.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  console.log(`\n  Config written to: ${configPath}`);

  // 9. Prompt for server URL if not already known
  if (!serverUrl) {
    serverUrl = await input({
      message: "Server URL (how clients will reach this server):",
      required: true,
    });
  }

  // 10. Start server in background
  console.log("\n  Starting server...");
  const serverArgs = ["start", "--config", configPath];

  const child = spawn("kond", serverArgs, {
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

  // 11. Generate pairing code from the running server
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
    console.log("  Run 'kond pair' once it's up to get a pairing code.\n");
    return;
  }

  console.log(`\n  Paste this into Claude to pair:\n`);
  console.log(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`  Install kon and pair with my server:\n`);
  console.log(`  \`\`\`bash`);
  console.log(`  npm install -g @schuttdev/kon`);
  console.log(`  kon pair ${code} ${serverUrl}`);
  console.log(`  \`\`\`\n`);
  console.log(`  Then show me the skill file output so I can save it.`);
  console.log(`  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`\n  Pairing code expires in ${config.auth.pairingTtlSeconds / 60} minutes.`);
  console.log(`  Run 'kond pair' to generate a new one.\n`);
}
