#!/usr/bin/env bash
#
# Builds `kvorum-secrets` on the new single-node cluster from the old one, so nothing is
# transcribed by hand. Three classes of key:
#
#   carried   copied verbatim from the old cluster (API keys, peppers, CHAIN_CONFIG, …)
#   derived   in-cluster datastore values, generated here — DATABASE_URL is composed from
#             the same generated password the StatefulSet initialises with, which is the
#             one pairing that silently breaks if a human does it
#   supplied  values only you have: the R2 token and the new tunnel token
#
# Usage:
#   R2_BUCKET=kvorum-backups \
#   R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com \
#   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... TUNNEL_TOKEN=... \
#   OLD_CONTEXT=do-fra1-kvorum-prod NEW_CONTEXT=kvorum-k3s \
#     ./infra/scripts/migration-secret.sh
#
# Missing `supplied` values are prompted for when attached to a terminal, and are an error
# otherwise. No secret value is ever printed or logged.
set -euo pipefail

OLD_CONTEXT="${OLD_CONTEXT:?set OLD_CONTEXT (see: kubectl config get-contexts)}"
NEW_CONTEXT="${NEW_CONTEXT:?set NEW_CONTEXT}"
OLD_NAMESPACE="${OLD_NAMESPACE:-kvorum}"
NEW_NAMESPACE="${NEW_NAMESPACE:-kvorum}"
SECRET=kvorum-secrets

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXAMPLE="$REPO_ROOT/infra/k8s/overlays/prod/secret.example.yaml"

# Keys taken verbatim from the old cluster.
CARRIED=(
  REDIS_URL CURSOR_SECRET HMAC_PEPPER_CURRENT INTERNAL_READ_TOKEN CHAIN_CONFIG
  SNAPSHOT_API_KEY ETHERSCAN_API_KEY ANTHROPIC_API_KEY OPENAI_API_KEY GRAFANA_ADMIN_PASSWORD
)
# Keys you must provide. TUNNEL_TOKEN is listed here because the new host needs its OWN
# tunnel: a second connector on the old one would load-balance the live hostnames across
# both clusters and serve half the traffic from an empty database.
SUPPLIED=(R2_BUCKET R2_ENDPOINT R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY TUNNEL_TOKEN)

log() { printf '%s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

for ctx in "$OLD_CONTEXT" "$NEW_CONTEXT"; do
  kubectl config get-contexts -o name | grep -qx "$ctx" || die "no such context: $ctx"
done
[[ "$OLD_CONTEXT" != "$NEW_CONTEXT" || "$OLD_NAMESPACE" != "$NEW_NAMESPACE" ]] \
  || die "source and target are the same cluster+namespace"

# Refuse to clobber. Re-running after Postgres has initialised would set a password that no
# longer matches the database, and the failure surfaces much later as an auth error.
if kubectl --context="$NEW_CONTEXT" -n "$NEW_NAMESPACE" get secret "$SECRET" >/dev/null 2>&1; then
  [[ "${FORCE:-}" == "1" ]] || die "$SECRET already exists in $NEW_CONTEXT/$NEW_NAMESPACE.
       If Postgres has already initialised, regenerating POSTGRES_PASSWORD will lock you out
       of the existing volume. Re-run with FORCE=1 only if the datastores are still empty."
  log "!! FORCE=1 — overwriting an existing secret"
fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
umask 077

log "== reading carried keys from $OLD_CONTEXT/$OLD_NAMESPACE"
kubectl --context="$OLD_CONTEXT" -n "$OLD_NAMESPACE" get secret "$SECRET" -o json > "$WORK/old.json" \
  || die "could not read $SECRET from $OLD_CONTEXT/$OLD_NAMESPACE"

args=()
for k in "${CARRIED[@]}"; do
  if ! v="$(python3 -c '
import base64, json, sys
d = json.load(open(sys.argv[1]))["data"]
k = sys.argv[2]
sys.stdout.write(base64.b64decode(d[k]).decode()) if k in d else sys.exit(3)
' "$WORK/old.json" "$k")"; then
    die "carried key $k is absent from the old secret — add it by hand or fix CARRIED"
  fi
  printf '%s' "$v" > "$WORK/$k"
  args+=("--from-file=$k=$WORK/$k")
  log "   carried  $k"
done

log "== generating datastore credentials"
PGPW="$(openssl rand -hex 24)"
CHPW="$(openssl rand -hex 24)"
add_literal() { printf '%s' "$2" > "$WORK/$1"; args+=("--from-file=$1=$WORK/$1"); log "   derived  $1"; }
add_literal POSTGRES_USER       "kvorum"
add_literal POSTGRES_PASSWORD   "$PGPW"
add_literal DATABASE_URL        "postgresql://kvorum:${PGPW}@kvorum-postgres.kvorum:5432/kvorum"
add_literal CLICKHOUSE_USER     "kvorum"
add_literal CLICKHOUSE_PASSWORD "$CHPW"
add_literal CLICKHOUSE_URL      "http://kvorum-clickhouse.kvorum:8123"
add_literal CLICKHOUSE_DATABASE "kvorum"

log "== values only you have"
for k in "${SUPPLIED[@]}"; do
  v="${!k:-}"
  if [[ -z "$v" ]]; then
    [[ -t 0 ]] || die "$k is not set and there is no terminal to prompt from"
    read -r -s -p "   $k: " v; echo >&2
    [[ -n "$v" ]] || die "$k cannot be empty"
  fi
  printf '%s' "$v" > "$WORK/$k"
  args+=("--from-file=$k=$WORK/$k")
  log "   supplied $k"
done

log "== applying to $NEW_CONTEXT/$NEW_NAMESPACE"
kubectl --context="$NEW_CONTEXT" -n "$NEW_NAMESPACE" \
  create secret generic "$SECRET" "${args[@]}" --dry-run=client -o yaml \
  | kubectl --context="$NEW_CONTEXT" -n "$NEW_NAMESPACE" apply -f - >/dev/null

log "== verifying against the contract in secret.example.yaml"
# The contract file and the live secret are passed as ARGUMENTS to a script written to
# disk. `python3 -` with both a heredoc and a stdin redirect is ambiguous about which
# becomes the program, and a verification step that silently passes is worse than none.
kubectl --context="$NEW_CONTEXT" -n "$NEW_NAMESPACE" get secret "$SECRET" -o json > "$WORK/new.json"
cat > "$WORK/verify.py" <<'VERIFY_EOF'
import json, re, sys

want = set(re.findall(r'^  ([A-Z0-9_]+):', open(sys.argv[1]).read(), re.M))
have = set(json.load(open(sys.argv[2]))['data'])
missing, extra = sorted(want - have), sorted(have - want)
for k in missing:
    print(f'   MISSING  {k}')
for k in extra:
    print(f'   EXTRA    {k}')
print(f'   {len(have)} keys present, contract wants {len(want)}')
sys.exit(1 if missing else 0)
VERIFY_EOF
if ! python3 "$WORK/verify.py" "$EXAMPLE" "$WORK/new.json" >&2; then
  die "the secret does not satisfy the contract in secret.example.yaml"
fi

log ""
log "done. Datastore passwords exist only in the new cluster's secret — DATABASE_URL was"
log "composed from the same value the StatefulSet will initialise with, so they cannot diverge."
