import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir, platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function getGigaiBin(): string {
  return process.argv[1] ?? "kond";
}

function getNodeBin(): string {
  return process.execPath;
}

function getLaunchdPlist(configPath: string): string {
  const nodeBin = getNodeBin();
  const bin = getGigaiBin();
  const currentPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.schutt.kond</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${currentPath}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${bin}</string>
    <string>start</string>
    <string>--config</string>
    <string>${configPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), ".kon", "server.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), ".kon", "server.log")}</string>
  <key>WorkingDirectory</key>
  <string>${homedir()}</string>
</dict>
</plist>
`;
}

function getSystemdUnit(configPath: string): string {
  const bin = getGigaiBin();
  return `[Unit]
Description=kond server
After=network.target

[Service]
Type=simple
ExecStart=${bin} start --config ${configPath}
Restart=always
RestartSec=5
WorkingDirectory=${homedir()}

[Install]
WantedBy=default.target
`;
}

export async function installDaemon(configPath?: string): Promise<void> {
  const config = resolve(configPath ?? "kon.config.json");
  const os = platform();

  if (os === "darwin") {
    const plistPath = join(homedir(), "Library", "LaunchAgents", "dev.schutt.kond.plist");
    await writeFile(plistPath, getLaunchdPlist(config));
    console.log(`  Wrote launchd plist: ${plistPath}`);

    try {
      await execFileAsync("launchctl", ["load", plistPath]);
      console.log("  Service loaded and started.");
    } catch {
      console.log(`  Load it with: launchctl load ${plistPath}`);
    }

    console.log(`  Logs: ~/.kon/server.log`);
    console.log(`  Stop:  launchctl unload ${plistPath}`);
  } else if (os === "linux") {
    const unitDir = join(homedir(), ".config", "systemd", "user");
    const unitPath = join(unitDir, "kond.service");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(unitDir, { recursive: true });
    await writeFile(unitPath, getSystemdUnit(config));
    console.log(`  Wrote systemd unit: ${unitPath}`);

    try {
      await execFileAsync("systemctl", ["--user", "daemon-reload"]);
      await execFileAsync("systemctl", ["--user", "enable", "--now", "kond"]);
      console.log("  Service enabled and started.");
    } catch {
      console.log("  Enable it with: systemctl --user enable --now kond");
    }

    console.log(`  Logs:   journalctl --user -u kond -f`);
    console.log(`  Stop:   systemctl --user stop kond`);
    console.log(`  Remove: systemctl --user disable kond`);
  } else {
    console.log("  Persistent daemon not supported on this platform.");
    console.log("  Run 'kond start' manually.");
  }
}

export async function uninstallDaemon(): Promise<void> {
  const os = platform();

  if (os === "darwin") {
    const plistPath = join(homedir(), "Library", "LaunchAgents", "dev.schutt.kond.plist");
    try {
      await execFileAsync("launchctl", ["unload", plistPath]);
    } catch {}
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(plistPath);
      console.log("  Service removed.");
    } catch {
      console.log("  No service found.");
    }
  } else if (os === "linux") {
    try {
      await execFileAsync("systemctl", ["--user", "disable", "--now", "kond"]);
    } catch {}
    const unitPath = join(homedir(), ".config", "systemd", "user", "kond.service");
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(unitPath);
      await execFileAsync("systemctl", ["--user", "daemon-reload"]);
      console.log("  Service removed.");
    } catch {
      console.log("  No service found.");
    }
  }
}
