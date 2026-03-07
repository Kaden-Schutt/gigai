import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir, platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function getGigaiBin(): string {
  return process.argv[1] ?? "gigai";
}

function getLaunchdPlist(configPath: string): string {
  const bin = getGigaiBin();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.gigai.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bin}</string>
    <string>server</string>
    <string>start</string>
    <string>--config</string>
    <string>${configPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), ".gigai", "server.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), ".gigai", "server.log")}</string>
  <key>WorkingDirectory</key>
  <string>${homedir()}</string>
</dict>
</plist>
`;
}

function getSystemdUnit(configPath: string): string {
  const bin = getGigaiBin();
  return `[Unit]
Description=gigai server
After=network.target

[Service]
Type=simple
ExecStart=${bin} server start --config ${configPath}
Restart=always
RestartSec=5
WorkingDirectory=${homedir()}

[Install]
WantedBy=default.target
`;
}

export async function installDaemon(configPath?: string): Promise<void> {
  const config = resolve(configPath ?? "gigai.config.json");
  const os = platform();

  if (os === "darwin") {
    const plistPath = join(homedir(), "Library", "LaunchAgents", "com.gigai.server.plist");
    await writeFile(plistPath, getLaunchdPlist(config));
    console.log(`  Wrote launchd plist: ${plistPath}`);

    try {
      await execFileAsync("launchctl", ["load", plistPath]);
      console.log("  Service loaded and started.");
    } catch {
      console.log(`  Load it with: launchctl load ${plistPath}`);
    }

    console.log(`  Logs: ~/.gigai/server.log`);
    console.log(`  Stop:  launchctl unload ${plistPath}`);
  } else if (os === "linux") {
    const unitDir = join(homedir(), ".config", "systemd", "user");
    const unitPath = join(unitDir, "gigai.service");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(unitDir, { recursive: true });
    await writeFile(unitPath, getSystemdUnit(config));
    console.log(`  Wrote systemd unit: ${unitPath}`);

    try {
      await execFileAsync("systemctl", ["--user", "daemon-reload"]);
      await execFileAsync("systemctl", ["--user", "enable", "--now", "gigai"]);
      console.log("  Service enabled and started.");
    } catch {
      console.log("  Enable it with: systemctl --user enable --now gigai");
    }

    console.log(`  Logs:   journalctl --user -u gigai -f`);
    console.log(`  Stop:   systemctl --user stop gigai`);
    console.log(`  Remove: systemctl --user disable gigai`);
  } else {
    console.log("  Persistent daemon not supported on this platform.");
    console.log("  Run 'gigai server start' manually.");
  }
}

export async function uninstallDaemon(): Promise<void> {
  const os = platform();

  if (os === "darwin") {
    const plistPath = join(homedir(), "Library", "LaunchAgents", "com.gigai.server.plist");
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
      await execFileAsync("systemctl", ["--user", "disable", "--now", "gigai"]);
    } catch {}
    const unitPath = join(homedir(), ".config", "systemd", "user", "gigai.service");
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
