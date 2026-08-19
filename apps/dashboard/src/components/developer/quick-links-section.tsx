import { ArrowUpRight } from 'lucide-react';

import { Section } from '@/components/ui/section';
import { API_DOCS_URL } from '@/lib/site';

// SPEC §6.13 §4 also lists a status page + support contact; those resources don't exist yet, so
// they're omitted rather than pointed at fabricated URLs. Both links leave this app: the reference
// is Swagger UI served by the API on its own origin, and the OpenAPI spec is fetched from
// v1/openapi.json through the same-origin BFF.
const LINKS = [
  { label: 'API documentation', href: API_DOCS_URL, external: true },
  { label: 'OpenAPI spec (download)', href: '/api/v1/openapi.json', external: true },
];

/** Quick links (§6.13 §4): docs + the OpenAPI spec. */
export function QuickLinksSection() {
  return (
    <Section number="4" title="Quick links">
      <ul className="flex flex-col">
        {LINKS.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noreferrer' : undefined}
              className="flex items-center gap-1.5 border-b border-line-3 py-2.5 text-body text-ink-2 transition-colors hover:text-primary"
            >
              {link.label}
              {link.external && <ArrowUpRight className="size-3.5" />}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
