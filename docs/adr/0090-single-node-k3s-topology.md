# ADR-0090 — Single-node k3s deployment topology

- **Status**: Accepted
- **Date**: 2026-09-27
- **Spec sections affected**: 7.1, 7.5, 7.7, 7.8
- **Related**: supersedes the deployment-topology and cost-envelope portions of [ADR-038](0038-clickhouse-archive-layer-in-m1.md) (its ClickHouse-layer decision stands, as refined by [ADR-0062](0062-ch-source-of-truth-for-derivations.md)); #673 (cost-reduction epic), #676/#677 (this topology's manifests), #681 (provisioning and cutover)

## Context

Kvorum is a demo deployment shown to the Compound and Aave teams. It is not revenue-generating and carries no availability commitment. It was nonetheless billed like a production system, at roughly **$93.56/month** of infrastructure plus up to $17/month of LLM spend:

| Line                              | Provider                                              | $/mo   |
| --------------------------------- | ----------------------------------------------------- | ------ |
| DOKS node pool (2× `s-1vcpu-2gb`) | DigitalOcean                                          | ~33.00 |
| Managed Postgres 18               | DigitalOcean                                          | ~13.56 |
| Managed ClickHouse                | Elestio                                               | ~27.00 |
| RPC (paid plan)                   | Alchemy                                               | 20.00  |
| Redis / ingress / registry / CI   | Upstash free, Cloudflare Tunnel, GHCR, GitHub Actions | 0.00   |

Nothing about the workload justifies that. ADR-038 sizes v1 at "~10 events/day post-backfill… ~10k rows/year" and says to revisit partitioning only past ~10M rows; SPEC §2.7 concedes ClickHouse is "technically optional" at three-DAO scale. The two managed datastore lines are fixed floors, not volume-driven — the dataset is orders of magnitude below anything that would move them.

Two documentation problems compound this. SPEC §7.1 and §7.8 describe a **single Hetzner CX32 running Docker Compose** with a €60/month ceiling, and ADR-038 reasons in terms of a CX32 → CX42 upgrade. That topology was never deployed: production has always been DOKS with external managed datastores. Anyone costing or capacity-planning this project from the SPEC gets the wrong answer, and `infra/caddy/Caddyfile` plus `docs/runbooks/caddy-deployment.md` survive as artifacts of the abandoned design (only `Caddyfile.dev` is still live, for local TLS testing via `docker-compose.dev.yml`).

## Decision

Run the whole deployment on **one DigitalOcean droplet (`s-2vcpu-4gb`, $24/month) running k3s**, with Postgres and ClickHouse moved in-cluster onto the node's own disk.

| Line                                                          | $/mo       |
| ------------------------------------------------------------- | ---------- |
| 1× `s-2vcpu-4gb` droplet (k3s; 80 GB SSD included)            | 24.00      |
| Weekly droplet snapshot (~10 GB used)                         | ~0.60      |
| Postgres, ClickHouse, Prometheus — in-cluster on `local-path` | 0.00       |
| Alchemy free tier + free public fallbacks                     | 0.00       |
| Upstash Redis free / Cloudflare Tunnel / R2 backups / GHCR    | 0.00       |
| **Infrastructure total**                                      | **~24.60** |
| LLM spend (caps retuned $17 → $5)                             | up to 5.00 |
| **All-in ceiling**                                            | **~29.60** |

### 1. k3s rather than a one-node DOKS pool

This is the load-bearing choice. DOKS reserves a punitive share of small nodes: per DigitalOcean's published limits, a **4 GB DOKS node exposes only 2.5 GiB allocatable to pods**, and kube-system consumes roughly 0.5 GiB of that. The workload set plus both datastores needs ~2.5 GiB of requests, so it does not fit, and the next DOKS size up (`s-4vcpu-8gb`) costs $48/month.

Measured on a real single-node k3s cluster (k3d, 4 GiB cap) rather than estimated:

| Measurement                                                | Value                           |
| ---------------------------------------------------------- | ------------------------------- |
| k3s allocatable on a 4 GiB node                            | **4.10 GiB of 4.10 GiB**        |
| kube-system requests (coredns, local-path, metrics-server) | 140Mi / 200m                    |
| k3s + containerd + kube-system resident at idle            | **511 MiB**                     |
| Full stack memory **requests**                             | **2540Mi — 60% of allocatable** |
| Full stack CPU requests                                    | 1275m                           |

The full stack is Postgres, ClickHouse, api, indexer, dashboard, ai-worker, Prometheus, Grafana and cloudflared. k3s reserves nothing by default, so allocatable equals capacity; subtracting the measured 511 MiB of real overhead leaves roughly 1 GiB of genuine headroom above the 2540Mi of requests.

### 2. k3s rather than reverting to Docker Compose

The droplet costs the same either way, so the saving does not depend on the orchestrator. Compose would mean discarding machinery that already works: the Kustomize base plus overlay and components, the deploy workflow's migration gate and per-deployment rollout waits, liveness and readiness probes, and the self-hosted Prometheus and Grafana component. k3s is conformant Kubernetes, so `kubectl apply -k` keeps working unchanged and the manifests need only the single-node fixes in §4. Reverting to the SPEC's original Compose design would be a rewrite that buys nothing.

### 3. Datastores in-cluster

Both run as single-replica StatefulSets on the default StorageClass, which on k3s is `local-path` — the node's included SSD, at no additional cost, rather than billed block storage.

Postgres uses the `pgvector/pgvector:pg18` image that `docker-compose.yml` already uses for local development. Two consequences beyond cost: the app role owns the database, so `ai_003`'s `CREATE EXTENSION vector` no longer needs a privileged pre-step (on DO Managed Postgres the migrate role lacked `CREATE EXTENSION`, so the extension had to be created by hand as `doadmin` or the migration gate hard-failed the entire deploy); and the `sslmode=require&uselibpqcompat=true` workaround for DO's private-CA certificate disappears, because traffic never leaves the node.

ClickHouse remains the source of truth for chain-event-derived data per ADR-0062 — proposal detail, the delegate and actor pages and DAO health all read it synchronously — so it changes host rather than role. Dropping it to save the managed-service bill would mean restoring the Postgres projection layer and cron that ADR-0062 deliberately deleted.

Neither datastore gets a Cloudflare Tunnel route. Both are ClusterIP-only and therefore unreachable from the internet, which also closes the hardening gap left by Elestio exposing ClickHouse to `0.0.0.0/0` behind password auth alone.

**Redis stays on Upstash.** It is free, it keeps session state off the box, and running it in-cluster would only spend RAM.

### 4. Single-node scheduling changes

Four changes to the manifests, none of which affect a multi-node topology:

- The `api`, `dashboard` and `indexer` deployments carried `requiredDuringSchedulingIgnoredDuringExecution` pod anti-affinity against each other, to keep the indexer's bursty derivation and RPC work off the request path. On one node that leaves the entire set `Pending` forever. They become `preferred`, so they still spread first as soon as a node is added.
- `api` and `dashboard` move from `maxUnavailable: 0 / maxSurge: 1` to `maxUnavailable: 1 / maxSurge: 0`. A surge pod has nowhere to land, so the rollout would sit `Pending` until the deploy workflow's `rollout status` timeout failed the deploy. The cost is roughly 20 seconds of downtime per deploy.
- The `api` HPA drops to one replica. A second replica competes for the same node's CPU rather than adding capacity, and the ~25-connection managed-Postgres ceiling that previously capped it at two no longer applies now that in-cluster Postgres runs `max_connections=100`.
- Prometheus moves to `local-path` with 5Gi and seven days of retention.

### 5. Backups become the operator's responsibility

`local-path` volumes live on the node, so node loss is data loss. Nightly logical dumps of both stores go to Cloudflare R2's free tier, with weekly droplet snapshots as a whole-host restore path. The restore procedure must be executed, not merely documented. As a last resort the data is re-derivable from a backfill, but a backfill is slow, spends RPC quota, and has historically been the riskiest operation in this project.

## Alternatives considered

- **One-node DOKS pool (`s-2vcpu-4gb`, $24).** Rejected on the allocatable arithmetic above: 2.5 GiB exposed against ~2.5 GiB of requests, with no headroom for the 511 MiB of real overhead.
- **DOKS `s-4vcpu-8gb` ($48) keeping managed datastores.** Rejected. Roughly $88/month all-in — a real cut, but it leaves both fixed managed-service floors in place and misses the target by a wide margin.
- **Keep DO Managed Postgres, self-host only ClickHouse.** Rejected for this deployment, but it is the natural first step back if operating self-hosted Postgres proves troublesome: ~$39/month, and it restores automatic backups and point-in-time restore.
- **Revert to the SPEC's Hetzner CX32 Docker Compose topology.** Rejected per §2. Hetzner is also cheaper per GB than DigitalOcean, but it raised prices during 2026 and several shared-vCPU plans became unavailable; moving providers is a separate decision from cutting the bill, and the saving here does not require it.
- **Drop ClickHouse and restore the Postgres projection layer.** Rejected. It would re-add roughly 1.8k lines and six tables that ADR-0062 deliberately removed, to save $27/month that self-hosting saves anyway.
- **Managed Kubernetes elsewhere, or a PaaS.** Not evaluated in depth. The demo has no requirement that a managed control plane satisfies and a single droplet does not.

## Consequences

### Positive

- Infrastructure drops from ~$93.56 to ~$24.60/month, a 74% cut, with all-in spend under $30.
- Both datastores come off the public internet.
- Two long-standing operational papercuts disappear: the `CREATE EXTENSION vector`-as-`doadmin` prerequisite that gated every deploy carrying `ai_003`, and the DO private-CA TLS workaround.
- The Kustomize manifests, deploy workflow and monitoring component carry over unchanged apart from the single-node fixes.
- Local reproduction of the production topology becomes a single `k3d cluster create`, which is how the two ClickHouse configuration traps in §"Known traps" were found before they reached production.

### Negative / risks

- **No control-plane HA and no failover.** A node failure is a full outage, and node maintenance is downtime. Accepted for a demo.
- **Node loss is data loss** between nightly backups. Mitigated by §5, and the data is re-derivable.
- **k3s upgrades are self-managed**, where DOKS handled them.
- **The scheduler cannot see the real overhead.** k3s reserves nothing, so allocatable equals capacity and the 511 MiB measured above is invisible to scheduling. The droplet must run with `--kubelet-arg=system-reserved=memory=768Mi` or equivalent, or the node can be scheduled into an OOM.
- **Memory limits are overcommitted** — they total 5674Mi against 4096Mi of capacity. Requests plus measured overhead come to roughly 3051Mi, so there is about 1 GiB of real headroom, but a simultaneous spike to every limit would OOM the node.
- **CPU headroom is thin and was not measured under contention.** Requests total 1275m plus 200m for kube-system against 2000m on a 2-vCPU droplet. Hourly polling (the indexer is near-idle between ticks) is what makes this comfortable; restoring a fast poll cadence would need a resize.
- Deploys now cost roughly 20 seconds of dashboard and API downtime, where the surge-based rollout was seamless.

### Neutral

- ADR-0062's contract is untouched: ClickHouse changes host, not role.
- Cloudflare Tunnel remains the ingress, so there is still no paid load balancer and no public IP.
- Scaling back up is an overlay change plus a node: the anti-affinity rules are `preferred`, the topology-spread constraints already exist, and the HPA ceiling is a one-line edit.

## Known traps

Both were found by applying the manifests to a real single-node k3s cluster; neither is visible to `kubectl kustomize`, and the second was invisible in `kubectl logs` until ClickHouse was switched to console logging.

- **The ClickHouse limits ConfigMap must be mounted with `subPath`.** Mounting it over `/etc/clickhouse-server/config.d` shadows the whole directory, including the image's own `docker_related_config.xml` — the only thing that sets `listen_host` to `0.0.0.0`/`::`. Without it the server binds loopback only: it answers `/ping` inside the container while every connection to the pod IP is refused, so probes fail and the logs look healthy. The cost of `subPath` is that ConfigMap edits do not propagate in place; the pod must be recreated.
- **`background_pool_size` must be left at its default.** Lowering it to 4 makes the server exit `BAD_ARGUMENTS` in under a second, before it listens: `number_of_free_entries_in_pool_to_execute_mutation` (20 by default) must not exceed `background_pool_size × background_merges_mutations_concurrency_ratio`, or mutations could never run. The saving was only thread stacks; `max_server_memory_usage` is the real ceiling.

## Supersedes

This ADR replaces the deployment-topology and cost-envelope reasoning in SPEC §7.1, §7.7 and §7.8 and in ADR-038 — the Hetzner CX32/CX42 single-host Docker Compose design and the €60/month ceiling. Those describe a deployment that was never built. ADR-038's ClickHouse-layer decision is unaffected and remains current as refined by ADR-0062.
