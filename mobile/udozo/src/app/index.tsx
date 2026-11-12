import { ComingNext, TabScreen } from '@/components/tab-screen';

/** Home: the market's home page, as on udozo.com (phase 1). */
export default function HomeScreen() {
  return (
    <TabScreen title="Udozo">
      <ComingNext text="Udozo's home page, with what is for sale near you, is coming in the next build." />
    </TabScreen>
  );
}
