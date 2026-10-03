'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { makeStore } from '@bitocard/api-client';
import { type Admin, type AdminRole, type Mode, useAdminSessionQuery } from '@bitocard/api-client/admin';
import { errorMessage } from '../format';
import { ErrorState } from '../ui/status';
import { Skeleton } from '../ui/primitives';

/** One Redux store (the API cache) per browser tab. */
export function AdminProviders({ children }: { children: ReactNode }) {
  const [store] = useState(makeStore);
  return (
    <Provider store={store}>
      <ModeProvider>{children}</ModeProvider>
    </Provider>
  );
}

// -- Links -------------------------------------------------------------------------------------------------------

export type AppLinkProps = { href: string; className?: string; children: ReactNode; 'aria-current'?: 'page'; onClick?: () => void; title?: string };
type LinkLike = ComponentType<AppLinkProps>;
type RenderLink = (props: AppLinkProps) => ReactNode;

const renderAnchor: RenderLink = ({ href, children, ...props }) => (
  <a href={href} {...props}>
    {children}
  </a>
);
const LinkContext = createContext<RenderLink>(renderAnchor);

/** The app passes Next.js Link (client navigation and prefetching); tests use plain anchors. */
export function LinkProvider({ link: LinkComponent, children }: { link: LinkLike; children: ReactNode }) {
  const render = useMemo<RenderLink>(() => {
    const renderLink: RenderLink = props => <LinkComponent {...props} />;
    return renderLink;
  }, [LinkComponent]);
  return <LinkContext.Provider value={render}>{children}</LinkContext.Provider>;
}

/** A link to another admin page, rendered with the Link the app provided. */
export function AppLink(props: AppLinkProps) {
  return useContext(LinkContext)(props);
}

// -- Live or test data -------------------------------------------------------------------------------------------

const ModeContext = createContext<{ mode: Mode; setMode: (mode: Mode) => void }>({ mode: 'live', setMode: () => {} });
const modeKey = 'bitocard-admin-mode';

/** Whether dashboards show live or sandbox figures; remembered in this browser only. */
export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>('live');
  useEffect(() => {
    try {
      // Read the stored choice once mounted (never during render, so server and client markup match).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem(modeKey) === 'test') setModeState('test');
    } catch {
      /* storage unavailable: stay on live */
    }
  }, []);
  const setMode = (next: Mode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(modeKey, next);
    } catch {
      /* not remembered */
    }
  };
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}
export const useMode = () => useContext(ModeContext);

// -- Session -----------------------------------------------------------------------------------------------------

const AdminContext = createContext<Admin | null>(null);

/** The signed-in admin. Only inside AdminGate. */
export function useAdmin() {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error('useAdmin must be used inside <AdminGate>');
  return admin;
}

/** super_admin can do everything; others need one of the roles. Mirrors the API's checks (the API decides). */
export const can = (admin: Admin | null, ...roles: AdminRole[]) => Boolean(admin && (admin.roles.includes('super_admin') || roles.some(role => admin.roles.includes(role))));

/** Sends the browser to sign-in, remembering where to come back to. */
export function goToSignIn() {
  const next = `${window.location.pathname}${window.location.search}`;
  // A full page load, so nothing cached from an expired session survives.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/signin${next && next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`);
}

/** Renders its children only for a signed-in admin; otherwise goes to sign-in. */
export function AdminGate({ children }: { children: ReactNode }) {
  const { data, error, isLoading, refetch } = useAdminSessionQuery();
  const unauthenticated = error && 'status' in error && error.status === 401;
  useEffect(() => {
    if (unauthenticated) goToSignIn();
  }, [unauthenticated]);
  if (isLoading || unauthenticated) {
    return (
      <div className="flex min-h-svh items-center justify-center p-8" aria-busy="true" aria-label="Checking your session">
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }
  if (error || !data) return <ErrorState message={errorMessage(error, 'Could not check your session.')} onRetry={refetch} />;
  return <AdminContext.Provider value={data.admin}>{children}</AdminContext.Provider>;
}
