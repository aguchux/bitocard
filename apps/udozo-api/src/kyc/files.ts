import { inspectImage } from '../media/images.js';

/**
 * Checks of the files people upload to BitoCard Verify. A file must really be what it claims (from its bytes, never
 * its name or declared type), and photos lose their metadata before they are stored: phone photos carry GPS
 * positions, device details and thumbnails in EXIF, which a reviewer never needs.
 */

/** The largest file the API takes (Vercel functions accept 4.5 MB bodies; the app compresses photos well below). */
export const maxDocumentBytes = 4 * 1024 * 1024;

export type CheckedFile = { contentType: 'image/jpeg' | 'image/png' | 'application/pdf'; bytes: Buffer; width: number | null; height: number | null };

/** JPEG without its APPn metadata (EXIF, XMP, IPTC, ICC thumbnails) and comments: only the image data and its tables. */
export function stripJpeg(bytes: Buffer): Buffer | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // Padding bytes before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Start of scan: the compressed image follows to the end; keep everything from here.
    if (marker === 0xda) {
      parts.push(bytes.subarray(offset));
      return Buffer.concat(parts);
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    // APP0 (JFIF) is harmless and kept; APP1 to APP15 (EXIF, XMP, ICC, IPTC…) and comments (FE) are dropped.
    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) parts.push(bytes.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  return null;
}

/** PNG without its text and EXIF chunks (tEXt, zTXt, iTXt, eXIf, tIME). */
export function stripPng(bytes: Buffer): Buffer | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(signature)) return null;
  const parts: Buffer[] = [signature];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  return ended ? Buffer.concat(parts) : null;
}

/** A PDF: its header, and nothing that runs (scripts, launch actions, embedded files) — refused rather than cleaned. */
export function pdfProblem(bytes: Buffer): string | null {
  if (bytes.length < 8 || bytes.toString('latin1', 0, 5) !== '%PDF-') return 'not a PDF';
  const text = bytes.toString('latin1');
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(text)) return 'the PDF contains scripts or embedded files';
  return null;
}

/**
 * The file as it will be stored, or null when it is not an allowed type (photos: JPEG or PNG; business documents also
 * PDF). The declared type must match the bytes.
 */
export function checkDocument(bytes: Buffer, declared: string, allowPdf: boolean): CheckedFile | { problem: string } {
  if (bytes.length === 0) return { problem: 'The file is empty.' };
  if (bytes.length > maxDocumentBytes) return { problem: 'The file is larger than 4 MB.' };
  if (declared === 'application/pdf') {
    if (!allowPdf) return { problem: 'Upload a photo (JPEG or PNG).' };
    const problem = pdfProblem(bytes);
    return problem ? { problem: `This file cannot be used: ${problem}.` } : { contentType: 'application/pdf', bytes, width: null, height: null };
  }
  if (declared !== 'image/jpeg' && declared !== 'image/png') return { problem: allowPdf ? 'Upload a JPEG, PNG or PDF file.' : 'Upload a photo (JPEG or PNG).' };
  const info = inspectImage(bytes, declared);
  if (!info) return { problem: 'The file is not the image it claims to be.' };
  const clean = declared === 'image/jpeg' ? stripJpeg(bytes) : stripPng(bytes);
  if (!clean) return { problem: 'The image could not be read. Take the photo again.' };
  return { contentType: declared, bytes: clean, width: info.width, height: info.height };
}
