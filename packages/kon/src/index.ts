import { defineCommand, runMain } from "citty";
import { readConfig } from "../../cli/src/config.js";
import { connect } from "../../cli/src/connect.js";
import { pair } from "../../cli/src/pair.js";
import { fetchTools, fetchToolDetail } from "../../cli/src/discover.js";
import { execTool, execMcpTool } from "../../cli/src/exec.js";
import { upload, download } from "../../cli/src/transfer.js";
import { formatToolList, formatToolDetail, formatStatus } from "../../cli/src/output.js";
import { generateSkillZip, writeSkillZip } from "../../cli/src/skill.js";
import { VERSION } from "../../cli/src/version.js";
import type { ToolDetail } from "@gigai/shared";

const KNOWN_COMMANDS = new Set([
  "pair", "connect", "list", "help", "status",
  "upload", "download", "version", "skill", "cron", "--help", "-h",
]);

// Intercept unknown commands as dynamic tool execution
const firstArg = process.argv[2];
if (firstArg && !firstArg.startsWith("-") && !KNOWN_COMMANDS.has(firstArg)) {
  const toolName = firstArg;
  const toolArgs = process.argv.slice(3);

  try {
    const { http } = await connect();
    const { tool: detail } = await fetchToolDetail(http, toolName);

    if (detail.type === "mcp") {
      const mcpToolName = toolArgs[0];
      if (!mcpToolName) {
        const toolNames = (detail.mcpTools ?? []).map(t => `  ${t.name} — ${t.description}`);
        console.log(`MCP tools for ${toolName}:\n${toolNames.join("\n")}`);
      } else {
        const jsonArg = toolArgs.slice(1).join(" ");
        const args = jsonArg ? JSON.parse(jsonArg) : {};
        await execMcpTool(http, toolName, mcpToolName, args);
      }
    } else {
      await execTool(http, toolName, toolArgs);
    }
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exitCode = 1;
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
      await pair(args.code, args.server);
    },
  });

  const connectCommand = defineCommand({
    meta: { name: "connect", description: "Establish a session with the server" },
    args: {
      name: { type: "positional", description: "Server name (optional)", required: false },
    },
    async run({ args }) {
      const { serverUrl } = await connect(args.name as string | undefined);
      console.log(`Connected to ${serverUrl}`);
    },
  });

  const listCommand = defineCommand({
    meta: { name: "list", description: "List available tools" },
    async run() {
      const { http } = await connect();
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
      const { http } = await connect();
      const { tool } = await fetchToolDetail(http, args.tool);
      console.log(formatToolDetail(tool));
    },
  });

  const statusCommand = defineCommand({
    meta: { name: "status", description: "Show connection status" },
    async run() {
      const config = await readConfig();
      console.log(formatStatus(config));
    },
  });

  const uploadCommand = defineCommand({
    meta: { name: "upload", description: "Upload a file to the server" },
    args: {
      file: { type: "positional", description: "File path", required: true },
    },
    async run({ args }) {
      const { http } = await connect();
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
      const { http } = await connect();
      await download(http, args.id, args.dest);
    },
  });

  const versionCommand = defineCommand({
    meta: { name: "version", description: "Show version" },
    run() {
      console.log(`kon v${VERSION}`);
    },
  });

  const skillCommand = defineCommand({
    meta: { name: "skill", description: "Regenerate the skill zip with current tool details" },
    async run() {
      const { http } = await connect();

      // Fetch all tools and their details
      const tools = await fetchTools(http);
      console.log(`Fetching details for ${tools.length} tool(s)...`);

      const toolDetails: ToolDetail[] = await Promise.all(
        tools.map(async (t) => {
          const { tool } = await fetchToolDetail(http, t.name);
          return tool;
        }),
      );

      // Read current config to get server info
      const config = await readConfig();
      const activeServer = config.activeServer;
      if (!activeServer || !config.servers[activeServer]) {
        throw new Error("No active server. Run 'kon connect' first.");
      }
      const entry = config.servers[activeServer];

      const zip = await generateSkillZip(activeServer, entry.server, entry.token, toolDetails);
      const outPath = await writeSkillZip(zip);

      console.log(`\nSkill zip written to: ${outPath}`);
      console.log(`Included ${toolDetails.length} tool documentation file(s).`);
      console.log("Upload this file as a skill in Claude (Settings → Customize → Upload Skill).");
    },
  });

  const cronAddCommand = defineCommand({
    meta: { name: "add", description: "Schedule a tool execution" },
    args: {
      at: { type: "string", description: "Human-readable time (e.g. '9:00 AM tomorrow')" },
    },
    async run({ args }) {
      const { http } = await connect();

      // Parse: kon cron add [--at "time"] <schedule-or-tool> <tool> [args...]
      // Raw argv after "cron add": find positional args (skip --at and its value)
      const rawArgs = process.argv.slice(4); // skip: kon cron add
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

      let schedule: string;
      let tool: string;
      let toolArgs: string[];
      let oneShot = false;

      if (atValue) {
        // --at mode: all positional args are tool + args
        tool = positional[0];
        toolArgs = positional.slice(1);
        // POST to server with at expression — server parses it
        const res = await http.post<{ job: { id: string; schedule: string; nextRun?: number } }>("/cron", {
          schedule: `@at ${atValue}`,
          tool,
          args: toolArgs,
          oneShot: true,
        });
        console.log(`Scheduled: ${res.job.id}`);
        console.log(`  ${tool} ${toolArgs.join(" ")}`);
        if (res.job.nextRun) {
          console.log(`  Next run: ${new Date(res.job.nextRun).toLocaleString()}`);
        }
        return;
      }

      // Standard cron mode: first positional is schedule, rest is tool + args
      schedule = positional[0];
      tool = positional[1];
      toolArgs = positional.slice(2);

      if (!schedule || !tool) {
        console.error("Usage:");
        console.error('  kon cron add "0 9 * * *" <tool> [args...]');
        console.error('  kon cron add --at "9:00 AM tomorrow" <tool> [args...]');
        process.exitCode = 1;
        return;
      }

      const res = await http.post<{ job: { id: string; schedule: string; nextRun?: number } }>("/cron", {
        schedule,
        tool,
        args: toolArgs,
      });
      console.log(`Scheduled: ${res.job.id}`);
      console.log(`  ${schedule} — ${tool} ${toolArgs.join(" ")}`);
      if (res.job.nextRun) {
        console.log(`  Next run: ${new Date(res.job.nextRun).toLocaleString()}`);
      }
    },
  });

  const cronListCommand = defineCommand({
    meta: { name: "list", description: "List scheduled jobs" },
    async run() {
      const { http } = await connect();
      const res = await http.get<{ jobs: Array<{
        id: string; schedule: string; tool: string; args: string[];
        enabled: boolean; lastRun?: number; nextRun?: number; description?: string;
      }> }>("/cron");

      if (res.jobs.length === 0) {
        console.log("No scheduled jobs.");
        return;
      }

      for (const job of res.jobs) {
        const status = job.enabled ? "active" : "disabled";
        const cmd = `${job.tool} ${job.args.join(" ")}`.trim();
        const next = job.nextRun ? new Date(job.nextRun).toLocaleString() : "—";
        const last = job.lastRun ? new Date(job.lastRun).toLocaleString() : "never";
        console.log(`${job.id}  [${status}]  ${job.schedule}`);
        console.log(`  ${cmd}`);
        console.log(`  next: ${next}  last: ${last}`);
        console.log();
      }
    },
  });

  const cronRemoveCommand = defineCommand({
    meta: { name: "remove", description: "Remove a scheduled job" },
    args: {
      id: { type: "positional", description: "Job ID", required: true },
    },
    async run({ args }) {
      const { http } = await connect();
      await http.delete(`/cron/${encodeURIComponent(args.id)}`);
      console.log(`Removed: ${args.id}`);
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
