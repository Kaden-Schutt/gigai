import { spawn } from "node:child_process";

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

export async function detectTailscale(): Promise<boolean> {
  try {
    const { exitCode } = await runCommand("tailscale", ["version"]);
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function getTailscaleStatus(): Promise<{ online: boolean; hostname?: string }> {
  try {
    const { stdout, exitCode } = await runCommand("tailscale", ["status", "--json"]);
    if (exitCode !== 0) return { online: false };
    const status = JSON.parse(stdout);
    return {
      online: status.BackendState === "Running",
      hostname: status.Self?.DNSName?.replace(/\.$/, ""),
    };
  } catch {
    return { online: false };
  }
}

export async function enableFunnel(port: number): Promise<string> {
  const status = await getTailscaleStatus();
  if (!status.online || !status.hostname) {
    throw new Error("Tailscale is not running or not connected");
  }

  // Enable funnel for the port (serves publicly on :443, proxies to local port)
  const { exitCode, stdout } = await runCommand("tailscale", [
    "funnel", "--bg", `${port}`,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Failed to enable Tailscale Funnel: ${stdout}`);
  }

  return `https://${status.hostname}`;
}

export async function disableFunnel(port: number): Promise<void> {
  await runCommand("tailscale", ["funnel", "--bg", "off", `${port}`]);
}

export async function getFunnelUrl(): Promise<string | null> {
  const status = await getTailscaleStatus();
  if (!status.online || !status.hostname) return null;
  return `https://${status.hostname}`;
}
