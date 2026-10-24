'use client';

import { SessionProvider } from 'next-auth/react';
import { QueryProvider } from '@/providers/QueryProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <QueryProvider>{children}</QueryProvider>
    </SessionProvider>
  );
}
