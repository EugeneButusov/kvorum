import { IdentityChip } from '@/components/ui/identity-chip';
import type { ActorIdentity } from '@/lib/actors/actor';

/** Identity header (§6.10 §1): name/address + a one-line auto-bio from the indexed footprint. */
export function ActorHeader({ actor, bio }: { actor: ActorIdentity; bio: string }) {
  return (
    <header className="flex flex-col gap-3 border-b border-line-2 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-h1 font-semibold text-ink">{actor.displayName ?? 'Actor'}</h1>
        <IdentityChip address={actor.primaryAddress} />
      </div>
      <p className="max-w-2xl text-body-lg text-ink-2">{bio}</p>
      {actor.addressCount > 1 && (
        <p className="font-mono text-caption text-ink-4">{actor.addressCount} linked addresses</p>
      )}
    </header>
  );
}
