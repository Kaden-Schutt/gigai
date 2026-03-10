# @schuttdev/kond

Server CLI for [Kon](https://github.com/Kaden-Schutt/kon) — runs on your machine and exposes tools to Claude over HTTPS.

Manages tool registration, MCP server wrapping, authentication, cron scheduling, and HTTPS setup via Tailscale Funnel or Cloudflare Tunnel.

## Install

```bash
npm install -g @schuttdev/kond
```

## Quickstart

```bash
kond init       # interactive setup wizard
kond pair       # generate a pairing code for Claude
```

## Commands

```bash
kond start                  # start the server
kond stop                   # stop the server
kond status                 # check if running
kond pair                   # generate a new pairing code
kond install                # install as background service (launchd / systemd)
kond uninstall              # remove background service
kond mcp add <n> -- <cmd>   # add an MCP server
kond wrap cli|mcp|script    # add a tool interactively
kond unwrap <name>          # remove a tool
kond cron add ...           # schedule a task
```

## Documentation

See the [full documentation](https://github.com/Kaden-Schutt/kon) for setup guides, tool configuration, and architecture details.

## License

MIT
