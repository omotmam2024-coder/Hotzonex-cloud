#!/usr/bin/env bash
# Applies the migrations to a throwaway local Postgres DB and runs the lifecycle test.
# Usage: PGHOST=/var/run/postgresql PGUSER=postgres bash supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-hzc_test}"
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
for f in tests/supabase_stub.sql migrations/*.sql tests/lifecycle_test.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" 2>&1 | grep -v "wal_level\|HINT" || true
done
