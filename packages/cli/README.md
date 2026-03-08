# @schuttdev/gigai

Server CLI for [Kon](https://github.com/Kaden-Schutt/kon) — runs on your machine and exposes tools to Claude over HTTPS.

Manages tool registration, MCP server wrapping, authentication, cron scheduling, and HTTPS setup via Tailscale Funnel or Cloudflare Tunnel.

## Install

```bash
npm install -g @schuttdev/gigai
```

## Quickstart

```bash
gigai init       # interactive setup wizard
gigai pair       # generate a pairing code for Claude
```

## Commands

```bash
gigai start                  # start the server
gigai stop                   # stop the server
gigai status                 # check if running
gigai pair                   # generate a new pairing code
gigai install                # install as background service (launchd / systemd)
gigai uninstall              # remove background service
gigai mcp add <n> -- <cmd>   # add an MCP server
gigai wrap cli|mcp|script    # add a tool interactively
gigai unwrap <name>          # remove a tool
gigai cron add ...           # schedule a task
```

## Documentation

See the [full documentation](https://github.com/Kaden-Schutt/kon) for setup guides, tool configuration, and architecture details.

## License

MIT
