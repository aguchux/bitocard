/**
 * Photos are made smaller in the browser before upload (BitoCard Verify, BitoCard Shop): at most 1600 px on the longest
 * side, JPEG at 0.85. Drawing on a canvas also drops the photo's EXIF data (location, device), and uploads stay well
 * under the 4 MB limit. The API checks every file again and strips its metadata whatever the browser did.
 */
export const maxImageSide = 1600;
export const jpegQuality = 0.85;

/** The size to draw an image at so it fits within `max` on its longest side, never enlarged. */
export function fitWithin(width: number, height: number, max = maxImageSide) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether a file is a photo we can redraw (PDFs are sent as they are). */
export const isPhoto = (type: string) => type === "image/jpeg" || type === "image/png";

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = jpegQuality): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("The photo could not be saved."))), "image/jpeg", quality));
}

/**
 * Draws one camera frame as a JPEG. The frame is drawn as the camera sees it, never mirrored, even when the preview is
 * (the front camera's preview is flipped so it behaves like a mirror; the photo must not be).
 */
export function grabFrame(video: HTMLVideoElement, max = maxImageSide): Promise<Blob> {
  const { width, height } = fitWithin(video.videoWidth, video.videoHeight, max);
  if (!width) return Promise.reject(new Error("The camera is not ready yet."));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("The photo could not be taken."));
  context.drawImage(video, 0, 0, width, height);
  return canvasToJpeg(canvas);
}

/**
 * A chosen photo, upright (EXIF orientation applied), at most 1600 px and re-encoded as JPEG without its metadata. PDFs
 * and anything the browser cannot decode come back unchanged (the server checks them). `redraw` picks the types to
 * redraw: JPEG and PNG by default; any image (an iPhone's HEIC, which Safari decodes) where only photos are taken.
 */
export async function compressImage(file: Blob, max = maxImageSide, redraw: (type: string) => boolean = isPhoto): Promise<Blob> {
  if (!redraw(file.type) || typeof createImageBitmap !== "function") return file;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    // PNGs with transparency would turn black as JPEG: paint white behind them.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvasToJpeg(canvas);
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

/** How a profile photo fills its square: `cover` crops to the middle (faces), `contain` shows it all (logos and icons). */
export type SquareFit = "cover" | "contain";
/** Profile photos are stored this many pixels square. */
export const avatarSide = 512;

/** Where to draw an image of `width` × `height` inside a square of `side` (no enlarging beyond the square). */
export function squareDraw(width: number, height: number, side: number, fit: SquareFit) {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = fit === "cover" ? side / Math.min(width, height) : side / Math.max(width, height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { x: Math.round((side - w) / 2), y: Math.round((side - h) / 2), width: w, height: h };
}

/**
 * A profile photo, square: upright, cropped to its middle (`cover`) or shown whole on white (`contain`), at `side`
 * pixels, re-encoded without its metadata: PNG where the picture had transparency to keep (a logo), else JPEG.
 */
export async function squareImage(file: Blob, fit: SquareFit = "cover", side = avatarSide): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const size = Math.min(side, fit === "cover" ? Math.min(bitmap.width, bitmap.height) : Math.max(bitmap.width, bitmap.height)) || side;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The photo could not be prepared.");
    const keepClear = file.type === "image/png" || file.type === "image/webp";
    if (!keepClear || fit === "contain") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
    }
    const place = squareDraw(bitmap.width, bitmap.height, size, fit);
    context.drawImage(bitmap, place.x, place.y, place.width, place.height);
    const type = keepClear && fit === "cover" ? "image/png" : "image/jpeg";
    return await new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("The photo could not be saved."))), type, jpegQuality));
  } finally {
    bitmap.close();
  }
}
