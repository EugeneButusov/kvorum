# status

Command:

- `admin-cli status`

Fields:

- `dlq_size`
- `active_backfills`
- `last_reorg_detected_at`
- `last_archived_event_at`
- `ingestion_idle_for_seconds`

Note:

- This is a zero-network Postgres proxy and not a head-block-age metric.
