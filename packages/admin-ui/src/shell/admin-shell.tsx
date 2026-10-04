'use client';

import type { ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';
import { useAdminSignOutMutation } from '@bitocard/api-client/admin';
import { cn, humanise } from '../format';
import { AccountMenu, ConsoleShell, type Crumb } from './console-shell';
import { menus, sections, type SectionKey } from './nav';
import { NotificationBell } from './notifications';
import { useAdmin, useMode } from './session';

export type { Crumb };

function AdminAccountMenu() {
  const admin = useAdmin();
  const [signOut, { isLoading }] = useAdminSignOutMutation();
  return (
    <AccountMenu
      name={admin.name}
      email={admin.email}
      detail={admin.roles.map(humanise).join(', ')}
      signingOut={isLoading}
      onSignOut={async () => {
        await signOut().unwrap().catch(() => undefined);
        // A full page load clears the API cache, so the next admin never sees this one's data.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign('/signin');
      }}
    />
  );
}

function AdminBell() {
  return <NotificationBell realm="admin" userId={useAdmin().id} />;
}

/** Live or sandbox figures. Shown where a page has mode-dependent data. */
export function ModeSwitch() {
  const { mode, setMode } = useMode();
  return (
    <button
      type="button"
      onClick={() => setMode(mode === 'live' ? 'test' : 'live')}
      aria-pressed={mode === 'test'}
      className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold', mode === 'test' ? 'bg-amber-100 text-amber-800' : 'bg-canvas text-muted hover:text-ink')}
    >
      <FlaskConical className="size-3.5" aria-hidden />
      {mode === 'test' ? 'Sandbox data' : 'Live data'}
    </button>
  );
}

/** The layout of every admin page (see ConsoleShell). */
export function AdminShell({ section, current, crumbs, actions, children }: { section: SectionKey; current: string; crumbs: Crumb[]; actions?: ReactNode; children: ReactNode }) {
  return (
    <ConsoleShell brand="Bitocard" sections={sections} menus={menus} section={section} current={current} crumbs={crumbs} actions={actions} notifications={<AdminBell />} account={<AdminAccountMenu />}>
      {children}
    </ConsoleShell>
  );
}
