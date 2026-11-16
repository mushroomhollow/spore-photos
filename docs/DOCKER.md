# Running Spore-Photos in containers

Docker is the fastest way to get a working instance: three containers (API +
web UI, public share, PostgreSQL), one published port, no host packages beyond
Docker itself.

Use this guide instead of `docs/INSTALL.md` if you want containers. The two are
alternatives, not steps in sequence.

---

## 1. Quick start

```bash
cd docker
cp .env.example .env      # set PG_PASSWORD at minimum
docker compose up -d --build
```

That builds the image locally from this checkout, starts Postgres, applies the
schema, and serves the app on **http://<host>:4051**.

Create the admin account:

```bash
docker compose logs api | grep -i "setup token"
```

Open the site, paste the token, choose a username and password. There is no
default account and no default password.

Everything lives in two places:

| What | Where | Survives `compose down`? |
|---|---|---|
| Database | named volume `spore-photos_pgdata` | yes (`down -v` deletes it) |
| Photos | `LIBRARY_PATH` on the host (default `docker/library`) | yes |

---

## 2. What runs

| Service | Port | Role |
|---|---|---|
| `api` | 4051 → published | Express API, serves the built web UI, applies migrations, proxies `/share/*` |
| `share` | 4052 → internal only | Public share pages and shared-file bytes |
| `db` | 5432 → internal only | PostgreSQL 17 |

Only 4051 is published. The API proxies share links to the `share` container, so
one port serves the UI, the API and public links. That is why `SHARE_SERVER_HOST`
exists — see `docker/compose.yaml`.

Both app services run the same image with a different command (`api` / `share`).

---

## 3. Configuration

All settings are environment variables in `docker/.env`. Compose reads that file
twice: for `$VAR` substitution and as the containers' environment.

| Variable | Default | Meaning |
|---|---|---|
| `PG_PASSWORD` | — (**required**) | Database password. Letters, digits, `-_.` only |
| `PG_DATABASE` | `spore_photos` | Database name (created on first start) |
| `PG_USER` | `spore` | Database role (created on first start) |
| `LIBRARY_PATH` | `./library` | Host path for the photo library |
| `APP_PORT` | `4051` | Host port for the UI/API |
| `TRUST_PROXY` | `false` | `true` only behind a reverse proxy you control |
| `PUID` / `PGID` | `1000` / `1000` | uid:gid the app runs as inside the container |
| `CHOWN_RECURSIVE` | `false` | `true` → `chown -R` the library on start (slow on big libraries) |
| `SETUP_TOKEN` | generated | Pin the first-run token instead of reading it from the log |
| `DB_WAIT_TIMEOUT` | `120` | Seconds to wait for Postgres before giving up |

`PUID`/`PGID` matter when the photo directory belongs to someone else — a NAS
mount, an existing library, or a Proxmox storage volume. The entrypoint chowns
the top-level directory before dropping privileges from root to that uid.

---

## 4. Behind a reverse proxy / TLS

The stack speaks plain HTTP on 4051. Put TLS in front of it with nginx, Caddy,
Traefik, a Cloudflare Tunnel, or anything else, and **set `TRUST_PROXY=true`** so
the app sees the real client address and marks the session cookie `Secure`.

```nginx
server {
    listen 443 ssl http2;
    server_name photos.example.com;
    client_max_body_size 200m;          # uploads; the default 1m rejects photos

    location / {
        proxy_pass http://127.0.0.1:4051;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you use an external proxy that routes `/share` separately, uncomment the
`share` port mapping in `docker/compose.yaml` and point it at 4052 instead.

Without any proxy the app works on plain HTTP for a LAN — cookies are then
`SameSite=Lax` and not `Secure`, which is fine inside a trusted network.

### Upload size limits

The app accepts files up to **200 MB**, and three layers must agree:
`MAX_UPLOAD_MB` in `spore-photos-client/src/api/client.js`, `MAX_UPLOAD_MB` in
`spore-photos-server/routes/photos.js`, and `client_max_body_size 200m` on
whatever proxy fronts the stack.

**Cloudflare caps this by plan** — 100 MB on Free/Pro, 200 MB on Business, no
matter what nginx says. A 300 MB video through a Cloudflare Tunnel gets a `413`
before it reaches the container. Upload large videos over the LAN or a Tailscale
address (point the mobile app at that address), or use a DNS-only record.

Uploads are buffered in memory while `sharp`/`ffmpeg` run, so a 200 MB video
needs roughly 500 MB of free RAM for that upload — see the RAM note in §5.

---

## 5. Proxmox (LXC) notes

The stack runs inside a Proxmox container as long as Docker is allowed to nest:

```
# on the Proxmox host, for the app container's config
features: nesting=1
```

`keyctl=1` is **not** required — this stack was provisioned on Proxmox with
`nesting=1` alone. Add it only if your own container hits a keyring error
(`Operation not permitted` on `keyctl`), which is usually a different workload's
problem rather than this one's.

- **Privileged vs unprivileged:** unprivileged is fine; keep the storage-backed
  mount point Proxmox manages (`mp0: pm_1:100,mp=/data/photos`) and set
  `LIBRARY_PATH=/data/photos`.
- **Disk:** give the container at least **16 GB** — the image is ~700 MB, and the
  CT rootfs also holds `/var/lib/docker` (Postgres data lives in a volume there).
  Media belongs on the mount point, not the rootfs.
- **ZFS:** `overlay2` on a ZFS rootfs is slow. Either put `/var/lib/docker` on an
  ext4-backed volume or accept the slower first build. Running a small VM instead
  of an LXC avoids the issue entirely.
- **RAM:** 2 GB is the practical minimum; 4 GB is comfortable. Uploads are
  buffered in memory while they are processed, so a 200 MB video needs about
  500 MB free at that moment — do not set a hard 512 MB container limit.
- **Networking:** the published port is on the container's LAN address, so a
  Cloudflare Tunnel or an edge container can point straight at
  `http://<ct-ip>:4051`.

---

## 6. Upgrading

```bash
git pull
cd docker
docker compose up -d --build
```

The `api` container applies any new `db/migrate-*.sql` on start (`db/init.js` is
idempotent). Only the API runs migrations, so the two app containers cannot race.
`VERSION` is baked into the image; if a stale client bundle is served alongside a
newer server the UI shows a version-mismatch banner.

---

## 7. Backup and restore

```bash
# database
docker compose exec -T db pg_dump -U spore -Fc spore_photos > spore-photos-$(date +%F).dump

# photos (plain directory on the host — back it up however you like)
rsync -a "$LIBRARY_PATH"/ /backup/spore-photos-library/
```

Restore: `docker compose up -d db`, then

```bash
docker compose exec -T db pg_restore -U spore -d spore_photos --clean --if-exists < spore-photos-2026-11-12.dump
```

and copy the library back to `LIBRARY_PATH`.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `required variable PG_PASSWORD is missing a value` | No `docker/.env`, or it lacks `PG_PASSWORD` |
| `[entrypoint] Postgres not reachable after 120s` | Postgres still starting (slow disk) — raise `DB_WAIT_TIMEOUT`, check `docker compose logs db` |
| Uploads fail, files never appear | `LIBRARY_PATH` not writable by `PUID:PGID` — set `CHOWN_RECURSIVE=true` once, or fix ownership on the host |
| Everything looks like `172.x.x.x` in the admin view | Behind a proxy without `TRUST_PROXY=true` |
| Login appears to work but the session drops | Serving over HTTPS through a proxy without `TRUST_PROXY=true` (cookie stays non-`Secure`) |
| "Download App" says no APK | The APK is not in the repo; drop `spore-photos-v*.apk` into `spore-photos-client/public/apk/` and rebuild |
| Large video rejected with `413` or "too large" | Cloudflare plan limit (100 MB Free/Pro) — upload over LAN/Tailscale; otherwise check `client_max_body_size` and `MAX_UPLOAD_MB` agree |
| `docker compose build` fails on a missing buildx | Install the buildx plugin, or build with `DOCKER_BUILDKIT=0 docker build -f docker/Dockerfile -t spore-photos .` |

---

## 9. Building the image yourself

```bash
# from the repository root
docker build -f docker/Dockerfile -t spore-photos .

# or via compose
cd docker && docker compose build
```

The build context must be the repository root: the client build reads
`../VERSION`, and the runtime needs `config/`, `VERSION` and both Node projects.
`.dockerignore` keeps the context small.

The image is not published anywhere by default — building locally is the
supported path. If you want to host it, push `spore-photos:latest` to any
registry after building and point `image:` in `docker/compose.yaml` at it.