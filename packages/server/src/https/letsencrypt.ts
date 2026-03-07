import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
        exitCode: exitCode ?? 1,
      });
    });
  });
}

export async function detectCertbot(): Promise<boolean> {
  try {
    const { exitCode } = await runCommand("certbot", ["--version"]);
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function getCert(domain: string, email: string): Promise<void> {
  const { exitCode, stderr } = await runCommand("certbot", [
    "certonly",
    "--standalone",
    "-d", domain,
    "--email", email,
    "--agree-tos",
    "--non-interactive",
  ]);

  if (exitCode !== 0) {
    throw new Error(`Failed to obtain certificate: ${stderr}`);
  }
}

export interface CertPaths {
  cert: string;
  key: string;
}

export async function getCertPaths(domain: string): Promise<CertPaths | null> {
  const certPath = join("/etc/letsencrypt/live", domain, "fullchain.pem");
  const keyPath = join("/etc/letsencrypt/live", domain, "privkey.pem");

  try {
    await access(certPath);
    await access(keyPath);
    return { cert: certPath, key: keyPath };
  } catch {
    return null;
  }
}
