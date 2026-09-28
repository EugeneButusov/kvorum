#!/bin/sh
set -eu
OUT=/backup
rm -rf "$OUT"/* 2>/dev/null || true

echo "[dump] postgres"
# `uselibpqcompat` belongs to node-postgres, not libpq. Strip it so the backup
# component accepts either the old managed-Postgres URL or the in-cluster URL.
PG_URL=$(printf '%s' "$DATABASE_URL" \
  | sed -e 's/uselibpqcompat=true//' -e 's/&&/\&/g' -e 's/?&/?/' -e 's/[?&]$//')
pg_dump -Fc --no-owner --no-privileges -f "$OUT/postgres.dump" "$PG_URL"
unset PG_URL

# ClickHouse over the HTTP interface. Only *MergeTree tables hold data — the
# projection VIEWs and the MVs are derived and rebuild from these on restore.
#
# busybox wget, not curl: postgres:*-alpine ships no curl, and installing one at job
# runtime would add a network dependency to the backup path. Credentials go in headers
# rather than the URL so they stay out of process args and logs.
CH_Q() {
  wget -q -O- \
    --header="X-ClickHouse-User: $CLICKHOUSE_USER" \
    --header="X-ClickHouse-Key: $CLICKHOUSE_PASSWORD" \
    --post-data="$1" \
    "$CLICKHOUSE_URL/?database=$CLICKHOUSE_DATABASE"
}

echo "[dump] clickhouse table list"
CH_Q "SELECT name FROM system.tables WHERE database = '$CLICKHOUSE_DATABASE' \
  AND engine LIKE '%MergeTree' \
  AND name NOT IN ('_migrations', 'vote_events_agg', 'delegation_flow_agg') \
  ORDER BY name FORMAT TabSeparated" > "$OUT/ch-tables.txt"
wc -l < "$OUT/ch-tables.txt" | tr -d ' ' | xargs echo "[dump] clickhouse tables:"

while IFS= read -r t; do
  [ -n "$t" ] || continue
  # Large forum payloads exceed the single-node memory ceiling if emitted as one
  # Native block. Restore consumes a file containing many small blocks incrementally.
  CH_Q "SELECT * FROM \`$t\` SETTINGS max_block_size=256 FORMAT Native" > "$OUT/ch__$t.native"
done < "$OUT/ch-tables.txt"

echo "[dump] compressing"
gzip -f "$OUT"/*.dump "$OUT"/*.native
ls -la "$OUT"
