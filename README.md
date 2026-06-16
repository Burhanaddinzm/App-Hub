# Webapp Hub

A self-hosted internal dashboard for your web services — health checks, labels, and admin management baked in. Replaces the nginx default page.

## Quick start

```bash
# 1. Clone / copy this directory
cd webapp-hub

# 2. (Optional) set credentials
cp .env.example .env
# Edit .env — set ADMIN_USER, ADMIN_PASS, SESSION_SECRET

# 3. Build and run
docker compose up -d
```

Open **http://localhost** (or your server IP) in a browser.

---

## Features

| Feature | Detail |
|---|---|
| **Service cards** | Title, URL, description, emoji/image icon |
| **Health checks** | Client-side HEAD request every 30 s — online / offline / checking |
| **Labels** | Color-coded; filter the grid by label |
| **Auth** | Session-based; credentials from env vars |
| **Admin-only** | Add / edit / delete cards and labels require login |
| **Public** | Card grid is always visible without login |
| **Persistence** | SQLite via `better-sqlite3`; data volume survives restarts |

---

## Configuration

All config is via environment variables (or `.env`):

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USER` | `admin` | Admin username |
| `ADMIN_PASS` | `admin` | Admin password |
| `SESSION_SECRET` | `changeme-hub-secret-2024` | Express session secret — **change in production** |
| `PORT` | `80` | HTTP port inside the container |
| `DB_PATH` | `/data/hub.db` | SQLite file path |

---

## Running on a different port

```yaml
# compose.yaml
ports:
  - "8080:80"   # host:container
```

---

## Behind a reverse proxy (nginx / Caddy)

The app is plain HTTP — terminate TLS at your proxy and forward to `http://hub:80`.

```nginx
location / {
    proxy_pass         http://hub:80;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
```

---

## Development (no Docker)

```bash
npm install
ADMIN_USER=admin ADMIN_PASS=admin DB_PATH=./hub.db node server.js
```
