import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError } from '@/lib/api';
import { clearSession, readSession, saveSession } from '@/lib/session';
import type { Customer, SessionReply } from '@/lib/types';
import { forgetTransactionPin } from '@/lib/transaction-pin';

type AccountState = {
  /** Undefined while the phone's secure store is read; null signed out. */
  customer: Customer | null | undefined;
  /** Keeps the session the API gave (sign-in, sign-up) and loads the account. */
  signedIn: (reply: SessionReply) => Promise<Customer>;
  /** After a change to the account (the email code confirmed). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Reading the account failed (no internet, the API down) and nothing is cached: say so, with `retry`. */
  error: unknown;
  retry: () => void;
};

const AccountContext = createContext<AccountState | null>(null);

/**
 * The signed-in customer: the session lives in the secure store, the account is read from the API and kept in the query
 * cache. A session the API no longer knows (401) is forgotten.
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
      return reply.customer;
    },
    [queries],
  );

  const signOut = useCallback(async () => {
    await api('/v1/store/account/signout', { body: {} }).catch(() => undefined);
    await clearSession();
    await forgetTransactionPin();
    setHasSession(false);
    queries.clear();
  }, [queries]);

  const refresh = useCallback(async () => {
    await queries.invalidateQueries({ queryKey: ['account'] });
  }, [queries]);

  const value = useMemo<AccountState>(() => {
    const customer = hasSession === undefined ? undefined : hasSession === false ? null : account.data === undefined ? (account.isError ? null : undefined) : account.data;
    return { customer, signedIn, refresh, signOut, error: account.data === undefined ? account.error : null, retry: () => void account.refetch() };
  }, [hasSession, account, signedIn, refresh, signOut]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount outside AccountProvider');
  return value;
}
