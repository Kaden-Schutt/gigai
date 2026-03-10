import { spawn } from "node:child_process";
import { GigaiError, ErrorCode } from "@gigai/shared";
import type { RegistryEntry } from "../registry/types.js";
import { sanitizeArgs } from "./sanitize.js";
import { shouldInjectSeparator, type SecurityTier } from "../security.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

const DEFAULT_TIMEOUT = 30_000;
const KILL_GRACE_PERIOD = 5_000;
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

export function executeTool(
  entry: RegistryEntry,
  args: string[],
  timeout?: number,
  tier: SecurityTier = "strict",
): Promise<ExecResult> {
  const sanitized = sanitizeArgs(args);
  const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT;

  let command: string;
  let spawnArgs: string[];
  let cwd: string | undefined;
  let env: Record<string, string> | undefined;

  switch (entry.type) {
    case "cli":
      command = entry.config.command;
      spawnArgs = [...(entry.config.args ?? [])];
      if (shouldInjectSeparator(tier)) {
        spawnArgs.push("--");
      }
      spawnArgs.push(...sanitized);
      cwd = entry.config.cwd;
      env = entry.config.env;
      break;
    case "script": {
      const interpreter = entry.config.interpreter ?? "node";
      command = interpreter;
      spawnArgs = [entry.config.path, ...sanitized];
      break;
    }
    default:
      throw new GigaiError(
        ErrorCode.EXEC_FAILED,
        `Cannot execute tool of type: ${entry.type}`,
      );
  }

  return new Promise<ExecResult>((resolve, reject) => {
    const start = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(command, spawnArgs, {
      shell: false,
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, KILL_GRACE_PERIOD);
    }, effectiveTimeout);

    let totalSize = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize <= MAX_OUTPUT_SIZE) stdoutChunks.push(chunk);
      else if (!killed) { killed = true; child.kill("SIGTERM"); }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize <= MAX_OUTPUT_SIZE) stderrChunks.push(chunk);
      else if (!killed) { killed = true; child.kill("SIGTERM"); }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new GigaiError(ErrorCode.EXEC_FAILED, `Failed to spawn: ${err.message}`));
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      if (killed) {
        reject(new GigaiError(ErrorCode.EXEC_TIMEOUT, `Tool execution timed out after ${effectiveTimeout}ms`));
        return;
      }

      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: exitCode ?? 1,
        durationMs,
      });
    });
  });
}
