"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { PinBoxes } from "@/components/pin-boxes";
import { PinPad } from "@/components/pin-pad";
import { easyPinText, type PosDeviceInfo, type PosInviteInfo, weakPin } from "@/lib/pos";
import { acceptInvite, changePin, deviceGone, deviceSignIn, linkDevice, lookupInvite, staffSignIn } from "@/lib/staff-actions";
import { rememberPin } from "@/lib/offline-store";

const field = "mt-1 h-12 w-full rounded-xl border border-pos-line bg-white px-4 text-base";
const primary = "inline-flex h-12 w-full items-center justify-center rounded-xl bg-pos-600 px-5 font-bold text-white hover:bg-pos-700 disabled:cursor-not-allowed disabled:opacity-50";

function Problem({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-xl bg-pos-warn-bg p-3 text-sm font-semibold text-pos-warn">
      {message}
    </p>
  ) : null;
}

/** Staff on the web: the shop code, their phone and their 6-digit PIN (4 for a PIN set before). No Udozo account. */
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
      <PinBoxes value={pin} onChange={setPin} label="Your PIN" disabled={pending} />
      <Problem message={message} />
      <button type="submit" disabled={pending || (pin.length !== 6 && pin.length !== 4)} className={primary}>
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

  // The sixth digit signs them in, once: a wrong PIN clears the box for the next try. A 4-digit PIN from before PINs were
  // 6 digits signs in with the button, then they choose a new one.
  const submit = (next: string) => {
    if (!chosen || (next.length !== 6 && next.length !== 4) || pending) return;
    start(async () => {
      const result = await deviceSignIn(chosen.id, next);
      if (!result.ok) {
        setMessage(result.message);
        setPin("");
        return;
      }
      // The till keeps a check of this PIN (never the PIN), so they can sign in here offline: 6-digit PINs only.
      if (next.length === 6) void rememberPin(chosen.id, next).catch(() => undefined);
      router.push("/app/till");
      router.refresh();
    });
  };
  const enter = (next: string) => {
    setPin(next);
    if (next.length === 6) submit(next);
  };

  if (chosen) {
    return (
      <section aria-labelledby="pin" className="mx-auto grid w-full max-w-sm gap-4 rounded-[20px] bg-white p-6">
        <h2 id="pin" className="font-display text-2xl font-bold text-pos-ink">
          Signing in as {chosen.name}
        </h2>
        <PinPad value={pin} onChange={enter} label="Your PIN" disabled={pending} autoFocus />
        <Problem message={message} />
        {pin.length === 4 ? (
          <button type="button" onClick={() => submit(pin)} disabled={pending} className={primary}>
            Sign in with my old 4-digit PIN
          </button>
        ) : null}
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

/**
 * The invite, one step at a time: who invited them, the role and what it allows (Accept), then their own 6-digit PIN
 * (Continue), then the same PIN again (Join the shop).
 */
export function AcceptInviteForm() {
  const router = useRouter();
  const token = useRef<string | null>(null);
  const [invite, setInvite] = useState<PosInviteInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [step, setStep] = useState<"welcome" | "pin" | "confirm">("welcome");
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
  const go = (next: typeof step) => {
    setMessage(null);
    setStep(next);
  };
  const steps = ["welcome", "pin", "confirm"] as const;
  const progress = (
    <ol aria-label="Steps" className="flex gap-2">
      {steps.map((name, index) => (
        <li key={name} aria-current={step === name ? "step" : undefined} className={`h-1.5 flex-1 rounded-full ${steps.indexOf(step) >= index ? "bg-pos-600" : "bg-pos-line"}`}>
          <span className="sr-only">
            Step {index + 1} of 3{step === name ? " (this step)" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
  const expires = new Date(invite.expires_at).toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  if (step === "welcome") {
    return (
      <div className="mx-auto grid w-full max-w-md gap-5">
        {progress}
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
        <button type="button" onClick={() => go("pin")} className={primary}>
          {invite.reset ? "Set my new PIN" : "Accept invite"}
        </button>
        <p className="text-sm text-pos-muted">
          No Udozo account needed. Your PIN works only at this shop{invite.shop.shop_code ? `, with shop code ${invite.shop.shop_code}` : ""}. This invite expires {expires}.
        </p>
      </div>
    );
  }

  if (step === "pin") {
    const easy = pin.length === 6 && weakPin(pin);
    return (
      <form
        onSubmit={event => {
          event.preventDefault();
          if (weakPin(pin)) return setMessage(easyPinText);
          setAgain("");
          go("confirm");
        }}
        className="mx-auto grid w-full max-w-md gap-5"
      >
        {progress}
        <div>
          <h1 className="font-display text-3xl font-bold text-pos-ink">Create your PIN</h1>
          <p className="mt-2 text-pos-ink-2">Six digits you will sign in with at {invite.shop.name ?? "the shop"}. Keep it to yourself.</p>
        </div>
        <div className="rounded-[20px] bg-white p-5">
          <PinBoxes key="pin" value={pin} onChange={next => {
              setMessage(null);
              setPin(next);
            }} label="Your 6-digit PIN" autoFocus />
        </div>
        {easy ? <p className="text-sm font-semibold text-pos-warn">{easyPinText}</p> : null}
        <Problem message={message} />
        <button type="submit" disabled={pin.length !== 6} className={primary}>
          Continue
        </button>
        <button type="button" onClick={() => go("welcome")} className="h-12 rounded-xl border border-pos-line font-bold">
          Back
        </button>
      </form>
    );
  }

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        if (pin !== again) {
          setAgain("");
          setMessage("The two PINs are not the same. Type it again, or go back to choose another.");
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
      className="mx-auto grid w-full max-w-md gap-5"
    >
      {progress}
      <div>
        <h1 className="font-display text-3xl font-bold text-pos-ink">Confirm your PIN</h1>
        <p className="mt-2 text-pos-ink-2">Type the same 6 digits again.</p>
      </div>
      <div className="rounded-[20px] bg-white p-5">
        <PinBoxes key="confirm" value={again} onChange={next => {
            setMessage(null);
            setAgain(next);
          }} label="Your PIN again" disabled={pending} autoFocus />
      </div>
      <Problem message={message} />
      <button type="submit" disabled={pending || again.length !== 6} className={primary}>
        {pending ? "Joining…" : invite.reset ? "Save my PIN" : "Join the shop"}
      </button>
      <button type="button" disabled={pending} onClick={() => {
          setPin("");
          setAgain("");
          go("pin");
        }} className="h-12 rounded-xl border border-pos-line font-bold">
        Choose another PIN
      </button>
    </form>
  );
}

/**
 * Choosing a new PIN (PINs are now 6 digits): the current PIN, then the new one twice. Someone whose PIN is from before
 * does this before anything else; on a linked till the new PIN is kept for signing in offline.
 */
export function ChangePinForm({ staffId, onDevice, required }: { staffId: string; onDevice: boolean; required: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const easy = pin.length === 6 && weakPin(pin);
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        if (pin !== again) return setMessage("The two new PINs are not the same.");
        if (weakPin(pin)) return setMessage(easyPinText);
        start(async () => {
          const result = await changePin(current, pin);
          if (!result.ok) {
            setMessage(result.message);
            if (result.param === "current_pin") setCurrent("");
            return;
          }
          if (onDevice) void rememberPin(staffId, pin).catch(() => undefined);
          router.push("/app");
          router.refresh();
        });
      }}
      className="mx-auto grid w-full max-w-md gap-4 rounded-[20px] bg-white p-6"
    >
      <h1 className="font-display text-2xl font-bold text-pos-ink">{required ? "PINs are now 6 digits" : "Change your PIN"}</h1>
      {required ? <p className="text-pos-ink-2">Choose a new 6-digit PIN to carry on. Your old 4-digit PIN stops working once you do.</p> : null}
      <PinPad value={current} onChange={setCurrent} label="Your current PIN" disabled={pending} autoFocus />
      <PinPad value={pin} onChange={setPin} label="Your new 6-digit PIN" disabled={pending} />
      {easy ? <p className="text-sm font-semibold text-pos-warn">{easyPinText}</p> : null}
      <PinPad value={again} onChange={setAgain} label="Type the new PIN again" disabled={pending} />
      <Problem message={message} />
      <button type="submit" disabled={pending || (current.length !== 4 && current.length !== 6) || pin.length !== 6 || again.length !== 6} className={primary}>
        {pending ? "Saving…" : "Save my new PIN"}
      </button>
    </form>
  );
}
