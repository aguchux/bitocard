"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { dismissUsernamePrompt } from "@/lib/username-actions";
import { usernameScreen } from "@/lib/username";

/**
 * The account pages' ask to choose a username, beside the mobile reminder and in its look, while the API says to
 * (`prompt`), except on the Username screen itself. Not now hides it at once and tells Udozo, which stops asking after
 * the third time.
 */
export function UsernameBanner({ example }: { example: string }) {
  const [hidden, setHidden] = useState(false);
  const pathname = usePathname();
  if (hidden || pathname === usernameScreen) return null;
  return (
    <div role="region" aria-label="Choose your username" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-navy-50 p-3 text-sm text-navy-800">
      <p className="min-w-0 flex-1 basis-56">
        Choose your username: your page becomes <strong className="break-all">{example}</strong>.
      </p>
      <span className="flex shrink-0 items-center gap-3">
        <Link href={usernameScreen} className="font-semibold underline">
          Choose
        </Link>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            void dismissUsernamePrompt().catch(() => undefined);
          }}
          className="font-semibold text-navy-600 hover:text-navy-900"
        >
          Not now
        </button>
      </span>
    </div>
  );
}
