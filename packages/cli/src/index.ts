import { defineCommand, runMain } from "citty";
import { detectMode } from "./mode.js";
import { readConfig } from "./config.js";
import { connect } from "./connect.js";
import { pair } from "./pair.js";
import { createHttpClient } from "./http.js";
import { fetchTools, fetchToolDetail } from "./discover.js";
import { execTool } from "./exec.js";
import { upload, download } from "./transfer.js";
import { formatToolList, formatToolDetail, formatStatus } from "./output.js";

const mode = detectMode();

// Known subcommands for client mode
const CLIENT_COMMANDS = new Set([
  "pair", "connect", "list", "help", "status",
  "upload", "download", "version", "--help", "-h",
]);

// In client mode, intercept unknown commands before citty sees them
if (mode === "client") {
  const firstArg = process.argv[2];
  if (firstArg && !firstArg.startsWith("-") && !CLIENT_COMMANDS.has(firstArg)) {
    // Dynamic tool execution
    const toolName = firstArg;
    const toolArgs = process.argv.slice(3);

    try {
      const { serverUrl, sessionToken } = await connect();
      const http = createHttpClient(serverUrl, sessionToken);
      await execTool(http, toolName, toolArgs);
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exitCode = 1;
    }
    // Don't fall through to citty
  } else {
    runCitty();
  }
} else {
  runCitty();
}

function runCitty() {
  // --- Client mode commands ---

  const pairCommand = defineCommand({
    meta: { name: "pair", description: "Pair with a gigai server" },
    args: {
      code: { type: "positional", description: "Pairing code", required: true },
      server: { type: "positional", description: "Server URL", required: true },
    },
    async run({ args }) {
      await pair(args.code, args.server);
    },
  });

  const connectCommand = defineCommand({
    meta: { name: "connect", description: "Establish a session with the server" },
    async run() {
      const { serverUrl } = await connect();
      console.log(`Connected to ${serverUrl}`);
    },
  });

  const listCommand = defineCommand({
    meta: { name: "list", description: "List available tools" },
    async run() {
      const { serverUrl, sessionToken } = await connect();
      const http = createHttpClient(serverUrl, sessionToken);
      const tools = await fetchTools(http);
      console.log(formatToolList(tools));
    },
  });

  const helpCommand = defineCommand({
    meta: { name: "help", description: "Show help for a tool" },
    args: {
      tool: { type: "positional", description: "Tool name", required: true },
    },
    async run({ args }) {
      const { serverUrl, sessionToken } = await connect();
      const http = createHttpClient(serverUrl, sessionToken);
      const { tool } = await fetchToolDetail(http, args.tool);
      console.log(formatToolDetail(tool));
    },
  });

  const statusCommand = defineCommand({
    meta: { name: "status", description: "Show connection status" },
    async run() {
      const config = await readConfig();
      const connected = Boolean(config.server && config.token);
      console.log(formatStatus(connected, config.server, config.sessionExpiresAt));
    },
  });

  const uploadCommand = defineCommand({
    meta: { name: "upload", description: "Upload a file to the server" },
    args: {
      file: { type: "positional", description: "File path", required: true },
    },
    async run({ args }) {
      const { serverUrl, sessionToken } = await connect();
      const http = createHttpClient(serverUrl, sessionToken);
      await upload(http, args.file);
    },
  });

  const downloadCommand = defineCommand({
    meta: { name: "download", description: "Download a file from the server" },
    args: {
      id: { type: "positional", description: "Transfer ID", required: true },
      dest: { type: "positional", description: "Destination path", required: true },
    },
    async run({ args }) {
      const { serverUrl, sessionToken } = await connect();
      const http = createHttpClient(serverUrl, sessionToken);
      await download(http, args.id, args.dest);
    },
  });

  const versionCommand = defineCommand({
    meta: { name: "version", description: "Show version" },
    run() {
      console.log("gigai v0.1.0");
    },
  });

  // --- Server mode commands ---

  const serverCommand = defineCommand({
    meta: { name: "server", description: "Server management commands" },
    subCommands: {
      start: defineCommand({
        meta: { name: "start", description: "Start the gigai server" },
        args: {
          config: { type: "string", alias: "c", description: "Config file path" },
          dev: { type: "boolean", description: "Development mode (no HTTPS)" },
        },
        async run({ args }) {
          const { startServer } = await import("@gigai/server");
          const extraArgs: string[] = [];
          if (args.config) extraArgs.push("--config", args.config as string);
          if (args.dev) extraArgs.push("--dev");
          process.argv.push(...extraArgs);
          await startServer();
        },
      }),
      init: defineCommand({
        meta: { name: "init", description: "Interactive setup wizard" },
        async run() {
          const { runInit } = await import("@gigai/server");
          await runInit();
        },
      }),
      pair: defineCommand({
        meta: { name: "pair", description: "Generate a pairing code" },
        args: {
          config: { type: "string", alias: "c", description: "Config file path" },
        },
        async run({ args }) {
          const { generateServerPairingCode } = await import("@gigai/server");
          await generateServerPairingCode(args.config as string | undefined);
        },
      }),
      status: defineCommand({
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
      }),
    },
  });

  const wrapCommand = defineCommand({
    meta: { name: "wrap", description: "Register a tool" },
    subCommands: {
      cli: defineCommand({
        meta: { name: "cli", description: "Wrap a CLI command" },
        async run() {
          const { wrapCli } = await import("@gigai/server");
          await wrapCli();
        },
      }),
      mcp: defineCommand({
        meta: { name: "mcp", description: "Wrap an MCP server" },
        async run() {
          const { wrapMcp } = await import("@gigai/server");
          await wrapMcp();
        },
      }),
      script: defineCommand({
        meta: { name: "script", description: "Wrap a script" },
        async run() {
          const { wrapScript } = await import("@gigai/server");
          await wrapScript();
        },
      }),
      import: defineCommand({
        meta: { name: "import", description: "Import from claude_desktop_config.json" },
        args: {
          path: { type: "positional", description: "Path to config file", required: true },
        },
        async run({ args }) {
          const { wrapImport } = await import("@gigai/server");
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
      const { unwrapTool } = await import("@gigai/server");
      await unwrapTool(args.name);
    },
  });

  // --- Main command ---

  const main = defineCommand({
    meta: {
      name: "gigai",
      version: "0.1.0",
      description: "Bridge CLI tools to Claude across platforms",
    },
    subCommands: mode === "client"
      ? {
          pair: pairCommand,
          connect: connectCommand,
          list: listCommand,
          help: helpCommand,
          status: statusCommand,
          upload: uploadCommand,
          download: downloadCommand,
          version: versionCommand,
        }
      : {
          server: serverCommand,
          wrap: wrapCommand,
          unwrap: unwrapCommand,
          version: versionCommand,
          pair: pairCommand,
          connect: connectCommand,
          list: listCommand,
          status: statusCommand,
        },
  });

  runMain(main);
}
