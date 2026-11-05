#!/usr/bin/env bash
# Apply every migration, including People, on a throwaway local database and
# run the M0 behaviour checks. Does not touch a hosted Supabase project.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
db="${ORBIT_M0_DB:-orbit_m0}"

sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"${db}\";"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${db}\";"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/scripts/sql/orbit-m0-harness-pre.sql"
for file in "$root"/supabase/migrations/*.sql; do
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$file"
done
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/scripts/sql/orbit-m0-harness-post.sql"
if [[ -f "$root/scripts/sql/orbit-office-checks.sql" ]]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$db" -f "$root/scripts/sql/orbit-office-checks.sql"
fi
