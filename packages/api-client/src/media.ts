import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { apiFetch, bitocardApi, toApiError } from './base';

/**
 * Whose files: the admin app (`/v1/admin/media`, platform files; admin.afrippa.com's switch sends it to Afrippa's own
 * `/v1/afrippa/admin/media`) or SHQ (`/v1/media`, the reseller's own folder).
 */
export type MediaRealm = 'admin' | 'reseller';

/** Admin purposes and the reseller's own (`src/media/purposes.ts` in the API). */
export type MediaPurpose =
  | 'brand_logo'
  | 'brand_card'
  | 'registry_logo'
  | 'registry_card'
  | 'product_image'
  | 'supplier_logo'
  | 'category_icon'
  | 'category_image'
  | 'storefront_image'
  /** Udozo's admins: the home pages' banners, slides and category tile photos. */
  | 'home_image'
  /** Udozo's admins: udozo.com's banner ads. */
  | 'banner_image'
  | 'hero_image'
  | 'classified_brand_logo'
  /** Udozo's admins: a brand page's banner (4:1). */
  | 'classified_brand_banner'
  | 'store_logo'
  | 'store_image'
  | 'bot_avatar'
  | 'platform_bot_avatar'
  | 'shop_bot_avatar'
  /** Afrippa's admins only, on Afrippa's own storage. */
  | 'afrippa_bot_avatar';

export type MediaAsset = {
  object: 'media_asset';
  id: string;
  /** The public address to save on the brand, product, store and so on. */
  url: string;
  purpose: MediaPurpose;
  folder: string;
  target_id: string | null;
  filename: string;
  content_type: string;
  size: number;
  width: number | null;
  height: number | null;
  status: 'pending' | 'ready';
  created_at: string;
  /** Where the file is shown, for example `brand:amazon:logo`. Files in use cannot be deleted. */
  in_use?: string[];
};

export type MediaSettings = {
  object: 'media_settings';
  /** False until file storage is set up; image addresses can still be typed in. */
  configured: boolean;
  purposes: Array<{ purpose: MediaPurpose; label: string; max_bytes: number; content_types: string[] }>;
};

export type MediaUpload = {
  object: 'media_upload';
  id: string;
  purpose: MediaPurpose;
  folder: string;
  url: string;
  /** Send the file here with exactly these headers; the link lasts 10 minutes. */
  upload: { method: 'PUT'; url: string; headers: Record<string, string> };
  expires_at: string;
};

export type MediaRequest = { purpose: MediaPurpose; target_id?: string };
export type MediaFilter = { purpose?: MediaPurpose; target_id?: string; owner?: string; q?: string; limit?: number };

const base = (realm: MediaRealm) => (realm === 'admin' ? '/v1/admin/media' : '/v1/media');
const clean = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));

/** Uploaded logos, icons and images, shared by the admin app and SHQ. */
export const mediaApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    // Storage keys are integration settings: saving one refreshes this.
    mediaSettings: build.query<MediaSettings, MediaRealm>({ query: realm => `${base(realm)}/settings`, providesTags: ['Integration'] }),
    mediaLibrary: build.query<{ object: 'list'; data: MediaAsset[]; has_more: boolean }, { realm: MediaRealm } & MediaFilter>({
      query: ({ realm, ...filter }) => ({ url: base(realm), params: clean(filter) }),
      providesTags: ['Media'],
    }),
    createMediaUpload: build.mutation<MediaUpload, { realm: MediaRealm; filename: string; content_type: string; size: number } & MediaRequest>({
      query: ({ realm, ...body }) => ({ url: `${base(realm)}/uploads`, method: 'POST', body }),
    }),
    completeMediaUpload: build.mutation<MediaAsset, { realm: MediaRealm; id: string }>({
      query: ({ realm, id }) => ({ url: `${base(realm)}/${id}/complete`, method: 'POST' }),
      invalidatesTags: ['Media', 'Activity'],
    }),
    deleteMedia: build.mutation<{ object: 'media_asset'; id: string; deleted: true }, { realm: MediaRealm; id: string }>({
      query: ({ realm, id }) => ({ url: `${base(realm)}/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Media', 'Activity'],
    }),
  }),
});

export const { useMediaSettingsQuery, useMediaLibraryQuery, useDeleteMediaMutation } = mediaApi;

type Dispatch = (action: unknown) => unknown;
type Unwrappable<T> = { unwrap: () => Promise<T> };

/**
 * Sends a file's bytes through the API to its pending upload (`POST <base>/<id>/content`, with the account's cookies and
 * headers), which stores it with the signed link's own key: the browser never talks to storage, so the bucket needs no
 * CORS rule for the apps. Resolves with the API's JSON; throws the API's error.
 */
export async function sendThroughApi<T>(path: string, file: Blob): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
  } catch {
    throw toApiError('FETCH_ERROR', null);
  }
  const json = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw toApiError(res.status, json);
  return json as T;
}

/**
 * Uploads a file the way the API expects: ask for an upload, send the file's bytes through the API (which stores it
 * where the signed link points), and the API checks it. Resolves with the checked file; its `url` is what to save.
 */
export async function uploadMedia(dispatch: Dispatch, realm: MediaRealm, request: MediaRequest, file: Blob & { name?: string }): Promise<MediaAsset> {
  const created = await (
    dispatch(mediaApi.endpoints.createMediaUpload.initiate({ realm, ...request, filename: file.name || 'upload', content_type: file.type, size: file.size })) as Unwrappable<MediaUpload>
  ).unwrap();
  const asset = await sendThroughApi<MediaAsset>(`${base(realm)}/${created.id}/content`, file);
  dispatch(mediaApi.util.invalidateTags(['Media', 'Activity']));
  return asset;
}

/** `upload(file, { purpose, target_id })` for components. */
export function useMediaUpload(realm: MediaRealm) {
  const dispatch = useDispatch();
  return useCallback((file: Blob & { name?: string }, request: MediaRequest) => uploadMedia(dispatch as Dispatch, realm, request, file), [dispatch, realm]);
}
