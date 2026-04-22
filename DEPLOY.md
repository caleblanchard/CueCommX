# CueCommX — Deployment Guide

CueCommX runs as a single Docker container on a Linux host. All clients (web and mobile) connect to it over the local network.

## Requirements

- Linux host (x86-64 or arm64)
- Docker Engine 24+ and Docker Compose v2+
- The host must be reachable on the LAN via a static IP or a reserved DHCP lease

---

## Quick start

### 1. Find your LAN IP

```bash
ip route get 1 | awk '{print $7; exit}'
```

This is the address clients will use to connect. Write it down — you need it in step 3.

### 2. Clone the repo or copy the deploy files

You only need `docker-compose.yml` and optionally `.env.example` from the repository root.

### 3. Configure the environment

```bash
cp .env.example .env
```

Open `.env` and set **`CUECOMMX_ANNOUNCED_IP`** to the LAN IP you found in step 1.
Every other variable has a sensible default, but review them before going live.

### 4. Open the firewall

CueCommX uses UDP for WebRTC media. Open the configured RTP port range on the host:

```bash
# Using ufw
sudo ufw allow 3000/tcp comment "CueCommX HTTP"
sudo ufw allow 40000:41000/udp comment "CueCommX WebRTC media"

# Using firewalld
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=40000-41000/udp
sudo firewall-cmd --reload
```

If you change `CUECOMMX_RTC_MIN_PORT` / `CUECOMMX_RTC_MAX_PORT`, update these rules to match.

### 5. Start the server

```bash
docker compose up -d
```

The first run builds the image from source. This takes a few minutes because mediasoup compiles a native C++ worker. Subsequent starts use the cached image.

### 6. Complete setup

1. Open `http://<YOUR_LAN_IP>:3000` in a browser.
2. You will be redirected to the setup wizard where you create the first admin account.
3. Log in to the admin panel at `/admin` to create channels and user accounts.
4. Clients connect to `http://<YOUR_LAN_IP>:3000` from any device on the LAN.

---

## Upgrading

```bash
docker compose down
git pull                  # or replace the Dockerfile/compose file with the new version
docker compose build --no-cache
docker compose up -d
```

Data is stored in the `cuecommx-data` Docker volume and persists across upgrades.

---

## Configuration reference

| Variable | Default | Description |
|---|---|---|
| `CUECOMMX_ANNOUNCED_IP` | *(required)* | LAN IP advertised to WebRTC clients |
| `CUECOMMX_SERVER_NAME` | `CueCommX` | Name shown on the client connect screen |
| `CUECOMMX_PORT` | `3000` | HTTP listen port |
| `CUECOMMX_HTTPS_PORT` | `3443` | HTTPS listen port (only active when TLS is configured) |
| `CUECOMMX_TLS_CERT_FILE` | *(unset)* | Absolute path to TLS certificate inside the container |
| `CUECOMMX_TLS_KEY_FILE` | *(unset)* | Absolute path to TLS private key inside the container |
| `CUECOMMX_RTC_MIN_PORT` | `40000` | Start of UDP port range for WebRTC media |
| `CUECOMMX_RTC_MAX_PORT` | `41000` | End of UDP port range for WebRTC media |
| `CUECOMMX_MAX_USERS` | `30` | Maximum concurrent connected users |
| `CUECOMMX_MAX_CHANNELS` | `16` | Maximum channels |
| `CUECOMMX_LOG_LEVEL` | `info` | Log level: `debug` `info` `warn` `error` |

---

## HTTPS / TLS

1. Obtain or self-sign a certificate for your LAN IP or hostname.
2. Mount the cert and key into the container and set the env vars:

```yaml
# docker-compose.yml additions
environment:
  CUECOMMX_HTTPS_PORT: 3443
  CUECOMMX_TLS_CERT_FILE: /etc/cuecommx/certs/server.crt
  CUECOMMX_TLS_KEY_FILE: /etc/cuecommx/certs/server.key
volumes:
  - ./certs:/etc/cuecommx/certs:ro
```

Both HTTP and HTTPS run simultaneously when TLS is configured.

> **Note:** iOS requires HTTPS for WebRTC on non-localhost origins. If you target iOS clients, configure TLS and open port 3443 in the firewall.

---

## Data persistence

All persistent data (SQLite database, recordings) is stored in the `cuecommx-data` Docker named volume, mounted at `/var/lib/cuecommx/data` inside the container.

To back up:
```bash
docker run --rm -v cuecommx-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/cuecommx-backup-$(date +%Y%m%d).tar.gz -C /data .
```

To restore:
```bash
docker run --rm -v cuecommx-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/cuecommx-backup-<DATE>.tar.gz -C /data
```

---

## Host networking

The container uses `network_mode: host`, which means it binds directly to the host's network stack. This is required for mediasoup WebRTC to work correctly — without it, the server cannot bind the UDP RTP ports to the right interface.

Do not change this to bridge networking without also configuring `--publish` rules for all 1001 UDP ports and verifying that mediasoup can reach clients through the NAT.

---

## Troubleshooting

**Clients connect but audio doesn't work**
- Verify `CUECOMMX_ANNOUNCED_IP` is set to the correct LAN IP (not `127.0.0.1` or a Docker interface).
- Confirm UDP ports 40000–41000 are open on the host firewall.
- Restart the container after changing the IP.

**Server fails to start**
```bash
docker compose logs cuecommx
```

**Port conflict**
Change `CUECOMMX_PORT` to an unused port and open that port in the firewall instead.

**iOS clients require HTTPS**
Configure TLS as described above and make clients connect to `https://<IP>:3443`.
