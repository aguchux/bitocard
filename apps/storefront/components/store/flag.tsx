import { Globe2 } from "lucide-react";

/** A country's flag from `/flags/<code>.svg`; a globe for "all countries" and "usable anywhere". */
export function Flag({ code, className = "h-4 w-6" }: { code?: string | null; className?: string }) {
  if (!code || !/^[a-z]{2}$/i.test(code)) return <Globe2 className={`${className} text-slate-500`} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs; the image optimiser adds nothing
  return <img src={`/flags/${code.toLowerCase()}.svg`} alt="" width={24} height={16} className={`${className} shrink-0 rounded-[3px] object-cover shadow-[0_0_0_1px_rgba(7,15,76,.12)]`} />;
}
