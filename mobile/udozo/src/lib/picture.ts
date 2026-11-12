import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { apiUpload } from '@/lib/api';

/** The longest side a listing photo is sent at, as udozo.com scales them in the browser: sharp, and well under 4 MB. */
export const photoEdge = 1600;

export type PickedPhoto = { uri: string; width: number; height: number };

/**
 * Photos from the camera or the library (several at once there), or none when the seller cancels or refuses the
 * permission. `refused` says the permission was turned down, so the screen can say how to allow it.
 */
export async function pickPhotos(from: 'camera' | 'library', limit: number): Promise<{ photos: PickedPhoto[]; refused: boolean }> {
  if (limit <= 0) return { photos: [], refused: false };
  if (from === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return { photos: [], refused: true };
    const taken = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    return { photos: taken.canceled ? [] : taken.assets.map(asset => ({ uri: asset.uri, width: asset.width, height: asset.height })), refused: false };
  }
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: limit > 1, selectionLimit: limit, orderedSelection: true });
  return { photos: picked.canceled ? [] : picked.assets.slice(0, limit).map(asset => ({ uri: asset.uri, width: asset.width, height: asset.height })), refused: false };
}

/** The photo scaled down to `photoEdge` on its longest side (never up) and saved again as a JPEG, which drops its metadata. */
export async function preparePhoto(photo: PickedPhoto) {
  const context = ImageManipulator.manipulate(photo.uri);
  const longest = Math.max(photo.width, photo.height);
  if (longest > photoEdge) context.resize(photo.width >= photo.height ? { width: photoEdge } : { height: photoEdge });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
  return saved.uri;
}

/** Sends one prepared photo to the listing (multipart `file`, as udozo.com's form does). */
export async function uploadListingPhoto(listingId: string, photo: PickedPhoto) {
  const uri = await preparePhoto(photo);
  const form = new FormData();
  form.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  return apiUpload(`/v1/classifieds/listings/${listingId}/photos`, form);
}
