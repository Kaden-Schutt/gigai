import { defineCommand, runMain } from "citty";
import { VERSION } from "./version.js";

async function requireServer(): Promise<typeof import("@gigai/server")> {
  try {
    return await import("@gigai/server");
  } catch {
    console.error("Server dependencies not installed.");
    console.error("Run: npm install -g @schuttdev/kond");
    process.exit(1);
  }
}

const initCommand = defineCommand({
  meta: { name: "init", description: "Interactive setup wizard" },
  async run() {
    const { runInit } = await requireServer();
    await runInit();
  },
});

const startCommand = defineCommand({
  meta: { name: "start", description: "Start the kond server" },
  args: {
    config: { type: "string", alias: "c", description: "Config file path" },
    dev: { type: "boolean", description: "Development mode (no HTTPS)" },
  },
  async run({ args }) {
    const { startServer } = await requireServer();
    const extraArgs: string[] = [];
    if (args.config) extraArgs.push("--config", args.config as string);
    if (args.dev) extraArgs.push("--dev");
    process.argv.push(...extraArgs);
    await startServer();
  },
});

const stopCommand = defineCommand({
  meta: { name: "stop", description: "Stop the running kond server" },
  async run() {
    const { execFileSync } = await import("node:child_process");
    let pids: number[] = [];
    try {
      const out = execFileSync("pgrep", ["-f", "kond start"], { encoding: "utf8" });
      pids = out.trim().split("\n").map(Number).filter(pid => pid && pid !== process.pid);
    } catch {
      // pgrep returns non-zero if no matches
    }
    if (pids.length === 0) {
      console.log("No running kond server found.");
      return;
    }
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        console.log(`Stopped kond server (PID ${pid})`);
      } catch (e) {
        console.error(`Failed to stop PID ${pid}: ${(e as Error).message}`);
      }
    }
  },
});

const statusCommand = defineCommand({
  meta: { name: "status", description: "Show server status" },
  async run() {
    console.log("Server status: checking...");
    try {
      const res = await fetch("http://localhost:7443/health");
      const data = await res.json();
      console.log(`Status: ${(data as any).status}`);
      console.log(`Version: ${(data as any).version}`);
      console.log(`Uptime: ${Math.floor((data as any).uptime / 1000)}s`);
    } catch {
      console.log("Server is not running.");
    }
  },
});

const pairCommand = defineCommand({
  meta: { name: "pair", description: "Generate a pairing code" },
  args: {
    config: { type: "string", alias: "c", description: "Config file path" },
  },
  async run({ args }) {
    const { generateServerPairingCode } = await requireServer();
    await generateServerPairingCode(args.config as string | undefined);
    process.exit(0);
  },
});

const installCommand = defineCommand({
  meta: { name: "install", description: "Install as persistent background service" },
  args: {
    config: { type: "string", alias: "c", description: "Config file path" },
  },
  async run({ args }) {
    const { installDaemon } = await requireServer();
    await installDaemon(args.config as string | undefined);
    process.exit(0);
  },
});

const uninstallCommand = defineCommand({
  meta: { name: "uninstall", description: "Remove background service" },
  async run() {
    const { uninstallDaemon } = await requireServer();
    await uninstallDaemon();
    process.exit(0);
  },
});

const wrapCommand = defineCommand({
  meta: { name: "wrap", description: "Register a tool" },
  subCommands: {
    cli: defineCommand({
      meta: { name: "cli", description: "Wrap a CLI command" },
      async run() {
        const { wrapCli } = await requireServer();
        await wrapCli();
        process.exit(0);
      },
    }),
    mcp: defineCommand({
      meta: { name: "mcp", description: "Wrap an MCP server" },
      async run() {
        const { wrapMcp } = await requireServer();
        await wrapMcp();
        process.exit(0);
      },
    }),
    script: defineCommand({
      meta: { name: "script", description: "Wrap a script" },
      async run() {
        const { wrapScript } = await requireServer();
        await wrapScript();
        process.exit(0);
      },
    }),
    import: defineCommand({
      meta: { name: "import", description: "Import from claude_desktop_config.json" },
      args: {
        path: { type: "positional", description: "Path to config file", required: true },
      },
      async run({ args }) {
        const { wrapImport } = await requireServer();
        await wrapImport(args.path as string);
        process.exit(0);
      },
    }),
  },
});

const unwrapCommand = defineCommand({
  meta: { name: "unwrap", description: "Unregister a tool" },
  args: {
    name: { type: "positional", description: "Tool name", required: true },
  },
  async run({ args }) {
    const { unwrapTool } = await requireServer();
    await unwrapTool(args.name);
    process.exit(0);
  },
});

const mcpCommand = defineCommand({
  meta: { name: "mcp", description: "Manage MCP servers" },
  subCommands: {
    add: defineCommand({
      meta: {
        name: "add",
        description: "Add an MCP server (e.g. kond mcp add <name> -- <command> [args...])",
      },
      args: {
        name: {
          type: "positional",
          description: "MCP server name",
          required: true,
        },
      },
      async run({ args: cmdArgs }) {
        const { mcpAdd } = await requireServer();
        const name = cmdArgs.name as string;

        // Find the "--" separator in the raw process.argv
        const rawArgs = process.argv;
        const dashDashIdx = rawArgs.indexOf("--");
        if (dashDashIdx === -1 || dashDashIdx >= rawArgs.length - 1) {
          console.error(
            "Usage: kond mcp add <name> [--env KEY=VALUE ...] -- <command> [args...]",
          );
          console.error(
            "\nExamples:");
          console.error(
            "  kond mcp add browser -- npx -y @anthropic-ai/mcp-server-puppeteer",
          );
          console.error(
            "  kond mcp add myserver --env API_KEY=abc123 -- uvx mcp-server",
          );
          process.exitCode = 1;
          return;
        }

        // Parse --env flags from everything before "--"
        const beforeDash = rawArgs.slice(0, dashDashIdx);
        const env: Record<string, string> = {};
        for (let i = 0; i < beforeDash.length; i++) {
          if (beforeDash[i] === "--env" && i + 1 < beforeDash.length) {
            const pair = beforeDash[i + 1];
            const eqIdx = pair.indexOf("=");
            if (eqIdx > 0) {
              env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
            }
            i++; // skip the value
          }
        }

        // Everything after "--" is command + args
        const afterDash = rawArgs.slice(dashDashIdx + 1);

        // Also extract --env flags mixed into the command args
        const commandParts: string[] = [];
        for (let i = 0; i < afterDash.length; i++) {
          if (afterDash[i] === "--env" && i + 1 < afterDash.length) {
            const pair = afterDash[i + 1];
            const eqIdx = pair.indexOf("=");
            if (eqIdx > 0) {
              env[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
            }
            i++;
          } else {
            commandParts.push(afterDash[i]);
          }
        }

        if (commandParts.length === 0) {
          console.error("Error: No command specified after '--'.");
          process.exitCode = 1;
          return;
        }

        const command = commandParts[0];
        const commandArgs = commandParts.slice(1);

        await mcpAdd(
          name,
          command,
          commandArgs,
          Object.keys(env).length > 0 ? env : undefined,
        );
        process.exit(0);
      },
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Remove an MCP server" },
      args: {
        name: {
          type: "positional",
          description: "MCP server name",
          required: true,
        },
      },
      async run({ args }) {
        const { unwrapTool } = await requireServer();
        await unwrapTool(args.name as string);
        process.exit(0);
      },
    }),
    list: defineCommand({
      meta: { name: "list", description: "List configured MCP servers" },
      async run() {
        const { mcpList } = await requireServer();
        await mcpList();
        process.exit(0);
      },
    }),
  },
});

const cronCommand = defineCommand({
  meta: { name: "cron", description: "Manage scheduled jobs" },
  subCommands: {
    add: defineCommand({
      meta: {
        name: "add",
        description: "Schedule a tool execution (e.g. kond cron add \"0 9 * * *\" bash git pull)",
      },
      args: {
        at: { type: "string", description: "Human-readable time (e.g. \"9:00 AM tomorrow\", \"in 30 minutes\")" },
        description: { type: "string", alias: "d", description: "Optional label for the job" },
      },
      async run({ args: cmdArgs }) {
        // Parse positional args from process.argv after "cron add"
        const rawArgs = process.argv;
        const addIdx = rawArgs.indexOf("add");
        if (addIdx === -1) {
          console.error("Usage: kond cron add [--at <time>] <tool> [args...]");
          console.error("       kond cron add \"0 9 * * *\" <tool> [args...]");
          process.exitCode = 1;
          return;
        }

        // Collect positional args (skip known flags and their values)
        const positionals: string[] = [];
        const rest = rawArgs.slice(addIdx + 1);
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "--at" || rest[i] === "--description" || rest[i] === "-d") {
            i++; // skip value
            continue;
          }
          if (rest[i].startsWith("--")) continue;
          positionals.push(rest[i]);
        }

        let schedule: string;
        let tool: string;
        let toolArgs: string[];
        let oneShot = false;

        if (cmdArgs.at) {
          // --at mode: parse human-readable time to one-shot cron expression
          const { parseAtExpression } = await requireServer();
          schedule = parseAtExpression(cmdArgs.at as string);
          oneShot = true;
          tool = positionals[0];
          toolArgs = positionals.slice(1);
        } else {
          // Standard cron mode: first positional is the cron expression
          schedule = positionals[0];
          tool = positionals[1];
          toolArgs = positionals.slice(2);
        }

        if (!schedule || !tool) {
          console.error("Usage: kond cron add \"0 9 * * *\" <tool> [args...]");
          console.error("       kond cron add --at \"9:00 AM tomorrow\" <tool> [args...]");
          process.exitCode = 1;
          return;
        }

        try {
          const res = await fetch("http://localhost:7443/cron", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              schedule,
              tool,
              args: toolArgs,
              description: cmdArgs.description as string | undefined,
              oneShot,
            }),
          });

          if (!res.ok) {
            const err = await res.json();
            console.error(`Error: ${(err as any).error?.message ?? res.statusText}`);
            process.exitCode = 1;
            return;
          }

          const data = await res.json() as any;
          const job = data.job;
          console.log(`Created cron job ${job.id}`);
          console.log(`  Schedule: ${job.schedule}`);
          console.log(`  Tool:     ${job.tool} ${job.args.join(" ")}`);
          if (job.description) console.log(`  Label:    ${job.description}`);
          if (job.nextRun) console.log(`  Next run: ${new Date(job.nextRun).toLocaleString()}`);
          if (oneShot) console.log(`  Type:     one-shot (will disable after execution)`);
        } catch {
          console.error("Server is not running. Start it with: kond start");
          process.exitCode = 1;
        }
      },
    }),
    list: defineCommand({
      meta: { name: "list", description: "List all scheduled jobs" },
      async run() {
        try {
          const res = await fetch("http://localhost:7443/cron");
          if (!res.ok) {
            const err = await res.json();
            console.error(`Error: ${(err as any).error?.message ?? res.statusText}`);
            process.exitCode = 1;
            return;
          }

          const data = await res.json() as any;
          const jobs = data.jobs as any[];

          if (jobs.length === 0) {
            console.log("No scheduled jobs.");
            return;
          }

          console.log(`${"ID".padEnd(14)} ${"Schedule".padEnd(16)} ${"Tool".padEnd(20)} ${"Enabled".padEnd(9)} ${"Next Run"}`);
          console.log("-".repeat(80));

          for (const job of jobs) {
            const enabled = job.enabled ? "yes" : "no";
            const next = job.nextRun && job.enabled ? new Date(job.nextRun).toLocaleString() : "-";
            const toolStr = `${job.tool} ${job.args.join(" ")}`.slice(0, 18);
            console.log(
              `${job.id.padEnd(14)} ${job.schedule.padEnd(16)} ${toolStr.padEnd(20)} ${enabled.padEnd(9)} ${next}`,
            );
            if (job.description) {
              console.log(`${"".padEnd(14)} ${job.description}`);
            }
          }
        } catch {
          console.error("Server is not running. Start it with: kond start");
          process.exitCode = 1;
        }
      },
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Remove a scheduled job" },
      args: {
        id: { type: "positional", description: "Job ID", required: true },
      },
      async run({ args }) {
        try {
          const res = await fetch(`http://localhost:7443/cron/${args.id}`, {
            method: "DELETE",
          });

          if (!res.ok) {
            const err = await res.json();
            console.error(`Error: ${(err as any).error?.message ?? res.statusText}`);
            process.exitCode = 1;
            return;
          }

          console.log(`Removed cron job ${args.id}`);
        } catch {
          console.error("Server is not running. Start it with: kond start");
          process.exitCode = 1;
        }
      },
    }),
  },
});

const versionCommand = defineCommand({
  meta: { name: "version", description: "Show version" },
  run() {
    console.log(`kond v${VERSION}`);
  },
});

const main = defineCommand({
  meta: {
    name: "kond",
    version: VERSION,
    description: "kond — bridge CLI tools to Claude",
  },
  subCommands: {
    init: initCommand,
    start: startCommand,
    stop: stopCommand,
    status: statusCommand,
    pair: pairCommand,
    install: installCommand,
    uninstall: uninstallCommand,
    wrap: wrapCommand,
    unwrap: unwrapCommand,
    mcp: mcpCommand,
    cron: cronCommand,
    version: versionCommand,
  },
});

runMain(main);
