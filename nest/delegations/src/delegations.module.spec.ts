import { describe, expect, it } from 'vitest';
import { DaoReadRepository, DelegationReadRepository } from '@libs/db';
import { DelegationsModule } from './delegations.module';

describe('DelegationsModule', () => {
  it('exports delegation/dao read repositories', () => {
    const exported = Reflect.getMetadata('exports', DelegationsModule) as unknown[];
    expect(exported).toEqual([DelegationReadRepository, DaoReadRepository]);
  });
});
