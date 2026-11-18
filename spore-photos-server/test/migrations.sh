#!/usr/bin/env bash
# The database-backed half of the migration tests — everything that only means
# something against a real PostgreSQL:
#
#   * a fresh install gets schema.sql and records the three archived migrations
#   * a release migration runs ONCE (a second start does not replay it)
#   * the scenario that motivated versioning: a later release re-adds a column an
#     earlier release dropped. A restart must not undo the backfill.
#   * a broken migration is fatal and is not recorded
#   * a badly named migration is refused before anything is applied
#
# Throwaway database and role: spore_mig_test. Nothing here touches the dev or
# production databases; the app is pointed at the scratch one with PG_* env vars.
#
#   bash test/migrations.sh
set -uo pipefail
umask 077

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER="$(dirname "$HERE")"
DB=mig_test
ROLE=mig_test
PASS="mig_$(head -c 9 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"

PASS_COUNT=0
FAIL_COUNT=0
check() { # check <label> <ok:0/1> [detail]
  if [ "$2" = 0 ]; then printf '  PASS  %s %s\n' "$1" "${3-}"; PASS_COUNT=$((PASS_COUNT + 1))
  else printf '  FAIL  %s %s\n' "$1" "${3-}"; FAIL_COUNT=$((FAIL_COUNT + 1)); fi
}

created_files=()
synthetic() { # synthetic <filename> <sql…>  — writes into db/migrations, cleaned up
  local name="$1"; shift
  created_files+=("$SERVER/db/migrations/$name")
  printf '%s\n' "$@" > "$SERVER/db/migrations/$name"
}
cleanup() {
  for f in "${created_files[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done
  sudo -n -u postgres psql -q -tAc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1
  sudo -n -u postgres psql -q -tAc "DROP ROLE IF EXISTS $ROLE" >/dev/null 2>&1
}
trap cleanup EXIT

sudo -n -u postgres psql -q -tAc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1
sudo -n -u postgres psql -q -tAc "DROP ROLE IF EXISTS $ROLE" >/dev/null 2>&1
sudo -n -u postgres psql -q -tAc "CREATE ROLE $ROLE LOGIN PASSWORD '$PASS'" >/dev/null || { echo "could not create the scratch role"; exit 1; }
sudo -n -u postgres psql -q -tAc "CREATE DATABASE $DB OWNER $ROLE" >/dev/null || { echo "could not create the scratch database"; exit 1; }

export PG_HOST=127.0.0.1 PG_PORT=5432 PG_DATABASE=$DB PG_USER=$ROLE PG_PASSWORD=$PASS
q() { PGPASSWORD="$PASS" psql -h 127.0.0.1 -U "$ROLE" -d "$DB" -tAc "$1" 2>&1; }
init() { ( cd "$SERVER" && node db/init.js "$@" 2>&1 ); }

echo "=== scratch database $DB (role $ROLE), never the dev/production ones"
echo
echo "=== 1. a fresh install runs schema.sql and records what came before"
OUT="$(init)"; RC=$?
check "first start exits 0" "$([ $RC = 0 ] && echo 0 || echo 1)" "(exit $RC)"
check "says it recorded the earlier migrations" "$(printf '%s' "$OUT" | grep -q 'recorded 3 earlier ones' && echo 0 || echo 1)"
check "schema_migrations holds the 3 archived ones" "$([ "$(q 'SELECT count(*) FROM schema_migrations')" = 3 ] && echo 0 || echo 1)"
check "the folded client-token columns are present (schema.sql carries them)" \
  "$([ "$(q "SELECT count(*) FROM information_schema.columns WHERE table_name='devices' AND column_name='client_token_hash'")" = 1 ] && echo 0 || echo 1)"
check "no migration file was needed for that" "$([ -z "$(q "SELECT filename FROM schema_migrations WHERE filename LIKE '2.%' OR filename LIKE '9.%'")" ] && echo 0 || echo 1)"

echo
echo "=== 2. a release migration runs exactly once"
synthetic 9.9.1-probe-table.sql \
  "-- a migration is free to be a single forward step: no IF NOT EXISTS guards" \
  "CREATE TABLE mig_probe (id SERIAL PRIMARY KEY, note TEXT);" \
  "INSERT INTO mig_probe (note) VALUES ('inserted by 9.9.1');"
OUT="$(init)"; RC=$?
check "applies it and exits 0" "$([ $RC = 0 ] && echo 0 || echo 1)" "(exit $RC)"
check "names the release it belongs to" "$(printf '%s' "$OUT" | grep -q 'v9.9.1 — 9.9.1-probe-table.sql' && echo 0 || echo 1)"
check "the change landed" "$([ "$(q 'SELECT count(*) FROM mig_probe')" = 1 ] && echo 0 || echo 1)"
OUT="$(init)"
check "a second start reports nothing pending" "$(printf '%s' "$OUT" | grep -q 'No pending migrations' && echo 0 || echo 1)"
check "and did NOT replay it (one row, not two)" "$([ "$(q 'SELECT count(*) FROM mig_probe')" = 1 ] && echo 0 || echo 1)"

echo
echo "=== 3. the reversal: a later release re-adds what an earlier one dropped"
synthetic 9.9.2-drop-flag.sql \
  "ALTER TABLE mig_probe DROP COLUMN IF EXISTS legacy_flag;"
synthetic 9.9.3-readd-flag.sql \
  "ALTER TABLE mig_probe ADD COLUMN legacy_flag TEXT;" \
  "UPDATE mig_probe SET legacy_flag = 'backfilled by 9.9.3';"
init >/dev/null
check "both applied; the column is back with its data" \
  "$([ "$(q "SELECT legacy_flag FROM mig_probe LIMIT 1")" = 'backfilled by 9.9.3' ] && echo 0 || echo 1)"

# Data written AFTER 9.9.3 — an upload, an edit, anything the app did since.
q "UPDATE mig_probe SET legacy_flag = 'written after 9.9.3'" >/dev/null
OUT="$(init)"   # ← a restart, which under the old runner replayed every file
check "restart applies nothing" "$(printf '%s' "$OUT" | grep -q 'No pending migrations' && echo 0 || echo 1)"
check "the newer data SURVIVED the restart" \
  "$([ "$(q "SELECT legacy_flag FROM mig_probe LIMIT 1")" = 'written after 9.9.3' ] && echo 0 || echo 1)" \
  "$(q "SELECT legacy_flag FROM mig_probe LIMIT 1")"

# Show what the old behaviour did — replaying every file, in order, on a database
# that has moved on. 9.9.2 drops the column again (taking the newer data with it)
# and 9.9.3 re-adds it empty-but-backfilled, so the newer value is gone.
( cd "$SERVER/db/migrations" && for f in $(ls -1 *.sql | sort -V); do
    PGPASSWORD="$PASS" psql -h 127.0.0.1 -U "$ROLE" -d "$DB" -q -f "$f" >/dev/null 2>&1
  done )
REPLAYED="$(q "SELECT legacy_flag FROM mig_probe LIMIT 1")"
check "replaying every file loses it (the old behaviour)" \
  "$([ "$REPLAYED" != 'written after 9.9.3' ] && echo 0 || echo 1)" \
  "value is now '$REPLAYED'"

echo
echo "=== 4. a broken migration is fatal and is not recorded"
synthetic 9.9.4-broken.sql "THIS IS NOT SQL;"
OUT="$(init)"; RC=$?
check "is fatal (non-zero exit)" "$([ $RC != 0 ] && echo 0 || echo 1)" "(exit $RC)"
check "says what happened" "$(printf '%s' "$OUT" | grep -q 'Migration error' && echo 0 || echo 1)"
check "is not recorded as applied" \
  "$([ "$(q "SELECT count(*) FROM schema_migrations WHERE filename='9.9.4-broken.sql'")" = 0 ] && echo 0 || echo 1)"
rm -f "$SERVER/db/migrations/9.9.4-broken.sql"
OUT="$(init)"
check "once removed, the install is healthy again" "$(printf '%s' "$OUT" | grep -q 'No pending migrations' && echo 0 || echo 1)"

echo
echo "=== 5. a badly named migration is refused before any migration runs"
synthetic bogus.sql "SELECT 1;"
OUT="$(init)"; RC=$?
check "is fatal (non-zero exit)" "$([ $RC != 0 ] && echo 0 || echo 1)" "(exit $RC)"
check "names the naming rule" "$(printf '%s' "$OUT" | grep -q 'must be <version>-<slug>.sql' && echo 0 || echo 1)"
rm -f "$SERVER/db/migrations/bogus.sql"

echo
echo "=== 6. status reports both halves"
STATUS="$(init --status)"
check "lists what is applied" "$(printf '%s' "$STATUS" | grep -q 'Applied (' && echo 0 || echo 1)"
check "and what is pending" "$(printf '%s' "$STATUS" | grep -q 'Pending (0)' && echo 0 || echo 1)"
check "--json is machine readable" \
  "$(init --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.exit(Array.isArray(j.applied)&&Array.isArray(j.pending)?0:1)})" && echo 0 || echo 1)"

echo
echo "=== $PASS_COUNT passed, $FAIL_COUNT failed"
[ "$FAIL_COUNT" = 0 ]
