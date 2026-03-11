import {
  readFile as fsReadFile,
  writeFile as fsWriteFile,
  readdir,
} from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { KondError, ErrorCode } from "@gigai/shared";
import { canAccessPath, expandTilde, type SecurityTier } from "../security.js";

const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_READ_SIZE = 2 * 1024 * 1024; // 2MB

export async function validatePath(
  targetPath: string,
  allowedPaths: string[],
  tier: SecurityTier = "strict",
): Promise<string> {
  const resolved = resolve(expandTilde(targetPath));
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    // File may not exist yet, check parent
    real = resolved;
  }

  const check = canAccessPath(tier, real, allowedPaths);
  if (!check.allowed) {
    throw new KondError(ErrorCode.PATH_NOT_ALLOWED, check.reason!);
  }

  return real;
}


/**
 * Read a file with optional offset/limit (line-based).
 * Returns file contents as string.
 */
export async function readBuiltin(
  args: string[],
  allowedPaths: string[],
  tier: SecurityTier = "strict",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const filePath = args[0];
  if (!filePath) {
    throw new KondError(ErrorCode.VALIDATION_ERROR, "Usage: read <file> [offset] [limit]");
  }

  const safePath = await validatePath(filePath, allowedPaths, tier);
  const content = await fsReadFile(safePath, "utf8");

  if (content.length > MAX_READ_SIZE) {
    throw new KondError(
      ErrorCode.VALIDATION_ERROR,
      `File too large (${(content.length / 1024 / 1024).toFixed(1)}MB). Max: ${MAX_READ_SIZE / 1024 / 1024}MB. Use offset/limit.`,
    );
  }

  const offset = args[1] ? parseInt(args[1], 10) : 0;
  const limit = args[2] ? parseInt(args[2], 10) : 0;

  if (offset || limit) {
    const lines = content.split("\n");
    const start = Math.max(0, offset);
    const end = limit ? start + limit : lines.length;
    const sliced = lines.slice(start, end);
    return { stdout: sliced.join("\n"), stderr: "", exitCode: 0 };
  }

  return { stdout: content, stderr: "", exitCode: 0 };
}

/**
 * Write content to a file. Creates parent directories if needed.
 * Args: <file> <content>
 */
export async function writeBuiltin(
  args: string[],
  allowedPaths: string[],
  tier: SecurityTier = "strict",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const filePath = args[0];
  const content = args[1];
  if (!filePath || content === undefined) {
    throw new KondError(ErrorCode.VALIDATION_ERROR, "Usage: write <file> <content>");
  }

  const safePath = await validatePath(filePath, allowedPaths, tier);

  // Ensure parent directory exists
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(safePath), { recursive: true });

  await fsWriteFile(safePath, content, "utf8");
  return { stdout: `Written: ${safePath}`, stderr: "", exitCode: 0 };
}

/**
 * Edit a file by replacing old_string with new_string.
 * Args: <file> <old_string> <new_string> [--all]
 */
export async function editBuiltin(
  args: string[],
  allowedPaths: string[],
  tier: SecurityTier = "strict",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const filePath = args[0];
  const oldStr = args[1];
  const newStr = args[2];
  const replaceAll = args.includes("--all");

  if (!filePath || oldStr === undefined || newStr === undefined) {
    throw new KondError(ErrorCode.VALIDATION_ERROR, "Usage: edit <file> <old_string> <new_string> [--all]");
  }

  const safePath = await validatePath(filePath, allowedPaths, tier);
  const content = await fsReadFile(safePath, "utf8");

  if (!content.includes(oldStr)) {
    throw new KondError(ErrorCode.VALIDATION_ERROR, "old_string not found in file");
  }

  if (!replaceAll) {
    // Check uniqueness
    const firstIdx = content.indexOf(oldStr);
    const secondIdx = content.indexOf(oldStr, firstIdx + 1);
    if (secondIdx !== -1) {
      throw new KondError(
        ErrorCode.VALIDATION_ERROR,
        "old_string matches multiple locations. Use --all to replace all, or provide more context to make it unique.",
      );
    }
  }

  const updated = replaceAll
    ? content.split(oldStr).join(newStr)
    : content.replace(oldStr, newStr);

  await fsWriteFile(safePath, updated, "utf8");

  const count = replaceAll
    ? content.split(oldStr).length - 1
    : 1;

  return { stdout: `Replaced ${count} occurrence(s) in ${safePath}`, stderr: "", exitCode: 0 };
}

/**
 * Glob: find files matching a pattern within allowed paths.
 * Uses the `find` command with a name pattern.
 * Args: <pattern> [path]
 */
export async function globBuiltin(
  args: string[],
  allowedPaths: string[],
  tier: SecurityTier = "strict",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const pattern = args[0];
  if (!pattern) {
    throw new KondError(ErrorCode.VALIDATION_ERROR, "Usage: glob <pattern> [path]");
  }

  const searchPath = args[1] ?? ".";
  const safePath = await validatePath(searchPath, allowedPaths, tier);

  // Walk and match against glob-like pattern
  const results: string[] = [];
  const globRegex = globToRegex(pattern);

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // skip unreadable dirs
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(safePath, fullPath);

      if (globRegex.test(relPath) || globRegex.test(entry.name)) {
        results.push(relPath);
      }

      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        await walk(fullPath);
      }

      if (results.length >= 1000) return;
    }
  }

  await walk(safePath);
  return { stdout: results.join("\n"), stderr: "", exitCode: 0 };
}

/**
 * Grep: search file contents using ripgrep or fallback to JS.
 * Args: <pattern> [path] [--glob <filter>] [--type <type>] [-i] [-n] [-C <num>]
 */
export async function grepBuiltin(
  args: string[],
  allowedPaths: string[],
  tier: SecurityTier = "strict",
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (args.length === 0) {
    throw new KondError(ErrorCode.VALIDATION_ERROR, "Usage: grep <pattern> [path] [--glob <filter>] [-i] [-n] [-C <num>]");
  }

  // Parse args
  const positional: string[] = [];
  const flags: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--glob" && args[i + 1]) {
      flags.push("--glob", args[i + 1]);
      i += 2;
    } else if (arg === "--type" && args[i + 1]) {
      flags.push("--type", args[i + 1]);
      i += 2;
    } else if (arg === "-C" && args[i + 1]) {
      flags.push("-C", args[i + 1]);
      i += 2;
    } else if (arg === "-i" || arg === "-n" || arg === "-l") {
      flags.push(arg);
      i++;
    } else {
      positional.push(arg);
      i++;
    }
  }

  const pattern = positional[0];
  if (!pattern) {
    throw new KondError(ErrorCode.VALIDATION_ERROR, "No search pattern provided");
  }
  const searchPath = positional[1] ?? ".";
  const safePath = await validatePath(searchPath, allowedPaths, tier);

  // Try ripgrep first, fall back to JS grep
  try {
    return await spawnGrep("rg", [pattern, safePath, "-n", ...flags]);
  } catch {
    // rg not available, try grep
    try {
      return await spawnGrep("grep", ["-rn", ...flags, pattern, safePath]);
    } catch {
      // Both unavailable, JS fallback
      return jsGrep(pattern, safePath);
    }
  }
}

function spawnGrep(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let totalSize = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize <= MAX_OUTPUT_SIZE) stdoutChunks.push(chunk);
      else child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize <= MAX_OUTPUT_SIZE) stderrChunks.push(chunk);
    });

    child.on("error", () => reject(new Error(`${cmd} not available`)));
    child.on("close", (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: exitCode ?? 1,
      });
    });
  });
}

async function jsGrep(
  pattern: string,
  searchPath: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new KondError(ErrorCode.VALIDATION_ERROR, `Invalid pattern: ${pattern}`);
  }

  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= 500) return;
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          await walk(fullPath);
        }
      } else {
        try {
          const content = await fsReadFile(fullPath, "utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${relative(searchPath, fullPath)}:${i + 1}:${lines[i]}`);
              if (results.length >= 500) return;
            }
          }
        } catch {
          // skip binary/unreadable files
        }
      }
    }
  }

  await walk(searchPath);
  return {
    stdout: results.join("\n"),
    stderr: results.length >= 500 ? "Results truncated at 500 matches" : "",
    exitCode: results.length > 0 ? 0 : 1,
  };
}

/**
 * Convert a glob pattern to a regex.
 * Supports *, **, ?, and {a,b} syntax.
 */
function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        regex += ".*";
        i += 2;
        if (pattern[i] === "/") i++; // skip trailing slash after **
      } else {
        regex += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      regex += "[^/]";
      i++;
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end !== -1) {
        const options = pattern.slice(i + 1, end).split(",");
        regex += `(?:${options.map(escapeRegex).join("|")})`;
        i = end + 1;
      } else {
        regex += escapeRegex(c);
        i++;
      }
    } else {
      regex += escapeRegex(c);
      i++;
    }
  }
  return new RegExp(regex);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
