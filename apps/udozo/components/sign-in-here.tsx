"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** `next`: where to go once signed in, instead of back to this page (Sell goes on to Post an ad). */
type Props = { reason?: "chat" | "phone" | "call" | "save" | "buy" | "report" | "sell"; next?: string; className?: string; children: React.ReactNode; ariaLabel?: string };

function Here({ reason, next: then, className, children, ariaLabel }: Props) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const next = then ?? `${path}${search ? `?${search}` : ""}`;
  return (
    <Link href={`/signin?next=${encodeURIComponent(next)}${reason ? `&for=${reason}` : ""}`} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}

/** A sign-in link that comes back to this very page (its path and query) afterwards, or goes on to `next`. */
export function SignInHere(props: Props) {
  // Reading the query needs a Suspense boundary on prerendered pages; until then it signs in and comes back to the path.
  return (
    <Suspense
      fallback={
        <Link href={props.next ? `/signin?next=${encodeURIComponent(props.next)}${props.reason ? `&for=${props.reason}` : ""}` : "/signin"} className={props.className} aria-label={props.ariaLabel}>
          {props.children}
        </Link>
      }
    >
      <Here {...props} />
    </Suspense>
  );
}
