/**
 * Checks that an uploaded file really is the image it claims to be, from its first bytes, and reads its size. A file
 * whose content does not match its declared type is refused, so a renamed HTML or script file is never served.
 */
export type ImageInfo = { type: string; width: number | null; height: number | null };

/** How much of a raster image is read to check it (JPEG dimensions can sit after large metadata). */
export const sniffBytes = 64 * 1024;

function png(bytes: Buffer): ImageInfo | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { type: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpeg(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    // Start-of-frame markers carry the dimensions (C4 is a Huffman table, C8 reserved, CC arithmetic coding).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { type: 'image/jpeg', height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  // A real JPEG whose frame header is past the bytes read: accepted, size unknown.
  return { type: 'image/jpeg', width: null, height: null };
}

function webp(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 30 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return { type: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { type: 'image/webp', width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  return null;
}

/**
 * SVG is text that browsers can run scripts from, so it is refused unless it is a plain drawing: no scripts, event
 * handlers, embedded HTML, entities or references to anything outside the file (data: images are allowed).
 */
export function svgProblem(text: string): string | null {
  const body = text.replace(/^\uFEFF/, '');
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>[]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(body)) return 'not an SVG image';
  if (/<script/i.test(body)) return 'contains a script';
  if (/<foreignObject/i.test(body)) return 'contains embedded HTML';
  if (/<!ENTITY/i.test(body)) return 'contains entities';
  if (/\son[a-z]+\s*=/i.test(body)) return 'contains event handlers';
  if (/javascript:/i.test(body)) return 'contains a script link';
  // Every href must stay inside the file (#id) or be a data: image.
  for (const match of body.matchAll(/(?:xlink:)?href\s*=\s*["']\s*([^"']*)/gi)) {
    if (!match[1].startsWith('#') && !/^data:image\/(png|jpeg|gif|webp);/i.test(match[1])) return 'refers to outside files';
  }
  if (/url\(\s*["']?\s*(?!#|data:image\/)/i.test(body)) return 'refers to outside files';
  if (/@import/i.test(body)) return 'refers to outside files';
  return null;
}

function svg(bytes: Buffer): ImageInfo | null {
  const text = bytes.toString('utf8');
  if (svgProblem(text)) return null;
  const tag = text.match(/<svg[^>]*>/i)?.[0] ?? '';
  const number = (name: string) => {
    const value = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i'))?.[1];
    return value ? Math.round(Number(value)) : null;
  };
  const box = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return { type: 'image/svg+xml', width: number('width') ?? (box ? Math.round(Number(box[1])) : null), height: number('height') ?? (box ? Math.round(Number(box[2])) : null) };
}

/** The image a file's bytes contain, or null when they are not the declared type. */
export function inspectImage(bytes: Buffer, declared: string): ImageInfo | null {
  const reader = { 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp, 'image/svg+xml': svg }[declared];
  const info = reader?.(bytes) ?? null;
  return info && info.type === declared ? info : null;
}
