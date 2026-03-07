import { spawn, type ChildProcess } from "node:child_process";

function runCommand(command: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ stdout: Buffer.concat(chunks).toString("utf8").trim(), exitCode: exitCode ?? 1 });
    });
  });
}

export async function detectCloudflared(): Promise<boolean> {
  try {
    const { exitCode } = await runCommand("cloudflared", ["version"]);
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function createTunnel(name: string): Promise<string> {
  const { stdout, exitCode } = await runCommand("cloudflared", [
    "tunnel", "create", name,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to create tunnel: ${stdout}`);
  }
  // Extract tunnel ID from output
  const match = stdout.match(/([a-f0-9-]{36})/);
  return match?.[1] ?? name;
}

export async function routeDns(tunnelName: string, subdomain: string): Promise<void> {
  const { exitCode, stdout } = await runCommand("cloudflared", [
    "tunnel", "route", "dns", tunnelName, subdomain,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Failed to route DNS: ${stdout}`);
  }
}

export function runTunnel(
  tunnelName: string,
  localPort: number,
): ChildProcess {
  const child = spawn("cloudflared", [
    "tunnel", "--url", `http://localhost:${localPort}`, "run", tunnelName,
  ], {
    shell: false,
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  return child;
}
