"use client";

/** Prints the page (the browser's own dialog, or saving it as a PDF). */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-11 items-center justify-center rounded-xl border border-pos-line bg-white px-4 font-semibold text-pos-ink hover:bg-pos-50 print:hidden"
    >
      {label}
    </button>
  );
}
