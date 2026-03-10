---
name: kond-setup
description: Set up, configure, and troubleshoot your kond server. Use after running the install wizard, or anytime you need help managing tools, MCP servers, cron jobs, or connectivity.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# kond Server Setup Helper

You are helping the user set up and manage their **kond server** — the backend component of Kon that runs on their machine and exposes tools to Claude over HTTPS.

## Context

Kon is a bridge that gives Claude access to local tools (CLI commands, MCP servers, scripts) from any platform. The architecture:

- **kond** (server) — runs on the user's machine. Install: `curl -fsSL kond.schutt.dev | sh` or `brew install schuttdev/tap/kond` or `npm i -g @schuttdev/kond`
- **kon** (client) — runs in Claude's code execution container. Install: `curl -fsSL kon.schutt.dev | sh` or `npm i -g @schuttdev/kon`
- Communication happens over HTTPS via Tailscale Funnel (recommended), Cloudflare Tunnel, or manual certs

## What you can help with

### Initial setup (post-wizard)
If the user just ran `kond init` and needs help finishing setup:

1. **Verify the server is running**: `curl -s http://localhost:7443/health | jq` or check with `kond status`
2. **Verify Tailscale Funnel**: `tailscale funnel status` — ensure port 7443 is funneled
3. **Test external access**: `curl -s https://<hostname>.ts.net:7443/health`
4. **Generate a pairing code**: `kond pair` — gives an 8-char code valid for 5 minutes

### Adding tools

**MCP servers** (most common):
```bash
kond mcp add <name> -- <command> [args...]
# Examples:
kond mcp add browser -- npx -y @anthropic-ai/mcp-server-puppeteer
kond mcp add github -- npx -y @modelcontextprotocol/server-github --env GITHUB_TOKEN=ghp_xxx
kond mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem /home/user/projects
```

**CLI tools**:
```bash
kond wrap cli    # interactive — prompts for name, command, description
```

**Scripts**:
```bash
kond wrap script  # interactive — prompts for name, path, description
```

**Import from Claude Desktop**: The init wizard can auto-detect MCP servers from Claude Desktop's config. If the user skipped this:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Read the file, find `mcpServers`, and add each one with `kond mcp add`

### Cron / scheduled tasks

```bash
kond cron add "0 9 * * *" bash git pull              # daily at 9am
kond cron add --at "9:00 AM tomorrow" bash git pull   # one-shot
kond cron add --at "in 30 minutes" read ~/log.txt     # relative time
kond cron list                                        # list scheduled jobs
kond cron remove <id>                                 # remove a job
```

### Multi-server setup

Users can pair multiple machines (e.g., a Mac and a Linux server). Each server runs its own kond instance. Kon routes commands to the active server — Claude learns to switch servers based on platform capabilities (iMessage needs macOS, systemd needs Linux, etc.).

To add another server, run `kond init` on the second machine and pair it. The kon client config at `~/.kon/config.json` (in code exec) holds all server entries.

### Troubleshooting

**Server won't start:**
- Check if port 7443 is in use: `lsof -i :7443`
- Check config is valid JSON: `cat kon.config.json | jq .`
- Check logs if running as daemon: `kond logs`

**Tailscale Funnel not working:**
- Verify Tailscale is running: `tailscale status`
- Enable funnel: `tailscale funnel 7443`
- Check funnel status: `tailscale funnel status`
- Ensure HTTPS is enabled in Tailscale admin console (admin.tailscale.com > DNS > Enable HTTPS)

**Pairing fails:**
- Codes expire after 5 minutes — generate a fresh one with `kond pair`
- Ensure the server URL is reachable from the internet (test with curl from another machine)
- Check that the org UUID matches (Claude's code exec environment must be under the same Anthropic org)

**MCP server won't start:**
- Test the command manually: run the MCP command directly to see if it starts
- Check for missing env vars or dependencies
- Some MCP servers need `npx -y` to auto-install

**Tools not showing up in kon:**
- After adding tools, regenerate the skill zip: the next `kon pair` or `kon skill` will pick them up
- Verify with `kond status` that the tool is registered

## Config file reference

The config lives at `kon.config.json` in the directory where the server was initialized. Key sections:

```json
{
  "serverName": "my-machine",
  "server": {
    "port": 7443,
    "host": "0.0.0.0",
    "https": { "provider": "tailscale", "funnelPort": 7443 }
  },
  "auth": {
    "encryptionKey": "<64-char hex key>",
    "pairingTtlSeconds": 300,
    "sessionTtlSeconds": 14400
  },
  "tools": [
    { "type": "builtin", "name": "read", "builtin": "filesystem", "description": "Read files", "config": { "allowedPaths": ["/home/user"] } },
    { "type": "mcp", "name": "browser", "command": "npx", "args": ["-y", "@anthropic-ai/mcp-server-puppeteer"], "description": "Browser automation" },
    { "type": "cli", "name": "docker", "command": "docker", "description": "Docker management" }
  ]
}
```

## Important notes

- Always check if the server is running before making changes
- After editing `kon.config.json` directly, restart the server: `kond restart` or stop + start
- The `kond mcp add` and `kond wrap` commands modify the config and restart automatically
- Never expose the `auth.encryptionKey` — it secures all client-server communication
- Tool paths in `allowedPaths` should be absolute paths
