# @schuttdev/kon

Lightweight client CLI for [Kon](https://github.com/Kaden-Schutt/kon) — gives Claude access to tools on your machine from any platform.

Runs inside Claude's code execution sandbox and proxies commands over HTTPS to a [kond](https://www.npmjs.com/package/@schuttdev/kond) server on your machine.

## Install

```bash
npm install -g @schuttdev/kon
```

## Usage

```bash
kon connect                  # establish session with kond server
kon list                     # list available tools
kon help <tool-name>         # show tool usage
kon <tool-name> [args...]    # execute a tool
kon status                   # connection info
kon connect <server-name>    # switch between servers
```

Any unrecognized subcommand is treated as a tool name:

```bash
kon read ~/notes.txt
kon bash git status
kon grep "TODO" ~/project
kon obsidian search-notes "meeting"
```

## Setup

This package is installed automatically when you pair with a kond server. See the [full documentation](https://github.com/Kaden-Schutt/kon) for setup instructions.

## License

MIT
