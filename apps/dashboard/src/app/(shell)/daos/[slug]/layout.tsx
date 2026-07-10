import type { ReactNode } from 'react';

import { Crumb } from '@/components/shell/crumb';
import { DaoNav } from '@/components/shell/dao-nav';

export default async function DaoLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const name = slug.charAt(0).toUpperCase() + slug.slice(1);
  return (
    <>
      <Crumb items={[{ label: 'DAOs', href: '/daos' }, { label: name }]} />
      <DaoNav slug={slug} />
      {children}
    </>
  );
}
