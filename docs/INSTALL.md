# Installing Spore-Photos on a new server

This is the long form of the README quick start. It assumes a Linux host and is
written so an automated agent or a person can follow it top to bottom. Section 1
lists everything that has to be installed before you start.

> **Prefer containers?** Stop here and use [`DOCKER.md`](DOCKER.md) instead —
> one `docker compose up` replaces sections 1–9 below.

Paths below use `/opt/spore-photos` for the checkout and `/srv/spore-photos/library`
for the photo library. Substitute your own.

---

## 1. Prerequisites

Nothing here needs a container or a cloud service: one Node process, one
PostgreSQL database, and a folder on disk. Check each item before cloning.

### 1.1 Software

| Package | Version | Why | Check |
|---|---|---|---|
| Node.js | **20.19 or newer** (22 LTS recommended) | runs the API and share service; the client build (Vite 8) needs ≥ 20.19 | `node --version` |
| npm | 10+ (ships with Node) | installs dependencies | `npm --version` |
| PostgreSQL | **14 or newer** (tested on 18) | all metadata: users, photos, albums, sessions | `psql --version` |
| ffmpeg **and ffprobe** | any recent | video uploads — ffprobe reads dimensions/duration, ffmpeg grabs the poster frame. **Without them video uploads fail.** Image uploads are unaffected | `ffmpeg -version`, `ffprobe -version` |
| git | any | to clone, and to upgrade later | `git --version` |
| compiler toolchain | optional | only if `npm ci` has to compile `sharp`; prebuilt binaries cover x86-64 and arm64, glibc and musl | — |

**Debian / Ubuntu**

```bash
sudo apt install nodejs npm postgresql ffmpeg git
```

Distro `nodejs` is often too old — if `node --version` reports below 20.19, use
[NodeSource](https://github.com/nodesource/distributions) or nvm.

**Arch**

```bash
sudo pacman -S nodejs npm postgresql ffmpeg git
sudo -u postgres initdb -D /var/lib/postgres/data   # pacman does not do this
sudo systemctl enable --now postgresql
```

**Fedora**

```bash
sudo dnf install nodejs npm postgresql-server ffmpeg git
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
```

### 1.2 A service user and two directories

Nothing should run as root. The API reads the checkout and writes photos, so
they are owned by one unprivileged user:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin spore
sudo mkdir -p /opt/spore-photos /srv/spore-photos/library
sudo chown spore:spore /opt/spore-photos /srv/spore-photos/library
```

- `/srv/spore-photos/library` — the photo library, **writable** by `spore`. A
  mounted NAS share is fine, but it must be mounted before the service starts.
- `/opt/spore-photos` — the checkout, only read at runtime. Needs to be writable
  during an upgrade.

### 1.3 Disk and memory

Every photo is stored three times: original, 1200 px preview, 300 px thumbnail
— budget about **1.15×** the size of the library you intend to import. Videos
store the original plus two JPEG frames. Uploads are buffered in memory (up to
100 MB per file), so leave RAM headroom for a large concurrent upload.

### 1.4 Ports

| Port | Service | Exposure |
|---|---|---|
| 4051 | API (also serves the built web UI) | LAN only, or `127.0.0.1` behind a proxy |
| 4052 | public share links | same |
| 5432 | PostgreSQL | localhost only (default) |

The API listens on all interfaces so a phone on the LAN can reach it. Do not
port-forward 4051/4052 — terminate TLS at a proxy (§9) and keep the API bound
to loopback.

## 2. Database

Create a role and a database. The app creates its own tables and never touches
anything outside that database. The role needs **no superuser rights**, only
ownership of its database.

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE spore LOGIN PASSWORD 'replace-with-a-strong-password';
CREATE DATABASE spore_photos OWNER spore;
SQL
```

> Use a unique password. There is no default, and the server refuses to start
> without one (`PG_PASSWORD` or `database.password` in the config file).

The app connects over TCP with a password, so verify that path works before
going further:

```bash
PGPASSWORD='replace-with-a-strong-password' \
  psql -h 127.0.0.1 -U spore -d spore_photos -c 'select 1'
```

If that fails with `peer authentication failed`, `pg_hba.conf` is using peer
auth for local TCP; add `host all all 127.0.0.1/32 scram-sha-256` (the default
on most distributions).

The schema needs the `uuid-ossp` extension. PostgreSQL 13+ marks it *trusted*,
so the database owner can create it during `npm run db:init`. On older servers,
create it once as the superuser:

```bash
sudo -u postgres psql -d spore_photos -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
```

## 3. Checkout and dependencies

```bash
sudo -u spore git clone <repository-url> /opt/spore-photos

# everything from here to step 7 runs as the service user, which owns the
# checkout (the account has a nologin shell, so start a shell explicitly)
sudo -u spore bash
cd /opt/spore-photos

(cd spore-photos-server       && npm ci --omit=dev)
(cd spore-photos-public-share && npm ci --omit=dev)
(cd spore-photos-client       && npm ci)
```

`npm ci` installs exactly the versions in the committed lockfiles — use it
rather than `npm install`, which can drift. The client needs its dev
dependencies because Vite builds the bundle; the two services do not. `npm ci`
downloads a prebuilt `sharp` binary, so the machine needs network access.

`spore-photos-mobile` is only needed if you intend to rebuild the Android app.

## 4. Configuration

One file configures every service.

```bash
cp config/spore-photos.config.example.json config/spore-photos.config.json
```

Edit it:

```json
{
  "default": {
    "server":      { "port": 4051, "corsOrigin": "", "trustProxy": false },
    "publicShare": { "port": 4052 },
    "database":    { "host": "localhost", "port": 5432, "name": "spore_photos",
                     "user": "spore", "password": "the-password-from-step-2" },
    "storage":     { "picturesRoot": "/srv/spore-photos/library" },
    "setup":       { "token": "" }
  }
}
```

Every value can be overridden by an environment variable (see `.env.example`);
that is often more convenient with systemd or containers. `SPORE_PHOTOS_CONFIG`
points at a config file somewhere else.

`trustProxy` stays `false` unless a reverse proxy you control sets
`X-Forwarded-*`. Leaving it `false` behind such a proxy makes every client look
like `127.0.0.1`; setting it `true` without a proxy lets clients forge their IP.

## 5. Schema

```bash
cd spore-photos-server && npm run db:init && cd ..
```

This applies `db/schema.sql` and any `db/migrate-*.sql` in order, and creates
**no user account**.

## 6. Build the web app

```bash
cd spore-photos-client && npm run build && cd ..
```

Output lands in `spore-photos-client/dist/`. The API server serves that
directory automatically when it exists, so a single port can host both the UI
and the API. If you would rather serve static files from nginx, do that instead
and leave `dist/` in place.

## 7. First run

Start the API (still in the `spore` shell from step 3; `exit` it before the
systemd steps, which need `sudo`):

```bash
cd spore-photos-server && npm start
```

It prints, among other things:

```
[Spore-Photos API] v1.9.0
  Env:        development
  Port:       4051
  Database:   spore_photos
  Pictures:   /srv/spore-photos/library
  TrustProxy: false

  ── First-run setup required ──
  Open the site and enter this setup token: A1B2-C3D4-E5F6-7890-ABCD-EF12
```

Open `http://<host>:4051`, enter that token, and create the admin account. The
token is stored in `app_settings` (`setup_token`) and is deleted the moment
setup completes. To pin it yourself, set `SETUP_TOKEN` or `setup.token`.

Start the public-share service as well (needed for public share links):

```bash
cd spore-photos-public-share && npm start
```

## 8. Run as services (systemd)

`/etc/systemd/system/spore-photos.service`:

```ini
[Unit]
Description=Spore-Photos API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=spore
WorkingDirectory=/opt/spore-photos/spore-photos-server
EnvironmentFile=/etc/spore-photos.env
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

`/etc/spore-photos.env` (owned by root, mode `600` — keep the password out of
the unit file, where it would be world-readable via `systemctl show`):

```bash
sudo tee /etc/spore-photos.env >/dev/null <<'EOF'
NODE_ENV=production
PG_PASSWORD=the-password-from-step-2
PICTURES_ROOT=/srv/spore-photos/library
EOF
sudo chmod 600 /etc/spore-photos.env
```

`/etc/systemd/system/spore-photos-share.service`: the same unit, with
`WorkingDirectory=/opt/spore-photos/spore-photos-public-share` and one extra
line in `[Service]`:

```ini
Environment=PORT=4052
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now spore-photos spore-photos-share
```

## 9. HTTPS and a hostname (optional but recommended)

nginx, terminating TLS and forwarding to the two services:

```nginx
server {
    listen 443 ssl http2;
    server_name photos.example.com;

    # ... ssl_certificate / ssl_certificate_key ...

    client_max_body_size 200m;   # uploads; default 1m rejects most photos.
                                 # Must match MAX_UPLOAD_MB in the app.

    location /api/   { proxy_pass http://127.0.0.1:4051; proxy_set_header Host $host;
                       proxy_set_header X-Real-IP $remote_addr;
                       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                       proxy_set_header X-Forwarded-Proto $scheme; }
    location /share/ { proxy_pass http://127.0.0.1:4052; proxy_set_header Host $host;
                       proxy_set_header X-Real-IP $remote_addr;
                       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                       proxy_set_header X-Forwarded-Proto $scheme; }
    location /       { root /opt/spore-photos/spore-photos-client/dist;
                       try_files $uri $uri/ /index.html; }
}
```

Set `TRUST_PROXY=true` for the API and share services when you do this, so the
app sees real client IPs and marks cookies `Secure`.

If you do not want a proxy at all, the API server serves the SPA itself; put
`https` in front of it some other way or keep it LAN-only.

### Upload size limits

The app accepts files up to **200 MB**. Three layers have to agree, or a large
video fails in a confusing way:

| Layer | Setting |
|---|---|
| Browser / app | `MAX_UPLOAD_MB` in `spore-photos-client/src/api/client.js` |
| API | `MAX_UPLOAD_MB` in `spore-photos-server/routes/photos.js` |
| Reverse proxy | `client_max_body_size 200m` (defaults to 1 MB in nginx) |

**Cloudflare is the exception.** Proxied DNS records and Cloudflare Tunnels cap
request bodies by plan — **100 MB on Free and Pro, 200 MB on Business** — no
matter what nginx is set to. A 300 MB video is rejected with a `413` before it
reaches your server. Upload large videos over the LAN or a Tailscale address
(the mobile app can point at either), or use a DNS-only record.

Uploads are buffered in memory while `sharp`/`ffmpeg` process them, so a 200 MB
video needs roughly 500 MB of free RAM for the duration of that upload.

## 10. Upgrading

```bash
sudo -u spore bash
cd /opt/spore-photos
git pull
(cd spore-photos-server       && npm ci --omit=dev)
(cd spore-photos-public-share && npm ci --omit=dev)
(cd spore-photos-client       && npm ci && npm run build)
(cd spore-photos-server       && npm run db:init)   # applies new migrations
exit
sudo systemctl restart spore-photos spore-photos-share
curl -s localhost:4051/api/health                   # confirm the new version
```

`VERSION` is the release version for everything. If you upgrade the server but
not the built client (or vice versa), the UI shows a version-mismatch banner
instead of failing quietly.

## 11. Backups

Two things hold all the state:

1. the PostgreSQL database (`pg_dump spore_photos`), and
2. the photo root (`picturesRoot`).

Back both up together; the database references files by path.

```bash
# metadata (run as a user that can read the database, e.g. spore)
pg_dump -h 127.0.0.1 -U spore -Fc spore_photos > spore-photos-$(date +%F).dump

# photos (three files per photo: orig, _prev, _thumb)
rsync -a /srv/spore-photos/library/ /backup/spore-photos-library/
```

## 12. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `PG_PASSWORD ... is required` at startup | No database password configured — set it in the config file or env |
| `password authentication failed for user "spore"` | Wrong password, or `pg_hba.conf` uses `peer` for local sockets |
| Setup screen never appears | The database already has users; it only shows while `users` is empty |
| Lost the setup token | `SELECT value FROM app_settings WHERE key='setup_token'`, or set `SETUP_TOKEN` and restart |
| Login works but every request is `403 Access Denied` | Your IP was blacklisted after 3 bad access codes: `UPDATE ip_addresses SET blacklisted=false WHERE ip='…'` |
| A new browser only offers "Enter an access code" | Expected — instances are invite-only. Create a code under Settings → Users & Access → Access Codes |
| Signing in returns `403 device_not_authorised` | That device has no client token. Add it with an access code first |
| A script gets `403 Missing X-Requested-With` | Send `X-Requested-With: XMLHttpRequest` on every POST/PUT/PATCH/DELETE |
| Everyone appears as `127.0.0.1` | Running behind a proxy without `TRUST_PROXY=true` |
| Uploads fail with `413` | A body-size limit. nginx: `client_max_body_size 200m`. Cloudflare caps at 100 MB (Free/Pro) no matter what — see §9 |
| A big video is "too large" though 200 MB should be fine | Cloudflare plan limit (100 MB Free/Pro), or `MAX_UPLOAD_MB` / `client_max_body_size` out of step |
| Video upload fails, images are fine | `ffmpeg`/`ffprobe` missing — install them and restart the service |
| Version banner appears | Server and client bundles are different releases — rebuild/restart both |
| HEIC photos fail to upload | `sharp` could not decode them; ensure `npm install` completed on the server |

## 13. Android app

See [`../spore-photos-mobile/AGENTS.md`](../spore-photos-mobile/AGENTS.md).
The app has no compiled-in server address; it asks for one on first launch.