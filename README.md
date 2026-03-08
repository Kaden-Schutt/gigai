# gigai

Claude on your phone can now reach your computer.

gigai is a server that runs on your machine and exposes tools — shell commands, filesystem access, MCP servers, scripts — over an authenticated HTTPS connection. kon is the client that runs inside Claude's code execution sandbox and talks to your server. Install the server, paste one command into Claude, and anything you've allowed is now accessible from Claude on iOS, the web, or anywhere else you use claude.ai.

No Claude Code subscription. No terminal running on your machine. No developer setup. Just Claude, talking to your computer, doing what you told it it could do.

## Secure by default

The whole point of gigai is that you decide exactly what Claude can touch. Nothing is open unless you open it.

Shell access is locked to an allowlist. You pick which commands are available — `ls`, `git`, `npm`, whatever you need — and everything else is blocked. There's no wildcard. There's no "allow all" in the default config. If you want to make it wide open, you'd have to go out of your way to do that, and the setup wizard doesn't encourage it.

Filesystem access is scoped to directories you specify. Claude can read files in `~/projects` if you say so. It can't wander into `~/`.

All traffic runs over HTTPS via Tailscale Funnel or Cloudflare Tunnel. Auth tokens are AES-256-GCM encrypted and tied to the org UUID from your Anthropic account — meaning someone would need both your token *and* your Anthropic account identity to establish a connection. Pairing codes expire in 5 minutes. Sessions expire in 4 hours. All command execution uses `spawn()` with `shell: false`, so there's no shell injection surface.

This was a deliberate design choice. Other tools in this space give you everything by default and hope you lock it down. gigai gives you nothing by default and makes you opt in.

## What you can do with it

**Wrap any CLI tool.** Run `gigai wrap cli` and point it at any command — docker, kubectl, ffmpeg, whatever. That command is now accessible from Claude on your phone. One interactive prompt, done.

**Wrap any MCP server.** Run `gigai wrap mcp` and give it an npx command or binary path. gigai spawns the MCP process and proxies tool calls over REST. If you've built or installed MCP servers, they now work from anywhere, not just Claude Desktop on your laptop.

**Import your Claude Desktop config.** If you've already set up MCP servers for Claude Desktop, run `gigai wrap import` and point it at your config file. Everything carries over. Your existing MCP setup is now available from Claude on your phone.

**Wrap scripts.** Any executable — bash, python, whatever — can become a tool with `gigai wrap script`.

**Browse files.** The built-in filesystem tool gives Claude scoped read access to directories you choose. Useful on its own, more useful combined with other tools.

## How it works

```
Claude (code execution sandbox)  ──HTTPS──>  gigai server (your machine)
                                                  │
                                                  ├── shell (allowlisted commands)
                                                  ├── filesystem (scoped directories)
                                                  ├── MCP servers (proxied over REST)
                                                  ├── CLI tools
                                                  └── scripts
```

Two npm packages:

| Package | Where it runs | What it does |
|---------|---------------|--------------|
| [`@schuttdev/gigai`](https://www.npmjs.com/package/@schuttdev/gigai) | Your machine | Server, tool management, HTTPS setup |
| [`@schuttdev/kon`](https://www.npmjs.com/package/@schuttdev/kon) | Claude's sandbox | Thin client, 5 dependencies total |

## Quickstart

### 1. Install the server on your machine

```bash
npm install -g @schuttdev/gigai
```

### 2. Run the setup wizard

```bash
gigai init
```

This walks you through HTTPS setup (Tailscale Funnel recommended), port config, selecting built-in tools, scoping permissions, and starting the server. At the end, it gives you a code block to paste into Claude.

### 3. Paste into Claude

The generated instructions tell Claude to install the client and pair with your server:

```bash
npm install -g @schuttdev/kon
kon pair <code> <server-url>
```

This creates a skill file. Download it and upload to Claude as a skill (Settings > Customize > Upload Skill).

**Note:** Claude's code execution sandbox needs network access to reach your server. In your Claude project settings, either enable access to all domains or add your specific server domain (e.g., your `*.ts.net` Tailscale domain).

### 4. Use it

In any new conversation, the skill handles setup automatically. Then just ask Claude to do things:

> "List my home directory"
> "Run the tests in my project"
> "Search for TODO comments in ~/projects/myapp"

Claude runs `kon shell ...`, `kon fs ...`, etc. behind the scenes.

## How this compares

**Claude Code Remote Control** requires Claude Code running in a terminal on your machine. You need a Pro or Max subscription and you need to be comfortable in a terminal. It gives you a remote window into a Claude Code session. gigai works with regular claude.ai — the chat interface anyone already uses. No Claude Code, no terminal left running, no developer background needed.

**OpenClaw** is a full autonomous agent that connects to everything and runs continuously. gigai takes the opposite approach: narrow scope, explicit permissions, nothing accessible by default. The security model is the product.

## Server management

```bash
gigai start                  # start the server
gigai start --dev            # start without HTTPS (local only)
gigai stop                   # stop the server
gigai status                 # check if running
gigai pair                   # generate a new pairing code
gigai install                # install as a background service (macOS launchd)
gigai uninstall              # remove background service
```

## kon commands

```bash
kon connect                  # establish session with server
kon connect <server-name>    # switch servers
kon list                     # list available tools
kon help <tool-name>         # show tool usage
kon <tool-name> [args...]    # execute a tool
kon status                   # connection info
kon upload <file>            # upload a file to the server
kon download <id> <dest>     # download a file from the server
```

Any unrecognized subcommand is treated as a tool name:

```bash
kon shell ls -la
kon fs read ~/notes.txt
kon browser navigate https://example.com
```

## Tool configuration

Tools are defined in `gigai.config.json`. The setup wizard and `gigai wrap` commands manage this file for you, but here's what each type looks like:

### Built-in: filesystem

```json
{
  "type": "builtin",
  "name": "fs",
  "builtin": "filesystem",
  "config": { "allowedPaths": ["/home/user/projects"] }
}
```

### Built-in: shell

```json
{
  "type": "builtin",
  "name": "shell",
  "builtin": "shell",
  "config": {
    "allowlist": ["ls", "cat", "grep", "git", "npm", "node"],
    "allowSudo": false
  }
}
```

### CLI tool

```json
{
  "type": "cli",
  "name": "docker",
  "command": "docker",
  "description": "Docker container management",
  "timeout": 60000
}
```

### MCP server

```json
{
  "type": "mcp",
  "name": "browser",
  "command": "npx",
  "args": ["-y", "@anthropic-ai/mcp-server-puppeteer"],
  "description": "Browser automation"
}
```

### Script

```json
{
  "type": "script",
  "name": "deploy",
  "command": "./scripts/deploy.sh",
  "description": "Deploy to production"
}
```

## Removing tools

```bash
gigai unwrap <tool-name>
```

## Config

Server config: `gigai.config.json` in the working directory. See [`gigai.config.example.json`](./gigai.config.example.json) for the full schema.

Client config: `~/.gigai/config.json`, managed automatically by `kon pair` and `kon connect`.

## Architecture

```
gigai/
├── packages/
│   ├── shared/          @gigai/shared — protocol types, crypto, config schemas
│   ├── server/          @gigai/server — Fastify server, auth, tool registry, MCP pool
│   ├── cli/             @schuttdev/gigai — server CLI
│   └── kon/             @schuttdev/kon — client CLI
├── docker/              Dockerfile + docker-compose
└── gigai.config.example.json
```

Monorepo with npm workspaces and turborepo. ESM-only, Node 20+.

## Docker

```bash
cd docker
docker compose up -d
```

Mount your config at `/data/gigai.config.json`.

## Requirements

- Node.js 20+
- For HTTPS: [Tailscale](https://tailscale.com/) (recommended) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- `gigai install` uses macOS launchd — other platforms need to manage the background process manually

## License

MIT
