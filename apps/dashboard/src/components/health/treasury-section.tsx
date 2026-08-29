import { Section } from '@/components/ui/section';

export function TreasurySection() {
  return (
    <Section number="04" title="Treasury composition">
      <div className="border border-line-3 px-[18px] py-4">
        <p className="font-mono text-mono-body text-ink-3">
          Treasury composition (stablecoin / native token / LP breakdown and 90-day burn rate) is
          served by an endpoint arriving in a later milestone.
        </p>
      </div>
    </Section>
  );
}
