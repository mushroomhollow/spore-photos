#!/bin/sh
# Container entrypoint for both services.
#
#   entrypoint.sh api     → API + web UI (applies the schema first)
#   entrypoint.sh share   → public share service
#
# Environment (all optional except the PG_* set):
#   PUID / PGID        run the app as this uid:gid (default 1000:1000)
#   PICTURES_ROOT      photo library inside the container (default /data/library)
#   CHOWN_RECURSIVE    "true" → chown -R the library on start. Slow on a large
#                      library; only needed when the mount belongs to another uid
#   SKIP_MIGRATE       "true" → never run db/init.js
#   DB_WAIT_TIMEOUT    seconds to wait for Postgres (default 120)
set -eu

ROLE="${1:-api}"
case "$ROLE" in
  api)   APPDIR=/app/spore-photos-server ;;
  share) APPDIR=/app/spore-photos-public-share ;;
  *)     echo "Unknown role '$ROLE' (expected 'api' or 'share')" >&2; exit 1 ;;
esac

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
PICTURES_ROOT="${PICTURES_ROOT:-/data/library}"
PG_HOST="${PG_HOST:-db}"
PG_PORT="${PG_PORT:-5432}"
# node -e reads process.env, so these must be exported, not just set.
export PG_HOST PG_PORT

log() { echo "[entrypoint] $*"; }

# ── 1. Volume ownership ───────────────────────────────────────────────
# Photos usually arrive from a bind mount (or a Proxmox storage-backed volume)
# created by another uid. Fix the top-level directory only — new files inherit
# from it — unless a recursive chown is explicitly requested.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$PICTURES_ROOT"
  if [ "${CHOWN_RECURSIVE:-false}" = "true" ]; then
    log "chown -R ${PUID}:${PGID} ${PICTURES_ROOT} (this can take a while)"
    chown -R "$PUID:$PGID" "$PICTURES_ROOT"
  else
    chown "$PUID:$PGID" "$PICTURES_ROOT"
  fi
  RUNAS="gosu ${PUID}:${PGID}"
else
  log "running as uid $(id -u); leaving ownership alone"
  RUNAS=""
fi

# ── 2. Wait for Postgres ──────────────────────────────────────────────
# A TCP probe is enough: Postgres does not listen until initdb has finished.
pg_ready() {
  node -e '
    const net = require("net");
    const sock = net.connect({ host: process.env.PG_HOST, port: Number(process.env.PG_PORT) });
    sock.setTimeout(2000);
    sock.on("connect", () => { sock.end(); process.exit(0); });
    sock.on("error", () => process.exit(1));
    sock.on("timeout", () => { sock.destroy(); process.exit(1); });
  ' 2>/dev/null
}

wait_for_db() {
  elapsed=0
  log "waiting for Postgres at ${PG_HOST}:${PG_PORT}"
  until pg_ready; do
    if [ "$elapsed" -ge "${DB_WAIT_TIMEOUT:-120}" ]; then
      echo "[entrypoint] Postgres not reachable after ${elapsed}s" >&2
      exit 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  log "Postgres is up"
}

wait_for_db

# ── 3. Schema ─────────────────────────────────────────────────────────
# db/init.js is idempotent (schema.sql + every migrate-*.sql). Only the API
# runs it, so two containers starting together cannot race.
if [ "$ROLE" = "api" ] && [ "${SKIP_MIGRATE:-false}" != "true" ]; then
  log "applying schema and migrations"
  $RUNAS sh -c "cd $APPDIR && node db/init.js"
fi

# ── 4. Start ──────────────────────────────────────────────────────────
log "starting '$ROLE' as ${PUID}:${PGID} on port ${PORT:-4051}"
cd "$APPDIR"
exec $RUNAS node index.js