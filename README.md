<p align="center">
  <img src="assets/kon-logo.png" alt="Kon" width="200" />
</p>

<h1 align="center">Kon</h1>

<p align="center">
  Claude on your phone can now reach your computer.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@schuttdev/kon"><img src="https://img.shields.io/npm/v/@schuttdev/kon?label=kon&color=orange" alt="kon npm" /></a>
  <a href="https://www.npmjs.com/package/@schuttdev/gigai"><img src="https://img.shields.io/npm/v/@schuttdev/gigai?label=gigai&color=brown" alt="gigai npm" /></a>
</p>

---

Kon is a lightweight client that runs inside Claude's code execution sandbox. It connects over HTTPS to **gigai**, a server running on your machine that exposes tools — shell commands, filesystem access, MCP servers, scripts — through an authenticated API.

<p align="center">
  <img src="assets/kon-demo.png" alt="Kon pairing demo" width="720" />
</p>

Install the server, paste one command into Claude, and anything you've allowed is now accessible from Claude on iOS, the web, or anywhere else you use claude.ai.

## Quickstart with Claude Code

If you have [Claude Code](https://docs.anthropic.com/en/docs/claude-code), it can handle the entire setup for you:

```
/plugin install https://github.com/Kaden-Schutt/kon
/kon:gigai-setup
```

Claude Code will walk you through everything below (and help you manage your server after). With [Claude Code remote control](https://docs.anthropic.com/en/docs/claude-code/remote-control), you can also add tools, change configs, and troubleshoot from your phone.

## What you can do with it

**Give Claude a browser.** Wrap [agent-browser](https://github.com/vercel-labs/agent-browser) as a CLI tool and Claude can navigate the web from your machine:

```bash
gigai wrap cli
# name: agent-browser
# command: npx agent-browser
```

**Connect your Obsidian vault.** Wrap an Obsidian MCP server and Claude can search and read your notes from anywhere:

```bash
gigai mcp add obsidian -- npx @mauricio.wolff/mcp-obsidian@latest ~/Documents/MyVault
```

**Wrap any CLI tool** — docker, kubectl, ffmpeg, whatever. It's now accessible from Claude on your phone.

**Wrap any MCP server** — gigai proxies tool calls over REST. Your existing MCP servers now work from anywhere, not just Claude Desktop.

**Import from Claude Desktop** — the setup wizard auto-detects your `claude_desktop_config.json` and offers to import everything.

**Schedule tasks** — `gigai cron add --at "9:00 AM tomorrow" bash git pull`

## Secure by default

You decide exactly what Claude can touch. Nothing is open unless you open it.

- **Shell**: locked to an allowlist you define. Everything else is blocked.
- **Filesystem**: scoped to directories you specify. No wandering.
- **HTTPS only**: all traffic encrypted via Tailscale Funnel or Cloudflare Tunnel.
- **AES-256-GCM tokens**: tied to your Anthropic org UUID.
- **No shell injection**: all execution uses `spawn()` with `shell: false`.

## Quickstart

**Prerequisites:** 
[Tailscale](https://tailscale.com/) with Funnel enabled. 
> Guides: [macOS](docs/setup-macos.md) | [Linux](docs/setup-linux.md) | [WSL](docs/setup-wsl.md) | [Docker](docs/setup-docker.md)

Claude capabilities configured for code execution — go to **Settings > Capabilities** on claude.ai:

<p align="left">
  <img src="assets/claude-capabilities.png" alt="Claude capabilities settings" width="800" />
</p>

### 1. Install and run the setup wizard

```bash
npm install -g @schuttdev/gigai
gigai init
```

### 2. Paste into Claude

The wizard generates a prompt for your server — paste it into Claude. It will look something like:

> Install kon and pair with my server:
> ```bash
> npm install -g @schuttdev/kon
> kon pair ABC123XY https://your-machine.tail1234.ts.net:7443
> ```
> Then show me the skill file output so I can save it.

**Don't paste the example above** — use the actual prompt from your wizard, which contains your real pairing code and server URL.

### 3. Use it

> "List my home directory"
> "Run the tests in my project"
> "Search for TODO comments in ~/projects/myapp"

## Commands

```bash
# Server management
gigai start                  # start the server
gigai stop                   # stop the server
gigai status                 # check if running
gigai pair                   # generate a new pairing code
gigai install                # install as background service (macOS launchd / Linux systemd)
gigai mcp add <n> -- <cmd>   # add an MCP server
gigai wrap cli|mcp|script    # add a tool interactively
gigai unwrap <name>          # remove a tool
gigai cron add ...           # schedule a task

# Client (runs in Claude's sandbox)
kon <tool-name> [args...]    # execute any tool
kon list                     # list available tools
kon status                   # connection info
kon connect <server-name>    # switch between servers
```

## Different approaches

**Claude Code** gives you full tool access from a terminal with a Pro/Max subscription. Kon takes a different approach — it works with regular claude.ai, the chat interface anyone already uses. No subscription beyond the base plan, no terminal, no developer background needed. They complement each other well: Claude Code users can use the [Kon plugin](#quickstart-with-claude-code) to manage their server.

**Other remote tool projects** tend toward giving Claude broad access by default. Kon goes the other way: nothing is accessible unless you explicitly opt in. Different philosophies for different use cases.

## More

- [Tool configuration reference](docs/configuration.md)
- [Architecture and internals](docs/architecture.md)
- [Tailscale setup guides](docs/setup-macos.md)

## License

MIT
