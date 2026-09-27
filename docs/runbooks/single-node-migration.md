# Runbook — Migrating to the single-node k3s host

One-time cutover from **DOKS + DO Managed Postgres + Elestio ClickHouse** to **one droplet running k3s with both datastores in-cluster**. Target: ~$93.56/mo → ~$24.60/mo. Rationale and measured capacity: [ADR-0090](../adr/0090-single-node-k3s-topology.md).

Build the new host **alongside** the running one. Nothing is destroyed until the verification gate in Phase 6 is green — one month of overlap is a cheap insurance premium.

Expect ~2–3 hours of hands-on work plus a 48-hour soak.

---

## Two rules before you start

**1. You will have two clusters. Name them and be explicit, every time.**

A destructive command against the wrong context is the worst thing that can happen during this. Do not rely on `current-context`:

This migration spans hours and probably several terminals, and both the aliases and `KUBECONFIG` are per-shell. Put them in a file you can re-source rather than retyping them:

```bash
doctl kubernetes cluster kubeconfig save <doks-name>   # → context do-fra1-kvorum-prod

cat > ~/kvorum-migration.env <<'ENV'
export KUBECONFIG=~/.kube/config:~/.kube/k3s.yaml
alias kold='kubectl --context=do-fra1-kvorum-prod -n kvorum'
alias knew='kubectl --context=kvorum-k3s -n kvorum'
ENV
```

Then in **every** new terminal:

```bash
source ~/kvorum-migration.env
```

Every command below is written as `kold` or `knew`. If you find yourself typing bare `kubectl`, stop.

`knew` only starts working after **Phase 1.4**, which creates the `kvorum-k3s` context. Until then it fails with `context "kvorum-k3s" does not exist` — expected, not a broken setup.

If an alias reports a context you do not recognise, the alias itself is stale: it is a shell string, so re-sourcing the file above is the fix. `kubectl config get-contexts` shows the truth.

**2. Nothing is deleted until Phase 7.** If a phase fails, the old stack is still serving traffic and you can walk away.

---

## Phase 0 — Prerequisites

### 0.1 Create the droplet

`s-2vcpu-4gb` (2 vCPU, 4 GB, 80 GB SSD), same region as your users. Note the IP.

Attach a DO Cloud Firewall allowing **inbound SSH only**. The Kubernetes API needs no public port, and ingress arrives through the Cloudflare Tunnel, which dials outbound.

### 0.2 Create the backup bucket

Cloudflare R2 (free tier, 10 GB) or any S3-compatible bucket:

- Bucket, e.g. `kvorum-backups`.
- An API token scoped to **object read + write on that bucket only**. It does not need bucket-creation rights — the backup job runs with `--s3-no-check-bucket`.
- Note the endpoint: `https://<account-id>.r2.cloudflarestorage.com`.

Do this **now**, not after the cutover. The moment data moves onto node-local storage it has no second copy until a backup lands.

### 0.3 Collect the values you will need

From the existing deployment:

```bash
# every current secret key (values, so redirect to a file with mode 600 — do not print)
umask 077
kold get secret kvorum-secrets -o json | jq -r '.data | to_entries[] | "\(.key)=\(.value|@base64d)"' > ~/kvorum-secrets.env
wc -l ~/kvorum-secrets.env    # expect ~16 keys
```

You will carry most of these across unchanged. The ones that **change** are `DATABASE_URL`, `CLICKHOUSE_URL`, and the new `POSTGRES_*` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` / `R2_*` keys.

Also record the current baseline, to compare against after the migration:

```bash
kold exec deploy/kvorum-api -- node -e "
const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,max:1});
(async()=>{for(const t of ['proposal','actor','archive_event','dao'])
  console.log(t, (await p.query(\`select count(*)::int n from \${t}\`)).rows[0].n);
await p.end();})();"
```

Write those numbers down. Phase 6 checks them.

---

## Phase 1 — Provision the host

### 1.1 Install k3s

```bash
ssh root@<droplet-ip>

groupadd -f k3s
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="\
  --disable=traefik \
  --disable=servicelb \
  --kubelet-arg=system-reserved=memory=768Mi,cpu=200m \
  --write-kubeconfig-group=k3s \
  --write-kubeconfig-mode=0640" sh -
```

Traefik and ServiceLB are disabled because ingress is the Cloudflare Tunnel pod.

**Gate — verify the reservation applied:**

```bash
kubectl get node -o json | jq '.items[0].status | {cap: .capacity.memory, alloc: .allocatable.memory}'
```

`alloc` must be **lower** than `cap`. If they are equal the reservation did not apply, and the scheduler will happily fill the node into an OOM. Fix before continuing.

### 1.2 Generate the CI deploy key

There is no existing key to reuse — create a dedicated one for this, **on your laptop**, not on the droplet. Never reuse your personal key: this one is going into a CI secret, and its only job is deploying.

```bash
ssh-keygen -t ed25519 -N '' -C 'github-actions-kvorum-deploy' -f ~/.ssh/kvorum-deploy
```

`-N ''` means no passphrase, because CI cannot type one. That makes the private half a bearer credential for your cluster, so it goes into the GitHub secret and nowhere else.

| Half                       | Goes to                                     |
| -------------------------- | ------------------------------------------- |
| `~/.ssh/kvorum-deploy.pub` | the droplet's `authorized_keys` (next step) |
| `~/.ssh/kvorum-deploy`     | GitHub secret `DEPLOY_SSH_KEY` (Phase 7.4)  |

When pasting the private key into GitHub, include the `-----BEGIN...` and `-----END...` lines and keep the trailing newline. A truncated key fails with an unhelpful `Load key: error in libcrypto`.

### 1.3 Create the deploy user

On the droplet, create the user and its `.ssh` directory:

```bash
adduser --disabled-password --gecos '' deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
usermod -aG k3s deploy
```

Then install the public key **from your laptop**, so it never goes near a clipboard:

```bash
ssh root@<droplet-ip> \
  'cat > /home/deploy/.ssh/authorized_keys \
   && chown deploy:deploy /home/deploy/.ssh/authorized_keys \
   && chmod 600 /home/deploy/.ssh/authorized_keys' \
  < ~/.ssh/kvorum-deploy.pub
```

This is the form to prefer: the key is piped byte-for-byte from the file, so there is no paste to mangle and no ambiguity about when input ends.

If you only have console access to the droplet and must paste, use a heredoc — **not** a bare `tee`. `tee` reads until end-of-file, so after pasting a key you have to press Enter and then `Ctrl-D`; until you do, it sits there and looks like it ignored you. A heredoc carries its own terminator, so paste the whole block including the final `KEY` line:

```bash
sudo -u deploy tee /home/deploy/.ssh/authorized_keys >/dev/null <<'KEY'
ssh-ed25519 AAAAC3Nz…rest-of-your-public-key… github-actions-kvorum-deploy
KEY
chmod 600 /home/deploy/.ssh/authorized_keys
```

`ssh-copy-id` does not help here: the `deploy` user has no credential yet, so there is nothing for it to authenticate with.

Group-readable kubeconfig, never `0644` — on a shared host that is cluster-admin for every local account.

**Verify before moving on**, or the first CI deploy fails on something you cannot see from the workflow logs:

```bash
ssh -i ~/.ssh/kvorum-deploy -o IdentitiesOnly=yes deploy@<droplet-ip> 'kubectl get nodes'
```

That must succeed without a password prompt and list the node. If `kubectl` is permission-denied, the `k3s` group membership has not taken effect — reconnect, since group changes only apply to new sessions.

> **Optional hardening.** Prefixing the `authorized_keys` line with `restrict,` disables port/agent/X11 forwarding and pty allocation for that key. Both `scp` and the workflow's non-interactive `ssh` work without a pty, but verify the first deploy after adding it and drop the prefix if anything misbehaves.

### 1.4 Get a kubeconfig on your laptop

The k3s API is firewalled off, so reach it through an SSH tunnel rather than opening 6443. k3s's own kubeconfig already points at `https://127.0.0.1:6443`, which is exactly what the tunnel serves — so it needs **no** rewriting.

```bash
ssh root@<droplet-ip> 'cat /etc/rancher/k3s/k3s.yaml' > ~/.kube/k3s.yaml
chmod 600 ~/.kube/k3s.yaml
```

Rename the context. k3s calls everything `default`, which is both collision-prone and a dangerous name for the cluster that is about to become production while another one is still live:

```bash
KUBECONFIG=~/.kube/k3s.yaml kubectl config rename-context default kvorum-k3s
```

Open the tunnel — it has to stay up for every `knew` command in this runbook. Skip if one is already listening, and fail loudly rather than silently if the forward cannot be set up:

```bash
lsof -nP -iTCP:6443 -sTCP:LISTEN >/dev/null 2>&1 \
  || ssh -f -N -o ExitOnForwardFailure=yes -L 6443:127.0.0.1:6443 root@<droplet-ip>
```

`ExitOnForwardFailure=yes` matters: without it, an `ssh` that loses the bind (because an earlier tunnel still holds the port) stays running and forwards nothing, so the session looks healthy while every `knew` command fails. Check with `lsof -nP -iTCP:6443 -sTCP:LISTEN`, and `curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:6443/version` — a `401` means the tunnel is good and only auth is left.

Now make both clusters visible at once and confirm:

```bash
export KUBECONFIG=~/.kube/config:~/.kube/k3s.yaml
kubectl config get-contexts        # expect do-fra1-kvorum-prod AND kvorum-k3s
knew get nodes
```

`KUBECONFIG` is per-shell. Put that `export` in your shell profile, or re-run it in every new terminal — otherwise `kubectl` reads only `~/.kube/config` and `knew` fails with `context "kvorum-k3s" does not exist`.

---

## Phase 2 — Bring up the stack, empty

### 2.1 Create the namespace and secret

Do this with the script, not by hand. The secret has 22 keys drawn from three places — 10 copied from the old cluster, 7 derived, 5 that only you have — and the pairing that matters most is invisible: `DATABASE_URL` must embed the same password the StatefulSet initialises Postgres with, or the apps authenticate against a database created with a different one and the failure surfaces hours later.

```bash
knew create namespace kvorum

OLD_CONTEXT=do-fra1-kvorum-prod NEW_CONTEXT=kvorum-k3s \
R2_BUCKET=kvorum-backups \
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com \
R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
TUNNEL_TOKEN=<token from 2.2> \
  ./infra/scripts/migration-secret.sh
```

Omit any of the five supplied values and it prompts for them without echoing. It prints key names only, never values.

| Class    | Keys                                                                                                                                                                                        | Source                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| carried  | `REDIS_URL` `CURSOR_SECRET` `HMAC_PEPPER_CURRENT` `INTERNAL_READ_TOKEN` `CHAIN_CONFIG` `SNAPSHOT_API_KEY` `ETHERSCAN_API_KEY` `ANTHROPIC_API_KEY` `OPENAI_API_KEY` `GRAFANA_ADMIN_PASSWORD` | read from the old cluster    |
| derived  | `POSTGRES_USER` `POSTGRES_PASSWORD` `DATABASE_URL` `CLICKHOUSE_USER` `CLICKHOUSE_PASSWORD` `CLICKHOUSE_URL` `CLICKHOUSE_DATABASE`                                                           | generated here, consistently |
| supplied | `R2_BUCKET` `R2_ENDPOINT` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `TUNNEL_TOKEN`                                                                                                          | you                          |

It refuses to run in three cases, each a mistake worth stopping for:

- **The secret already exists** (override with `FORCE=1`). Re-running after Postgres has initialised generates a password that no longer matches the volume, locking you out of your own data. Only force while the datastores are still empty.
- **A carried key is missing** from the old secret, rather than silently producing a secret with a hole in it.
- **The result does not match** the key list in `secret.example.yaml`, which is the contract the manifests are written against.

Confirm — key names only, no values:

```bash
knew get secret kvorum-secrets -o jsonpath='{.data}' | jq -r 'keys[]' | wc -l   # 22
```

### 2.2 Create a _second_ Cloudflare Tunnel

Do **not** reuse the existing tunnel token. Two connectors on one tunnel would load-balance the live hostnames across both clusters — a split brain where half your traffic hits an empty database.

In the Zero Trust dashboard:

1. Create a new tunnel, e.g. `kvorum-k3s`. Copy its connector token into `TUNNEL_TOKEN` above.
2. Give it **one temporary hostname** for testing, e.g. `new.<domain>` → `http://kvorum-dashboard.kvorum:80`.
3. Leave the production hostnames on the old tunnel for now.

### 2.3 Deploy

```bash
IMG=ghcr.io/<owner>/kvorum:$(git rev-parse origin/main)
cd infra/k8s/overlays/prod && kustomize edit set image "ghcr.io/kvorum/kvorum=$IMG" && cd -

# copy the manifests to the host and run the deploy script there
tar czf /tmp/bundle.tar.gz infra/k8s infra/scripts/deploy.sh
scp /tmp/bundle.tar.gz deploy@<droplet-ip>:/tmp/
ssh deploy@<droplet-ip> 'rm -rf ~/kvorum-deploy && mkdir -p ~/kvorum-deploy \
  && tar xzf /tmp/bundle.tar.gz -C ~/kvorum-deploy \
  && ~/kvorum-deploy/infra/scripts/deploy.sh '"$IMG"
```

The script bootstraps the namespace and ConfigMap, runs the migration gate, applies the manifests and waits for rollouts. On a fresh cluster the gate creates the whole schema in both stores.

**Gate:**

```bash
knew get pods
knew get pvc
```

Everything `Running`, all three PVCs `Bound` on `local-path`. Memory requests should sit near 2540Mi — `knew describe node | grep -A6 'Allocated resources'`.

The app pods will be up but serving an **empty** database. That is expected; data arrives next.

---

## Phase 3 — Stop the old indexer

Freeze the source so cursors do not advance mid-copy and leave holes:

```bash
kold set env deploy/kvorum-indexer INDEXER_LIVE_POLLER_ENABLED=false
kold rollout status deploy/kvorum-indexer
```

Derivation keeps running; only live polling stops. From here the old stack is read-only in effect, and the clock is running — keep Phases 4–6 tight.

---

## Phase 4 — Move the data

### 4.1 Postgres

Dump **from inside the old cluster**. DO Managed Postgres is usually restricted to the VPC, so the droplet cannot reach it directly — dumping from a pod avoids adding trusted sources and removing them later.

```bash
kold run pgdump --image=postgres:18-alpine --restart=Never -- sleep 3600
kold wait --for=condition=Ready pod/pgdump --timeout=120s

# uses the old DATABASE_URL; strip &uselibpqcompat=true — libpq rejects that param
kold exec pgdump -- sh -c \
  'pg_dump -Fc --no-owner --no-privileges "$OLD_URL" > /tmp/pg.dump' \
  # pass OLD_URL via --env when creating the pod, or export it inside

kold cp pgdump:/tmp/pg.dump ./pg.dump
ls -la pg.dump
```

Restore into the new cluster. **Restore the full dump — do not run `db:migrate` first.** The dump carries schema, data _and_ the Kysely migration table, so a later migrate run correctly finds nothing pending. Running migrations first would collide with the restored schema.

```bash
knew cp ./pg.dump kvorum-postgres-0:/tmp/pg.dump
knew exec kvorum-postgres-0 -- sh -c \
  'pg_restore -U kvorum -d kvorum --no-owner --no-privileges /tmp/pg.dump'
```

Some `already exists` notices are normal — the deploy gate created the schema. If that bothers you, drop and recreate the database first, then restore.

### 4.2 ClickHouse

The reverse order applies here: ClickHouse dumps carry **no DDL**, so the schema must exist first. The Phase 2 deploy already ran the 13 migrations, so the tables are there.

Elestio exposes the HTTP interface on **:18123**, not the prominently displayed native :29000 — `@clickhouse/client` speaks HTTP only.

```bash
OLD_CH='https://<elestio-host>:18123'
NEW_CH='http://localhost:58123'     # via: knew port-forward svc/kvorum-clickhouse 58123:8123

TABLES=$(curl -sS -u "$OLD_U:$OLD_P" "$OLD_CH/?database=kvorum" --data-binary \
  "SELECT name FROM system.tables WHERE database='kvorum' AND engine LIKE '%MergeTree' FORMAT TabSeparated")

for t in $TABLES; do
  echo "→ $t"
  curl -sS -u "$OLD_U:$OLD_P" "$OLD_CH/?database=kvorum" \
    --data-binary "SELECT * FROM \`$t\` FORMAT Native" \
  | curl -sS -u "kvorum:$CHPW" \
      "$NEW_CH/?database=kvorum&query=INSERT+INTO+%60$t%60+FORMAT+Native" --data-binary @-
done
```

Only `*MergeTree` tables. The projection `VIEW`s and materialized views are derived and rebuild from these.

### 4.3 Compare row counts

```bash
for t in $TABLES; do
  a=$(curl -sS -u "$OLD_U:$OLD_P" "$OLD_CH/?database=kvorum" --data-binary "SELECT count() FROM \`$t\` FORMAT TSV")
  b=$(curl -sS -u "kvorum:$CHPW"  "$NEW_CH/?database=kvorum" --data-binary "SELECT count() FROM \`$t\` FORMAT TSV")
  [ "$a" = "$b" ] && echo "  ok   $t ($a)" || echo "  MISMATCH $t: old=$a new=$b"
done
```

Every table must match before you continue.

---

## Phase 5 — Take the first backup

Before anything depends on this data surviving:

```bash
knew create job backup-first --from=cronjob/kvorum-backup
knew wait --for=condition=complete job/backup-first --timeout=600s
knew logs job/backup-first -c upload | tail -5
```

Then do a **restore drill** per [`backup-restore.md`](backup-restore.md) and record it in that file's drill log. An unverified backup is not a backup — and this is the moment you are about to start relying on it.

---

## Phase 6 — Verification gate

Test through the **temporary** hostname (`new.<domain>`) while production still points at the old stack. Do not proceed to Phase 7 until every line passes.

- [ ] All pods `Running` on the single node, none `Pending`; requests below allocatable.
- [ ] **Row counts match** the Phase 0 baseline: `proposal` (~650), `actor`, `archive_event`, `dao`.
- [ ] Every ClickHouse table count matches (Phase 4.3).
- [ ] **ClickHouse read paths** — the surfaces that go dark if CH is wrong (ADR-0062): proposal detail with tally and vote list, `/actors/[address]`, `/daos/[slug]/delegates`, `/delegates/[address]`, `/daos/[slug]/health`.
- [ ] `pnpm --filter dashboard test:smoke` against `new.<domain>` — 7 flows. The script is `test:smoke`, **not** `test:e2e`.
- [ ] **Auth** — SIWE login, key CRUD, sign-out-everywhere. Confirms Upstash Redis still reaches the new cluster.
- [ ] **Grafana** at its temporary hostname: three scrape targets `UP`, both dashboards render.
- [ ] Backup job completed and a restore drill passed (Phase 5).

---

## Phase 7 — Cut over

### 7.1 Move the hostnames

In the Cloudflare Zero Trust dashboard, move `dashboard.<domain>`, `api.<domain>` and `grafana.<domain>` from the old tunnel to the new one. DNS updates automatically. Delete the temporary `new.<domain>` route.

Postgres and ClickHouse get **no route** — they stay ClusterIP-only.

### 7.2 Start the new indexer

```bash
knew get cm kvorum-config -o jsonpath='{.data.INDEXER_LIVE_POLLER_ENABLED}'   # unset = enabled
knew rollout restart deploy/kvorum-indexer
knew logs deploy/kvorum-indexer --tail=50 | grep -E 'poller_tick|started [0-9]+ source'
```

Expect `started 19 source(s) across 3 chain(s)` and one tick batch at boot. Next batch in ~1 hour — the cadence is hourly. Derivation and stitch logs run on their own intervals and are **not** evidence about poll cadence.

### 7.3 Soak for 48 hours

Leave the old stack up, indexer still frozen. Watch:

```bash
knew logs deploy/kvorum-indexer --since=1h | grep -i error
knew get pods            # no restarts
```

After ~2 hours confirm `poll_cursor_block` advanced for each live source and the DLQ has not grown.

### 7.4 Point CI at the new host

Add three secrets to the GitHub `production` environment:

```bash
echo "deploy@<droplet-ip>"                 # → DEPLOY_HOST
cat ~/.ssh/kvorum-deploy                   # → DEPLOY_SSH_KEY   (private half, from 1.2)
ssh-keyscan <droplet-ip> 2>/dev/null       # → DEPLOY_KNOWN_HOSTS
```

`DEPLOY_KNOWN_HOSTS` pins the host key so the workflow never needs `StrictHostKeyChecking=no`, which would accept a man-in-the-middle on the one channel that can change production. Run `ssh-keyscan` from a network you trust — it is trust-on-first-use, and you are recording that decision.

Then remove `DIGITALOCEAN_ACCESS_TOKEN` and the `DOKS_CLUSTER` variable.

Merge a trivial change and confirm the workflow deploys end to end.

---

## Phase 8 — Tear down

**Only after the soak is clean.** Each of these is irreversible.

- [ ] Destroy the DOKS cluster.
- [ ] Destroy the DO Managed Postgres instance. _(Take a final manual snapshot first.)_
- [ ] Destroy the Elestio ClickHouse service.
- [ ] Delete the old Cloudflare Tunnel.
- [ ] Enable weekly droplet snapshots (~$0.60/mo).
- [ ] Confirm the next DigitalOcean invoice shows the droplet only.

### Alchemy

Separate timeline. Hourly polling went live 2026-09-26; after a week, read **Alchemy's own dashboard** — not Grafana — and confirm the monthly projection is well under the 30M free tier, then downgrade.

Grafana under-reports by ~23%, because the health checker calls `provider.send()` directly and bypasses the metric.

---

## Rollback

| Failed at                      | Action                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Phases 1–2                     | Nothing to undo. Destroy the droplet and retry.                                                                               |
| Phases 3–6                     | Re-enable the old indexer: `kold set env deploy/kvorum-indexer INDEXER_LIVE_POLLER_ENABLED=true`. Production never moved.     |
| Phase 7, after hostnames moved | Move the three hostnames back to the old tunnel, re-enable the old indexer. Downtime is a DNS propagation, typically seconds. |
| Phase 8                        | No rollback. This is why the soak exists.                                                                                     |

The old stack stays intact and serving through Phase 7, so everything before Phase 8 is reversible in minutes.

---

## Known gotchas

Collected from this deployment's history — each of these has cost time before.

- **Elestio ClickHouse:** HTTP is on **:18123**. The dashboard prominently shows the native port 29000, which the client cannot speak (`tls_validate_record_header: wrong version number`).
- **`DATABASE_URL` and `POSTGRES_PASSWORD` must agree.** The StatefulSet initialises the database from `POSTGRES_PASSWORD` on first start only; changing it later does not change the database.
- **`uselibpqcompat=true`** is a node-postgres parameter. Strip it before handing a URL to `psql` or `pg_dump`, which reject it. It is not needed at all on the new cluster.
- **Restore order differs per store.** Postgres: restore the full dump, _then_ let migrations no-op. ClickHouse: run migrations _first_ for the DDL, then load Native data.
- **App images have no `curl` or `wget`.** Use `node -e fetch` or a throwaway `postgres:18-alpine` pod.
- **The bucket must pre-exist.** The backup job cannot create it and fails with `NoSuchBucket`.
- **A required anti-affinity would strand the pods.** Already relaxed to `preferred`; if you see `Pending` with "didn't match pod anti-affinity", something reverted.
