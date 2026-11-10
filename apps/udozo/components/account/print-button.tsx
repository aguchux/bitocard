"use client";

/** Prints the page (a parcel label): the browser's own print, to paper or a PDF. */
export function PrintButton({ label = "Print the label" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="h-10 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
      {label}
    </button>
  );
}
