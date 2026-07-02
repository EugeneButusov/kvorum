import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { PgDatabase } from '@libs/db';
import { ForumThreadRepository } from './forum-thread-repository';

function fakeDb() {
  const captured: {
    table?: string;
    values?: Record<string, unknown>;
    conflictCols?: string[];
    updateSet?: Record<string, unknown>;
    executed?: boolean;
  } = {};
  const db = {
    insertInto: (table: string) => ({
      values: (values: Record<string, unknown>) => {
        captured.table = table;
        captured.values = values;
        return {
          onConflict: (cb: (oc: unknown) => unknown) => {
            const oc = {
              columns: (cols: string[]) => {
                captured.conflictCols = cols;
                return {
                  doUpdateSet: (set: Record<string, unknown>) => {
                    captured.updateSet = set;
                    return oc;
                  },
                };
              },
            };
            cb(oc);
            return {
              returning: () => ({
                executeTakeFirst: () => {
                  captured.executed = true;
                  return Promise.resolve({ inserted: true });
                },
              }),
            };
          },
        };
      },
    }),
  };
  return { db: db as unknown as Kysely<PgDatabase>, captured };
}

describe('ForumThreadRepository.upsert', () => {
  it('upserts on (forum_host, forum_topic_id), updating mutable fields but never dao_id', async () => {
    const { db, captured } = fakeDb();
    const lastActivity = new Date('2026-01-05T00:00:00Z');

    const result = await new ForumThreadRepository(db).upsert({
      daoId: 'dao-1',
      forumHost: 'research.lido.fi',
      forumTopicId: '42',
      title: 'Raise staking limit',
      rawContent: '**@u** at t\n\nhello',
      contentPipelineVersion: 'turndown@7.2.4+rules-v1',
      postCount: 3,
      lastActivityAt: lastActivity,
    });

    expect(result).toEqual({ inserted: true });
    expect(captured.table).toBe('forum_thread');
    expect(captured.values).toEqual({
      dao_id: 'dao-1',
      forum_host: 'research.lido.fi',
      forum_topic_id: '42',
      title: 'Raise staking limit',
      raw_content: '**@u** at t\n\nhello',
      content_pipeline_version: 'turndown@7.2.4+rules-v1',
      post_count: 3,
      last_activity_at: lastActivity,
    });
    expect(captured.conflictCols).toEqual(['forum_host', 'forum_topic_id']);
    expect(captured.updateSet).toEqual({
      title: 'Raise staking limit',
      raw_content: '**@u** at t\n\nhello',
      content_pipeline_version: 'turndown@7.2.4+rules-v1',
      post_count: 3,
      last_activity_at: lastActivity,
    });
    expect(captured.updateSet).not.toHaveProperty('dao_id');
    expect(captured.executed).toBe(true);
  });
});
