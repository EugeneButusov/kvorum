'use client';

import { useEffect, useState } from 'react';

import { Section } from '@/components/ui/section';
import { Skeleton } from '@/components/ui/skeleton';
import type { WindowState } from '@/lib/developer/usage';
import { useUsage } from '@/lib/developer/use-usage';
import { formatCompactNumber } from '@/lib/format';

function progressColor(ratio: number): string {
  if (ratio >= 0.9) return 'var(--against)';
  if (ratio >= 0.75) return 'var(--note, #c59000)';
  return 'var(--accent)';
}

function useCountdown(serverSeconds: number) {
  const [remaining, setRemaining] = useState(serverSeconds);
  const isRunning = remaining > 0;

  useEffect(() => {
    setRemaining(serverSeconds);
  }, [serverSeconds]);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1_000);
    return () => clearInterval(id);
  }, [isRunning]);

  return remaining;
}

function ConsumptionCard({ label, state }: { label: string; state: WindowState }) {
  const ratio = state.limit > 0 ? state.used / state.limit : 0;
  const remaining = useCountdown(state.reset_seconds);

  return (
    <div className="flex flex-col gap-2 border border-line-2 bg-bg-2 px-4 py-3">
      <span className="font-mono text-caption uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <span className="font-mono text-lead text-ink">
        {formatCompactNumber(state.used)}
        <span className="text-caption text-ink-3"> / {formatCompactNumber(state.limit)} req</span>
      </span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(100, ratio * 100)}%`,
            backgroundColor: progressColor(ratio),
          }}
        />
      </div>
      {remaining > 0 && (
        <span className="font-mono text-caption text-ink-4">Resets in {remaining}s</span>
      )}
    </div>
  );
}

function StaticLimitCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 border border-line-2 bg-bg-2 px-4 py-3">
      <span className="font-mono text-caption uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <span className="font-mono text-lead text-ink">
        {formatCompactNumber(value)}
        <span className="ml-1 text-caption text-ink-3">req</span>
      </span>
    </div>
  );
}

export function RateLimitSection() {
  const { data, isLoading } = useUsage();

  if (isLoading) {
    return (
      <Section number="3" title="Rate limits" reference="Free tier">
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </Section>
    );
  }

  if (!data || data.keys.length === 0) {
    return (
      <Section number="3" title="Rate limits" reference="Free tier">
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <StaticLimitCard label="Per minute" value={60} />
          <StaticLimitCard label="Per day" value={10_000} />
        </div>
        <p className="text-caption text-ink-4">Create an API key to see live consumption data.</p>
      </Section>
    );
  }

  return (
    <Section number="3" title="Rate limits" reference="Free tier">
      <div className="flex flex-col gap-4">
        {data.keys.map((k) => (
          <div key={k.id}>
            {data.keys.length > 1 && (
              <p className="mb-2 font-mono text-small text-ink-3">
                {k.label ?? `${k.prefix}...${k.last_four}`}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <ConsumptionCard label="Per minute" state={k.rate_limit.minute} />
              <ConsumptionCard label="Per day" state={k.rate_limit.day} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
