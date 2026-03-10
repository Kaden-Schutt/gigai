# Kon Setup: macOS

## 1. Install kond

Requires Node.js 20+ and [Homebrew](https://brew.sh/).

```bash
npm install -g @schuttdev/kond
```

If you need Node:

```bash
brew install node@20
```

## 2. Run the setup wizard

```bash
kond init
```

The wizard handles everything automatically:

- **No Tailscale?** Installs it via Homebrew (`brew install tailscale`), starts the daemon, and optionally installs the menu bar app
- **App Store Tailscale?** Guides you through switching to the standalone version (required for Funnel)
- **Tailscale already installed?** Detects it and skips straight to auth
- Authenticates with Tailscale and enables Funnel
- Asks which tools to enable (filesystem, shell, etc.)
- Scopes permissions (allowed paths, allowed commands)
- Auto-imports MCP servers from Claude Desktop if found
- Starts the server and generates a pairing prompt

## 3. Enable Funnel in the admin console

Before the wizard can activate Funnel, you need to enable it in Tailscale's admin console:

1. Go to [Tailscale Admin Console](https://login.tailscale.com/admin/dns)
2. Under **DNS**, scroll to **HTTPS Certificates** and enable it
3. Go to [Access Controls](https://login.tailscale.com/admin/acls/file) and add a Funnel policy:

```json
{
  "nodeAttrs": [
    {
      "target": ["autogroup:member"],
      "attr": ["funnel"]
    }
  ]
}
```

This allows all your devices to use Funnel. You can restrict it to specific devices if you prefer.

> Funnel assigns your machine a stable HTTPS URL like `https://macbook-pro.tail1234.ts.net`. This URL is what Claude uses to reach your server.

## 4. Run as a background service

To keep kond running after you close the terminal:

```bash
kond install
```

This creates a macOS launchd service that starts kond on login. To remove it:

```bash
kond uninstall
```

To manage manually:

```bash
kond start                   # start in foreground
kond stop                    # stop the server
kond status                  # check if running
```

## Troubleshooting

**`tailscale funnel` says Funnel is not enabled**

You need to enable HTTPS certificates and add the Funnel node attribute in the Tailscale admin console. See step 3.

**`tailscale up` hangs or fails**

Make sure the daemon is running: `brew services start tailscale`.

**Port 7443 already in use**

Another process is using the port. Either stop it or configure kond to use a different port in `kon.config.json`:

```json
{
  "server": { "port": 8443 }
}
```

Then update your Funnel to match: `tailscale funnel 8443`.

**Node.js version too old**

Kon requires Node 20+. Check with `node --version`. If you're on an older version:

```bash
brew install node@20
brew link --overwrite node@20
```
