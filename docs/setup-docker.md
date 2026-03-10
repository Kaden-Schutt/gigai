# Kon Setup: Docker

Running kond in Docker with Tailscale Funnel. Three approaches, from simplest to most self-contained.

## Option A: Host Tailscale + Docker port mapping (simplest)

Run Tailscale on the host machine. Run kond in a container with a published port. Point Funnel at the port.

This is the recommended approach if Tailscale is already running on your host (which it is if you followed any of the platform setup guides).

### 1. Start the container

```bash
docker run -d \
  --name kond \
  -p 7443:7443 \
  -v /path/to/kon.config.json:/data/kon.config.json \
  ghcr.io/kaden-schutt/kon:latest
```

Or with docker compose:

```yaml
# docker-compose.yml
services:
  kond:
    image: ghcr.io/kaden-schutt/kon:latest
    ports:
      - "7443:7443"
    volumes:
      - ./kon.config.json:/data/kon.config.json
    restart: unless-stopped
```

### 2. Point Funnel at it

On the host:

```bash
tailscale funnel 7443
```

That's it. Funnel terminates HTTPS and forwards to the container's published port.

### 3. Generate a pairing code

```bash
docker exec kond node /app/dist/index.js pair
```

### When to use this

- You already have Tailscale on the host
- You want the simplest possible setup
- Works on macOS, Linux, and Windows (with Docker Desktop)

---

## Option B: Tailscale sidecar container

Run Tailscale as a separate container sharing the network namespace with the kond container. Good for headless servers or VPS where you don't want Tailscale on the host.

### 1. docker-compose.yml

```yaml
services:
  tailscale:
    image: tailscale/tailscale:latest
    hostname: kond-server
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY}           # generate at https://login.tailscale.com/admin/settings/keys
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_EXTRA_ARGS=--advertise-tags=tag:funnel
      - TS_SERVE_CONFIG=/config/serve.json
    volumes:
      - tailscale-state:/var/lib/tailscale
      - ./ts-serve.json:/config/serve.json:ro
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    devices:
      - /dev/net/tun:/dev/net/tun
    restart: unless-stopped

  kond:
    image: ghcr.io/kaden-schutt/kon:latest
    network_mode: service:tailscale
    volumes:
      - ./kon.config.json:/data/kon.config.json
    depends_on:
      - tailscale
    restart: unless-stopped

volumes:
  tailscale-state:
```

### 2. ts-serve.json

This tells Tailscale to serve port 7443 via Funnel:

```json
{
  "TCP": {
    "443": {
      "HTTPS": true
    }
  },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": {
        "/": {
          "Proxy": "http://127.0.0.1:7443"
        }
      }
    }
  },
  "AllowFunnel": {
    "${TS_CERT_DOMAIN}:443": true
  }
}
```

### 3. Generate an auth key

Go to [Tailscale Admin > Settings > Keys](https://login.tailscale.com/admin/settings/keys) and generate an **auth key**. Set it as `TS_AUTHKEY` in your environment or `.env` file.

> Use a reusable key if you plan to recreate the container. Ephemeral keys work too but the node disappears from your tailnet when the container stops.

### 4. ACL setup

In your [Tailscale ACL file](https://login.tailscale.com/admin/acls/file), make sure the `tag:funnel` tag is allowed to use Funnel:

```json
{
  "tagOwners": {
    "tag:funnel": ["autogroup:admin"]
  },
  "nodeAttrs": [
    {
      "target": ["tag:funnel"],
      "attr": ["funnel"]
    }
  ]
}
```

### 5. Start

```bash
docker compose up -d
```

The Tailscale container authenticates, establishes Funnel, and proxies HTTPS traffic to the kond container.

### 6. Generate a pairing code

```bash
docker compose exec kond node /app/dist/index.js pair
```

### When to use this

- Headless servers, VPS, cloud instances
- You don't want Tailscale on the host
- Everything contained in docker compose

---

## Option C: Host network mode

The simplest Docker approach, but gives up container network isolation.

```bash
docker run -d \
  --name kond \
  --network=host \
  -v /path/to/kon.config.json:/data/kon.config.json \
  ghcr.io/kaden-schutt/kon:latest
```

The container shares the host's network stack directly, so Tailscale Funnel on the host just works — no port mapping needed.

Then on the host:

```bash
tailscale funnel 7443
```

### When to use this

- Quick testing
- You're fine with the container having full host network access
- Only works on Linux (Docker Desktop on macOS/Windows doesn't support `--network=host` the same way)

---

## Comparison

| Approach | Complexity | Isolation | Works without host Tailscale | Platform |
|----------|-----------|-----------|------------------------------|----------|
| **A: Host Tailscale** | Low | Container isolated | No | All |
| **B: Sidecar** | Medium | Both containers isolated | Yes | All |
| **C: Host network** | Low | None | No | Linux only |

**Recommendation:** Use **Option A** if Tailscale is on your host. Use **Option B** for headless/cloud deployments.

---

## Troubleshooting

**Sidecar: Tailscale container can't create TUN device**

Make sure you have the `cap_add` and `devices` entries in your compose file. On some hosts you may also need:

```yaml
sysctls:
  - net.ipv4.ip_forward=1
  - net.ipv6.conf.all.forwarding=1
```

**Sidecar: `TS_AUTHKEY` not working**

Make sure the key hasn't expired. Auth keys have a configurable TTL. Generate a new one from the admin console.

**Sidecar: Funnel not working**

Check that the ACL allows the `tag:funnel` tag to use Funnel, and that HTTPS certificates are enabled in DNS settings.

**Port conflict with host Tailscale**

If both the host and sidecar are trying to run Tailscale, they'll conflict. Use one or the other, not both.

**Container can't reach the internet**

Some Docker network configurations block outbound traffic. The kond server needs outbound access if your tools require it (e.g., MCP servers that fetch from the web). Check your Docker network settings.
