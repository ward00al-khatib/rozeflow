#!/usr/bin/env bash
# Applies all migrations to an empty PostgreSQL database and runs the schema checks.
# Needs DATABASE_URL pointing at a throwaway database (CI provides one).
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to an empty test database}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/auth_stub.sql
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
for f in supabase/tests/*_test.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
