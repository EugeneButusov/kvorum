#!/usr/bin/env bash
# collect-backfill-results.sh
#
# Queries Postgres (and optionally ClickHouse) after the M1 Compound backfill
# and patches docs/runbooks/m1-backfill.md in-place with real values.
#
# Usage:
#   DAO_SOURCE_ID=<uuid> ./infra/scripts/collect-backfill-results.sh
#
# Requires:
#   DATABASE_URL, DAO_SOURCE_ID
#   psql, curl (for ClickHouse HTTP), admin-cli on PATH
#
# ClickHouse defaults to localhost:8123 (docker-compose defaults).
# Override with: CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE

set -euo pipefail

RUNBOOK="$(git rev-parse --show-toplevel)/docs/runbooks/m1-backfill.md"

# ── helpers ───────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

psql_val() {
  psql "$DATABASE_URL" -Atc "$1" 2>/dev/null || echo "N/A"
}

ch_val() {
  local query="$1"
  local url="${CLICKHOUSE_URL:-http://localhost:8123}"
  local user="${CLICKHOUSE_USER:-default}"
  local pass="${CLICKHOUSE_PASSWORD:-}"
  local db="${CLICKHOUSE_DATABASE:-default}"
  curl -sf --user "${user}:${pass}" \
    "${url}/?database=${db}&query=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$query")" \
    2>/dev/null || echo "N/A (ClickHouse unreachable)"
}

sed_inplace() {
  # portable sed -i for both GNU and BSD
  if sed --version 2>/dev/null | grep -q GNU; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

patch_runbook() {
  local pattern="$1"
  local replacement="$2"
  sed_inplace "s|${pattern}|${replacement}|g" "$RUNBOOK"
}

# ── pre-flight ────────────────────────────────────────────────────────────────

[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is not set"
[[ -n "${DAO_SOURCE_ID:-}" ]] || die "DAO_SOURCE_ID is not set"
[[ -f "$RUNBOOK" ]] || die "Runbook not found at $RUNBOOK"

psql "$DATABASE_URL" -Atc "SELECT 1" >/dev/null 2>&1 \
  || die "Cannot connect to Postgres — check DATABASE_URL (current value: ${DATABASE_URL})"

echo "Collecting backfill results for dao_source $DAO_SOURCE_ID ..."
echo

# ── 1. backfill status (direct dao_source query) ─────────────────────────────
# admin-cli backfill status was removed; query the table directly.
# Columns: backfill_started_at_block (cleared on drain), backfill_head_block (last checkpoint).

DS_ROW=$(psql_val "SELECT coalesce(backfill_head_block::text,'null')||'|'||coalesce(backfill_started_at_block::text,'null') FROM dao_source WHERE id='${DAO_SOURCE_ID}'")
BACKFILL_HEAD=$(echo "$DS_ROW" | cut -d'|' -f1)
BACKFILL_STARTED=$(echo "$DS_ROW" | cut -d'|' -f2)

if [[ "$DS_ROW" == "N/A" ]]; then
  DRAIN_STATUS="N/A (DB query failed)"
elif [[ "$BACKFILL_HEAD" == "null" ]]; then
  DRAIN_STATUS="never started (backfill_head_block is null)"
elif [[ "$BACKFILL_STARTED" == "null" ]]; then
  DRAIN_STATUS="drained — backfill_started_at_block cleared (head=$BACKFILL_HEAD)"
else
  DRAIN_STATUS="in progress — started=$BACKFILL_STARTED head=$BACKFILL_HEAD"
fi

# ── 2. archive counts ─────────────────────────────────────────────────────────

ARCHIVED=$(psql_val "SELECT count(*) FROM archive_confirmation WHERE source_type='compound_governor'")
DERIVED=$(psql_val  "SELECT count(*) FROM proposal           WHERE source_type='compound_governor'")
BACKLOG=$(psql_val  "SELECT (SELECT count(*) FROM archive_confirmation WHERE source_type='compound_governor')
                           - (SELECT count(*) FROM proposal           WHERE source_type='compound_governor')")

# ── 3. decode rate ────────────────────────────────────────────────────────────

DECODE_STATS=$(psql_val "
  SELECT
    count(*) FILTER (WHERE pa.decoded_function IS NOT NULL)::text || ' / ' || count(*)::text AS ratio,
    round(100.0 * count(*) FILTER (WHERE pa.decoded_function IS NOT NULL) / nullif(count(*),0), 2)::text || '%' AS pct
  FROM proposal_action pa
  JOIN proposal p ON p.id = pa.proposal_id
  WHERE p.source_type = 'compound_governor'
    AND p.state IN ('executed','defeated','canceled','expired')")
DECODE_RATIO=$(echo "$DECODE_STATS" | awk -F'|' '{print $1}' | xargs)
DECODE_PCT=$(echo   "$DECODE_STATS" | awk -F'|' '{print $2}' | xargs)

UNDECODED_NO_ATTEMPT=$(psql_val "
  SELECT count(*)
  FROM proposal_action pa
  JOIN proposal p ON p.id = pa.proposal_id
  WHERE p.source_type = 'compound_governor'
    AND pa.decode_attempt_count = 0")

# ── 4. DLQ ───────────────────────────────────────────────────────────────────

DLQ_SIZE=$(psql_val "SELECT count(*) FROM dlq WHERE source_type='compound_governor'")

# ── 5. duplicate proposals ───────────────────────────────────────────────────

DUPE_ROWS=$(psql_val "
  SELECT count(*)
  FROM (
    SELECT source_type, source_id
    FROM proposal
    WHERE source_type='compound_governor'
    GROUP BY 1,2
    HAVING count(*) > 1
  ) t")
DUPES_OK=$([[ "$DUPE_ROWS" == "0" ]] && echo "yes — 0 duplicate rows" || echo "FAIL — $DUPE_ROWS duplicate source_ids")

# ── 6. ClickHouse count ───────────────────────────────────────────────────────

CH_COUNT=$(ch_val "SELECT count() FROM event_archive_compound_governor FINAL")
CH_COUNT=$(echo "$CH_COUNT" | tr -d '[:space:]')

if [[ "$CH_COUNT" =~ ^[0-9]+$ && "$ARCHIVED" =~ ^[0-9]+$ && "$DLQ_SIZE" =~ ^[0-9]+$ ]]; then
  DELTA=$(( CH_COUNT - ARCHIVED ))
  if [[ "$DELTA" -eq "$DLQ_SIZE" ]]; then
    CH_PG_OK="yes (CH=$CH_COUNT PG=$ARCHIVED DLQ=$DLQ_SIZE delta=$DELTA)"
  else
    CH_PG_OK="FAIL (CH=$CH_COUNT PG=$ARCHIVED DLQ=$DLQ_SIZE delta=$DELTA expected=$DLQ_SIZE)"
  fi
else
  CH_PG_OK="CH=$CH_COUNT PG=$ARCHIVED DLQ=$DLQ_SIZE — verify manually"
fi

# ── 7. admin-cli status ───────────────────────────────────────────────────────

STATUS_JSON=$(admin-cli status --format json 2>/dev/null || echo '{}')
IDLE_SECS=$(echo "$STATUS_JSON"         | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ingestion_idle_for_seconds','N/A'))" 2>/dev/null || echo "N/A")
LAST_ARCHIVED=$(echo "$STATUS_JSON"     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('last_archived_event_at','N/A'))"    2>/dev/null || echo "N/A")
LAST_REORG=$(echo "$STATUS_JSON"        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('last_reorg_detected_at','N/A'))"    2>/dev/null || echo "N/A")

# ── print summary ─────────────────────────────────────────────────────────────

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=== Collected at $NOW ==="
echo
echo "Backfill"
echo "  backfill_head_block   : $BACKFILL_HEAD"
echo "  backfill_started_at   : $BACKFILL_STARTED"
echo "  drain status          : $DRAIN_STATUS"
echo
echo "Archive / derivation"
echo "  archived (PG)       : $ARCHIVED"
echo "  derived (proposal)  : $DERIVED"
echo "  backlog             : $BACKLOG"
echo
echo "Decode"
echo "  action decode ratio : $DECODE_RATIO"
echo "  action decode rate  : $DECODE_PCT"
echo "  undecoded no-attempt: $UNDECODED_NO_ATTEMPT"
echo
echo "DLQ"
echo "  dlq_size            : $DLQ_SIZE"
echo
echo "Duplicates"
echo "  zero duplicate rows : $DUPES_OK"
echo
echo "CH / PG integrity"
echo "  CH count (FINAL)    : $CH_COUNT"
echo "  CH >= PG, delta==DLQ: $CH_PG_OK"
echo
echo "admin-cli status"
echo "  idle_secs           : $IDLE_SECS"
echo "  last_archived_at    : $LAST_ARCHIVED"
echo "  last_reorg_at       : $LAST_REORG"
echo

# ── patch runbook ─────────────────────────────────────────────────────────────

read -r -p "Patch runbook at $RUNBOOK with these values? [y/N] " CONFIRM
if [[ "${CONFIRM,,}" != "y" ]]; then
  echo "Skipped. Copy values above manually."
  exit 0
fi

# Run results table
patch_runbook '_(timestamp)_.*Run started at'           "_(fill in)_ | Run started at"  # timestamps are manual
patch_runbook '_\(block\)_.*backfill_head_block'        "${BACKFILL_HEAD}"
patch_runbook '_\(yes\/no\)_.*drain status'             "${DRAIN_STATUS}"
patch_runbook '_\(count\)_.*DLQ entries'                "${DLQ_SIZE}"

# Acceptance tables
patch_runbook '| CH count (FINAL)                |       |'  "| CH count (FINAL)                | ${CH_COUNT} |"
patch_runbook '| PG count                        |       |'  "| PG count                        | ${ARCHIVED} |"
patch_runbook '| DLQ size                        |       |'  "| DLQ size                        | ${DLQ_SIZE} |"
patch_runbook '| CH >= PG.*delta.*DLQ.*|       |'            "| CH >= PG AND (CH − PG) == DLQ?  | ${CH_PG_OK} |"

# Decode rate
patch_runbook '| Action-level decode rate |       |' "| Action-level decode rate | ${DECODE_PCT} (${DECODE_RATIO}) |"

echo
echo "Runbook patched. Review with: git diff $RUNBOOK"
echo
echo "NOTE: Fill these manually in the runbook (require human judgement or mid-run capture):"
echo "  - Run started/completed timestamps and wall-clock duration"
echo "  - Crash-resume performed? (yes/no + output)"
echo "  - RPC provider failovers observed"
echo "  - Acceptance #1: API paginated count + REF_BRAVO_BINDING gate check"
echo "  - Acceptance #2: new proposal observed? (post-drain poller window)"
echo "  - Known-proposal sanity: Tally/Etherscan cross-check values"
echo "  - Drain polling table (3 × poll rows)"
