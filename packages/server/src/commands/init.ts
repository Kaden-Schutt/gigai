import { input, select, checkbox, confirm } from "@inquirer/prompts";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { generateEncryptionKey } from "@gigai/shared";
import type { GigaiConfig, ToolConfig } from "@gigai/shared";
import { generatePairingCode } from "../auth/pairing.js";
import { AuthStore } from "../auth/store.js";

export async function runInit(): Promise<void> {
  console.log("\n  gigai server setup\n");

  // 1. HTTPS provider
  const httpsProvider = await select({
    message: "HTTPS provider:",
    choices: [
      { name: "Tailscale Funnel (recommended)", value: "tailscale" },
      { name: "Cloudflare Tunnel", value: "cloudflare" },
      { name: "Let's Encrypt", value: "letsencrypt" },
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
      console.log("  Will use Tailscale Funnel for HTTPS.");
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

    case "letsencrypt": {
      const domain = await input({
        message: "Domain name:",
        required: true,
      });
      const email = await input({
        message: "Email for Let's Encrypt:",
        required: true,
      });
      httpsConfig = {
        provider: "letsencrypt" as const,
        domain,
        email,
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

  // Filesystem config
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

  // Shell config
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

  // 4. Generate config
  const encryptionKey = generateEncryptionKey();

  const config: GigaiConfig = {
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

  // 5. Write config
  const configPath = resolve("gigai.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  console.log(`\n  Config written to: ${configPath}`);

  // 6. Generate skill template
  const skillDir = resolve("gigai-skill");
  await mkdir(skillDir, { recursive: true });

  const skillMd = `# gigai Skill

This skill gives you access to tools running on the user's machine via the gigai CLI.

## Setup

The gigai CLI is pre-installed. To use it:

1. Connect to the server: \`gigai connect\`
2. List available tools: \`gigai list\`
3. Get help on a tool: \`gigai help <tool-name>\`
4. Use a tool: \`gigai <tool-name> [args...]\`

## File Transfer

- Upload: \`gigai upload <file>\`
- Download: \`gigai download <id> <dest>\`

## Notes

- The connection is authenticated and encrypted
- Tools are scoped to what the user has configured
- If a command fails, check \`gigai status\` for connection info
`;

  await writeFile(join(skillDir, "SKILL.md"), skillMd);

  const skillConfig = {
    server: "<YOUR_SERVER_URL>",
    token: "<PASTE_ENCRYPTED_TOKEN_HERE>",
  };
  await writeFile(join(skillDir, "config.json"), JSON.stringify(skillConfig, null, 2) + "\n");
  console.log(`  Skill template written to: ${skillDir}/`);

  // 7. Generate initial pairing code
  const store = new AuthStore();
  const code = generatePairingCode(store, config.auth.pairingTtlSeconds);
  console.log(`\n  Pairing code: ${code}`);
  console.log(`  Expires in ${config.auth.pairingTtlSeconds / 60} minutes.`);
  console.log(`\n  Start the server with: gigai server start${httpsConfig ? "" : " --dev"}`);
  store.destroy();
}
