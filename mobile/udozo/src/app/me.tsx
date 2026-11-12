import { ComingNext, TabScreen } from '@/components/tab-screen';

/** Me: the account, listings, wallet and orders (phases 1 to 3). */
export default function MeScreen() {
  return (
    <TabScreen title="Me">
      <ComingNext text="Sign in to see your listings, wallet, UdozoPay orders and settings. Coming in the next build." />
    </TabScreen>
  );
}
