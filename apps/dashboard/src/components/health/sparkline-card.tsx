import { Sparkline } from '@/components/charts/sparkline';

export function SparklineCard({
  label,
  source,
  dateRange,
  currentValue,
  values,
  comingSoon,
}: {
  label: string;
  source: string;
  dateRange: string;
  currentValue: string;
  values?: number[];
  comingSoon?: boolean;
}) {
  return (
    <div className="border border-line-3">
      <div className="flex items-baseline justify-between px-3.5 pt-2.5">
        <span className="font-mono text-caption text-ink">{label}</span>
        <span className="font-mono text-caption text-ink-3">{source}</span>
      </div>
      <div className="relative h-20 px-3.5">
        {comingSoon ? (
          <span className="absolute inset-x-3.5 bottom-3.5 font-mono text-caption text-ink-3">
            endpoint pending
          </span>
        ) : values && values.length > 0 ? (
          <div className="absolute bottom-3.5 left-3.5 right-3.5">
            <Sparkline
              values={values}
              label={`${label} trend, latest ${currentValue}`}
              width={200}
              height={48}
            />
          </div>
        ) : null}
        <span className="absolute right-3.5 top-2.5 font-mono text-body font-semibold tabular-nums text-ink">
          {currentValue}
        </span>
        <span className="absolute bottom-3.5 left-3.5 font-mono text-caption text-ink-3">
          {dateRange}
        </span>
        <div className="absolute inset-x-3.5 bottom-3.5 h-px bg-line-2" />
      </div>
    </div>
  );
}
