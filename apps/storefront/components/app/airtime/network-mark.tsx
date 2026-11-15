import { networkIcon } from "@/lib/airtime-rules";

/** Each network's colour where BitoCard has no icon for it: its initials on that colour. */
const tint: Record<string, string> = { mtn: "bg-yellow-400 text-navy-900", airtel: "bg-red-600 text-white", glo: "bg-green-600 text-white", "9mobile": "bg-emerald-800 text-white" };

/** A network's mark on a white tile, else its initials on its own colour. */
export function NetworkMark({ network, name, className = "size-11" }: { network: string; name: string; className?: string }) {
  const icon = networkIcon(network);
  return icon ? (
    // eslint-disable-next-line @next/next/no-img-element -- a small local SVG
    <img src={icon} alt="" className={`${className} shrink-0 rounded-xl bg-white object-contain p-1.5 ring-1 ring-slate-200`} />
  ) : (
    <span aria-hidden="true" className={`${className} grid shrink-0 place-items-center rounded-xl text-sm font-extrabold ${tint[network] ?? "bg-slate-200 text-navy-900"}`}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
