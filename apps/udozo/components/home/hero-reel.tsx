import Link from "next/link";
import { Marquee } from "@/components/marquee";
import { collageOf, filledSlides, heroRows, type ShownSlide, type ShownTile } from "@/lib/hero";

/** Each banner's row span (its share of the column's three rows). */
const spans: Record<number, string> = { 1: "row-span-1", 2: "row-span-2", 3: "row-span-3" };

/**
 * A linked banner answers the pointer (and keyboard focus) on its own: it fades a little and its colours deepen and
 * shift slightly, quickly and without moving (none at all for reduced motion). Banners without a link stay still.
 */
export const hover = "transition-[opacity,filter] duration-200 ease-out motion-reduce:transition-none group-hover:opacity-85 group-hover:saturate-150 group-hover:hue-rotate-15 group-focus-visible:opacity-85 group-focus-visible:saturate-150";

function Tile({ tile, rows, first, hidden }: { tile: ShownTile; rows: number; first: boolean; hidden: boolean }) {
  const linked = Boolean(tile.link);
  const load = { draggable: false, loading: first ? ("eager" as const) : ("lazy" as const), decoding: "async" as const };
  const adLabel = (place: string) => (tile.ad ? <span className={`absolute ${place} bg-black/60 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white`}>Ad</span> : null);
  // No image uploaded: photos of what it links to, side by side, with the banner's words over them.
  const collage = tile.image_url ? null : collageOf(tile.photos, rows);
  const picture = collage ? (
    <>
      <span data-hero-collage={collage.photos.length} className={`grid size-full gap-px bg-white ${collage.grid}`}>
        {collage.photos.map((src, at) => (
          // eslint-disable-next-line @next/next/no-img-element -- listing photos on Udozo's storage
          <img key={`${src}-${at}`} src={src} alt="" {...load} className={`size-full min-h-0 object-cover select-none ${linked ? hover : ""}`} />
        ))}
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-3 pt-8 pb-2.5 text-sm leading-snug font-bold text-white sm:text-base">{tile.alt}</span>
      {adLabel("top-1.5 left-1.5")}
    </>
  ) : (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- banners on Udozo's storage, any size the team uploaded */}
      <img src={tile.image_url!} alt={tile.alt} {...load} fetchPriority={first ? "high" : undefined} className={`size-full object-cover select-none ${linked ? hover : ""}`} />
      {adLabel("bottom-1.5 left-1.5")}
    </>
  );
  const box = `relative block min-h-0 overflow-hidden rounded-md bg-navy-100 ${linked ? "group" : ""} ${spans[rows] ?? "row-span-1"}`;
  if (!tile.link) return <div className={box}>{picture}</div>;
  const focus = hidden ? { tabIndex: -1 } : {};
  return tile.link.external ? (
    <a href={tile.link.href} target="_blank" rel={tile.ad ? "sponsored noopener" : "noopener"} className={box} {...focus}>
      {picture}
    </a>
  ) : (
    <Link href={tile.link.href} prefetch={false} className={box} {...focus}>
      {picture}
    </Link>
  );
}

/**
 * udozo.com's hero reel, the home page's top below the header in place of its own hero: columns three rows high, each
 * one banner, a third and two thirds (either way up) or three thirds, 6 px apart on white with small rounded corners (a
 * banner without an image shows photos of its listings under its words, `collageOf`), sliding past on
 * their own and moved by hand (dragged with the mouse, swiped, scrolled), with a Pause button (`Marquee`). Few columns
 * are repeated so the reel always fills the screen; repeats are hidden from screen readers and the tab order. `title`
 * is the page's heading (the hero's, which this replaces), for screen readers and search engines.
 */
export function HeroReel({ slides, title }: { slides: ShownSlide[]; title: string }) {
  const columns = filledSlides(slides);
  return (
    <section aria-label="Featured" className="bg-white py-1.5">
      <h1 className="sr-only">{title}</h1>
      <Marquee label="Featured on Udozo" count={columns.length} speed="slow" tight>
        {columns.map(({ slide, repeat }, index) => (
          <li
            key={`${slide.id}-${repeat}`}
            aria-hidden={repeat > 0 || undefined}
            data-hero-slide={slide.id}
            className="grid h-[330px] w-[78vw] max-w-[440px] gap-1.5 sm:h-[420px] sm:w-[380px] lg:h-[480px] lg:w-[440px]"
            style={{ gridTemplateRows: "repeat(3, minmax(0, 1fr))" }}
          >
            {slide.tiles.map((tile, at) => (
              <Tile key={tile.id} tile={tile} rows={heroRows[slide.layout][at] ?? 1} first={index === 0} hidden={repeat > 0} />
            ))}
          </li>
        ))}
      </Marquee>
    </section>
  );
}
