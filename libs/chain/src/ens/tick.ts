import type { EnsClient, ReverseResolveOutcome } from './ens-client.js';

export interface ActorEnsRepository {
  findEnsRefreshCandidates(args: {
    limit: number;
    ttlSeconds: number;
  }): Promise<Array<{ id: string; primary_address: string }>>;
  updateDisplayName(args: { actorId: string; displayName: string | null }): Promise<void>;
}

export interface TickOptions {
  limit: number;
  ttlSeconds: number;
}

export interface TickCounts {
  resolved: number;
  no_record: number;
  mismatch: number;
  error: number;
}

export interface PerCandidateOutcome {
  actorId: string;
  address: string;
  outcome: ReverseResolveOutcome;
}

export type TickOutcome =
  | { outcome: 'idle' }
  | { outcome: 'completed'; counts: TickCounts; perCandidate: PerCandidateOutcome[] };

export async function tickEnsResolution(args: {
  ensClient: EnsClient;
  actorRepo: ActorEnsRepository;
  opts: TickOptions;
}): Promise<TickOutcome> {
  const candidates = await args.actorRepo.findEnsRefreshCandidates({
    limit: args.opts.limit,
    ttlSeconds: args.opts.ttlSeconds,
  });

  if (candidates.length === 0) {
    return { outcome: 'idle' };
  }

  const addresses = candidates.map((candidate) => candidate.primary_address);
  const outcomes = await args.ensClient.batchReverseResolve(addresses);

  const counts: TickCounts = { resolved: 0, no_record: 0, mismatch: 0, error: 0 };
  const perCandidate: PerCandidateOutcome[] = [];

  for (const actor of candidates) {
    const outcome = outcomes.get(actor.primary_address) ?? {
      kind: 'error',
      reason: 'missing_outcome_from_client',
    };

    perCandidate.push({
      actorId: actor.id,
      address: actor.primary_address,
      outcome,
    });

    switch (outcome.kind) {
      case 'resolved':
        await args.actorRepo.updateDisplayName({ actorId: actor.id, displayName: outcome.name });
        counts.resolved += 1;
        break;
      case 'no_record':
        await args.actorRepo.updateDisplayName({ actorId: actor.id, displayName: null });
        counts.no_record += 1;
        break;
      case 'mismatch':
        counts.mismatch += 1;
        break;
      case 'error':
        counts.error += 1;
        break;
      default: {
        const exhaustive: never = outcome;
        throw new Error(`unreachable outcome kind: ${(exhaustive as { kind: string }).kind}`);
      }
    }
  }

  return { outcome: 'completed', counts, perCandidate };
}
