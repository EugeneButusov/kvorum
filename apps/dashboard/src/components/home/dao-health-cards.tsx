import Link from 'next/link';

/**
 * DAO health snapshot (§6.4 §4): one card per DAO, linking to its full health dashboard. The pass-
 * rate / concentration / participation metrics are aggregated from the analytics endpoints in the
 * analytics epic (M6-4) that owns them; here the cards orient and route.
 */
export function DaoHealthCards({ daos }: { daos: { slug: string; name: string }[] }) {
  if (daos.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-h3 font-semibold text-ink">DAO health</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {daos.map((dao) => (
          <Link
            key={dao.slug}
            href={`/daos/${dao.slug}/health`}
            className="flex flex-col gap-2 border border-line-2 bg-bg-2 p-4 transition-colors hover:border-ink-3"
          >
            <span className="text-body-lg font-medium text-ink">{dao.name}</span>
            <span className="font-mono text-caption text-ink-3">
              Pass rate · concentration · participation →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
