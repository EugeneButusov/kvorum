import { ConcentrationSection } from '@/components/health/concentration-section';
import { DelegationFlowSection } from '@/components/health/delegation-flow-section';
import {
  AnomalySection,
  FlagSummary,
  ParticipationSection,
} from '@/components/health/health-secondary';
import { PassRateSection } from '@/components/health/pass-rate-section';
import {
  fetchConcentration,
  fetchDelegationFlow,
  fetchPassRate,
  rangeFrom,
} from '@/lib/analytics/health';
import { serverApi } from '@/lib/api/client';

async function loadDaoName(slug: string): Promise<string> {
  const fallback = slug.charAt(0).toUpperCase() + slug.slice(1);
  try {
    const { data, error } = await serverApi().GET('/v1/daos/{slug}', {
      params: { path: { slug } },
    });
    if (error || !data) return fallback;
    return (data as { data?: { name?: string } }).data?.name ?? fallback;
  } catch {
    return fallback;
  }
}

export default async function DaoHealthPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const from1y = rangeFrom('1y', Date.now());

  const [name, concentration, passRate, flow] = await Promise.all([
    loadDaoName(slug),
    fetchConcentration(serverApi(), slug, { from: from1y }),
    fetchPassRate(serverApi(), slug, from1y),
    fetchDelegationFlow(serverApi(), slug),
  ]);

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-col gap-2 border-b border-line-2 pb-6">
        <h1 className="text-h1 font-semibold text-ink">{name} — health</h1>
        <p className="max-w-2xl text-body-lg text-ink-2">
          Stewarding {name}? This view is built for you — how the DAO&rsquo;s governance is
          behaving, and what to watch. A public page designed for operators.
        </p>
      </header>

      <ConcentrationSection slug={slug} initial={concentration} />
      <DelegationFlowSection view={flow} />
      <ParticipationSection />
      <PassRateSection view={passRate} />
      <FlagSummary />
      <AnomalySection concentrationDelta90={concentration.delta90Top10} />
    </div>
  );
}
