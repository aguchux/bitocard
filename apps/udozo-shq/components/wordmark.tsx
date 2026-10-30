import { cn } from "@bitocard/admin-ui";

/**
 * Udozo's lockup: its mark on the left of the name, with an optional suffix ("Seller HQ"). The shared `Wordmark` in
 * `@bitocard/admin-ui` draws BitoCard's; Udozo's apps draw their own from `/udozo-mark.png` (and the light mark on navy).
 */
export function UdozoWordmark({ tone = "dark", suffix, className }: { tone?: "dark" | "light"; suffix?: string; className?: string }) {
  const name = suffix ? `Udozo ${suffix}` : "Udozo";
  return (
    <span role="img" aria-label={name} className={cn("inline-flex items-center gap-[0.3em] font-extrabold leading-none tracking-tight whitespace-nowrap", tone === "light" ? "text-white" : "text-ink", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static mark from the app's public folder */}
      <img src={tone === "light" ? "/udozo-mark-light.png" : "/udozo-mark.png"} alt="" aria-hidden="true" className="h-[1.15em] w-auto shrink-0" />
      <span aria-hidden="true">
        Udo<span className="text-brand-500">zo</span>
        {suffix ? <span className="ml-[0.28em]">{suffix}</span> : null}
      </span>
    </span>
  );
}
