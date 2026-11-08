import Link from "next/link";
import { Marquee } from "@/components/marquee";
import { filledSlides, heroRows, type ShownSlide, type ShownTile } from "@/lib/hero";

/** Each banner's row span (its share of the column's three rows). */
const spans: Record<number, string> = { 1: "row-span-1", 2: "row-span-2", 3: "row-span-3" };

/**
 * A linked banner answers the pointer (and keyboard focus) on its own: it fades a little and its colours deepen and
 * shift slightly, quickly and without moving (none at all for reduced motion). Banners without a link stay still.
 */
export const hover = "transition-[opacity,filter] duration-200 ease-out motion-reduce:transition-none group-hover:opacity-85 group-hover:saturate-150 group-hover:hue-rotate-15 group-focus-visible:opacity-85 group-focus-visible:saturate-150";

function Tile({ tile, rows, first, hidden }: { tile: ShownTile; rows: number; first: boolean; hidden: boolean }) {
  const linked = Boolean(tile.link);
  const picture = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- banners on Udozo's storage, any size the team uploaded */}
      <img src={tile.image_url} alt={tile.alt} draggable={false} loading={first ? "eager" : "lazy"} fetchPriority={first ? "high" : undefined} decoding="async" className={`size-full object-cover select-none ${linked ? hover : ""}`} />
      {tile.ad ? <span className="absolute bottom-1.5 left-1.5 bg-black/60 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white">Ad</span> : null}
    </>
  );
  const box = `relative block min-h-0 overflow-hidden bg-navy-100 ${linked ? "group" : ""} ${spans[rows] ?? "row-span-1"}`;
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
 * one banner, a third and two thirds (either way up) or three thirds, 6 px apart on white and square-cornered, sliding past on
 * their own and moved by hand (dragged with the mouse, swiped, scrolled), with a Pause button (`Marquee`). Few columns
 * are repeated so the reel always fills the screen; repeats are hidden from screen readers and the tab order. `title`
 * is the page's heading (the hero's, which this replaces), for screen readers and search engines.
 */
export function HeroReel({ slides, title }: { slides: ShownSlide[]; title: string }) {
  const columns = filledSlides(slides);
  return (
    <section aria-label="Featured" className="bg-white py-1.5">
      <h1 className="sr-only">{title}</h1>
      <Marquee label="Featured on Udozo" count={columns.length} speed="normal" tight>
        {columns.map(({ slide, repeat }, index) => (
          <li
            key={`${slide.id}-${repeat}`}
            aria-hidden={repeat > 0 || undefined}
            data-hero-slide={slide.id}
            // As wide as one row is high (three rows less the two 6 px gaps), so a third is a square, two thirds an
            // upright 1:2 rectangle and a whole column an upright 1:3 strip: narrow columns, many on screen.
            className="grid h-[330px] w-[106px] gap-1.5 sm:h-[420px] sm:w-[136px] lg:h-[480px] lg:w-[156px]"
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
