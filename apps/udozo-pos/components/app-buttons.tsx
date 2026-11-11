import Link from "next/link";
import { appPlatforms, type PosApps } from "@/lib/pos";

/**
 * Google Play, the App Store and the Microsoft Store, each a link to its store once admins set it, and until then
 * Coming soon and not a link, so the site never claims an app that does not exist. The browser always works.
 */
export function AppButtons({ apps }: { apps: PosApps }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {appPlatforms.map(platform => {
        const url = apps[platform.key];
        const inner = (
          <>
            <span className="text-xs text-pos-night-muted">{url ? platform.lead : `${platform.name}:`}</span>
            <span className="font-display text-lg font-bold">{url ? platform.store : "Coming soon"}</span>
          </>
        );
        return (
          <li key={platform.key}>
            {url ? (
              <a href={url} rel="noopener" className="flex min-h-16 flex-col justify-center rounded-2xl border border-pos-night-line bg-pos-night-2 px-4 text-white no-underline hover:border-pos-500" aria-label={`${platform.name}: ${platform.store}`}>
                {inner}
              </a>
            ) : (
              <span className="flex min-h-16 flex-col justify-center rounded-2xl border border-dashed border-pos-night-line px-4 text-pos-night-text" aria-label={`${platform.name} app: coming soon`}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
      <li>
        <Link href="/app" className="flex min-h-16 flex-col justify-center rounded-2xl bg-pos-500 px-4 text-white no-underline hover:bg-pos-600">
          <span className="text-xs text-pos-50">Use it in your browser</span>
          <span className="font-display text-lg font-bold">pos.udozo.com</span>
        </Link>
      </li>
    </ul>
  );
}
