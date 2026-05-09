# Caddy deployment runbook

Covers first deployment, reloads, cert monitoring, and the status-page topology decision.

## Prerequisites

- DNS A/CNAME records for `dashboard.kvorum.example` and `api.kvorum.example` pointing at the server's public IP.
- Ports 80 and 443 open on the host firewall (80 for ACME HTTP-01 challenge; 443 for traffic).
- The ACME email sentinel in `infra/caddy/Caddyfile` replaced with a real address before deploy.
- Application services (`dashboard:3000`, `api:3001`) reachable from the Caddy container.

## First deployment

```bash
# Replace the ACME email sentinel
grep -r 'REPLACE_BEFORE_DEPLOY' infra/caddy/Caddyfile && echo "STOP: replace ACME email first"

# Validate config (no Caddy install required)
docker run --rm -v "$(pwd)/infra/caddy:/etc/caddy" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile

# Start (production docker-compose includes the Caddy service — add in M7)
docker compose up -d caddy
```

## Zero-downtime config reload

```bash
# Validate before reloading — prevents loading a broken config
docker run --rm -v "$(pwd)/infra/caddy:/etc/caddy" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile

# Reload running Caddy without dropping connections
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Certificate renewal monitoring

Caddy renews certificates automatically ~30 days before expiry. To verify:

```bash
# Check Caddy logs for TLS renewal events
docker compose logs caddy | grep -i 'renew\|certificate\|acme'

# Inspect the managed cert expiry (replace with actual domain)
echo | openssl s_client -servername dashboard.kvorum.example \
  -connect dashboard.kvorum.example:443 2>/dev/null \
  | openssl x509 -noout -dates
```

If renewal fails, Caddy logs the ACME error. Common causes: port 80 not reachable (HTTP-01 challenge blocked), rate-limit hit, stale ACME account.

## Local dev TLS overlay

Start the dev Caddy container alongside the infra stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

This uses `local_certs` (Caddy's built-in local CA). Import the CA cert into your browser once:

```bash
# macOS — trust the local CA system-wide
docker compose exec caddy caddy trust
```

Dev endpoints: `https://dashboard.localhost` and `https://api.localhost`.

## Status page: separate-host pattern (SPEC §7.11)

The status page (`status.kvorum.example`) is **not** routed through this Caddy instance. Reasoning: if Caddy is down, the status page must still be reachable to diagnose the outage. Routing it through Caddy creates a circular dependency.

DNS precondition for M7: `status.kvorum` must have its own A/CNAME record pointing to a separate host (or a cloud-hosted status provider), independent of the `dashboard`/`api` records. Provision the separate status host before adding the `status.kvorum.example` block to the Caddyfile.
