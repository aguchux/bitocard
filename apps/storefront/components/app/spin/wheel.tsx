import type { Ref } from "react";
import type { StoreSpinSegment } from "@bitocard/api-client/storefront";
import { colors } from "@bitocard/ui/tokens";
import { dollar, segmentTones, type SegmentTone, usd } from "@/lib/spin";
import styles from "./spin.module.css";

/** The disc is drawn in 400 units; the fixed rim around it in 440 (the disc sits 20 units inside the rim's edge). */
const centre = 200;
const radius = 196;

/** A point `degrees` clockwise from the top, `r` from the centre `c`. */
function at(degrees: number, r: number, c = centre) {
  const rad = (degrees * Math.PI) / 180;
  return [c + r * Math.sin(rad), c - r * Math.cos(rad)] as const;
}
const xy = ([x, y]: readonly [number, number]) => `${x.toFixed(2)} ${y.toFixed(2)}`;
const wedge = (start: number, end: number) => `M ${centre} ${centre} L ${xy(at(start, radius))} A ${radius} ${radius} 0 0 1 ${xy(at(end, radius))} Z`;

const fill: Record<SegmentTone, string> = { navy: "url(#spin-navy)", pink: "url(#spin-pink)", gold: "url(#spin-gold)" };
const ink: Record<SegmentTone, string> = { navy: "white", pink: "white", gold: colors.navy900 };

/** Gold metal, light from the top left: the pegs, the rim and the hub ring. */
function Metal({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={colors.gold200} />
      <stop offset="0.3" stopColor={colors.gold400} />
      <stop offset="0.55" stopColor={colors.gold700} />
      <stop offset="0.8" stopColor={colors.gold500} />
      <stop offset="1" stopColor={colors.gold200} />
    </linearGradient>
  );
}

/**
 * The turning disc: a wedge per segment (navy and pink, the top prize gold), each with its value and coin, gold pegs on
 * the lines the pointer clicks against, and the won wedge lit once the wheel lands (`won`, its position).
 */
export function WheelDisc({ segments, won }: { segments: StoreSpinSegment[]; won: number | null }) {
  const width = 360 / segments.length;
  const tones = segmentTones(segments);
  return (
    <svg viewBox="0 0 400 400" className="block size-full" aria-hidden="true">
      <defs>
        <radialGradient id="spin-navy">
          <stop offset="0.25" stopColor={colors.navy700} />
          <stop offset="1" stopColor={colors.navy950} />
        </radialGradient>
        <radialGradient id="spin-pink">
          <stop offset="0.25" stopColor={colors.brand400} />
          <stop offset="1" stopColor={colors.brand700} />
        </radialGradient>
        <radialGradient id="spin-gold">
          <stop offset="0.25" stopColor={colors.gold200} />
          <stop offset="0.7" stopColor={colors.gold400} />
          <stop offset="1" stopColor={colors.gold500} />
        </radialGradient>
        <Metal id="spin-peg" />
      </defs>
      <circle cx={centre} cy={centre} r={200} fill={colors.navy950} />
      {segments.map((segment, i) => {
        const start = i * width;
        const tone = tones[i];
        return (
          <g key={segment.index}>
            <path d={wedge(start, start + width)} fill={fill[tone]} stroke={colors.gold400} strokeOpacity={0.75} strokeWidth={1.25} />
            <g transform={`rotate(${start + width / 2} ${centre} ${centre})`}>
              <text
                x={centre}
                y={centre - radius * 0.75}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={ink[tone]}
                fontSize={tone === "gold" ? 24 : 22}
                fontWeight={900}
                className="font-display"
                stroke={tone === "gold" ? "none" : "black"}
                strokeOpacity={0.3}
                strokeWidth={3}
                paintOrder="stroke"
              >
                {usd(segment.usd)}
              </text>
              <rect x={centre - 24} y={centre - radius * 0.53 - 10} width={48} height={20} rx={10} fill={dollar.colour} stroke="white" strokeOpacity={0.55} />
              <text x={centre} y={centre - radius * 0.53} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={10.5} fontWeight={800} className="font-display">
                USD
              </text>
            </g>
          </g>
        );
      })}
      {won !== null && won >= 0 && won < segments.length ? <path d={wedge(won * width, (won + 1) * width)} fill="white" className={styles.winWedge} /> : null}
      {segments.map((segment, i) => {
        const [x, y] = at(i * width, radius - 7);
        return <circle key={segment.index} cx={x} cy={y} r={4.2} fill="url(#spin-peg)" stroke={colors.navy950} strokeWidth={1} />;
      })}
      <circle cx={centre} cy={centre} r={64} fill={colors.navy950} stroke="url(#spin-peg)" strokeWidth={6} />
    </svg>
  );
}

/** The fixed gold rim round the disc, with 24 bulbs that blink, chase and flash with the wheel (spin.module.css). */
export function WheelFrame() {
  const c = 220;
  return (
    <svg viewBox="0 0 440 440" className="absolute inset-0 block size-full" aria-hidden="true">
      <defs>
        <Metal id="spin-rim" />
      </defs>
      <circle cx={c} cy={c} r={219} fill="url(#spin-rim)" />
      <circle cx={c} cy={c} r={213.5} fill="none" stroke={colors.navy950} strokeOpacity={0.55} strokeWidth={9} />
      <circle cx={c} cy={c} r={202} fill={colors.navy950} />
      {Array.from({ length: 24 }, (_, i) => {
        const [x, y] = at(i * 15 + 7.5, 213.5, c);
        return (
          <g key={i} className={i % 2 ? `${styles.bulb} ${styles.bulbAlt}` : styles.bulb}>
            <circle cx={x} cy={y} r={6.5} fill={colors.gold400} opacity={0.35} />
            <circle cx={x} cy={y} r={3.4} fill={colors.gold200} />
          </g>
        );
      })}
    </svg>
  );
}

/** The fixed pointer at the top: gold, with a pink jewel where it pivots. */
export function Pointer({ ref }: { ref: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={styles.pointer} aria-hidden="true">
      <svg viewBox="0 0 48 64" className="block size-full">
        <defs>
          <linearGradient id="spin-pointer" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={colors.gold200} />
            <stop offset="0.55" stopColor={colors.gold400} />
            <stop offset="1" stopColor={colors.gold700} />
          </linearGradient>
        </defs>
        <path d="M24 62 L7 26 A18 18 0 1 1 41 26 Z" fill="url(#spin-pointer)" stroke={colors.navy950} strokeWidth={2.5} strokeLinejoin="round" />
        <circle cx={24} cy={20} r={8.5} fill={colors.brand500} stroke={colors.gold200} strokeWidth={2} />
        <circle cx={21.5} cy={17.5} r={2.6} fill="white" opacity={0.85} />
      </svg>
    </div>
  );
}
