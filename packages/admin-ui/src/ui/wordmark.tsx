import { cn } from '../format';

/**
 * The BitoCard wordmark for the console apps: the "b" mark as the first letter (as tall as an ascender, on the
 * baseline), then "ito" and a pink "Card", with an optional suffix such as "SHQ". `tone="light"` is for navy and dark
 * backgrounds (white mark and text, pink kept). Size it with a text size class. Read as "BitoCard".
 */
export function Wordmark({ tone = 'dark', suffix, className }: { tone?: 'dark' | 'light'; suffix?: string; className?: string }) {
  const name = suffix ? `BitoCard ${suffix}` : 'BitoCard';
  return (
    <span role="img" aria-label={name} className={cn('inline-flex items-baseline font-extrabold leading-none tracking-tight whitespace-nowrap', tone === 'light' ? 'text-white' : 'text-ink', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static mark from the app's public folder */}
      <img src={tone === 'light' ? '/bitocard-mark-light.png' : '/bitocard-mark.png'} alt="" aria-hidden="true" className="mr-[0.02em] inline-block h-[0.74em] w-auto" />
      <span aria-hidden="true">ito</span>
      <span aria-hidden="true" className="text-brand-500">
        Card
      </span>
      {suffix ? (
        <span aria-hidden="true" className="ml-[0.28em]">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
