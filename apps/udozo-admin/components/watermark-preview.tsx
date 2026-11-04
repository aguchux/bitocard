import { Smartphone } from "lucide-react";

/**
 * How a listing photo looks with the watermark, drawn in CSS on a sample photo: the text in the bottom-right corner
 * (white with a soft shadow, about 3.5% of the width high) and the same text large and faint across the middle. Only a
 * preview: udozo.com draws the real mark into each photo (docs/UDOZO_WATERMARK_PLAN.md).
 */
export function WatermarkPreview({ text, className }: { text: string; className?: string }) {
  const shown = text.trim() || "udozo.com";
  return (
    <figure className={className}>
      <div
        role="img"
        aria-label={`Preview of a listing photo marked “${shown}”`}
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-line bg-gradient-to-br from-slate-300 via-slate-200 to-amber-100"
        style={{ containerType: "inline-size" }}
      >
        <Smartphone className="absolute left-1/2 top-1/2 size-1/3 -translate-x-1/2 -translate-y-1/2 text-slate-500/60" strokeWidth={1.2} aria-hidden />
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 whitespace-nowrap font-bold text-white"
          style={{ fontSize: "9cqw", opacity: 0.16, transform: "translate(-50%, -50%) rotate(-12deg)", textShadow: "0 0 1cqw rgba(0,0,0,0.6)" }}
          data-testid="watermark-centre"
        >
          {shown}
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute whitespace-nowrap font-semibold text-white"
          style={{ fontSize: "3.5cqw", right: "2.5cqw", bottom: "2cqw", textShadow: "0 0.15cqw 0.6cqw rgba(0,0,0,0.65)" }}
          data-testid="watermark-corner"
        >
          {shown}
        </span>
      </div>
      <figcaption className="mt-2 text-xs text-muted">Preview on a sample photo. udozo.com draws the mark into every listing photo it serves.</figcaption>
    </figure>
  );
}
