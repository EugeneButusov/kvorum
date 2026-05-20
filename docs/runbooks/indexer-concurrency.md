# Indexer Concurrency Note

## Current posture

The indexer is currently operated as a **single-instance** service.

While some write paths are idempotent, the full live-sync pipeline is not
designed as a strongly coordinated multi-instance system yet. Running multiple
indexer instances for the same sources/chains may cause duplicate work and
non-deterministic behavior in parts of the pipeline.

## Practical guidance

- Run one indexer instance per environment for now.
- Treat multi-instance indexer deployment as unsupported until concurrency
  hardening is explicitly implemented.

## Future work (when needed)

- Define multi-instance ownership/claim model per source (or per chain+source).
- Add explicit coordination semantics for live pollers and downstream workers.
- Document failover and leader-election behavior for concurrent deployments.
