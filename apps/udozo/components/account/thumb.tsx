/* eslint-disable @next/next/no-img-element -- listing photos from the media CDN. */
import { ImageIcon } from "lucide-react";

/** A listing's square cover, or a plain tile while it has none. */
export function Thumb({ url, size = "size-[72px]" }: { url: string | null | undefined; size?: string }) {
  return (
    <span className={`${size} grid shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100`}>
      {url ? <img src={url} alt="" className="size-full object-cover" loading="lazy" /> : <ImageIcon className="size-6 text-slate-400" aria-hidden="true" />}
    </span>
  );
}
