import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ToolConfig, ToolSummary, ToolDetail, ToolArg } from "@gigai/shared";
import { KondError, ErrorCode } from "@gigai/shared";
import type { RegistryEntry } from "./types.js";

const execFileAsync = promisify(execFile);

interface BuiltinDoc {
  usage: string;
  args: ToolArg[];
  examples: string;
  returns: string;
  notes?: string;
}

const BUILTIN_DOCS: Record<string, BuiltinDoc> = {
  read: {
    usage: "read <file> [offset] [limit]",
    args: [
      { name: "file", description: "Absolute path to the file to read", required: true },
      { name: "offset", description: "Start from this line number (0-based)", required: false, default: "0" },
      { name: "limit", description: "Max number of lines to return", required: false, default: "all" },
    ],
    examples: [
      "kon read ~/projects/app/src/index.ts",
      "kon read ~/projects/app/src/index.ts 10 50  # lines 10-59",
    ].join("\n"),
    returns: "File contents as text. Max 2MB per read.",
  },
  write: {
    usage: "write <file> <content>",
    args: [
      { name: "file", description: "Absolute path to write to (parent dirs created automatically)", required: true },
      { name: "content", description: "The content to write (overwrites existing file)", required: true },
    ],
    examples: 'kon write ~/projects/app/hello.txt "Hello, world!"',
    returns: "Confirmation message with the written path.",
  },
  edit: {
    usage: "edit <file> <old_string> <new_string> [--all]",
    args: [
      { name: "file", description: "Absolute path to the file to edit", required: true },
      { name: "old_string", description: "Exact text to find and replace", required: true },
      { name: "new_string", description: "Replacement text", required: true },
      { name: "--all", description: "Replace all occurrences (default: replace first, fails if not unique)", required: false },
    ],
    examples: [
      'kon edit ~/projects/app/src/index.ts "const x = 1" "const x = 2"',
      'kon edit ~/projects/app/src/index.ts "TODO" "DONE" --all',
    ].join("\n"),
    returns: "Count of replacements made.",
    notes: "Without --all, fails if old_string matches multiple locations. Provide more surrounding context to make it unique.",
  },
  glob: {
    usage: "glob <pattern> [path]",
    args: [
      { name: "pattern", description: "Glob pattern to match files against. Supports *, **, ?, {a,b}", required: true },
      { name: "path", description: "Directory to search in", required: false, default: "." },
    ],
    examples: [
      'kon glob "**/*.ts" ~/projects/app',
      'kon glob "src/**/*.{ts,tsx}"',
      'kon glob "*.json" ~/projects/app/config',
    ].join("\n"),
    returns: "Newline-separated list of matching relative paths. Max 1000 results. Skips dot dirs and node_modules.",
  },
  grep: {
    usage: "grep <pattern> [path] [--glob <filter>] [--type <type>] [-i] [-n] [-l] [-C <num>]",
    args: [
      { name: "pattern", description: "Regex pattern to search for", required: true },
      { name: "path", description: "File or directory to search in", required: false, default: "." },
      { name: "--glob", description: "Filter files by glob (e.g. \"*.ts\")", required: false },
      { name: "--type", description: "Filter by file type (e.g. js, py)", required: false },
      { name: "-i", description: "Case-insensitive search", required: false },
      { name: "-n", description: "Show line numbers", required: false },
      { name: "-l", description: "Only show file names", required: false },
      { name: "-C", description: "Show num lines of context around matches", required: false },
    ],
    examples: [
      'kon grep "TODO" ~/projects/app --glob "*.ts"',
      'kon grep "function\\s+\\w+" ~/projects/app -n',
      'kon grep "error" ~/projects/app/logs -i -C 3',
    ].join("\n"),
    returns: "Matching lines in file:line:content format. Uses ripgrep if available, falls back to built-in search. Max 500 results.",
  },
  bash: {
    usage: "bash <command> [args...]",
    args: [
      { name: "command", description: "The command to execute (e.g. git, npm, ls)", required: true },
      { name: "args", description: "Arguments to pass to the command", required: false },
    ],
    examples: [
      "kon bash git status",
      "kon bash ls -la ~/projects",
      "kon bash npm install --save-dev typescript",
      "kon bash cat /etc/hostname",
    ].join("\n"),
    returns: "stdout, stderr, and exit code. Max 10MB output.",
    notes: "Commands are executed directly (not through a shell interpreter). Shell operators like pipes (|), redirects (>), and && are NOT supported — run separate commands instead. May be restricted by an allowlist depending on server security tier.",
  },
};

export class ToolRegistry {
  private tools = new Map<string, RegistryEntry>();

  loadFromConfig(tools: ToolConfig[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(config: ToolConfig): void {
    const entry: RegistryEntry = { type: config.type, config } as RegistryEntry;
    this.tools.set(config.name, entry);
  }

  get(name: string): RegistryEntry {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new KondError(ErrorCode.TOOL_NOT_FOUND, `Tool not found: ${name}`);
    }
    return entry;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolSummary[] {
    return Array.from(this.tools.values()).map((entry) => ({
      name: entry.config.name,
      type: entry.config.type,
      description: entry.config.description,
    }));
  }

  getDetail(name: string): ToolDetail {
    const entry = this.get(name);
    const detail: ToolDetail = {
      name: entry.config.name,
      type: entry.config.type,
      description: entry.config.description,
    };

    if (entry.type === "builtin") {
      const builtinName = (entry.config as { builtin: string }).builtin;
      const doc = BUILTIN_DOCS[builtinName];
      if (doc) {
        detail.usage = doc.usage;
        detail.args = doc.args;
        detail.helpOutput = formatBuiltinHelp(builtinName, doc);
      }
    } else if (entry.type === "cli") {
      detail.usage = `${entry.config.command} ${(entry.config.args ?? []).join(" ")} [args...]`;
    } else if (entry.type === "script") {
      detail.usage = `${entry.config.path} [args...]`;
    }

    return detail;
  }

  async getDetailWithHelp(name: string): Promise<ToolDetail> {
    const detail = this.getDetail(name);
    const entry = this.get(name);

    // For CLI tools, try to capture --help output
    if (entry.type === "cli") {
      try {
        const { stdout, stderr } = await execFileAsync(
          entry.config.command,
          [...(entry.config.args ?? []), "--help"],
          { timeout: 5000, encoding: "utf8" },
        );
        const helpText = (stdout || stderr).trim();
        if (helpText.length > 0 && helpText.length < 4096) {
          detail.helpOutput = helpText;
        }
      } catch (e: any) {
        const helpText = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
        if (helpText.length > 0 && helpText.length < 4096) {
          detail.helpOutput = helpText;
        }
      }
    }

    return detail;
  }
}

function formatBuiltinHelp(name: string, doc: BuiltinDoc): string {
  const lines: string[] = [];

  lines.push(`Usage: kon ${doc.usage}`);
  lines.push("");

  lines.push("Arguments:");
  for (const arg of doc.args) {
    const req = arg.required ? " (required)" : "";
    const def = arg.default ? ` [default: ${arg.default}]` : "";
    lines.push(`  ${arg.name}${req}${def} — ${arg.description}`);
  }
  lines.push("");

  lines.push("Examples:");
  for (const ex of doc.examples.split("\n")) {
    lines.push(`  ${ex}`);
  }
  lines.push("");

  lines.push(`Returns: ${doc.returns}`);

  if (doc.notes) {
    lines.push("");
    lines.push(`Note: ${doc.notes}`);
  }

  return lines.join("\n");
}
