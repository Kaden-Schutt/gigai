# gigai Skill

This skill gives you access to tools running on the user's machine via the gigai CLI.

## Quick Start

1. Connect to the server:
   ```
   gigai connect
   ```

2. List available tools:
   ```
   gigai list
   ```

3. Get help on a specific tool:
   ```
   gigai help <tool-name>
   ```

4. Use a tool directly:
   ```
   gigai <tool-name> [args...]
   ```

## Commands

### Connection
- `gigai connect` — Establish/renew a session with the server
- `gigai status` — Check connection status
- `gigai pair <code> <server-url>` — Pair with a new server

### Tool Usage
- `gigai list` — List all available tools
- `gigai help <name>` — Show detailed help for a tool
- `gigai <name> [args...]` — Execute a tool by name

### File Transfer
- `gigai upload <file>` — Upload a file to the server
- `gigai download <id> <dest>` — Download a file from the server

## Notes

- The connection is authenticated and encrypted end-to-end
- Tools are scoped to what the user has explicitly configured
- Sessions auto-renew; if you get auth errors, run `gigai connect`
- All tool execution happens on the user's machine, not in this container
