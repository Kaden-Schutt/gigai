import { spawn } from "node:child_process";
import { GigaiError, ErrorCode } from "@gigai/shared";

export interface ShellConfig {
  allowlist: string[];
  allowSudo: boolean;
}

const SHELL_INTERPRETERS = new Set([
  "sh", "bash", "zsh", "fish", "csh", "tcsh", "dash", "ksh",
  "env", "xargs", "nohup", "strace", "ltrace",
]);

const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB

export async function execCommandSafe(
  command: string,
  args: string[],
  config: ShellConfig,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!config.allowlist.includes(command)) {
    throw new GigaiError(
      ErrorCode.COMMAND_NOT_ALLOWED,
      `Command not in allowlist: ${command}. Allowed: ${config.allowlist.join(", ")}`,
    );
  }

  if (command === "sudo" && !config.allowSudo) {
    throw new GigaiError(ErrorCode.COMMAND_NOT_ALLOWED, "sudo is not allowed");
  }

  if (SHELL_INTERPRETERS.has(command)) {
    throw new GigaiError(
      ErrorCode.COMMAND_NOT_ALLOWED,
      `Shell interpreter not allowed: ${command}`,
    );
  }

  for (const arg of args) {
    if (arg.includes("\0")) {
      throw new GigaiError(ErrorCode.VALIDATION_ERROR, "Null byte in argument");
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

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
      else child.kill("SIGTERM");
    });

    child.on("error", (err) => {
      reject(new GigaiError(ErrorCode.EXEC_FAILED, `Failed to spawn ${command}: ${err.message}`));
    });

    child.on("close", (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: exitCode ?? 1,
      });
    });
  });
}
