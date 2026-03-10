# Kon Setup: WSL (Windows Subsystem for Linux)

There are two ways to run Kon with Tailscale on WSL. Pick the one that fits your setup.

## Option A: Tailscale inside WSL2 (recommended)

Run everything — Tailscale, kond, Node — entirely inside your WSL2 distro. This is the cleanest approach and doesn't require Tailscale on the Windows host.

> Requires WSL2 (not WSL1). Check with `wsl --list --verbose`.

### 1. Install Tailscale in WSL

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

Start the daemon (WSL2 doesn't use systemd by default on older versions):

```bash
# If your WSL distro has systemd (Ubuntu 22.04+ with systemd enabled):
sudo systemctl start tailscaled
sudo systemctl enable tailscaled

# If systemd is not available, start manually:
sudo tailscaled --state=/var/lib/tailscale/tailscaled.state &
```

> To enable systemd in WSL2, add this to `/etc/wsl.conf`:
> ```ini
> [boot]
> systemd=true
> ```
> Then restart WSL: `wsl --shutdown` from PowerShell, then reopen your distro.

### 2. Authenticate

```bash
sudo tailscale up
```

Open the printed URL in a browser to log in.

### 3. Enable Funnel

Follow the same admin console steps as Linux:

1. [Tailscale Admin Console](https://login.tailscale.com/admin/dns) > DNS > enable HTTPS Certificates
2. [Access Controls](https://login.tailscale.com/admin/acls/file) > add Funnel policy:

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

Test it:

```bash
sudo tailscale funnel 7443
```

### 4. Install Node.js and kond

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
npm install -g @schuttdev/kond
```

### 5. Run the setup wizard

```bash
kond init
```

### 6. Keep kond running

WSL2 distros shut down when you close the terminal unless you configure them to persist.

**Option 1: Keep a terminal open**

```bash
kond start
```

**Option 2: Background with nohup**

```bash
nohup kond start > ~/kond.log 2>&1 &
```

**Option 3: systemd service (if systemd is enabled)**

```bash
kond install
```

**Option 4: Prevent WSL from shutting down**

In PowerShell (as admin), create or edit `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
# Keeps the VM running even after all terminals close
vmIdleTimeout=-1
```

---

## Option B: Tailscale on Windows, kond in WSL

If you already have Tailscale running on your Windows host, you can use it to provide Funnel while running kond inside WSL.

### 1. Tailscale on Windows

Install [Tailscale for Windows](https://tailscale.com/download/windows) and authenticate normally.

### 2. Expose WSL port through Windows

WSL2 runs in a VM with its own network. You need to forward the port from Windows to WSL.

Find your WSL IP:

```bash
# Inside WSL
hostname -I
```

In PowerShell (as admin), forward the port:

```powershell
netsh interface portproxy add v4tov4 listenport=7443 listenaddress=0.0.0.0 connectport=7443 connectaddress=<WSL_IP>
```

> The WSL IP can change on restart. You'll need to update this when it does, or use a script to automate it.

### 3. Configure Funnel on Windows

In PowerShell:

```powershell
tailscale funnel 7443
```

### 4. Install and run kond in WSL

Follow the Linux guide from step 4 onward — install Node, install kond, run the wizard.

### Caveat

The WSL2 IP changes on restart, which breaks the port forwarding. You'd need to re-run the `netsh` command or automate it with a startup script. **Option A is more reliable for this reason.**

---

## Troubleshooting

**`tailscaled` won't start in WSL**

Make sure you're on WSL2, not WSL1. WSL1 doesn't support the TUN device Tailscale needs.

```powershell
# From PowerShell
wsl --list --verbose
```

If your distro is version 1, convert it:

```powershell
wsl --set-version <distro-name> 2
```

**DNS resolution fails after `tailscale up`**

Tailscale modifies `/etc/resolv.conf` in WSL. If DNS breaks:

```bash
sudo tailscale up --accept-dns=false
```

**Port forwarding (Option B) stops working after WSL restart**

The WSL2 IP changed. Re-run the `netsh` command with the new IP from `hostname -I`.

**WSL shuts down when terminal closes**

See step 6 above — either use systemd, nohup, or set `vmIdleTimeout=-1` in `.wslconfig`.
