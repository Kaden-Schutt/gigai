import { resolve } from "node:path";
import { homedir } from "node:os";
import type { SecurityTier, SecurityConfig } from "@gigai/shared";

export type { SecurityTier, SecurityConfig };

const DEFAULT_SECURITY: SecurityConfig = { default: "strict", overrides: {} };

// ── Tier resolution ──

export function getEffectiveTier(
  config: SecurityConfig | undefined,
  toolName: string,
): SecurityTier {
  const c = config ?? DEFAULT_SECURITY;
  return c.overrides[toolName] ?? c.default;
}

// ── Shell enforcement ──

/**
 * Catastrophic commands blocked in standard tier.
 * Hardcoded, auditable, no regex. Targets
 * irreversible or system-destabilizing operations.
 */
const STANDARD_DENYLIST = new Set([
  "dd",          // raw disk I/O
  "mkfs",        // format filesystem
  "fdisk",       // partition editor
  "parted",      // partition editor
  "mkswap",      // overwrite partition with swap
  "mount",       // arbitrary fs mounting
  "umount",      // unmount filesystems
  "insmod",      // load kernel modules
  "rmmod",       // remove kernel modules
  "modprobe",    // kernel module loader
  "iptables",    // firewall rules
  "ip6tables",   // ipv6 firewall
  "reboot",      // reboot machine
  "shutdown",    // power off
  "halt",        // halt machine
  "poweroff",    // power off
  "init",        // change runlevel
  "telinit",     // change runlevel
  "systemctl",   // service management (can make remote machine unreachable)
  "chown",       // change file ownership
]);

/**
 * Shell interpreters — blocked in strict and standard to prevent
 * shell injection via `bash -c "..."`. Allowed in unrestricted.
 */
const SHELL_INTERPRETERS = new Set([
  "sh", "bash", "zsh", "fish", "csh", "tcsh", "dash", "ksh",
  "env", "xargs", "nohup", "strace", "ltrace",
]);

export function canExecuteCommand(
  tier: SecurityTier,
  command: string,
  allowlist?: string[],
): { allowed: boolean; reason?: string } {
  if (command.includes("\0")) {
    return { allowed: false, reason: "Null byte in command" };
  }

  switch (tier) {
    case "strict": {
      const list = allowlist ?? [];
      if (list.length > 0 && !list.includes(command)) {
        return { allowed: false, reason: `Command not in allowlist: ${command}. Allowed: ${list.join(", ")}` };
      }
      if (SHELL_INTERPRETERS.has(command)) {
        return { allowed: false, reason: `Shell interpreter not allowed: ${command}` };
      }
      return { allowed: true };
    }
    case "standard": {
      if (STANDARD_DENYLIST.has(command)) {
        return { allowed: false, reason: `Command blocked by security policy: ${command}` };
      }
      if (SHELL_INTERPRETERS.has(command)) {
        return { allowed: false, reason: `Shell interpreter not allowed: ${command}` };
      }
      return { allowed: true };
    }
    case "unrestricted":
      return { allowed: true };
  }
}

export function canUseSudo(allowSudo?: boolean): { allowed: boolean; reason?: string } {
  if (allowSudo === false) return { allowed: false, reason: "sudo is not allowed" };
  return { allowed: true };
}

// ── Filesystem enforcement ──

/** Sensitive paths blocked in standard tier (relative to home) */
const STANDARD_BLOCKED_PATHS = [
  ".ssh",
  ".gnupg",
  ".gpg",
  ".config/gigai",
  ".aws",
  ".azure",
  ".gcloud",
  ".kube",
  ".docker",
];

export function canAccessPath(
  tier: SecurityTier,
  resolvedPath: string,
  allowedPaths?: string[],
): { allowed: boolean; reason?: string } {
  switch (tier) {
    case "strict": {
      const paths = allowedPaths ?? [];
      if (paths.length === 0) {
        return { allowed: true };
      }
      const ok = paths.some((allowed) => {
        const r = resolve(allowed);
        return resolvedPath === r || resolvedPath.startsWith(r.endsWith("/") ? r : r + "/");
      });
      if (!ok) return { allowed: false, reason: `Path not within allowed directories: ${resolvedPath}` };
      return { allowed: true };
    }
    case "standard": {
      const home = homedir();
      for (const blocked of STANDARD_BLOCKED_PATHS) {
        const full = resolve(home, blocked);
        if (resolvedPath === full || resolvedPath.startsWith(full + "/")) {
          return { allowed: false, reason: `Path blocked by security policy: ${blocked}` };
        }
      }
      return { allowed: true };
    }
    case "unrestricted":
      return { allowed: true };
  }
}

// ── Executor enforcement ──

export function shouldInjectSeparator(tier: SecurityTier): boolean {
  return tier === "strict";
}
