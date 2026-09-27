#!/usr/bin/env bash
#
# Deploys a built image to the single-node k3s host. Runs ON the host — CI copies the
# manifests here and invokes this over SSH, and a manual deploy runs the same script, so
# there is one code path rather than a workflow and a divergent runbook snippet.
#
#   ./deploy.sh ghcr.io/<owner>/kvorum:<sha>
#
# Expects the prod overlay to already reference that image: CI runs `kustomize edit set
# image` before copying, which keeps kustomize off the host. The check below fails loudly
# rather than deploying a different tag than the one requested.
set -euo pipefail

IMAGE="${1:-}"
if [[ -z "$IMAGE" ]]; then
  echo "usage: deploy.sh <image-ref>" >&2
  exit 64
fi

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K8S="$INFRA_DIR/k8s"
OVERLAY="$K8S/overlays/prod"
NS=kvorum

# k3s writes its kubeconfig here; override for any other cluster.
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

MIGRATE_TIMEOUT="${MIGRATE_TIMEOUT:-300s}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-180s}"

log() { printf '\n=== %s\n' "$*"; }

log "target"
echo "  image:      $IMAGE"
echo "  kubeconfig: $KUBECONFIG"
kubectl version -o json 2>/dev/null | sed -n 's/.*"gitVersion": "\(v[^"]*\)".*/  server:     \1/p' | tail -1 || true

# Guard against deploying something other than what was asked for. Checked against the
# RENDERED output, not the kustomization source: the tag alone is not enough, because an
# edit that sets newTag but not newName leaves the image pointing at the placeholder
# registry path while still matching on tag.
log "verifying the overlay renders the requested image"
if ! kubectl kustomize "$OVERLAY" | grep -qF "image: ${IMAGE}"; then
  echo "ERROR: $OVERLAY does not render ${IMAGE}" >&2
  echo "       it currently renders:" >&2
  kubectl kustomize "$OVERLAY" | grep -oE 'image: [^ ]+' | sort -u | sed 's/^/         /' >&2
  echo "       fix with: (cd $OVERLAY && kustomize edit set image ghcr.io/kvorum/kvorum=$IMAGE)" >&2
  exit 1
fi
echo "  ok"

# First-deploy bootstrap: the migrate Job envFrom's kvorum-config, which is otherwise
# created only by the later `apply -k`. On a fresh cluster the gate would fail with
# CreateContainerConfigError. Idempotent — `apply -k` re-adopts both afterwards.
log "bootstrapping namespace and config"
kubectl apply -f "$OVERLAY/namespace.yaml"
kubectl -n "$NS" apply -f "$K8S/base/configmap.yaml"

# The gate: a failed migration must abort before any Deployment rolls, so code never runs
# against an un-migrated schema.
log "running migrations (deploy gate)"
kubectl -n "$NS" delete job kvorum-migrate --ignore-not-found
sed "s#ghcr.io/kvorum/kvorum:latest#${IMAGE}#" "$K8S/base/migrate-job.yaml" \
  | kubectl -n "$NS" apply -f -

if ! kubectl -n "$NS" wait --for=condition=complete "job/kvorum-migrate" --timeout="$MIGRATE_TIMEOUT"; then
  echo "ERROR: migration job did not complete — aborting deploy" >&2
  kubectl -n "$NS" logs "job/kvorum-migrate" --tail=200 >&2 || true
  kubectl -n "$NS" describe "job/kvorum-migrate" >&2 || true
  exit 1
fi

log "applying manifests"
kubectl apply -k "$OVERLAY"

log "waiting for rollout"
for d in kvorum-api kvorum-indexer kvorum-ai-worker kvorum-dashboard; do
  kubectl -n "$NS" rollout status "deploy/$d" --timeout="$ROLLOUT_TIMEOUT"
done

log "deployed $IMAGE"
