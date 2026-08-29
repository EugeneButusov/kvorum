import { AIPanel } from '@/components/ui/ai-panel';
import { Section } from '@/components/ui/section';

export function HealthTakeawaysSection({ slug }: { slug: string }) {
  return (
    <Section number="01" title="Health takeaways" reference={<span>90-day rolling</span>}>
      <AIPanel
        state="coming-soon"
        label="Synthesis by Kvorum"
        comingSoonLabel="Health synthesis"
        fallbackHref={`/daos/${slug}/proposals`}
        fallbackLabel="View recent proposals"
      />
    </Section>
  );
}
