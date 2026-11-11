"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { PinPad } from "@/components/pin-pad";
import { type PosDeviceInfo, type PosInviteInfo, weakPin } from "@/lib/pos";
import { acceptInvite, deviceGone, deviceSignIn, linkDevice, lookupInvite, staffSignIn } from "@/lib/staff-actions";

const field = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-4 text-base";
const primary = "inline-flex h-12 w-full items-center justify-center rounded-xl bg-pos-600 px-5 font-bold text-white hover:bg-pos-700 disabled:cursor-not-allowed disabled:opacity-50";

function Problem({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-xl bg-pos-warn-bg p-3 text-sm font-semibold text-pos-warn">
      {message}
    </p>
  ) : null;
}

/** Staff on the web: the shop code, their phone and their 4-digit PIN. No Udozo account. */
export function StaffSignInForm() {
  const router = useRouter();
  const [shopCode, setShopCode] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        start(async () => {
          const result = await staffSignIn(shopCode, phone, pin);
          if (!result.ok) {
            setMessage(result.message);
            setPin("");
            return;
          }
          router.push("/app");
          router.refresh();
        });
      }}
      className="mt-4 grid gap-3"
    >
      <label className="text-sm font-semibold text-pos-ink-2">
        Shop code
        <input value={shopCode} onChange={event => setShopCode(event.target.value.toUpperCase())} placeholder="ADA-4821" autoComplete="off" autoCapitalize="characters" maxLength={8} required className={field} />
      </label>
      <label className="text-sm font-semibold text-pos-ink-2">
        Your phone number
        <input type="tel" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" maxLength={20} required className={field} />
      </label>
      <PinPad value={pin} onChange={setPin} label="Your PIN" disabled={pending} />
      <Problem message={message} />
      <button type="submit" disabled={pending || pin.length !== 4} className={primary}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

/** A linked till: "Who's selling?" Tap your name, then your PIN. */
export function TillTiles({ device }: { device: PosDeviceInfo }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<PosDeviceInfo["staff"][number] | null>(null);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The fourth digit signs them in, once: a wrong PIN clears the box for the next try.
  const enter = (next: string) => {
    setPin(next);
    if (!chosen || next.length !== 4 || pending) return;
    start(async () => {
      const result = await deviceSignIn(chosen.id, next);
      if (!result.ok) {
        setMessage(result.message);
        setPin("");
        return;
      }
      router.push("/app/till");
      router.refresh();
    });
  };

  if (chosen) {
    return (
      <section aria-labelledby="pin" className="mx-auto grid w-full max-w-sm gap-4 rounded-[20px] bg-white p-6">
        <h2 id="pin" className="font-display text-2xl font-bold text-pos-ink">
          Signing in as {chosen.name}
        </h2>
        <PinPad value={pin} onChange={enter} label="Your PIN" disabled={pending} autoFocus />
        <Problem message={message} />
        <button type="button" onClick={() => {
            setChosen(null);
            setPin("");
            setMessage(null);
          }} className="h-12 rounded-xl border border-pos-line font-bold">
          Not you? Back
        </button>
        <p className="text-sm text-pos-muted">Forgot your PIN? A manager or the shop owner can send you a new one.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="who" className="grid gap-4">
      <div>
        <h1 id="who" className="font-display text-3xl font-bold text-pos-ink">
          Who’s selling?
        </h1>
        <p className="mt-1 text-pos-ink-2">
          {device.shop.name} · {device.till.name} · Shop code {device.shop.shop_code}
        </p>
      </div>
      {device.staff.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {device.staff.map(person => (
            <li key={person.id}>
              <button type="button" onClick={() => setChosen(person)} disabled={person.locked} className="flex w-full flex-col items-center gap-2 rounded-[20px] border border-pos-line bg-white p-4 hover:bg-pos-50 disabled:opacity-50">
                <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-pos-50 font-display text-xl font-bold text-pos-700">
                  {person.initials}
                </span>
                <span className="font-semibold text-pos-ink">{person.name}</span>
                <span className="text-sm text-pos-muted">{person.locked ? "Locked for a while" : person.role}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[20px] bg-white p-6 text-pos-ink-2">Nobody may sell at this till yet. The shop owner invites staff from Staff on Udozo POS.</p>
      )}
    </section>
  );
}

/** Links this browser to a till with the code the owner made (typed, or from the link's `#c=`). */
export function LinkDeviceForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // The code from the link's `#c=` (read once, then cleared from the address bar) fills the field in.
  const fromLink = useRef<string | null>(null);
  useEffect(() => {
    if (fromLink.current === null) {
      fromLink.current = new URLSearchParams(window.location.hash.slice(1)).get("c")?.toUpperCase() ?? "";
      if (fromLink.current) window.history.replaceState(null, "", window.location.pathname);
    }
    let live = true;
    const found = fromLink.current;
    if (found) void Promise.resolve(found).then(value => live && setCode(value));
    return () => {
      live = false;
    };
  }, []);
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        start(async () => {
          const result = await linkDevice(code, name);
          if (!result.ok) {
            setMessage(result.message);
            return;
          }
          router.push("/signin/till");
          router.refresh();
        });
      }}
      className="grid gap-3"
    >
      <label className="text-sm font-semibold text-pos-ink-2">
        Link code
        <input value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="4F7K-29QX" autoComplete="off" autoCapitalize="characters" maxLength={9} required className={`${field} font-display tracking-widest`} />
      </label>
      <label className="text-sm font-semibold text-pos-ink-2">
        Name this device (optional)
        <input value={name} onChange={event => setName(event.target.value)} placeholder="Front counter" maxLength={60} className={field} />
      </label>
      <Problem message={message} />
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "Linking…" : "Link this device"}
      </button>
    </form>
  );
}

/** A linked device the shop unlinked: forget it here, then link again. */
export function DeviceGone() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() =>
        start(async () => {
          await deviceGone();
          router.push("/link");
        })
      } className={primary}>
      Link it again
    </button>
  );
}

/** The invite page: who invited them, the role and what it allows, then their own 4-digit PIN, twice. */
export function AcceptInviteForm() {
  const router = useRouter();
  const token = useRef<string | null>(null);
  const [invite, setInvite] = useState<PosInviteInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [pending, start] = useTransition();

  // The token from the link's `#t=` (never sent to a server log), read once and cleared from the address bar.
  const loading = useRef<Promise<{ ok: true; data: PosInviteInfo } | { ok: false; message: string }> | null>(null);
  useEffect(() => {
    if (!loading.current) {
      const found = new URLSearchParams(window.location.hash.slice(1)).get("t");
      window.history.replaceState(null, "", window.location.pathname);
      token.current = found;
      loading.current = found ? lookupInvite(found) : Promise.resolve({ ok: false as const, message: "This invite link is not complete. Open it again from the message the shop sent you." });
    }
    let live = true;
    void loading.current.then(result => {
      if (!live) return;
      if (result.ok) setInvite(result.data);
      else setMessage(result.message);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!invite) {
    return message ? <Problem message={message} /> : <p className="text-pos-ink-2">Opening your invite…</p>;
  }
  const easy = pin.length === 4 && weakPin(pin);
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="font-display text-3xl font-bold text-pos-ink">
          Hi {invite.first_name}, {invite.reset ? "set a new PIN" : `you’re invited to sell at ${invite.shop.name ?? "the shop"}`}
        </h1>
        <p className="mt-2 text-pos-ink-2">
          Role: {invite.role.name} · {invite.tills === "all" ? "Every till" : invite.tills.join(", ")} · Invited by {invite.invited_by}
        </p>
      </div>
      {invite.role.allows.length ? (
        <section aria-labelledby="can" className="rounded-[20px] bg-white p-5">
          <h2 id="can" className="font-semibold text-pos-ink">
            As {invite.role.name.toLowerCase()} you can
          </h2>
          <ul className="mt-2 grid gap-1 text-pos-ink-2">
            {invite.role.allows.map(line => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="font-bold text-pos-600">
                  ✓
                </span>
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form
        onSubmit={event => {
          event.preventDefault();
          if (pin !== again) {
            setMessage("The two PINs are not the same.");
            return;
          }
          if (weakPin(pin)) {
            setMessage("Choose a PIN that is harder to guess: not 1234, one digit four times or a year.");
            return;
          }
          start(async () => {
            const result = await acceptInvite(token.current ?? "", pin);
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            router.push("/app");
            router.refresh();
          });
        }}
        className="grid gap-4 rounded-[20px] bg-white p-5"
      >
        <PinPad value={pin} onChange={setPin} label="Create your 4-digit PIN" disabled={pending} />
        {easy ? <p className="text-sm font-semibold text-pos-warn">That PIN is easy to guess. Avoid 1234, one digit four times or your birth year.</p> : null}
        <PinPad value={again} onChange={setAgain} label="Type it again" disabled={pending} />
        <Problem message={message} />
        <button type="submit" disabled={pending || pin.length !== 4 || again.length !== 4} className={primary}>
          {pending ? "Joining…" : invite.reset ? "Save my PIN" : "Join the shop"}
        </button>
        <p className="text-sm text-pos-muted">
          No Udozo account needed. Your PIN works only at this shop{invite.shop.shop_code ? `, with shop code ${invite.shop.shop_code}` : ""}. This invite expires {new Date(invite.expires_at).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.
        </p>
      </form>
    </div>
  );
}
