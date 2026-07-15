import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';

import { ActorHeader } from '@/components/actor/actor-header';
import { ActorActivity, AuthoredProposals } from '@/components/actor/actor-lists';
import { CrossDaoAlignment } from '@/components/actor/cross-dao-alignment';
import { CrossDaoTable } from '@/components/actor/cross-dao-table';
import { Crumb } from '@/components/shell/crumb';
import { PageContainer } from '@/components/shell/page-container';
import {
  buildBio,
  fetchActor,
  fetchActorVotes,
  fetchAuthoredProposals,
  fetchFootprint,
  type ActorIdentity,
} from '@/lib/actors/actor';
import { serverApi } from '@/lib/api/client';
import { truncateAddress } from '@/lib/format';

type Params = Promise<{ address: string }>;

// Deduped so generateMetadata and the page share one fetch.
const loadActor = cache(
  (address: string): Promise<ActorIdentity | null> => fetchActor(serverApi(), address),
);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { address } = await params;
  const actor = await loadActor(address);
  const label = actor?.displayName ?? truncateAddress(address);
  return {
    title: `${label} — Kvorum`,
    description: `Cross-DAO governance footprint for ${label}.`,
  };
}

export default async function ActorPage({ params }: { params: Params }) {
  const { address } = await params;
  const actor = await loadActor(address);
  if (!actor) notFound();

  // ADR-033: a merged/secondary address 301s to the survivor's canonical URL — mirror that so the
  // browser lands on the primary address.
  if (actor.primaryAddress.toLowerCase() !== address.toLowerCase()) {
    redirect(`/actors/${actor.primaryAddress}`);
  }

  const [footprints, votes, authored] = await Promise.all([
    fetchFootprint(serverApi(), actor.primaryAddress),
    fetchActorVotes(serverApi(), actor.primaryAddress),
    fetchAuthoredProposals(serverApi(), actor.primaryAddress),
  ]);

  return (
    <>
      <Crumb
        items={[
          { label: 'Home', href: '/' },
          { label: actor.displayName ?? truncateAddress(actor.primaryAddress) },
        ]}
      />
      <PageContainer className="flex flex-col gap-10">
        <ActorHeader actor={actor} bio={buildBio(footprints)} />
        <CrossDaoTable footprints={footprints} address={actor.primaryAddress} />
        <CrossDaoAlignment footprints={footprints} />
        <ActorActivity votes={votes} />
        <AuthoredProposals proposals={authored} />
      </PageContainer>
    </>
  );
}
