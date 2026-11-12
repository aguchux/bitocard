import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError } from '@/lib/api';
import { registerPush } from '@/lib/push';
import { clearSession, readSession, saveSession } from '@/lib/session';
import { confirmationPending, type Customer, type SessionReply } from '@/lib/types';

type AccountState = {
  /** Undefined while the phone's secure store is read; null signed out. */
  customer: Customer | null | undefined;
  /** The account still needs its emailed code, its name and country, or its mobile. */
  pending: boolean;
  /** Keeps the session the API gave (sign-in, sign-up, Google, Apple, Facebook, WhatsApp) and loads the account. */
  signedIn: (reply: SessionReply) => Promise<Customer>;
  /** After a change to the account (a code confirmed, the profile saved). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** The session is gone (deleted account): forget it here without asking the API. */
  forget: () => Promise<void>;
  /** Reading the account failed (no internet, the API down) and nothing is cached: say so, with `retry`. */
  error: unknown;
  retry: () => void;
};

const AccountContext = createContext<AccountState | null>(null);

/**
 * The signed-in customer: the session lives in the secure store, the account is read from the API and kept in the
 * query cache. A session the API no longer knows (401) is forgotten. Signing in registers the phone for push when
 * notifications are already allowed (never asking: the app asks after the first chat).
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const queries = useQueryClient();
  const [hasSession, setHasSession] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    readSession().then(token => setHasSession(Boolean(token)), () => setHasSession(false));
  }, []);

  const account = useQuery({
    queryKey: ['account'],
    enabled: hasSession === true,
    queryFn: async () => {
      try {
        return await api<Customer>('/v1/store/account');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await clearSession();
          setHasSession(false);
          return null;
        }
        throw error;
      }
    },
    staleTime: 60_000,
  });

  const signedIn = useCallback(
    async (reply: SessionReply) => {
      await saveSession(reply.session.token);
      queries.setQueryData(['account'], reply.customer);
      setHasSession(true);
      registerPush({ ask: false }).catch(() => undefined);
      return reply.customer;
    },
    [queries],
  );

  const forget = useCallback(async () => {
    await clearSession();
    setHasSession(false);
    queries.clear();
  }, [queries]);

  const signOut = useCallback(async () => {
    await api('/v1/store/account/signout', { body: {} }).catch(() => undefined);
    await forget();
  }, [forget]);

  const refresh = useCallback(async () => {
    await queries.invalidateQueries({ queryKey: ['account'] });
  }, [queries]);

  const customer = hasSession === undefined ? undefined : hasSession ? (account.data === undefined ? undefined : account.data) : null;
  const error = customer === undefined && account.isError ? account.error : null;
  const { refetch } = account;
  const retry = useCallback(() => void refetch(), [refetch]);
  const value = useMemo<AccountState>(
    () => ({ customer, pending: Boolean(customer && confirmationPending(customer)), signedIn, refresh, signOut, forget, error, retry }),
    [customer, signedIn, refresh, signOut, forget, error, retry],
  );
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount outside AccountProvider');
  return value;
}
