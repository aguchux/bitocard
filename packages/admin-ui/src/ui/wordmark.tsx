import { cn } from '../format';

/**
 * The Bitocard logo for the console apps: the "b" mark on the left, then "Bito" and a pink "card", with an optional
 * suffix such as "SHQ". `tone="light"` is for navy and dark backgrounds (white mark and text, pink kept). Size it
 * with a text size class.
 */
export function Wordmark({ tone = 'dark', suffix, className }: { tone?: 'dark' | 'light'; suffix?: string; className?: string }) {
  const name = suffix ? `Bitocard ${suffix}` : 'Bitocard';
  return (
    <span role="img" aria-label={name} className={cn('inline-flex items-center gap-[0.3em] font-extrabold leading-none tracking-tight whitespace-nowrap', tone === 'light' ? 'text-white' : 'text-ink', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static mark from the app's public folder */}
      <img src={tone === 'light' ? '/bitocard-mark-light.png' : '/bitocard-mark.png'} alt="" aria-hidden="true" className="h-[1.15em] w-auto shrink-0" />
      <span aria-hidden="true">
        Bito<span className="text-brand-500">card</span>
        {suffix ? <span className="ml-[0.28em]">{suffix}</span> : null}
      </span>
    </span>
  );
}
