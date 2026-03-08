import { defineCommand, runMain } from "citty";
import { VERSION } from "./version.js";

async function requireServer(): Promise<typeof import("@gigai/server")> {
  try {
    return await import("@gigai/server");
  } catch {
    console.error("Server dependencies not installed.");
    console.error("Run: npm install -g @schuttdev/gigai");
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
  meta: { name: "start", description: "Start the gigai server" },
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
  meta: { name: "stop", description: "Stop the running gigai server" },
  async run() {
    const { execFileSync } = await import("node:child_process");
    let pids: number[] = [];
    try {
      const out = execFileSync("pgrep", ["-f", "gigai start"], { encoding: "utf8" });
      pids = out.trim().split("\n").map(Number).filter(pid => pid && pid !== process.pid);
    } catch {
      // pgrep returns non-zero if no matches
    }
    if (pids.length === 0) {
      console.log("No running gigai server found.");
      return;
    }
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        console.log(`Stopped gigai server (PID ${pid})`);
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
  },
});

const uninstallCommand = defineCommand({
  meta: { name: "uninstall", description: "Remove background service" },
  async run() {
    const { uninstallDaemon } = await requireServer();
    await uninstallDaemon();
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
      },
    }),
    mcp: defineCommand({
      meta: { name: "mcp", description: "Wrap an MCP server" },
      async run() {
        const { wrapMcp } = await requireServer();
        await wrapMcp();
      },
    }),
    script: defineCommand({
      meta: { name: "script", description: "Wrap a script" },
      async run() {
        const { wrapScript } = await requireServer();
        await wrapScript();
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
  },
});

const versionCommand = defineCommand({
  meta: { name: "version", description: "Show version" },
  run() {
    console.log(`gigai v${VERSION}`);
  },
});

const main = defineCommand({
  meta: {
    name: "gigai",
    version: VERSION,
    description: "gigai — bridge CLI tools to Claude",
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
    version: versionCommand,
  },
});

runMain(main);
