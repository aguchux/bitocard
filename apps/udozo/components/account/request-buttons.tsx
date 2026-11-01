"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { answerRequest, stopSharing } from "@/lib/listing-actions";

type Action = "accept" | "decline" | "done" | "dismiss";

const labels: Record<Action, string> = { accept: "Share my contact", decline: "Decline", done: "I called them", dismiss: "Dismiss" };

/** The seller's answer to a request: accept or decline a contact request, mark a call back done or dismiss it. */
export function RequestButtons({ id, actions }: { id: string; actions: Action[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <button
            key={action}
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await answerRequest(id, action);
                if (result.ok) router.refresh();
                else setError(result.message);
              })
            }
            className={`h-10 rounded-xl px-4 text-sm font-bold disabled:opacity-60 ${index === 0 ? "bg-navy-900 text-white" : "border border-navy-200 text-navy-900 hover:bg-navy-50"}`}
          >
            {labels[action]}
          </button>
        ))}
      </div>
      {error ? (
        <p className="text-sm text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Stops showing the seller's contact details to one buyer (who may ask again). */
export function StopSharing({ buyerId, name }: { buyerId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Stop sharing your contact with ${name}`}
      onClick={() =>
        start(async () => {
          if ((await stopSharing(buyerId)).ok) router.refresh();
        })
      }
      className="h-9 rounded-xl border border-navy-200 px-3 text-sm font-semibold text-navy-900 hover:bg-navy-50 disabled:opacity-60"
    >
      Stop sharing
    </button>
  );
}
