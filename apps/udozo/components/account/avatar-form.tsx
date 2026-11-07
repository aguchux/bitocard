"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AvatarEditor } from "@bitocard/ui/avatar";
import { removeAvatar } from "@/lib/avatar-actions";
import { sendPicture } from "@/lib/picture-client";

/**
 * The customer's profile photo: a face, a logo or an icon, made square in the browser, stored through this site's server
 * with Udozo's signed link and checked by Udozo. The new photo shows here at once, and the page is refreshed so the
 * header, seller page and listings show it too.
 */
export function AvatarForm({ name, url }: { name: string; url: string | null }) {
  const router = useRouter();
  // What was just saved here, until the page's own (refreshed) address catches up with it.
  const [saved, setSaved] = useState<{ from: string | null; url: string | null } | null>(null);
  const shown = saved && saved.from === url ? saved.url : url;
  const actions = useMemo(
    () => ({
      upload: async (photo: Blob, filename: string) => {
        const next = await sendPicture("avatar", photo, filename);
        setSaved({ from: url, url: next });
        router.refresh();
      },
      remove: async () => {
        const result = await removeAvatar();
        if (!result.ok) throw new Error(result.message);
        setSaved({ from: url, url: null });
        router.refresh();
      },
    }),
    [router, url],
  );
  return <AvatarEditor name={name} url={shown} actions={actions} note="A photo of you, or your shop's logo or icon. Buyers see it on your seller page and listings." />;
}
