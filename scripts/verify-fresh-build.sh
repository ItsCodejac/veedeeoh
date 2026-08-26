#!/usr/bin/env bash
#
# Build a database from supabase/migrations alone and check that it works.
#
# WHY. For most of this project's life the migrations could not build anything:
# seven tables were created by hand against the live project and every migration
# ALTERed something no migration had created. Nobody noticed, because migrations
# were only ever applied to a database that already had those tables. Running
# them against production proves nothing. This runs them against an empty one.
#
#   bash scripts/verify-fresh-build.sh
#
# It starts a throwaway Postgres in a temp directory on port 55432, applies the
# Supabase shim and then every migration in filename order, runs the smoke test,
# and stops the cluster. It touches no service on this machine and no remote
# database. Needs initdb and psql on PATH (brew install postgresql@14).
#
# Exit status is 0 only if every migration applied and every smoke check passed.

set -euo pipefail
cd "$(dirname "$0")/.."

PORT=55432
DATA="$(mktemp -d)/pgdata"
LOG="$DATA.log"

cleanup() { pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; }
trap cleanup EXIT

command -v initdb >/dev/null || { echo "initdb not on PATH -- brew install postgresql@14"; exit 1; }

printf '\n  building a database from migrations only\n\n'

initdb -D "$DATA" -U postgres --auth=trust >/dev/null 2>&1

# TCP only: the socket path under a temp dir routinely exceeds the 103-byte
# limit Postgres allows for a unix socket, and the failure is opaque.
pg_ctl -D "$DATA" -o "-p $PORT -c unix_socket_directories=" -l "$LOG" start >/dev/null 2>&1
for _ in $(seq 1 20); do pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break; sleep 0.5; done
pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null || { echo "postgres did not start:"; tail -5 "$LOG"; exit 1; }

export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
psql -q -c "create database fresh" postgres >/dev/null
psql -q -v ON_ERROR_STOP=1 -d fresh -f scripts/sql/supabase-shim.sql >/dev/null

n=0
for f in supabase/migrations/*.sql; do
  if psql -q -v ON_ERROR_STOP=1 -d fresh -f "$f" >/dev/null 2>/tmp/vfb.err; then
    n=$((n+1))
  else
    printf '  FAILED on %s\n\n' "$(basename "$f")"
    grep -E "ERROR" /tmp/vfb.err | head -3
    exit 1
  fi
done
printf '  %d migrations applied\n\n' "$n"

# Run once and keep the output. The smoke test inserts fixed user ids, so a
# second run against the same database fails on the primary key rather than on
# anything real.
out="$(psql -q -At -v ON_ERROR_STOP=1 -d fresh -f scripts/sql/verify-fresh-build.sql 2>&1 || true)"
printf '%s\n' "$out" | grep -E "PASS|FAIL" | sed 's/^.*NOTICE:  //; s/^/  /'

printf '\n'
if printf '%s' "$out" | grep -q FAIL; then
  echo "  smoke test FAILED"; exit 1
fi
echo "  fresh build verified"
