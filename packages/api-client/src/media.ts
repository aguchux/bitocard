import { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { type ApiError, bitocardApi } from './base';

/** Whose files: the admin app (`/v1/admin/media`, platform files) or SHQ (`/v1/media`, the reseller's own folder). */
export type MediaRealm = 'admin' | 'reseller';

/** Admin purposes and the reseller's own (`src/media/purposes.ts` in the API). */
export type MediaPurpose =
  | 'brand_logo'
  | 'brand_card'
  | 'product_image'
  | 'supplier_logo'
  | 'category_icon'
  | 'category_image'
  | 'storefront_image'
  | 'store_logo'
  | 'store_image';

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
    mediaSettings: build.query<MediaSettings, MediaRealm>({ query: realm => `${base(realm)}/settings` }),
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

/** Raised when storage refuses the file itself (for example an expired link), in the API's error shape. */
const storageError = (status: number): ApiError => ({
  status,
  type: 'api_error',
  code: 'upload_failed',
  message: status === 403 ? 'The upload link was refused or has expired. Try again.' : 'The file could not be uploaded. Check your connection and try again.',
});

/**
 * Uploads a file the way the API expects: ask for a signed link, PUT the file straight to storage (no cookies, only
 * the signed headers), then ask the API to check it. Resolves with the checked file; its `url` is what to save.
 */
export async function uploadMedia(dispatch: Dispatch, realm: MediaRealm, request: MediaRequest, file: Blob & { name?: string }): Promise<MediaAsset> {
  const created = await (
    dispatch(mediaApi.endpoints.createMediaUpload.initiate({ realm, ...request, filename: file.name || 'upload', content_type: file.type, size: file.size })) as Unwrappable<MediaUpload>
  ).unwrap();
  let res: Response;
  try {
    res = await fetch(created.upload.url, { method: created.upload.method, headers: created.upload.headers, body: file, credentials: 'omit' });
  } catch {
    throw storageError(0);
  }
  if (!res.ok) throw storageError(res.status);
  return (dispatch(mediaApi.endpoints.completeMediaUpload.initiate({ realm, id: created.id })) as Unwrappable<MediaAsset>).unwrap();
}

/** `upload(file, { purpose, target_id })` for components. */
export function useMediaUpload(realm: MediaRealm) {
  const dispatch = useDispatch();
  return useCallback((file: Blob & { name?: string }, request: MediaRequest) => uploadMedia(dispatch as Dispatch, realm, request, file), [dispatch, realm]);
}
