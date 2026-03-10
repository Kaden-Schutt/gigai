# Kon Setup: Linux

Works on Ubuntu, Debian, Fedora, Arch, and most other distributions.

## 1. Install Tailscale

**One-line install (recommended):**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

This detects your distro and installs the appropriate package. It also enables and starts the `tailscaled` systemd service.

**Manual install by distro:**

<details>
<summary>Ubuntu / Debian</summary>

```bash
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/jammy.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
sudo apt update
sudo apt install tailscale
```
</details>

<details>
<summary>Fedora / RHEL</summary>

```bash
sudo dnf config-manager --add-repo https://pkgs.tailscale.com/stable/fedora/tailscale.repo
sudo dnf install tailscale
sudo systemctl enable --now tailscaled
```
</details>

<details>
<summary>Arch</summary>

```bash
sudo pacman -S tailscale
sudo systemctl enable --now tailscaled
```
</details>

## 2. Start and authenticate

```bash
sudo tailscale up
```

This prints a URL — open it in a browser to authenticate. If you don't have a Tailscale account, create a free one at [tailscale.com](https://tailscale.com/).

Verify:

```bash
tailscale status
```

You should see your machine with a `100.x.x.x` address.

## 3. Enable Funnel

Funnel lets your machine accept HTTPS connections from the public internet. This is how Claude's sandbox reaches your server.

**Enable in the admin console first:**

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

**Test from the CLI:**

```bash
sudo tailscale funnel 7443
```

> On Linux, Funnel commands typically need `sudo` because `tailscaled` runs as root.

This serves port 7443 over HTTPS at `https://<your-machine>.<tailnet>.ts.net/`. Ctrl+C to stop.

## 4. Install Node.js

Kon requires Node.js 20+.

**Using NodeSource (recommended):**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**Using nvm:**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
```

Verify: `node --version` should show v20 or higher.

## 5. Install kond

```bash
npm install -g @schuttdev/kond
```

If you get permission errors:

```bash
sudo npm install -g @schuttdev/kond
```

Or better, configure npm to use a user-local prefix:

```bash
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g @schuttdev/kond
```

## 6. Run the setup wizard

```bash
kond init
```

The wizard detects Tailscale and walks you through Funnel configuration, tool selection, permission scoping, and server startup. At the end it generates a prompt to paste into Claude.

## 7. Run as a systemd service

To keep kond running across reboots:

```bash
kond install
```

This creates a systemd user service. To remove it:

```bash
kond uninstall
```

You can also manage the service directly:

```bash
systemctl --user status kond
systemctl --user restart kond
journalctl --user -u kond -f    # view logs
```

## Firewall notes

If you're running a firewall (ufw, firewalld, iptables), Tailscale Funnel handles its own connectivity — you don't need to open port 7443 on your firewall. Funnel traffic arrives through the Tailscale tunnel, not directly from the internet.

However, if you're also accessing kond from other devices on your tailnet (not through Funnel), you may need to allow port 7443 on the Tailscale interface:

```bash
# ufw
sudo ufw allow in on tailscale0 to any port 7443

# firewalld
sudo firewall-cmd --zone=trusted --add-interface=tailscale0 --permanent
sudo firewall-cmd --reload
```

## Troubleshooting

**`tailscale up` says "failed to connect to local tailscaled"**

The daemon isn't running. Start it:

```bash
sudo systemctl start tailscaled
sudo systemctl enable tailscaled
```

**`tailscale funnel` says Funnel is not enabled**

You need to enable HTTPS certificates and add the Funnel node attribute in the Tailscale admin console. See step 3.

**`npm install -g` fails with EACCES**

Don't use `sudo npm`. Configure a user-local prefix instead — see step 5.

**kond can't bind to port 7443**

On Linux, ports below 1024 require root. Port 7443 should be fine, but if something else is using it:

```bash
sudo lsof -i :7443
```

Change the port in `kon.config.json` if needed.
