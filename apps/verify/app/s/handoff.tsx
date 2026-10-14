"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { LinkProblem } from "@/components/link-problem";
import { tokenFromHash } from "@/lib/handoff";

type Problem = null | "link" | "unreachable";

/** Exchanges the token on this app's server, which sets the session cookie. */
async function exchange(token: string | null): Promise<Problem> {
  if (!token) return "link";
  try {
    const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" });
    if (res.ok) return null;
    return res.status === 502 ? "unreachable" : "link";
  } catch {
    return "unreachable";
  }
}

/**
 * Reads the token from the address's fragment, removes it from the address bar at once (so it is not kept in history
 * or shared by mistake), and exchanges it once (the token works only once, even if the effect runs twice). Then on to
 * the check.
 */
export function Handoff() {
  const router = useRouter();
  const pending = useRef<Promise<Problem> | null>(null);
  const [failed, setFailed] = useState<Problem>(null);

  useEffect(() => {
    if (!pending.current) {
      const token = tokenFromHash(window.location.hash);
      window.history.replaceState(null, "", window.location.pathname);
      pending.current = exchange(token);
    }
    let live = true;
    void pending.current.then(problem => {
      if (!live) return;
      if (problem) setFailed(problem);
      else router.replace("/");
    });
    return () => {
      live = false;
    };
  }, [router]);

  if (failed) return <LinkProblem unreachable={failed === "unreachable"} />;
  return (
    <p className="flex items-center justify-center gap-2 rounded-3xl border border-line bg-white p-8 font-semibold text-muted shadow-card" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden /> Opening your check…
    </p>
  );
}
