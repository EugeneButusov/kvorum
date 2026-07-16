import { ConcentrationSection } from '@/components/health/concentration-section';
import { DelegationFlowSection } from '@/components/health/delegation-flow-section';
import { HealthHeader, type HealthKpi } from '@/components/health/health-header';
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

  // Headline metrics, from live analytics only. The design's letter grade, participation, and
  // open-flag count have no data source in v1 and are omitted rather than mocked (ADR-086).
  const kpis: HealthKpi[] = [
    {
      label: 'Pass rate (1y)',
      value: passRate.overallPct == null ? '—' : `${passRate.overallPct}%`,
    },
    {
      label: 'Top-10 VP',
      value: concentration.current == null ? '—' : `${concentration.current.top10Pct.toFixed(1)}%`,
      deltaPp: concentration.delta90Top10,
      higherIsWorse: true,
    },
    {
      label: 'Gini',
      value: concentration.current == null ? '—' : concentration.current.gini.toFixed(2),
      higherIsWorse: true,
    },
  ];

  return (
    <div className="flex flex-col gap-12">
      <HealthHeader name={name} slug={slug} kpis={kpis} />

      <ConcentrationSection slug={slug} initial={concentration} />
      <DelegationFlowSection view={flow} />
      <ParticipationSection />
      <PassRateSection view={passRate} />
      <FlagSummary />
      <AnomalySection concentrationDelta90={concentration.delta90Top10} />
    </div>
  );
}
