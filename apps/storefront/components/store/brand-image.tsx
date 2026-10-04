"use client";

import { type ReactNode, useState } from "react";

/**
 * A logo or card image that shows `fallback` (the brand's initials) if the address fails to load. With `frame`, the
 * image sits in a wrapper with those classes (the white logo tile), which goes too if it fails.
 */
export function BrandImage({ src, className, fallback, frame }: { src: string; className: string; fallback: ReactNode; frame?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element -- brand logos are https addresses on any host (registry, uploads)
  const image = <img src={src} alt="" className={className} loading="lazy" onError={() => setFailed(true)} />;
  return frame ? <span className={frame}>{image}</span> : image;
}
