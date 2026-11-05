'use client';

import { type AvatarRealm, useAvatarActions } from '@bitocard/api-client';
import { AvatarEditor, sendToStorage } from '@bitocard/ui/avatar';
import { Card, CardHeader } from './primitives';

/**
 * Udozo: the signed-in person's profile photo (a face, a logo or an icon) in Seller HQ (Settings > Your profile) and the
 * admin (Your account): chosen, shown as it will look, made square in the browser, sent to storage with a signed link
 * and checked by the API before it is used. It shows in the account menu at once.
 */
export function ProfilePhotoCard({ realm, name, url }: { realm: AvatarRealm; name: string; url: string | null | undefined }) {
  const actions = useAvatarActions(realm, sendToStorage);
  return (
    <Card>
      <CardHeader title="Profile photo" description="A photo of you, or your logo or icon. It shows in the account menu and on team lists." />
      <div className="p-5 sm:p-6">
        <AvatarEditor name={name} url={url ?? null} actions={actions} />
      </div>
    </Card>
  );
}
