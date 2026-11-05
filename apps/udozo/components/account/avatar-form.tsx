"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { AvatarEditor, sendToStorage } from "@bitocard/ui/avatar";
import { removeAvatar, setAvatar, startAvatarUpload } from "@/lib/avatar-actions";

/**
 * The customer's profile photo on their profile: a face, a logo or an icon, made square in the browser, sent straight to
 * storage with a signed link, then checked by Udozo before it shows on their seller page, listings and account.
 */
export function AvatarForm({ name, url }: { name: string; url: string | null }) {
  const router = useRouter();
  const actions = useMemo(
    () => ({
      upload: async (photo: Blob, filename: string) => {
        const link = await startAvatarUpload({ filename, content_type: photo.type, size: photo.size });
        if (!link.ok) throw new Error(link.message);
        await sendToStorage(link.data.upload, photo);
        const set = await setAvatar(link.data.id);
        if (!set.ok) throw new Error(set.message);
        router.refresh();
      },
      remove: async () => {
        const result = await removeAvatar();
        if (!result.ok) throw new Error(result.message);
        router.refresh();
      },
    }),
    [router],
  );
  return <AvatarEditor name={name} url={url} actions={actions} note="A photo of you, or your shop's logo or icon. Buyers see it on your seller page and listings." />;
}
