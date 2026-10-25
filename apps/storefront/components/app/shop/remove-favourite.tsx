"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { removeFavourite } from "@/lib/shop-actions";

/** Takes a listing off the customer's favourites. */
export function RemoveFavourite({ listingId, title }: { listingId: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Remove ${title} from favourites`}
      onClick={() =>
        start(async () => {
          const result = await removeFavourite(listingId);
          if (result.ok) router.refresh();
        })
      }
      className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-white/95 text-navy-900 shadow disabled:opacity-60"
    >
      <X className="size-4" aria-hidden="true" />
    </button>
  );
}
