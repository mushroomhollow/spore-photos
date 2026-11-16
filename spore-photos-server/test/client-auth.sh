#!/usr/bin/env bash
# End-to-end check of the client-token auth model.
#
# Needs a THROWAWAY database and a running server pointed at it, plus the setup
# token that server was started with:
#
#   createdb spore_auth_test
#   PG_DATABASE=spore_auth_test PG_USER=... PG_PASSWORD=... npm run db:init
#   PORT=3057 PG_DATABASE=spore_auth_test SETUP_TOKEN=TEST-TOKEN-1234 \
#     PICTURES_ROOT=/tmp/spore-auth-test npm start
#
#   BASE_URL=http://localhost:3057 SETUP_TOKEN=TEST-TOKEN-1234 \
#   PGPASSWORD=... test/client-auth.sh
#
# It never touches production data: the assertions read and write only the
# database named by the PG* environment.

set -u
BASE_URL="${BASE_URL:-http://localhost:3057}"
SETUP_TOKEN="${SETUP_TOKEN:-TEST-TOKEN-1234}"
B="$BASE_URL/api"
H=(-H 'Content-Type: application/json' -H 'X-Requested-With: XMLHttpRequest')
J=$(mktemp); J2=$(mktemp)
trap 'rm -f "$J" "$J2"' EXIT

pass=0; fail=0
chk() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1 (expected '$2', got '$3')"; fail=$((fail+1)); fi
}
jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const v=$1;console.log(v===undefined?'':String(v))}catch(e){console.log('PARSE_ERR')}})"; }
sql() { psql -tA -c "$1"; }
psql_ok() { command -v psql >/dev/null 2>&1; }

echo "1. first run"
chk "needsSetup=true" "true" "$(curl -s $B/setup/status | jget 'j.needsSetup')"

echo "2. CSRF guard"
chk "POST without X-Requested-With -> 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/setup -H 'Content-Type: application/json' -d '{"token":"x","username":"a","password":"bbbbbbbb"}')"

echo "3. setup creates the admin, authorises the client, signs it in"
R=$(curl -s -c $J -b $J "${H[@]}" -H 'X-Device-ID: dev-admin' -X POST $B/setup \
  -d "{\"token\":\"$SETUP_TOKEN\",\"username\":\"admin\",\"password\":\"supersecret1\",\"displayName\":\"Admin\"}")
chk "admin user" "admin" "$(echo "$R" | jget 'j.user.username')"
chk "client token issued" "64" "$(echo "$R" | jget 'j.client_token.length')"
TOK=$(echo "$R" | jget 'j.client_token')
chk "needsSetup now false" "false" "$(curl -s $B/setup/status | jget 'j.needsSetup')"

echo "4. session cookie alone signs in"
chk "auto_login" "auto_login" "$(curl -s -c $J -b $J "${H[@]}" -H 'X-Device-ID: dev-admin' -X POST $B/auth/check | jget 'j.status')"

echo "5. client token alone signs in (no cookie)"
chk "auto_login" "auto_login" "$(curl -s "${H[@]}" -H 'X-Device-ID: dev-admin' -H "X-Client-Token: $TOK" -X POST $B/auth/check | jget 'j.status')"

echo "6. unknown client is invite-only"
chk "code_required" "code_required" "$(curl -s "${H[@]}" -H 'X-Device-ID: dev-stranger' -X POST $B/auth/check | jget 'j.status')"

echo "7. an unauthorised device cannot use the password form"
chk "403" "403" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H 'X-Device-ID: dev-stranger' -X POST $B/auth/login -d '{"username":"admin","password":"supersecret1"}')"
chk "code=device_not_authorised" "device_not_authorised" "$(curl -s "${H[@]}" -H 'X-Device-ID: dev-stranger' -X POST $B/auth/login -d '{"username":"admin","password":"supersecret1"}' | jget 'j.code')"

if psql_ok; then
  echo "8. an authorised device with no token yet may log in (grants a token)"
  sql "INSERT INTO devices (device_id, authorized, authorized_at) VALUES ('dev-grandfathered', true, NOW()) ON CONFLICT (device_id) DO UPDATE SET authorized=true, client_token_hash=NULL" > /dev/null
  R=$(curl -s -c $J -b $J "${H[@]}" -H 'X-Device-ID: dev-grandfathered' -X POST $B/auth/login -d '{"username":"admin","password":"supersecret1"}')
  chk "token issued on login" "64" "$(echo "$R" | jget 'j.client_token.length')"
  TOK2=$(echo "$R" | jget 'j.client_token')

  echo "9. wrong password is still rejected"
  chk "401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -H 'X-Device-ID: dev-grandfathered' -H "X-Client-Token: $TOK2" -X POST $B/auth/login -d '{"username":"admin","password":"wrongpassword"}')"

  echo "10. sign out ends the session but keeps the device authorised"
  sql "INSERT INTO devices (device_id, authorized, authorized_at) VALUES ('dev-logout', true, NOW()) ON CONFLICT (device_id) DO UPDATE SET authorized=true, client_token_hash=NULL" > /dev/null
  R=$(curl -s -c $J2 -b $J2 "${H[@]}" -H 'X-Device-ID: dev-logout' -X POST $B/auth/login -d '{"username":"admin","password":"supersecret1"}')
  T4=$(echo "$R" | jget 'j.client_token')
  chk "session live before sign-out" "auto_login" "$(curl -s -c $J2 -b $J2 "${H[@]}" -H 'X-Device-ID: dev-logout' -X POST $B/auth/check | jget 'j.status')"
  curl -s -c $J2 -b $J2 "${H[@]}" -H 'X-Device-ID: dev-logout' -X POST $B/auth/logout > /dev/null
  chk "login_required afterwards" "login_required" "$(curl -s "${H[@]}" -H 'X-Device-ID: dev-logout' -H "X-Client-Token: $T4" -X POST $B/auth/check | jget 'j.status')"
  chk "no session rows left" "0" "$(sql "SELECT count(*) FROM sessions s JOIN devices d ON d.id=s.device_id WHERE d.device_id='dev-logout'")"

  echo "11. logging in rotates the token"
  R=$(curl -s -c $J -b $J "${H[@]}" -H 'X-Device-ID: dev-admin' -H "X-Client-Token: $TOK" -X POST $B/auth/login -d '{"username":"admin","password":"supersecret1"}')
  TOK3=$(echo "$R" | jget 'j.client_token')
  chk "new token differs" "yes" "$([ -n "$TOK3" ] && [ "$TOK3" != "$TOK" ] && echo yes || echo no)"
  chk "old token rejected" "code_required" "$(curl -s "${H[@]}" -H 'X-Device-ID: dev-admin' -H "X-Client-Token: $TOK" -X POST $B/auth/check | jget 'j.status')"
  chk "new token works" "auto_login" "$(curl -s "${H[@]}" -H 'X-Device-ID: dev-admin' -H "X-Client-Token: $TOK3" -X POST $B/auth/check | jget 'j.status')"

  echo "12. the IP address plays no part"
  chk "token from a different IP works" "auto_login" "$(curl -s "${H[@]}" -H 'X-Forwarded-For: 203.0.113.9' -H 'X-Device-ID: dev-admin' -H "X-Client-Token: $TOK3" -X POST $B/auth/check | jget 'j.status')"

  echo "13. database state"
  chk "no plaintext token stored" "0" "$(sql "SELECT count(*) FROM devices WHERE client_token_hash = '$TOK3'")"
  chk "grandfathered device authorised" "t" "$(sql "SELECT authorized FROM devices WHERE device_id='dev-grandfathered'")"
  chk "stranger device never recorded" "0" "$(sql "SELECT count(*) FROM devices WHERE device_id='dev-stranger'")"
else
  echo "  SKIP  steps 8-13 (psql not found)"
fi

echo
echo "passed: $pass   failed: $fail"
[ "$fail" -eq 0 ]