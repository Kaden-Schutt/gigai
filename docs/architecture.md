# Architecture

## Packages

```
kon/
├── packages/
│   ├── shared/          @gigai/shared — types, crypto, config schemas
│   ├── server/          @gigai/server — Fastify server, auth, tool registry, MCP pool
│   ├── cli/             @schuttdev/kond — server management CLI
│   └── kon/             @schuttdev/kon — lightweight client CLI
├── skills/              Claude Code plugin
├── assets/              logo, icon
├── docs/                setup guides, configuration reference
├── docker/              Dockerfile + docker-compose
└── kon.config.example.json
```

Monorepo with npm workspaces and turborepo. ESM-only, Node 20+.

## How it works

```
kon (Claude's sandbox)  ──HTTPS──>  kond (your machine)
                                         │
                                         ├── read / write / edit (scoped filesystem)
                                         ├── bash (allowlisted commands)
                                         ├── glob / grep (file search)
                                         ├── MCP servers (proxied over REST)
                                         ├── CLI tools
                                         └── scripts
```

| Package | Where it runs | What it does |
|---------|---------------|--------------|
| [`@schuttdev/kon`](https://www.npmjs.com/package/@schuttdev/kon) | Claude's sandbox | Thin client, 5 dependencies total |
| [`@schuttdev/kond`](https://www.npmjs.com/package/@schuttdev/kond) | Your machine | Server, tool management, HTTPS setup |

## Auth flow

1. Server generates a pairing code (8-char alphanumeric, 5 min TTL)
2. Client sends code + org UUID to `/auth/pair` — gets an AES-256-GCM encrypted token
3. Client sends encrypted token + org UUID to `/auth/connect` — gets a session token (4 hr TTL)
4. All subsequent requests use `Authorization: Bearer <session_token>`
5. Sessions auto-renew transparently using the stored encrypted token

The encrypted token is persistent — you pair once and it works indefinitely.

## Server internals

- **Fastify** with plugin architecture (auth, registry, executor, MCP pool, cron)
- **Tool registry** loads from `kon.config.json`, provides lookup/list/detail
- **Executor** uses `child_process.spawn` with `shell: false` — no shell injection possible
- **MCP pool** manages MCP server processes (lazy start, health checks, auto-restart)
- **Cron scheduler** runs a 30-second check loop, persists jobs to `kon.crons.json`

## Multi-server routing

Users can pair multiple machines (e.g. a Mac and a Linux server). Each server reports its platform via the health endpoint. The skill file teaches Claude to route platform-specific tasks to the correct server:

- iMessage, Shortcuts, AppleScript → macOS server
- systemd, apt → Linux server

## Docker

```bash
cd docker
docker compose up -d
```

Mount your config at `/data/kon.config.json`. See [Docker setup guide](setup-docker.md) for Tailscale integration options.
