import { describe, expect, it } from 'vitest';
import { DbModule, PrismaService } from './db';

describe('db', () => {
  it('exports DbModule and PrismaService', () => {
    expect(DbModule).toBeDefined();
    expect(PrismaService).toBeDefined();
  });
});
