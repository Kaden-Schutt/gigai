# Kon Setup: macOS

## 1. Install Tailscale

**Option A: Homebrew (recommended for CLI usage)**

```bash
brew install tailscale
```

Start the daemon:

```bash
sudo tailscaled install-system-daemon
```

**Option B: App Store**

Download [Tailscale from the Mac App Store](https://apps.apple.com/app/tailscale/id1475387142). The app runs in the menu bar and manages the daemon automatically.

> Both options work. The Homebrew version gives you CLI-only control. The App Store version adds a menu bar UI. Pick whichever you prefer — the `tailscale` CLI commands are the same either way.

## 2. Authenticate

```bash
tailscale up
```

This opens a browser to log in to your Tailscale account. If you don't have one, create a free account at [tailscale.com](https://tailscale.com/).

Verify you're connected:

```bash
tailscale status
```

You should see your machine listed with a `100.x.x.x` IP address.

## 3. Enable Funnel

Funnel lets your machine accept connections from the public internet over HTTPS. This is how Claude's sandbox reaches your server.

**Enable Funnel in the admin console first:**

1. Go to [Tailscale Admin Console](https://login.tailscale.com/admin/dns)
2. Under **DNS**, scroll to **HTTPS Certificates** and enable it
3. Go to [Access Controls](https://login.tailscale.com/admin/acls/file) and add a Funnel policy. Add this to your ACL file (or merge with existing):

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

**Test Funnel from the CLI:**

```bash
tailscale funnel 7443
```

This serves port 7443 over HTTPS at `https://<your-machine>.<tailnet>.ts.net/`. Press Ctrl+C to stop the test.

> Funnel assigns your machine a stable HTTPS URL like `https://macbook-pro.tail1234.ts.net`. This URL is what Claude uses to reach your server.

## 4. Install kond

```bash
npm install -g @schuttdev/kond
```

Requires Node.js 20+. If you need Node:

```bash
brew install node@20
```

## 5. Run the setup wizard

```bash
kond init
```

The wizard will:
- Detect Tailscale and offer to configure Funnel
- Ask which tools to enable (filesystem, shell, etc.)
- Ask you to scope permissions (allowed paths, allowed commands)
- Start the server
- Generate a pairing prompt to paste into Claude

## 6. Run as a background service

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

If using Homebrew, make sure the daemon is running: `sudo tailscaled install-system-daemon`. If using the App Store app, make sure it's open in the menu bar.

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
