import Link from 'next/link';

import { Sparkline } from '@/components/charts/sparkline';
import type { DelegateProfile } from '@/lib/analytics/delegate';
import { formatCompactNumber, truncateAddress } from '@/lib/format';

/** Delegate header (§6.11 §1): identity, current power, participation, and a VP-trajectory sparkline. */
export function DelegateHeader({
  slug,
  profile,
  participationRate,
  trajectory,
}: {
  slug: string;
  profile: DelegateProfile;
  participationRate: number;
  trajectory: number[];
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-line-2 pb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-h1 font-semibold text-ink">
          {profile.name ?? truncateAddress(profile.address)}
        </h1>
        {trajectory.length > 1 && (
          <span className="flex items-center gap-2 font-mono text-caption text-ink-3">
            VP trajectory
            <Sparkline
              values={trajectory}
              label={`voting-power trajectory, latest ${formatCompactNumber(trajectory[trajectory.length - 1] ?? 0)}`}
              width={120}
            />
          </span>
        )}
      </div>
      <p className="font-mono text-caption text-ink-4" title={profile.address}>
        {profile.address}
      </p>
      <dl className="flex flex-wrap gap-x-10 gap-y-2 font-mono text-caption">
        <Stat
          label="Voting power"
          value={profile.currentPower == null ? '—' : formatCompactNumber(profile.currentPower)}
        />
        <Stat label="Participation" value={`${participationRate}%`} />
        <Stat
          label="Majority alignment"
          value={
            // A fraction, despite the API field being named `_pct`: 0.9139 is 91%. Rounding it
            // directly rendered every delegate as 0% or 1%. The cross-DAO table on the actor page
            // scales it correctly, so the two pages disagreed about the same number.
            profile.alignmentPct == null ? '—' : `${Math.round(profile.alignmentPct * 100)}%`
          }
        />
        <Link href={`/daos/${slug}/delegates`} className="self-center text-ink-2 hover:text-ink">
          All delegates →
        </Link>
      </dl>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="uppercase tracking-[0.04em] text-ink-4">{label}</dt>
      <dd className="text-body-lg tabular-nums text-ink">{value}</dd>
    </div>
  );
}
