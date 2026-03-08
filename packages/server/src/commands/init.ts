import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
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
    const pathsStr = await input({
      message: "Allowed filesystem paths (comma-separated):",
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
  }

  if (selectedBuiltins.includes("shell")) {
    const allowlistStr = await input({
      message: "Allowed shell commands (comma-separated):",
      default: "ls,cat,head,tail,grep,find,wc,echo,date,whoami,pwd,git,npm,node",
    });
    const allowlist = allowlistStr.split(",").map((c) => c.trim());
    const allowSudo = await confirm({
      message: "Allow sudo?",
      default: false,
    });
    tools.push({
      type: "builtin",
      name: "shell",
      builtin: "shell",
      description: "Execute allowed shell commands",
      config: { allowlist, allowSudo },
    });
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
      console.log("  You can enable Funnel later and run 'gigai server start' manually.\n");
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
  const serverArgs = ["server", "start", "--config", configPath];
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
    console.log("  Run 'gigai server pair' once it's up to get a pairing code.\n");
    return;
  }

  console.log(`\n  Paste this into Claude to pair:\n`);
  console.log(`  ──────────────────────────────────────────────`);
  console.log(`  Install the gigai CLI and pair with my server:\n`);
  console.log(`  \`\`\`bash`);
  console.log(`  npm install -g @schuttdev/gigai`);
  console.log(`  gigai pair ${code} ${serverUrl}`);
  console.log(`  \`\`\`\n`);
  console.log(`  Then show me the skill file output so I can save it.`);
  console.log(`  ──────────────────────────────────────────────`);
  console.log(`\n  Pairing code expires in ${config.auth.pairingTtlSeconds / 60} minutes.`);
  console.log(`  Run 'gigai server pair' to generate a new one.\n`);
}
