import { ArrowUpRight } from 'lucide-react';

import { Section } from '@/components/ui/section';

// SPEC §6.13 §4 also lists a status page + support contact; those resources don't exist yet, so
// they're omitted rather than pointed at fabricated URLs. The OpenAPI spec is served by the API at
// v1/openapi.json (reached through the same-origin BFF).
const LINKS = [
  { label: 'API documentation', href: '/docs', external: false },
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
