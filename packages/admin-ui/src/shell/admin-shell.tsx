'use client';

import { useEffect, type ReactNode } from 'react';
import { FlaskConical, UserRound } from 'lucide-react';
import { useAdminSignOutMutation } from '@bitocard/api-client/admin';
import { cn, humanise } from '../format';
import { AccountMenu, ConsoleShell, type Crumb } from './console-shell';
import { menus, sections, type SectionKey } from './nav';
import { NotificationBell } from './notifications';
import { StepUpPrompt } from './step-up';
import { AppLink, can, useAdmin, useMode } from './session';

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
    >
      <AppLink href="/account" className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium text-ink hover:bg-canvas">
        <UserRound className="size-4" aria-hidden />
        Your account
        {admin.authenticator === false ? <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">2-step off</span> : null}
      </AppLink>
    </AccountMenu>
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
  const admin = useAdmin();
  const allowed = (roles: import('@bitocard/api-client/admin').AdminRole[] | undefined) => roles === undefined || can(admin, ...roles);
  const visibleMenus = Object.fromEntries(Object.entries(menus).map(([key, menu]) => [key, { ...menu, items: menu.items.filter(item => allowed(item.roles)) }])) as typeof menus;
  const visibleSections = sections
    .filter(item => visibleMenus[item.key].items.length > 0)
    .map(item => ({ ...item, href: visibleMenus[item.key].items[0]?.href ?? item.href }));
  const currentAllowed = current === '/account' || visibleMenus[section].items.some(item => current === item.href || (item.href !== '/' && current.startsWith(`${item.href}/`)));
  useEffect(() => {
    if (!currentAllowed) window.location.assign('/');
  }, [currentAllowed]);
  if (!currentAllowed) return null;
  return (
    <ConsoleShell brand="Bitocard" sections={visibleSections} menus={visibleMenus} section={section} current={current} crumbs={crumbs} actions={actions} notifications={<AdminBell />} account={<AdminAccountMenu />}>
      {children}
      <StepUpPrompt />
    </ConsoleShell>
  );
}
