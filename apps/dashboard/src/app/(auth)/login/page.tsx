import type { Metadata } from 'next';

import { SiweConnectPanel } from '@/components/auth/siwe-connect-panel';
import { safeNext } from '@/lib/auth/redirect';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <SiweConnectPanel mode="login" next={safeNext(next)} />;
}
