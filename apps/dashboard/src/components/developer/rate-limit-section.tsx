import { Section } from '@/components/ui/section';
import { formatCompactNumber } from '@/lib/format';

// The authenticated_free tier limits (apps/api rate-limit.config.ts, SPEC §4.4). Live per-minute /
// per-day consumption + reset ride on the RateLimit-* response headers; the standalone consumption
// view lands with usage analytics.
const FREE_TIER = { perMinute: 60, perDay: 10_000 };

function LimitCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex flex-col gap-1 border border-line-2 bg-bg-2 px-4 py-3">
      <span className="font-mono text-caption uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <span className="font-mono text-lead text-ink">
        {formatCompactNumber(value)}
        <span className="ml-1 text-caption text-ink-3">{unit}</span>
      </span>
    </div>
  );
}

export function RateLimitSection() {
  return (
    <Section number="3" title="Rate limits" reference="Free tier">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <LimitCard label="Per minute" value={FREE_TIER.perMinute} unit="req" />
        <LimitCard label="Per day" value={FREE_TIER.perDay} unit="req" />
      </div>
      <p className="text-caption text-ink-4">
        Live consumption and reset times are returned on the RateLimit-* headers of every API
        response.
      </p>
    </Section>
  );
}
