"use client";

import Link from "next/link";
import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Props = { reason?: "chat" | "phone" | "save" | "buy" | "report" | "sell"; className?: string; children: React.ReactNode; ariaLabel?: string };

function Here({ reason, className, children, ariaLabel }: Props) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const next = `${path}${search ? `?${search}` : ""}`;
  return (
    <Link href={`/signin?next=${encodeURIComponent(next)}${reason ? `&for=${reason}` : ""}`} className={className} aria-label={ariaLabel}>
      {children}
    </Link>
  );
}

/** A sign-in link that comes back to this very page (its path and query) afterwards. */
export function SignInHere(props: Props) {
  // Reading the query needs a Suspense boundary on prerendered pages; until then it signs in and comes back to the path.
  return (
    <Suspense
      fallback={
        <Link href="/signin" className={props.className} aria-label={props.ariaLabel}>
          {props.children}
        </Link>
      }
    >
      <Here {...props} />
    </Suspense>
  );
}
