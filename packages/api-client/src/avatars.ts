import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { bitocardApi } from './base';

/**
 * Udozo's profile photos for the people of Seller HQ (`reseller`: `/v1/auth/avatar`) and the admin (`admin`:
 * `/v1/admin/auth/avatar`): a signed link to send the photo to storage, then set it (the API checks the stored file
 * first), or take it off. Setting or removing it refreshes the session, so the account menu shows it at once.
 */
export type AvatarRealm = 'admin' | 'reseller';
export type AvatarUpload = { object: 'media_upload'; id: string; url: string; upload: { method: 'PUT'; url: string; headers: Record<string, string> }; expires_at: string };
export type AvatarSet = { object: 'avatar'; avatar_url: string | null };

const base = (realm: AvatarRealm) => (realm === 'admin' ? '/v1/admin/auth/avatar' : '/v1/auth/avatar');

export const avatarsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    createAvatarUpload: build.mutation<AvatarUpload, { realm: AvatarRealm; filename: string; content_type: string; size: number }>({
      query: ({ realm, ...body }) => ({ url: `${base(realm)}/uploads`, method: 'POST', body }),
    }),
    setAvatar: build.mutation<AvatarSet, { realm: AvatarRealm; media_id: string }>({
      query: ({ realm, media_id }) => ({ url: base(realm), method: 'POST', body: { media_id } }),
      invalidatesTags: ['Session', 'Team'],
    }),
    removeAvatar: build.mutation<AvatarSet, AvatarRealm>({
      query: realm => ({ url: base(realm), method: 'DELETE' }),
      invalidatesTags: ['Session', 'Team'],
    }),
  }),
});

export const { useRemoveAvatarMutation } = avatarsApi;

type Unwrappable<T> = { unwrap: () => Promise<T> };

/** The API's message from a refused request, or a plain one. */
const messageOf = (error: unknown) => (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'The photo could not be saved. Try again.');

/**
 * `{ upload, remove }` for the shared photo editor (`AvatarEditor` in `@bitocard/ui/avatar`): ask for a signed link,
 * send the prepared photo to storage, set it; or take it off. Each throws an `Error` with the message to show.
 */
export function useAvatarActions(realm: AvatarRealm, send: (upload: AvatarUpload['upload'], photo: Blob) => Promise<void>) {
  const dispatch = useDispatch() as (action: unknown) => unknown;
  const upload = useCallback(
    async (photo: Blob, filename: string) => {
      try {
        const created = await (dispatch(avatarsApi.endpoints.createAvatarUpload.initiate({ realm, filename, content_type: photo.type, size: photo.size })) as Unwrappable<AvatarUpload>).unwrap();
        await send(created.upload, photo);
        await (dispatch(avatarsApi.endpoints.setAvatar.initiate({ realm, media_id: created.id })) as Unwrappable<AvatarSet>).unwrap();
      } catch (error) {
        throw error instanceof Error ? error : new Error(messageOf(error));
      }
    },
    [dispatch, realm, send],
  );
  const remove = useCallback(async () => {
    try {
      await (dispatch(avatarsApi.endpoints.removeAvatar.initiate(realm)) as Unwrappable<AvatarSet>).unwrap();
    } catch (error) {
      throw new Error(messageOf(error));
    }
  }, [dispatch, realm]);
  return { upload, remove };
}
