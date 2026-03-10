import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// --- Types ---

export interface PrerequisiteCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
  action?: string;
}

export interface PrerequisiteResult {
  passed: boolean;
  checks: PrerequisiteCheck[];
}

export interface TailscaleAuthState {
  installed: boolean;
  running: boolean;
  authenticated: boolean;
  dnsName?: string;
  backendState?: string;
}

export interface TailscaleAuthEvent {
  type: "auth-url" | "authenticated" | "error";
  authUrl?: string;
  error?: string;
}

export interface FunnelResult {
  url: string;
  consentUrl?: string;
}

// --- Helper ---

async function runCmd(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args);
    return { stdout, stderr, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    if (err.stdout !== undefined) {
      return {
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
        exitCode: typeof err.code === "number" ? err.code : 1,
      };
    }
    throw e;
  }
}

// --- macOS-specific ---

export async function checkRunningTailscaleApp(): Promise<boolean> {
  try {
    const { exitCode } = await runCmd("pgrep", ["-x", "Tailscale"]);
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function checkHomebrew(): Promise<boolean> {
  try {
    const { exitCode } = await runCmd("which", ["brew"]);
    return exitCode === 0;
  } catch {
    return false;
  }
}

// --- Cross-platform detection ---

export async function checkTailscaleDaemonRunning(): Promise<{
  running: boolean;
  error?: string;
}> {
  try {
    const { stdout, exitCode } = await runCmd("tailscale", ["status", "--json"]);
    if (exitCode !== 0) {
      return { running: false, error: "tailscale status returned non-zero" };
    }
    JSON.parse(stdout);
    return { running: true };
  } catch (e) {
    const msg = (e as Error).message;
    if (/ECONNREFUSED|connect/i.test(msg)) {
      return { running: false, error: "Daemon not running (connection refused)" };
    }
    if (/permission/i.test(msg)) {
      return { running: false, error: "Permission denied — may need Full Disk Access on macOS" };
    }
    if (/ENOENT/.test(msg)) {
      return { running: false, error: "tailscale CLI not found" };
    }
    return { running: false, error: msg };
  }
}

export async function checkTailscaledInstalled(): Promise<{
  found: boolean;
  path?: string;
}> {
  try {
    const { stdout } = await execFileAsync("which", ["tailscaled"]);
    const path = stdout.trim();
    return path ? { found: true, path } : { found: false };
  } catch {
    return { found: false };
  }
}

export async function checkTailscaleAuth(): Promise<TailscaleAuthState> {
  try {
    const { stdout, exitCode } = await runCmd("tailscale", ["status", "--json"]);
    if (exitCode !== 0) {
      return { installed: true, running: false, authenticated: false };
    }
    const data = JSON.parse(stdout);
    const backendState = data.BackendState as string | undefined;
    const dnsName = (data.Self?.DNSName as string | undefined)?.replace(/\.$/, "");
    return {
      installed: true,
      running: true,
      authenticated: backendState === "Running",
      dnsName,
      backendState,
    };
  } catch (e) {
    if (/ENOENT/.test((e as Error).message)) {
      return { installed: false, running: false, authenticated: false };
    }
    return { installed: true, running: false, authenticated: false };
  }
}

export async function checkFunnelStatus(): Promise<{
  active: boolean;
  error?: string;
}> {
  try {
    const { stdout, stderr, exitCode } = await runCmd("tailscale", [
      "funnel",
      "status",
    ]);
    const combined = stdout + stderr;
    if (exitCode !== 0) {
      return { active: false, error: combined.trim() || `exit code ${exitCode}` };
    }
    if (combined.includes("No serve config")) {
      return { active: false };
    }
    return { active: true };
  } catch (e) {
    return { active: false, error: (e as Error).message };
  }
}

// --- Setup functions ---

export async function installTailscaleFormula(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("brew", ["install", "tailscale"], {
      stdio: "inherit",
    });
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`brew install tailscale exited ${code}`));
      const svc = spawn("brew", ["services", "start", "tailscale"], {
        stdio: "inherit",
      });
      svc.on("close", (svcCode) => {
        svcCode === 0
          ? resolve()
          : reject(new Error(`brew services start tailscale exited ${svcCode}`));
      });
      svc.on("error", reject);
    });
    child.on("error", reject);
  });
}

export async function installTailscaleCask(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("brew", ["install", "--cask", "tailscale-app"], {
      stdio: "inherit",
    });
    child.on("close", (code) => {
      code === 0
        ? resolve()
        : reject(new Error(`brew install --cask tailscale-app exited ${code}`));
    });
    child.on("error", reject);
  });
}

export async function removeTailscaleApp(): Promise<void> {
  const { exitCode, stderr } = await runCmd("rm", ["-rf", "/Applications/Tailscale.app"]);
  if (exitCode !== 0) {
    throw new Error(`Failed to remove /Applications/Tailscale.app: ${stderr}`);
  }
}

// --- Composite ---

export async function checkAllPrerequisites(): Promise<PrerequisiteResult> {
  const checks: PrerequisiteCheck[] = [];
  const isMac = platform() === "darwin";

  // 1. Is tailscaled on PATH?
  const installed = await checkTailscaledInstalled();
  if (installed.found) {
    // Is the daemon running?
    const daemon = await checkTailscaleDaemonRunning();
    if (daemon.running) {
      // Check funnel status
      const funnel = await checkFunnelStatus();
      if (funnel.active || !funnel.error?.includes("not supported")) {
        checks.push({
          id: "tailscaled",
          label: "Tailscale daemon",
          passed: true,
          detail: "Running (using existing)",
        });
        return { passed: true, checks };
      }
      // Running but doesn't support Funnel
      checks.push({
        id: "tailscaled-no-funnel",
        label: "Tailscale daemon",
        passed: false,
        detail: "Running but doesn't support Funnel",
        action:
          "Your tailscaled doesn't support Funnel. " +
          "Uninstall it, then re-run 'kond init' to install the Homebrew version.",
      });
      return { passed: false, checks };
    }

    // On PATH but not running
    checks.push({
      id: "tailscaled-stopped",
      label: "Tailscale daemon",
      passed: false,
      detail: `Found at ${installed.path} but not running`,
      action: isMac
        ? "Start it: brew services start tailscale"
        : "Start it: sudo systemctl start tailscaled",
    });
    return { passed: false, checks };
  }

  // 2. tailscaled NOT on PATH
  if (isMac) {
    // Is there a running Tailscale GUI process? (App Store or standalone .app)
    const guiRunning = await checkRunningTailscaleApp();
    if (guiRunning) {
      checks.push({
        id: "appstore-tailscale",
        label: "Tailscale (GUI app)",
        passed: false,
        detail: "App Store or standalone Tailscale.app detected",
        action:
          "The standalone CLI version is required for Funnel. " +
          "Your account and devices stay the same after switching.",
      });
      return { passed: false, checks };
    }

    // Is Homebrew installed?
    const hasBrew = await checkHomebrew();
    if (!hasBrew) {
      checks.push({
        id: "homebrew",
        label: "Homebrew",
        passed: false,
        detail: "Homebrew not found",
        action: "Install Homebrew first: https://brew.sh",
      });
      return { passed: false, checks };
    }
  }

  // 3. Nothing found — tailscale-missing
  checks.push({
    id: "tailscale-missing",
    label: "Tailscale",
    passed: false,
    detail: "Not installed",
    action: isMac
      ? "Will install via Homebrew"
      : "Install: curl -fsSL https://tailscale.com/install.sh | sh",
  });
  return { passed: false, checks };
}

// --- Setup functions ---

export async function runTailscaleAuth(
  onEvent: (event: TailscaleAuthEvent) => void,
): Promise<void> {
  const state = await checkTailscaleAuth();
  if (state.authenticated) {
    onEvent({ type: "authenticated" });
    return;
  }

  return new Promise((resolve, reject) => {
    const child = spawn("tailscale", ["up", "--json"], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.AuthURL) {
            onEvent({ type: "auth-url", authUrl: obj.AuthURL });
          }
          if (obj.BackendState === "Running") {
            onEvent({ type: "authenticated" });
          }
        } catch {
          /* not JSON, skip */
        }
      }
    });

    child.on("close", (code) => {
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer);
          if (obj.BackendState === "Running") onEvent({ type: "authenticated" });
        } catch {
          /* ignore */
        }
      }
      code === 0 ? resolve() : reject(new Error(`tailscale up exited ${code}`));
    });

    child.on("error", (err) => {
      onEvent({ type: "error", error: err.message });
      reject(err);
    });
  });
}

export async function activateFunnel(port: number): Promise<FunnelResult> {
  const auth = await checkTailscaleAuth();
  if (!auth.dnsName) throw new Error("Tailscale not authenticated");

  const url = `https://${auth.dnsName}`;

  const result = await Promise.race([
    runCmd("tailscale", ["funnel", "--bg", `${port}`]),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), 10_000),
    ),
  ]).catch((e) => {
    if ((e as Error).message === "TIMEOUT") return null;
    throw e;
  });

  const combined = result ? result.stdout + result.stderr : "";
  const consentMatch = combined.match(
    /(https:\/\/login\.tailscale\.com\/\S+)/,
  );

  if (consentMatch) {
    return { url, consentUrl: consentMatch[1] };
  }

  const status = await checkFunnelStatus();
  if (!status.active) {
    throw new Error(
      `Funnel failed to activate: ${status.error ?? combined}`,
    );
  }

  return { url };
}

export function openUrl(url: string): void {
  const cmd = platform() === "darwin" ? "open" : "xdg-open";
  const child = spawn(cmd, [url], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
