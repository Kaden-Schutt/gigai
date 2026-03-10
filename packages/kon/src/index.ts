import { defineCommand, runMain } from "citty";
import { readConfig, getActiveEntry } from "../../cli/src/config.js";
import { connect } from "../../cli/src/connect.js";
import { pair } from "../../cli/src/pair.js";
import { fetchTools, fetchToolDetail } from "../../cli/src/discover.js";
import { execTool, execMcpTool } from "../../cli/src/exec.js";
import { upload, download } from "../../cli/src/transfer.js";
import { output, outputError, homePath, expandHome, classifyError } from "../../cli/src/output.js";
import { generateSkillZip, writeSkillZip } from "../../cli/src/skill.js";
import { VERSION } from "../../cli/src/version.js";
import type { ToolDetail } from "@gigai/shared";

const KNOWN_COMMANDS = new Set([
  "pair", "connect", "list", "help", "status",
  "upload", "download", "version", "skill", "cron", "--help", "-h",
]);

// Resolve server home dir for tilde expansion
async function getServerHomeDir(): Promise<string | undefined> {
  try {
    const config = await readConfig();
    const active = getActiveEntry(config);
    return active?.entry.homeDir;
  } catch {
    return undefined;
  }
}

// Intercept unknown commands as dynamic tool execution
const firstArg = process.argv[2];
if (firstArg && !firstArg.startsWith("-") && !KNOWN_COMMANDS.has(firstArg)) {
  const toolName = firstArg;
  const serverHome = await getServerHomeDir();
  const toolArgs = process.argv.slice(3).map(a => expandHome(a, serverHome));

  try {
    const { http } = await connect();
    const { tool: detail } = await fetchToolDetail(http, toolName);

    if (detail.type === "mcp") {
      const mcpToolName = toolArgs[0];
      if (!mcpToolName) {
        output((detail.mcpTools ?? []).map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
      } else {
        const jsonArg = toolArgs.slice(1).join(" ");
        const args = jsonArg ? JSON.parse(jsonArg) : {};
        await execMcpTool(http, toolName, mcpToolName, args);
      }
    } else {
      await execTool(http, toolName, toolArgs);
    }
  } catch (e) {
    outputError(classifyError(e), (e as Error).message);
  }
} else {
  runCitty();
}

function runCitty() {
  const pairCommand = defineCommand({
    meta: { name: "pair", description: "Pair with a gigai server" },
    args: {
      code: { type: "positional", description: "Pairing code", required: true },
      server: { type: "positional", description: "Server URL", required: true },
    },
    async run({ args }) {
      try {
        await pair(args.code as string, args.server as string);
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const connectCommand = defineCommand({
    meta: { name: "connect", description: "Establish a session with the server" },
    args: {
      name: { type: "positional", description: "Server name (optional)", required: false },
    },
    async run({ args }) {
      try {
        const { serverUrl } = await connect(args.name as string | undefined);
        output(serverUrl);
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const listCommand = defineCommand({
    meta: { name: "list", description: "List available tools" },
    async run() {
      try {
        const { http } = await connect();
        const tools = await fetchTools(http);
        output(tools);
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const helpCommand = defineCommand({
    meta: { name: "help", description: "Show help for a tool" },
    args: {
      tool: { type: "positional", description: "Tool name", required: true },
    },
    async run({ args }) {
      try {
        const { http } = await connect();
        const { tool } = await fetchToolDetail(http, args.tool);
        output(tool);
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const statusCommand = defineCommand({
    meta: { name: "status", description: "Show connection status" },
    async run() {
      try {
        const config = await readConfig();
        const servers = Object.entries(config.servers).map(([name, entry]) => ({
          name,
          active: name === config.activeServer,
          url: entry.server,
          platform: entry.platform ?? undefined,
          hostname: entry.hostname ?? undefined,
          sessionExpiresAt: entry.sessionExpiresAt ?? undefined,
        }));
        output(servers);
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const uploadCommand = defineCommand({
    meta: { name: "upload", description: "Upload a file to the server" },
    args: {
      file: { type: "positional", description: "File path", required: true },
    },
    async run({ args }) {
      try {
        const serverHome = await getServerHomeDir();
        const { http } = await connect();
        await upload(http, expandHome(args.file as string, serverHome));
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const downloadCommand = defineCommand({
    meta: { name: "download", description: "Download a file from the server" },
    args: {
      id: { type: "positional", description: "Transfer ID", required: true },
      dest: { type: "positional", description: "Destination path", required: true },
    },
    async run({ args }) {
      try {
        const { http } = await connect();
        const serverHome = await getServerHomeDir();
        await download(http, args.id as string, expandHome(args.dest as string, serverHome));
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const versionCommand = defineCommand({
    meta: { name: "version", description: "Show version" },
    run() {
      output(VERSION);
    },
  });

  const skillCommand = defineCommand({
    meta: { name: "skill", description: "Regenerate the skill zip with current tool details" },
    async run() {
      try {
        const { http } = await connect();

        const tools = await fetchTools(http);
        const toolDetails: ToolDetail[] = await Promise.all(
          tools.map(async (t) => {
            const { tool } = await fetchToolDetail(http, t.name);
            return tool;
          }),
        );

        const config = await readConfig();
        const activeServer = config.activeServer;
        if (!activeServer || !config.servers[activeServer]) {
          throw new Error("No active server. Run 'kon connect' first.");
        }
        const entry = config.servers[activeServer];

        const zip = await generateSkillZip(activeServer, entry.server, entry.token, toolDetails);
        const outPath = await writeSkillZip(zip);

        output({ skillPath: homePath(outPath), toolCount: toolDetails.length });
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const cronAddCommand = defineCommand({
    meta: { name: "add", description: "Schedule a tool execution" },
    args: {
      at: { type: "string", description: "Human-readable time (e.g. '9:00 AM tomorrow')" },
    },
    async run({ args }) {
      try {
        const { http } = await connect();

        const rawArgs = process.argv.slice(4);
        const positional: string[] = [];
        let atValue = args.at as string | undefined;

        for (let i = 0; i < rawArgs.length; i++) {
          if (rawArgs[i] === "--at" && rawArgs[i + 1]) {
            atValue = rawArgs[i + 1];
            i++;
          } else if (!rawArgs[i].startsWith("--")) {
            positional.push(rawArgs[i]);
          }
        }

        if (atValue) {
          const tool = positional[0];
          const toolArgs = positional.slice(1);
          const res = await http.post<{ job: { id: string; schedule: string; nextRun?: number } }>("/cron", {
            schedule: `@at ${atValue}`,
            tool,
            args: toolArgs,
            oneShot: true,
          });
          output({ id: res.job.id, nextRun: res.job.nextRun ? new Date(res.job.nextRun).toISOString() : null });
          return;
        }

        const schedule = positional[0];
        const tool = positional[1];
        const toolArgs = positional.slice(2);

        if (!schedule || !tool) {
          outputError("INVALID_ARGS", 'Usage: kon cron add "0 9 * * *" <tool> [args...] OR kon cron add --at "time" <tool> [args...]');
          return;
        }

        const res = await http.post<{ job: { id: string; schedule: string; nextRun?: number } }>("/cron", {
          schedule,
          tool,
          args: toolArgs,
        });
        output({ id: res.job.id, nextRun: res.job.nextRun ? new Date(res.job.nextRun).toISOString() : null });
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const cronListCommand = defineCommand({
    meta: { name: "list", description: "List scheduled jobs" },
    async run() {
      try {
        const { http } = await connect();
        const res = await http.get<{ jobs: Array<{
          id: string; schedule: string; tool: string; args: string[];
          enabled: boolean; lastRun?: number; nextRun?: number; description?: string;
        }> }>("/cron");

        output(res.jobs.length === 0 ? [] : res.jobs.map(job => ({
          id: job.id, schedule: job.schedule, tool: job.tool, args: job.args,
          enabled: job.enabled,
          nextRun: job.nextRun ? new Date(job.nextRun).toISOString() : null,
          lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : null,
        })));
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const cronRemoveCommand = defineCommand({
    meta: { name: "remove", description: "Remove a scheduled job" },
    args: {
      id: { type: "positional", description: "Job ID", required: true },
    },
    async run({ args }) {
      try {
        const { http } = await connect();
        await http.delete(`/cron/${encodeURIComponent(args.id)}`);
        output(args.id as string);
      } catch (e) {
        outputError(classifyError(e), (e as Error).message);
      }
    },
  });

  const cronCommand = defineCommand({
    meta: { name: "cron", description: "Manage scheduled tasks" },
    subCommands: {
      add: cronAddCommand,
      list: cronListCommand,
      remove: cronRemoveCommand,
    },
  });

  const main = defineCommand({
    meta: {
      name: "kon",
      version: VERSION,
      description: "kon — gigai client for Claude",
    },
    subCommands: {
      pair: pairCommand,
      connect: connectCommand,
      list: listCommand,
      help: helpCommand,
      status: statusCommand,
      upload: uploadCommand,
      download: downloadCommand,
      version: versionCommand,
      skill: skillCommand,
      cron: cronCommand,
    },
  });

  runMain(main);
}
