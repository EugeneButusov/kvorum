import { SystemStatusRepository } from '@libs/db';

export interface StatusPayload {
  active_backfills: number;
  dlq_size: number;
  last_archived_event_at: string | null;
  ingestion_idle_for_seconds: number | null;
}

export class StatusHandler {
  constructor(private readonly repository: SystemStatusRepository) {}

  async get(): Promise<StatusPayload> {
    const snapshot = await this.repository.read();
    const now = Date.now();
    const lastArchivedEventAt = snapshot.lastArchivedEventAt;

    return {
      active_backfills: snapshot.activeBackfills,
      dlq_size: snapshot.dlqSize,
      last_archived_event_at: lastArchivedEventAt?.toISOString() ?? null,
      ingestion_idle_for_seconds:
        lastArchivedEventAt == null
          ? null
          : Math.max(0, Math.floor((now - lastArchivedEventAt.getTime()) / 1000)),
    };
  }
}
