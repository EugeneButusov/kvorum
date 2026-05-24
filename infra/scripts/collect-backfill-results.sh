#!/usr/bin/env bash
# collect-backfill-results.sh
#
# Queries Postgres (and optionally ClickHouse) after the M1 Compound backfill
# and patches docs/runbooks/m1-backfill.md in-place with real values.
#
# Usage:
#   DAO_SLUG=compound ./infra/scripts/collect-backfill-results.sh
#
# Requires:
#   DATABASE_URL, DAO_SLUG (defaults to "compound")
#   docker (postgres queries run via docker exec), curl (ClickHouse + API)
# Optional:
#   API_KEY   — Bearer token for authenticated API checks (skipped if unset)
#   API_URL   — override API base URL (default: http://localhost:API_PORT)
#
# ClickHouse defaults to localhost:8123 (docker-compose defaults).
# Override with: CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE

set -euo pipefail

RUNBOOK="$(git rev-parse --show-toplevel)/docs/runbooks/m1-backfill.md"

# ── helpers ───────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

# Extract Postgres connection params from DATABASE_URL for docker exec.
# Uses docker exec into the compose postgres container — no psql install needed.
_PG_CONTAINER="$(docker compose ps -q postgres 2>/dev/null || true)"
_PG_USER="$(python3 -c "from urllib.parse import urlparse; print(urlparse('${DATABASE_URL%%\?*}').username or 'postgres')" 2>/dev/null || echo 'postgres')"
_PG_DB="$(python3 -c "from urllib.parse import urlparse; print(urlparse('${DATABASE_URL%%\?*}').path.lstrip('/') or 'postgres')" 2>/dev/null || echo 'postgres')"

psql_val() {
  [[ -n "$_PG_CONTAINER" ]] || { echo "N/A"; return; }
  docker exec -i "$_PG_CONTAINER" psql -U "$_PG_USER" -d "$_PG_DB" -Atc "$1" 2>/dev/null || echo "N/A"
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
  sed_inplace "s~${pattern}~${replacement}~g" "$RUNBOOK"
}

# ── pre-flight ────────────────────────────────────────────────────────────────

[[ -n "${DATABASE_URL:-}" ]] || die "DATABASE_URL is not set"
DAO_SLUG="${DAO_SLUG:-compound}"
[[ -f "$RUNBOOK" ]] || die "Runbook not found at $RUNBOOK"

[[ -n "$_PG_CONTAINER" ]] \
  || die "Postgres container not found — is 'just up' running? (docker compose ps -q postgres returned empty)"
docker exec -i "$_PG_CONTAINER" psql -U "$_PG_USER" -d "$_PG_DB" -Atc "SELECT 1" >/dev/null 2>&1 \
  || die "Postgres container found but psql query failed (container: ${_PG_CONTAINER})"

echo "Collecting backfill results for dao_slug=$DAO_SLUG ..."
echo

# ── 1. backfill status (direct dao_source query) ─────────────────────────────
# admin-cli backfill status was removed; query the table directly.
# Columns: backfill_started_at_block (cleared on drain), backfill_head_block (last checkpoint).

DS_ROW=$(psql_val "SELECT coalesce(ds.backfill_head_block::text,'null')||'|'||coalesce(ds.backfill_started_at_block::text,'null') FROM dao_source ds JOIN dao d ON d.id=ds.dao_id WHERE d.slug='${DAO_SLUG}' AND ds.source_type='compound_governor_bravo'")
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

ARCHIVED=$(psql_val "SELECT count(*) FROM archive_confirmation WHERE source_type='compound_governor_bravo'")
DERIVED=$(psql_val  "SELECT count(*) FROM proposal           WHERE source_type='compound_governor_bravo'")
BACKLOG=$(psql_val  "SELECT (SELECT count(*) FROM archive_confirmation WHERE source_type='compound_governor_bravo')
                           - (SELECT count(*) FROM proposal           WHERE source_type='compound_governor_bravo')")

# ── 3. decode rate ────────────────────────────────────────────────────────────

DECODE_STATS=$(psql_val "
  SELECT
    count(*) FILTER (WHERE pa.decoded_function IS NOT NULL)::text || ' / ' || count(*)::text AS ratio,
    round(100.0 * count(*) FILTER (WHERE pa.decoded_function IS NOT NULL) / nullif(count(*),0), 2)::text || '%' AS pct
  FROM proposal_action pa
  JOIN proposal p ON p.id = pa.proposal_id
  WHERE p.source_type = 'compound_governor_bravo'
    AND p.state IN ('executed','defeated','canceled','expired')")
DECODE_RATIO=$(echo "$DECODE_STATS" | awk -F'|' '{print $1}' | xargs)
DECODE_PCT=$(echo   "$DECODE_STATS" | awk -F'|' '{print $2}' | xargs)

UNDECODED_NO_ATTEMPT=$(psql_val "
  SELECT count(*)
  FROM proposal_action pa
  JOIN proposal p ON p.id = pa.proposal_id
  WHERE p.source_type = 'compound_governor_bravo'
    AND pa.decode_attempt_count = 0")

# ── 4. DLQ ───────────────────────────────────────────────────────────────────

DLQ_SIZE=$(psql_val "SELECT count(*) FROM ingestion_dlq WHERE archive_source_type='compound_governor_bravo'")

# ── 5. duplicate proposals ───────────────────────────────────────────────────

DUPE_ROWS=$(psql_val "
  SELECT count(*)
  FROM (
    SELECT source_type, source_id
    FROM proposal
    WHERE source_type='compound_governor_bravo'
    GROUP BY 1,2
    HAVING count(*) > 1
  ) t")
DUPES_OK=$([[ "$DUPE_ROWS" == "0" ]] && echo "yes — 0 duplicate rows" || echo "FAIL — $DUPE_ROWS duplicate source_ids")

# ── 6. ClickHouse count ───────────────────────────────────────────────────────

CH_COUNT=$(ch_val "SELECT count() FROM archive_event_compound_governor_bravo FINAL")
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

# ── 7. system status (direct SQL — admin-cli may not be on PATH) ─────────────

LAST_ARCHIVED=$(psql_val "SELECT max(received_at) FROM archive_event WHERE source_type='compound_governor_bravo'")
IDLE_SECS=$(psql_val     "SELECT extract(epoch FROM (now() - max(received_at)))::int FROM archive_event WHERE source_type='compound_governor_bravo'")

# ── 8. API spot-checks ───────────────────────────────────────────────────────
# Requires API_KEY env var (Bearer token). Authenticated checks are skipped if unset.

API_BASE="${API_URL:-http://localhost:${API_PORT:-3001}}"

api_get() {
  local path="$1"
  if [[ -n "${API_KEY:-}" ]]; then
    curl -sf -H "Authorization: Bearer ${API_KEY}" "${API_BASE}${path}" 2>/dev/null || echo 'ERROR'
  else
    curl -sf "${API_BASE}${path}" 2>/dev/null || echo 'ERROR'
  fi
}

py_field() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null || echo "N/A"; }

_HEALTH_JSON=$(api_get "/health")
API_HEALTH=$(echo "$_HEALTH_JSON" | py_field "d.get('status','N/A')")

if [[ -z "${API_KEY:-}" ]]; then
  API_DAO_SLUG="skipped (API_KEY not set)"
  API_DAO_SOURCES="skipped"
  API_PROP_FIRST="skipped"
  API_PROP_HAS_MORE="skipped"
  API_BINDING_OK="skipped"
  API_PROP_TOTAL="skipped"
elif [[ "$API_HEALTH" == "ok" ]]; then
  _DAO_JSON=$(api_get "/v1/daos/${DAO_SLUG}")
  API_DAO_SLUG=$(echo "$_DAO_JSON"    | py_field "d['data'].get('slug','N/A')")
  API_DAO_SOURCES=$(echo "$_DAO_JSON" | py_field "','.join(s['source_type'] for s in d['data'].get('sources',[]))")

  _PROP_JSON=$(api_get "/v1/daos/${DAO_SLUG}/proposals?limit=1")
  API_PROP_FIRST=$(echo "$_PROP_JSON"    | py_field "d['data'][0]['source_id'] if d.get('data') else 'none'")
  API_PROP_HAS_MORE=$(echo "$_PROP_JSON" | py_field "d.get('pagination',{}).get('has_more','N/A')")

  _BIND_JSON=$(api_get "/v1/daos/${DAO_SLUG}/proposals?binding=true&limit=1")
  API_BINDING_OK=$(echo "$_BIND_JSON" | py_field "'yes' if d.get('data') else 'no — 0 binding proposals returned'")

  echo "  (paginating proposals via API...)" >&2
  API_PROP_TOTAL=$(python3 - <<PYEOF
import urllib.request, urllib.parse, json, sys

base   = "${API_BASE}"
slug   = "${DAO_SLUG}"
key    = "${API_KEY:-}"
total  = 0
cursor = None
pages  = 0

while True:
    params = {"limit": "100"}
    if cursor:
        params["cursor"] = cursor
    url = f"{base}/v1/daos/{slug}/proposals?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"} if key else {})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = json.loads(r.read())
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        print("N/A")
        sys.exit(0)
    total += len(body.get("data", []))
    pages += 1
    pag = body.get("pagination", {})
    if not pag.get("has_more"):
        break
    cursor = pag.get("next_cursor")

print(total)
PYEOF
)
else
  API_DAO_SLUG="N/A (health=$API_HEALTH)"
  API_DAO_SOURCES="N/A"
  API_PROP_FIRST="N/A"
  API_PROP_HAS_MORE="N/A"
  API_BINDING_OK="N/A"
  API_PROP_TOTAL="N/A"
fi

if [[ "$API_PROP_TOTAL" =~ ^[0-9]+$ && "$DERIVED" =~ ^[0-9]+$ ]]; then
  if [[ "$API_PROP_TOTAL" -eq "$DERIVED" ]]; then
    API_VS_DB="yes — API=$API_PROP_TOTAL DB=$DERIVED"
  else
    API_VS_DB="MISMATCH — API=$API_PROP_TOTAL DB=$DERIVED delta=$(( API_PROP_TOTAL - DERIVED ))"
  fi
else
  API_VS_DB="API=$API_PROP_TOTAL DB=$DERIVED — verify manually"
fi

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
echo "API ($API_BASE)"
echo "  health              : $API_HEALTH"
echo "  dao slug            : $API_DAO_SLUG"
echo "  dao sources         : $API_DAO_SOURCES"
echo "  first proposal id   : $API_PROP_FIRST"
echo "  has_more proposals  : $API_PROP_HAS_MORE"
echo "  binding filter ok   : $API_BINDING_OK"
echo "  total proposals     : $API_PROP_TOTAL"
echo "  API count == DB     : $API_VS_DB"
echo

# ── patch runbook ─────────────────────────────────────────────────────────────

read -r -p "Patch runbook at $RUNBOOK with these values? [y/N] " CONFIRM
if [[ "$(echo "$CONFIRM" | tr '[:upper:]' '[:lower:]')" != "y" ]]; then
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
