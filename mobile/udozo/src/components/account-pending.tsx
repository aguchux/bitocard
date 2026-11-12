import { Failed, Loading } from '@/components/ui';
import { useAccount } from '@/lib/account';

/**
 * While the account is not known yet: a spinner, or, when reading it failed (offline, the API down), what went wrong
 * with Try again, so a launch without internet never spins for ever.
 */
export function AccountPending() {
  const { error, retry } = useAccount();
  return error ? <Failed error={error} retry={retry} /> : <Loading />;
}
