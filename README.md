# gigai

Give Claude access to your local tools — MCP servers, CLI commands, scripts — from any platform. Claude on iOS, web, or any code execution environment can reach tools running on your machine over HTTPS.

## How it works

```
Claude (code exec)  ──HTTPS──>  gigai server (your machine)
     kon pair                        │
     kon shell date                  ├── shell tools
     kon fs list ~/                  ├── filesystem
     kon browser navigate ...        └── MCP servers
```

**gigai** is the server. It runs on your machine and exposes your tools over an authenticated HTTPS API.

**kon** is the client. It runs inside Claude's code execution sandbox and forwards commands to your server.

Two npm packages:

| Package | Install | Purpose |
|---------|---------|---------|
| [`@schuttdev/gigai`](https://www.npmjs.com/package/@schuttdev/gigai) | Your machine | Server, tool management, HTTPS setup |
| [`@schuttdev/kon`](https://www.npmjs.com/package/@schuttdev/kon) | Claude's sandbox | Lightweight client (5 packages total) |

## Quickstart

### 1. Install the server

```bash
npm install -g @schuttdev/gigai
```

### 2. Run the setup wizard

```bash
gigai init
```

This walks you through:
- HTTPS setup (Tailscale Funnel recommended, or Cloudflare Tunnel)
- Port configuration
- Selecting built-in tools (filesystem, shell)
- Scoping permissions (allowed paths, allowed commands)
- Starting the server
- Generating a pairing code

At the end, you get a code block to paste into Claude.

### 3. Pair from Claude

Paste the generated instructions into Claude. It will run:

```bash
npm install -g @schuttdev/kon
kon pair <code> <server-url>
```

This creates a skill zip file. Download it and upload to Claude as a skill (Settings > Customize > Upload Skill).

### 4. Use tools

In any new Claude conversation, the skill auto-runs setup, then you can ask Claude to use your tools:

> "List my home directory"
> "Run the tests in my project"
> "Search for TODO comments in ~/projects/myapp"

Claude executes `kon shell ...`, `kon fs ...`, etc. behind the scenes.

## Server management

```bash
gigai start                           # start the server
gigai start --dev                     # start without HTTPS (local only)
gigai stop                            # stop the server
gigai status                          # check if server is running
gigai pair                            # generate a new pairing code
gigai install                         # install as a background service (macOS launchd)
gigai uninstall                       # remove background service
```

## Adding tools

### Wrap a CLI command

```bash
gigai wrap cli
```

Prompts for a name, command, and description. Example: wrapping `docker` so Claude can manage containers.

### Wrap an MCP server

```bash
gigai wrap mcp
```

Prompts for a name, npx command (or binary path), and environment variables. The server spawns the MCP process and proxies tool calls over REST.

### Wrap a script

```bash
gigai wrap script
```

Wraps any executable script as a tool.

### Import from Claude Desktop

```bash
gigai wrap import ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Imports MCP servers you've already configured for Claude Desktop.

### Remove a tool

```bash
gigai unwrap <tool-name>
```

## kon client commands

```bash
kon connect                           # establish session with server
kon connect <server-name>             # switch to a different server
kon list                              # list available tools
kon help <tool-name>                  # show tool usage
kon <tool-name> [args...]             # execute a tool
kon status                            # show connection info
kon upload <file>                     # upload a file to the server
kon download <id> <dest>              # download a file from the server
```

Any unrecognized subcommand is treated as a tool name:

```bash
kon shell ls -la                      # run shell command
kon fs read ~/notes.txt               # read a file
kon browser navigate https://example  # use an MCP tool
```

## Tool types

### Built-in: filesystem

Scoped file access. Read, list, and search within allowed directories.

```json
{
  "type": "builtin",
  "name": "fs",
  "builtin": "filesystem",
  "config": { "allowedPaths": ["/home/user/projects"] }
}
```

### Built-in: shell

Execute commands from an allowlist. Sudo is opt-in.

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

Any command-line program.

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

Spawns an MCP server process and proxies `tools/list` and `tools/call` over REST.

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

Any executable file.

```json
{
  "type": "script",
  "name": "deploy",
  "command": "./scripts/deploy.sh",
  "description": "Deploy to production"
}
```

## Security

- All traffic is encrypted over HTTPS (Tailscale Funnel or Cloudflare Tunnel)
- Auth uses AES-256-GCM encrypted tokens tied to the org UUID from Claude's environment
- Pairing codes expire in 5 minutes
- Sessions expire in 4 hours
- Shell commands are restricted to an explicit allowlist
- Filesystem access is scoped to configured directories
- All command execution uses `spawn()` with `shell: false` — no shell injection
- Tools are never exposed without authentication

## Config

Server config lives in `gigai.config.json` in the working directory. See [`gigai.config.example.json`](./gigai.config.example.json) for the full schema.

Client config lives in `~/.gigai/config.json` and is managed automatically by `kon pair` and `kon connect`.

## Architecture

```
gigai/
├── packages/
│   ├── shared/          @gigai/shared — protocol types, crypto, config schemas
│   ├── server/          @gigai/server — Fastify server, auth, tool registry, MCP pool
│   ├── cli/             @schuttdev/gigai — server CLI (gigai binary)
│   └── kon/             @schuttdev/kon — client CLI (kon binary)
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

## License

MIT
