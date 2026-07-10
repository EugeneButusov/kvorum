'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { makeQueryClient } from '@/lib/api/query-client';

export function QueryProvider({ children }: { children: ReactNode }) {
  // One client per browser session; useState keeps it stable across re-renders.
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
