# Tool Configuration

Tools are defined in `kon.config.json`. The setup wizard and `kond wrap` commands manage this for you, but you can also edit the config directly.

## Built-in tools

```json
[
  {
    "type": "builtin", "name": "read", "builtin": "read",
    "description": "Read file contents",
    "config": { "allowedPaths": ["/home/user/projects"] }
  },
  {
    "type": "builtin", "name": "bash", "builtin": "bash",
    "description": "Execute shell commands",
    "config": {
      "allowlist": ["ls", "cat", "git", "npm", "node"],
      "allowSudo": false
    }
  }
]
```

Available builtins:

| Builtin | Description | Example |
|---------|-------------|---------|
| `read` | Read file contents (with optional offset/limit) | `kon read ~/notes.txt 0 50` |
| `write` | Write content to a file (creates parent dirs) | `kon write ~/out.txt "hello"` |
| `edit` | Replace text in a file (unique match required) | `kon edit ~/f.txt "old" "new"` |
| `glob` | Find files by glob pattern | `kon glob "**/*.ts" ~/project` |
| `grep` | Search file contents (uses ripgrep if available) | `kon grep "TODO" ~/project --glob "*.ts"` |
| `bash` | Execute shell commands from an allowlist | `kon bash git status` |

## CLI tool

```json
{
  "type": "cli",
  "name": "agent-browser",
  "command": "npx",
  "args": ["agent-browser"],
  "description": "Headless browser automation for AI agents",
  "timeout": 60000
}
```

## MCP server

```json
{
  "type": "mcp",
  "name": "obsidian",
  "command": "npx",
  "args": ["@mauricio.wolff/mcp-obsidian@latest", "~/Documents/MyVault"],
  "description": "Search and read Obsidian notes"
}
```

MCP servers can also include environment variables:

```json
{
  "type": "mcp",
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "description": "GitHub API access",
  "env": {
    "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx"
  }
}
```

## Script

```json
{
  "type": "script",
  "name": "deploy",
  "command": "./scripts/deploy.sh",
  "description": "Deploy to production"
}
```

## Adding tools

**Via CLI (recommended):**

```bash
kond mcp add obsidian -- npx @mauricio.wolff/mcp-obsidian@latest ~/Documents/MyVault
kond wrap cli       # interactive
kond wrap mcp       # interactive
kond wrap script    # interactive
kond wrap import    # import from claude_desktop_config.json
kond unwrap <name>  # remove a tool
```

**Via config:** Edit `kon.config.json` directly, then restart the server.
