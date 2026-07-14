import Link from 'next/link';

import { daoVariant } from '@/components/proposal/state';
import { Pill } from '@/components/ui/pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { DaoFootprint } from '@/lib/actors/actor';
import { formatCompactNumber } from '@/lib/format';

/** Cross-DAO summary table (§6.10 §2): one row per DAO, linking to the delegate scorecard there. */
export function CrossDaoTable({
  footprints,
  address,
}: {
  footprints: DaoFootprint[];
  address: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">Cross-DAO footprint</h2>
      {footprints.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">No DAO participation recorded.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>DAO</TableHead>
              <TableHead className="text-right">Voting power</TableHead>
              <TableHead className="text-right">Votes cast</TableHead>
              <TableHead className="text-right">Majority alignment</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {footprints.map((f) => (
              <TableRow key={f.slug}>
                <TableCell>
                  <Pill dao={daoVariant(f.slug)}>{f.slug}</Pill>
                </TableCell>
                <TableCell className="text-right">{formatCompactNumber(f.votingPower)}</TableCell>
                <TableCell className="text-right">{f.votesCast}</TableCell>
                <TableCell className="text-right">
                  {f.majorityAlignmentPct == null
                    ? '—'
                    : `${(f.majorityAlignmentPct * 100).toFixed(0)}%`}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/daos/${f.slug}/delegates/${address}`}
                    className="text-ink-2 hover:text-ink"
                  >
                    Scorecard →
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
