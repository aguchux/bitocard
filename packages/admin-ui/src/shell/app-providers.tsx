'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AdminProviders, LinkProvider } from './session';

/** What the admin root layout wraps every page in: the API cache, the live/sandbox choice and Next.js links. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AdminProviders>
      <LinkProvider link={Link}>{children}</LinkProvider>
    </AdminProviders>
  );
}
