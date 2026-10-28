import { cn } from "@bitocard/admin-ui";

/** Afrippa's lockup: the "a" mark, then "Afri" in the ink colour (white on navy) and "ppa" in the accent. */
export function AfrippaWordmark({ tone = "dark", className }: { tone?: "dark" | "light"; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-extrabold tracking-tight", tone === "light" ? "text-white" : "text-navy-900", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the mark from this app's public folder */}
      <img src={tone === "light" ? "/afrippa-mark-light.png" : "/afrippa-mark.png"} alt="" className="h-[1.1em] w-auto" />
      <span>
        Afri<span className="text-brand-500">ppa</span>
      </span>
    </span>
  );
}
