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

> **Copy the connector token, not the tunnel ID.** The dashboard shows the tunnel's UUID
> prominently; the token is the long base64 string inside the `cloudflared service install …`
> command it gives you. They are easy to confuse, and the UUID is accepted everywhere until
> `cloudflared` starts and says `Provided Tunnel token is not valid`. A real token is ~180–200
> characters and base64-decodes to JSON with `a`, `t` and `s` claims; a UUID is 36 characters
> with four dashes. `migration-secret.sh` rejects the UUID form, but if you are patching the
> secret by hand there is nothing to catch it. 3. Leave the production hostnames on the old tunnel for now.

### 2.3 Deploy

Run from the repository root. The image reference is derived from the remote and **lowercased**, because GHCR rejects uppercase path segments and the build workflow publishes the lowercased form (`${GITHUB_REPOSITORY,,}`). Typing the owner as it appears on GitHub names an image that does not exist, and the symptom arrives five minutes later as the migration gate timing out on `ImagePullBackOff`.

```bash
cd "$(git rev-parse --show-toplevel)"

OWNER=$(git remote get-url origin | sed -E 's#.*[:/]([^/]+)/[^/]+$#\1#' | sed 's/\.git$//' | tr 'A-Z' 'a-z')
IMG="ghcr.io/$OWNER/kvorum:$(git rev-parse origin/main)"
echo "$IMG"          # sanity-check: all lowercase, 40-char sha
```

Confirm the image was actually built and pushed for that commit — it is published only on merge to `main`, so a local commit will not have one:

```bash
SHA=$(git rev-parse origin/main)
RID=$(gh run list --workflow=deploy.yml --commit="$SHA" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RID" --json jobs --jq '.jobs[] | "\(.conclusion // .status)\t\(.name)"'
```

Only **`Build & push image` must be `success`** — that is the job that pushes to GHCR.

`Migrate & roll out` will show `failure` for every commit between merging the SSH deploy change and finishing this migration, because it targets a host whose `DEPLOY_*` secrets do not exist yet. Expected during the cutover, and it does not affect the image. It also means **the old cluster stops auto-deploying** from that commit onward — it stays pinned at whatever it last received until the new host takes over.

This uses the `repo` scope you already have. Querying the registry directly (`gh api …/packages/container/…`) needs `read:packages`, which a default `gh auth login` does not grant.

### Build the bundle

Pin the image in a **copy**, never in the working tree:

```bash
BUNDLE=$(mktemp -d)
cp -R infra "$BUNDLE/"
(cd "$BUNDLE/infra/k8s/overlays/prod" && kustomize edit set image "ghcr.io/kvorum/kvorum=$IMG")

# confirm it renders what you meant — deploy.sh checks this too, but failing here is cheaper
kubectl kustomize "$BUNDLE/infra/k8s/overlays/prod" | grep -oE 'image: ghcr[^ ]+' | sort -u

COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/bundle.tar.gz -C "$BUNDLE" infra/k8s infra/scripts/deploy.sh
```

Working from a copy matters for three reasons. `kustomize edit` rewrites the file with its own formatting — de-indenting list items so `prettier --check` fails and lefthook blocks your next commit, and detaching comments from the entries they describe. The pin is deploy-time state that does not belong in git. And pinning in place means every `git checkout` of that file silently invalidates an already-built tarball, which then deploys the wrong image — or, since `deploy.sh` renders and checks the real reference, refuses to deploy at all.

`COPYFILE_DISABLE=1 --no-xattrs` suppresses the macOS extended attributes that make GNU tar print a `LIBARCHIVE.xattr.com.apple.provenance` warning for every file on extraction. Harmless, but two dozen lines of it hides real errors.

### Ship it

```bash
scp -i ~/.ssh/kvorum-deploy -o IdentitiesOnly=yes /tmp/bundle.tar.gz deploy@<droplet-ip>:/tmp/
ssh -i ~/.ssh/kvorum-deploy -o IdentitiesOnly=yes deploy@<droplet-ip> \
  'rm -rf ~/kvorum-deploy && mkdir -p ~/kvorum-deploy \
   && tar xzf /tmp/bundle.tar.gz -C ~/kvorum-deploy \
   && ~/kvorum-deploy/infra/scripts/deploy.sh '"$IMG"
```

Every `ssh`/`scp` to the deploy user needs `-i ~/.ssh/kvorum-deploy`: it is a dedicated key, so your agent will not offer it by default and the connection fails with `Permission denied (publickey)` — which reads like a broken `authorized_keys` rather than a missing flag. `IdentitiesOnly=yes` stops ssh working through your other keys first and tripping the server's `MaxAuthTries`.

Better, set it once in `~/.ssh/config` and drop the flags from every command in this runbook:

```
Host kvorum-droplet
  HostName <droplet-ip>
  User deploy
  IdentityFile ~/.ssh/kvorum-deploy
  IdentitiesOnly yes
```

Then it is `scp /tmp/bundle.tar.gz kvorum-droplet:/tmp/` and `ssh kvorum-droplet '…'`.

The script bootstraps the namespace and ConfigMap, runs the migration gate, applies the manifests and waits for rollouts. On a fresh cluster the gate creates the whole schema in both stores.

**Gate:**

```bash
knew get pods
knew get pvc
```

Everything `Running`, all three PVCs `Bound` on `local-path`. Memory requests should sit near 2540Mi — `knew describe node | grep -A6 'Allocated resources'`.

The app pods will be up but serving an **empty** database. That is expected; data arrives next.

---

## Phase 3 — Freeze both indexers

Freeze the old source so cursors do not advance mid-copy and leave holes. Freeze the new
indexer too: it initially starts against an empty Postgres database and sees no sources, but
the Phase 4 restore can make it reconnect or restart against the populated database. Without
an explicit gate, that restart could begin polling before ClickHouse has been copied.

```bash
kold set env deploy/kvorum-indexer INDEXER_LIVE_POLLER_ENABLED=false
kold rollout status deploy/kvorum-indexer

knew set env deploy/kvorum-indexer INDEXER_LIVE_POLLER_ENABLED=false
knew rollout status deploy/kvorum-indexer
```

Derivation keeps running; only live polling stops. From here the old stack is read-only in
effect, and the clock is running — keep Phases 4–6 tight.

---

## Phase 4 — Move the data

### 4.1 Postgres

Dump **from inside the old cluster**. DO Managed Postgres is reachable on its VPC-private host
(`private-…`), so neither your laptop nor the droplet can connect to it — a pod in the old
cluster can. Dumping there also means the credential never leaves the cluster.

The dump pod takes `DATABASE_URL` straight from the existing secret, so there is nothing to
copy or paste:

```bash
kold delete pod pgdump --ignore-not-found      # a pod from an earlier attempt has no env wired in

kold run pgdump --image=postgres:18-alpine --restart=Never --overrides='{
  "spec": { "containers": [{
    "name": "pgdump", "image": "postgres:18-alpine", "command": ["sleep","86400"],
    "env": [{ "name": "DATABASE_URL", "valueFrom": {
      "secretKeyRef": { "name": "kvorum-secrets", "key": "DATABASE_URL" } } }]
  }]}}'

kold wait --for=condition=Ready pod/pgdump --timeout=120s
```

`uselibpqcompat=true` is a node-postgres parameter. `pg_dump` uses libpq, which rejects
unknown keywords outright, so it has to come off the URL first — done inside the pod so the
credential is never echoed:

```bash
kold exec pgdump -- sh -c '
  URL=$(printf "%s" "$DATABASE_URL" \
    | sed -e "s/uselibpqcompat=true//" -e "s/&&/\&/g" -e "s/?&/?/" -e "s/[?&]$//")
  pg_dump -Fc --no-owner --no-privileges "$URL" > /tmp/pg.dump
  ls -la /tmp/pg.dump
'

kold cp pgdump:/tmp/pg.dump ./pg.dump
ls -la pg.dump
kold delete pod pgdump
```

The pod stays alive for 24 hours because `kubectl cp` runs `tar` inside the source
container. Once the container reaches `Succeeded`, its `/tmp/pg.dump` still appears in the
pod's old writable layer but `kubectl` can no longer exec into it to retrieve the file. If
that happens, delete and recreate the pod and dump again; the frozen source makes the retry
safe.

Restore into the new cluster. **Restore the full dump — do not run `db:migrate` first.** The
dump carries schema, data _and_ the Kysely migration table, so a later migrate run correctly
finds nothing pending. The deploy already created the schema, so drop and recreate the database
first to avoid restoring on top of it:

```bash
knew cp ./pg.dump kvorum-postgres-0:/tmp/pg.dump

knew exec kvorum-postgres-0 -- sh -c '
  psql -U kvorum -d postgres -c "DROP DATABASE IF EXISTS kvorum WITH (FORCE)" \
                              -c "CREATE DATABASE kvorum OWNER kvorum"
  pg_restore -U kvorum -d kvorum --no-owner --no-privileges /tmp/pg.dump
'
```

`WITH (FORCE)` terminates the app connections holding the database open; without it the drop
blocks behind them. The apps reconnect on their own.

Verify before moving on — `vector` must be present, or `ai_003` and every embedding read will
fail later:

```bash
knew exec kvorum-postgres-0 -- psql -U kvorum -d kvorum -tAc \
  "select count(*) from information_schema.tables where table_schema='public'"
knew exec kvorum-postgres-0 -- psql -U kvorum -d kvorum -tAc \
  "select extname from pg_extension order by 1"
knew exec kvorum-postgres-0 -- psql -U kvorum -d kvorum -tAc "select count(*) from proposal"
```

### 4.2 ClickHouse

The reverse order applies here: ClickHouse dumps carry **no DDL**, so the schema must exist first. The Phase 2 deploy already ran the 13 migrations, so the tables are there.

Elestio exposes the HTTP interface on **:18123**, not the prominently displayed native :29000 — `@clickhouse/client` speaks HTTP only.

Load both sets of credentials from the cluster secrets. Do not transcribe or print them:

```bash
OLD_SECRET=$(kold get secret kvorum-secrets -o json)
NEW_SECRET=$(knew get secret kvorum-secrets -o json)

OLD_CH=$(printf '%s' "$OLD_SECRET" | jq -er '.data.CLICKHOUSE_URL | @base64d')
OLD_CH=${OLD_CH%/}
OLD_U=$(printf '%s' "$OLD_SECRET" | jq -er '.data.CLICKHOUSE_USER | @base64d')
OLD_P=$(printf '%s' "$OLD_SECRET" | jq -er '.data.CLICKHOUSE_PASSWORD | @base64d')
OLD_DB=$(printf '%s' "$OLD_SECRET" | jq -er '.data.CLICKHOUSE_DATABASE | @base64d')

NEW_U=$(printf '%s' "$NEW_SECRET" | jq -er '.data.CLICKHOUSE_USER | @base64d')
NEW_P=$(printf '%s' "$NEW_SECRET" | jq -er '.data.CLICKHOUSE_PASSWORD | @base64d')
NEW_DB=$(printf '%s' "$NEW_SECRET" | jq -er '.data.CLICKHOUSE_DATABASE | @base64d')
NEW_CH='http://127.0.0.1:58123'

unset OLD_SECRET NEW_SECRET
```

In a second terminal, source the migration environment and leave the ClickHouse forward
running:

```bash
source ~/kvorum-migration.env
knew port-forward svc/kvorum-clickhouse 58123:8123
```

Back in the first terminal, prove both endpoints and credentials work before moving data.
These queries print only the authenticated username and database, never the password:

```bash
curl -fsS -u "$OLD_U:$OLD_P" "$OLD_CH/?database=$OLD_DB" \
  --data-binary 'SELECT currentUser(), currentDatabase() FORMAT TabSeparated'
curl -fsS -u "$NEW_U:$NEW_P" "$NEW_CH/?database=$NEW_DB" \
  --data-binary 'SELECT currentUser(), currentDatabase() FORMAT TabSeparated'
```

Build an explicit file of source-data tables. Do not copy `_migrations`: Phase 2 already
created the target's migration metadata. Do not copy the two `*_agg` tables either: their
materialized views populate them as the corresponding `*_raw` tables are inserted, and
copying both raw and aggregate storage would double the aggregate state.

```bash
TABLES_FILE=/tmp/kvorum-ch-tables.txt

curl -fsS -u "$OLD_U:$OLD_P" "$OLD_CH/?database=$OLD_DB" --data-binary \
  "SELECT name
   FROM system.tables
   WHERE database='$OLD_DB'
     AND engine LIKE '%MergeTree'
     AND name NOT IN ('_migrations', 'vote_events_agg', 'delegation_flow_agg')
   ORDER BY name
   FORMAT TabSeparated" > "$TABLES_FILE"

wc -l "$TABLES_FILE"       # expect 17 for the current schema
cat "$TABLES_FILE"
```

Import line by line rather than using `for t in $TABLES`: zsh does not split a multiline
scalar on newlines, so that form turns the entire list into one malformed table name. The
subshell also makes `pipefail` local and lets any failed transfer stop the import without
closing the operator's shell.

The preflight refuses to start if any target source table already has rows. Native inserts
are not idempotent, so after a partial transfer, stop and clean up the partial target rather
than blindly running the loop again.

```bash
(
  set -o pipefail

  while IFS= read -r t; do
    rows=$(curl -fsS -u "$NEW_U:$NEW_P" "$NEW_CH/?database=$NEW_DB" \
      --data-binary "SELECT count() FROM \`$t\` FORMAT TSV")
    if [ "$rows" != 0 ]; then
      echo "ERROR: target table $t already has $rows row(s); refusing a duplicate import" >&2
      exit 1
    fi
  done < "$TABLES_FILE"

  for t in vote_events_agg delegation_flow_agg; do
    rows=$(curl -fsS -u "$NEW_U:$NEW_P" "$NEW_CH/?database=$NEW_DB" \
      --data-binary "SELECT count() FROM \`$t\` FORMAT TSV")
    if [ "$rows" != 0 ]; then
      echo "ERROR: derived target table $t already has $rows row(s); refusing a duplicate import" >&2
      exit 1
    fi
  done

  while IFS= read -r t; do
    echo "→ $t"
    curl -fsS -u "$OLD_U:$OLD_P" "$OLD_CH/?database=$OLD_DB" \
      --data-binary "SELECT * FROM \`$t\` FORMAT Native" \
    | curl -fsS -u "$NEW_U:$NEW_P" \
        "$NEW_CH/?database=$NEW_DB&query=INSERT%20INTO%20%60${t}%60%20FORMAT%20Native" \
        --data-binary @-
    echo "  ok"
  done < "$TABLES_FILE"
)
```

Only source `*MergeTree` tables cross the wire. The projection `VIEW`s already exist from
the migrations, and the materialized views rebuild the aggregate storage from the raw
inserts.

### 4.3 Compare row counts

```bash
while IFS= read -r t; do
  a=$(curl -fsS -u "$OLD_U:$OLD_P" "$OLD_CH/?database=$OLD_DB" \
    --data-binary "SELECT count() FROM \`$t\` FORMAT TSV")
  b=$(curl -fsS -u "$NEW_U:$NEW_P" "$NEW_CH/?database=$NEW_DB" \
    --data-binary "SELECT count() FROM \`$t\` FORMAT TSV")
  [ "$a" = "$b" ] && echo "  ok   $t ($a)" || echo "  MISMATCH $t: old=$a new=$b"
done < "$TABLES_FILE"

# Compare the logical projections, not the physical AggregatingMergeTree row counts: the
# number of physical aggregate-state rows depends on background merge timing.
for view in vote_events_projection delegation_flow_projection; do
  a=$(curl -fsS -u "$OLD_U:$OLD_P" "$OLD_CH/?database=$OLD_DB" \
    --data-binary "SELECT count() FROM \`$view\` FORMAT TSV")
  b=$(curl -fsS -u "$NEW_U:$NEW_P" "$NEW_CH/?database=$NEW_DB" \
    --data-binary "SELECT count() FROM \`$view\` FORMAT TSV")
  [ "$a" = "$b" ] && echo "  ok   $view ($a)" || echo "  MISMATCH $view: old=$a new=$b"
done
```

Every copied source table and both logical projections must match before you continue.

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
- [ ] Every copied ClickHouse source table and both logical projection counts match (Phase 4.3).
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
knew set env deploy/kvorum-indexer INDEXER_LIVE_POLLER_ENABLED-
knew rollout status deploy/kvorum-indexer
knew logs deploy/kvorum-indexer --tail=50 | grep -E 'poller_tick|started [0-9]+ source'
```

The trailing `-` removes the temporary Deployment override from Phase 3, revealing the
application default (enabled); `set env` triggers the rollout. Expect
`started 19 source(s) across 3 chain(s)` and one tick batch at boot. Next batch in ~1 hour —
the cadence is hourly. Derivation and stitch logs run on their own intervals and are **not**
evidence about poll cadence.

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
