import type { CSSProperties, ReactNode } from "react";
import { Laptop, Lock, Monitor, ShieldCheck, Smartphone, Tablet, Tv, Watch } from "lucide-react";
import type { ResolvedSection, StoreDesign } from "@bitocard/api-client/storefront";

/**
 * The heroes of the VPN shop (shield, devices, tunnel) and RDP shop (desktop, rack, blueprint) variants. Their drawings
 * are decorative, made from the theme's colours (`--st-*`), so every colour theme repaints them.
 */

type Hero = Extract<ResolvedSection, { type: "hero" }>;
export type ServiceHeroKind = Extract<StoreDesign["style"]["hero"], "shield" | "devices" | "tunnel" | "desktop" | "rack" | "blueprint">;

export const serviceHeroKinds: readonly ServiceHeroKind[] = ["shield", "devices", "tunnel", "desktop", "rack", "blueprint"];

export function isServiceHero(hero: string): hero is ServiceHeroKind {
  return (serviceHeroKinds as readonly string[]).includes(hero);
}

const heroBand = { background: "linear-gradient(135deg, var(--st-hero-from), var(--st-hero-to))", color: "var(--st-hero-ink)" } as const;

function Heading({ id, section, accentClass, className }: { id: string; section: Hero; accentClass: string; className: string }) {
  return (
    <h1 id={id} className={`font-display font-extrabold tracking-tight ${className}`}>
      {section.title}
      {section.accent ? (
        <>
          {" "}
          <span className={accentClass}>{section.accent}</span>
        </>
      ) : null}
    </h1>
  );
}

/** Headline and subtitle on the left, the drawing on the right (below on phones). */
function Split({ id, section, frame, inner, style, accentClass, drawing, after }: { id: string; section: Hero; frame: string; inner: string; style?: CSSProperties; accentClass: string; drawing: ReactNode; after?: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${frame} relative isolate`} style={style}>
      {after}
      <div className={`${inner} grid gap-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center`}>
        <div>
          <Heading id={id} section={section} className="max-w-2xl text-4xl leading-[1.05] sm:text-6xl" accentClass={accentClass} />
          {section.subtitle ? <p className="mt-4 max-w-xl text-lg opacity-85">{section.subtitle}</p> : null}
        </div>
        <div aria-hidden="true" className="mx-auto w-full max-w-md">
          {drawing}
        </div>
      </div>
    </section>
  );
}

function ShieldDrawing() {
  return (
    <div className="relative grid aspect-square place-items-center">
      <span className="absolute inset-[8%] rounded-full bg-white/10 ring-1 ring-white/20" />
      <span className="absolute inset-[22%] rounded-full bg-white/10 ring-1 ring-white/20" />
      <ShieldCheck className="relative size-2/5 text-[var(--st-hero-ink)] drop-shadow-xl" strokeWidth={1.25} />
      <span className="absolute right-[14%] bottom-[18%] grid size-14 place-items-center rounded-2xl bg-[var(--st-accent)] text-white shadow-lg">
        <Lock className="size-7" />
      </span>
    </div>
  );
}

const deviceIcons = [Smartphone, Laptop, Tablet, Monitor, Tv, Watch];

function DevicesDrawing() {
  return (
    <ul className="grid grid-cols-3 gap-3">
      {deviceIcons.map((Icon, index) => (
        <li key={index} className="grid aspect-square place-items-center rounded-2xl bg-[var(--st-surface)] text-[var(--st-primary)] shadow-sm ring-1 ring-black/5">
          <Icon className="size-1/2" strokeWidth={1.5} />
        </li>
      ))}
      <li className="col-span-3 rounded-2xl bg-[var(--st-primary)] px-4 py-3 text-center text-sm font-semibold text-white">Up to 10 devices</li>
    </ul>
  );
}

function TunnelGlow() {
  return (
    <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
      {[0, 1, 2, 3, 4].map(ring => (
        <span
          key={ring}
          className="absolute top-1/2 left-[70%] aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full border opacity-40"
          style={{ width: `${30 + ring * 22}%`, borderColor: ring % 2 ? "var(--st-accent)" : "var(--st-primary)", boxShadow: "0 0 32px var(--st-primary)" }}
        />
      ))}
    </div>
  );
}

function DesktopDrawing() {
  return (
    <div className="overflow-hidden rounded-2xl bg-[var(--st-surface)] shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center gap-1.5 bg-black/5 px-3 py-2">
        {["#ef4444", "#f59e0b", "#22c55e"].map(color => (
          <span key={color} className="size-2.5 rounded-full" style={{ background: color }} />
        ))}
        <span className="ml-3 h-2 w-24 rounded-full bg-[var(--st-muted)] opacity-40" />
      </div>
      <div className="grid grid-cols-[3rem_1fr] gap-3 p-4" style={{ background: "linear-gradient(135deg, var(--st-primary), var(--st-accent))" }}>
        <div className="space-y-2">
          {[0, 1, 2, 3].map(icon => (
            <span key={icon} className="block aspect-square rounded-lg bg-white/30" />
          ))}
        </div>
        <div className="rounded-lg bg-white/90 p-3">
          <span className="block h-2 w-2/3 rounded-full bg-[var(--st-ink)] opacity-70" />
          <span className="mt-2 block h-2 w-1/2 rounded-full bg-[var(--st-muted)] opacity-50" />
          <span className="mt-4 block h-16 rounded-md bg-[var(--st-primary)] opacity-15" />
        </div>
      </div>
      <div className="flex justify-center gap-2 bg-black/5 py-2">
        {[0, 1, 2, 3, 4].map(dot => (
          <span key={dot} className="size-4 rounded bg-[var(--st-primary)] opacity-60" />
        ))}
      </div>
    </div>
  );
}

function RackDrawing() {
  return (
    <div className="space-y-2 rounded-md bg-black/40 p-3 ring-1 ring-white/10">
      {[0, 1, 2, 3, 4].map(unit => (
        <div key={unit} className="flex items-center gap-2 rounded-sm bg-[var(--st-surface)] px-3 py-2.5 ring-1 ring-white/5">
          <span className="size-2 rounded-full bg-[var(--st-primary)] shadow-[0_0_8px_var(--st-primary)]" />
          <span className={`size-2 rounded-full ${unit % 2 ? "bg-[var(--st-accent)] shadow-[0_0_8px_var(--st-accent)]" : "bg-white/20"}`} />
          <span className="ml-2 flex flex-1 gap-1">
            {Array.from({ length: 10 }, (_, slot) => (
              <span key={slot} className="h-3 flex-1 rounded-[1px] bg-white/10" />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function BlueprintDrawing() {
  return (
    <div className="relative aspect-[4/3] rounded-lg border-2 border-dashed border-[var(--st-primary)] p-5 opacity-90">
      <div className="h-full rounded-md border-2 border-[var(--st-primary)] bg-[var(--st-surface)] p-3">
        <span className="block h-2 w-1/3 rounded-full bg-[var(--st-primary)]" />
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[0, 1, 2].map(box => (
            <span key={box} className="aspect-video rounded border border-[var(--st-primary)]" />
          ))}
        </div>
        <span className="mt-4 block h-2 w-1/2 rounded-full bg-[var(--st-accent)]" />
      </div>
      <span className="absolute -top-3 left-6 bg-[var(--st-hero-from)] px-2 font-mono text-xs text-[var(--st-primary)]">1920 × 1080</span>
    </div>
  );
}

const grid = "[background-image:linear-gradient(var(--st-primary)_1px,transparent_1px),linear-gradient(90deg,var(--st-primary)_1px,transparent_1px)] [background-size:32px_32px] opacity-[0.08]";

/** The hero for a VPN shop or RDP shop variant. */
export function ServiceHero({ kind, section, id, frame, inner }: { kind: ServiceHeroKind; section: Hero; id: string; frame: string; inner: string }) {
  switch (kind) {
    case "shield":
      return <Split id={id} section={section} frame={frame} inner={inner} style={heroBand} accentClass="text-[var(--st-accent)]" drawing={<ShieldDrawing />} />;
    case "devices":
      return <Split id={id} section={section} frame={`${frame} text-[var(--st-hero-ink)]`} inner={inner} style={{ background: "linear-gradient(180deg, var(--st-hero-from), var(--st-hero-to))" }} accentClass="text-[var(--st-primary)]" drawing={<DevicesDrawing />} />;
    case "tunnel":
      return <Split id={id} section={section} frame={frame} inner={inner} style={heroBand} accentClass="text-[var(--st-primary)] [text-shadow:0_0_24px_var(--st-primary)]" drawing={<ShieldDrawing />} after={<TunnelGlow />} />;
    case "desktop":
      return <Split id={id} section={section} frame={frame} inner={inner} style={heroBand} accentClass="text-[var(--st-accent)]" drawing={<DesktopDrawing />} />;
    case "rack":
      return <Split id={id} section={section} frame={frame} inner={inner} style={heroBand} accentClass="text-[var(--st-primary)]" drawing={<RackDrawing />} />;
    case "blueprint":
      return (
        <Split
          id={id}
          section={section}
          frame={`${frame} text-[var(--st-hero-ink)]`}
          inner={inner}
          style={{ background: "var(--st-hero-from)" }}
          accentClass="text-[var(--st-primary)]"
          drawing={<BlueprintDrawing />}
          after={<div aria-hidden="true" className={`absolute inset-0 -z-10 ${grid}`} />}
        />
      );
  }
}
