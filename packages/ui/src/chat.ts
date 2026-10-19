/**
 * Shared pieces of BitoCard's live chat, used by the store's chat (customers and visitors) and by the consoles (SHQ and
 * the admin app): who a message is from, grouping, and getting a file ready to send.
 */

/** Files a chat takes: photos (JPEG, PNG) and PDFs. */
export const chatFileAccept = 'image/jpeg,image/png,application/pdf';
/** The largest file the API takes. */
export const maxChatFileBytes = 4 * 1024 * 1024;
/** Photos are scaled down to this many pixels on their longest side before sending. */
const photoEdge = 1600;

/** Up to two initials for an avatar: "Ada Obi" → "AO", "bitocard" → "B". */
export function initials(name: string | null | undefined) {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1 ? [words[0][0]] : [words[0][0], words[words.length - 1][0]];
  return letters.join('').toUpperCase();
}

/** "2.4 MB", "830 KB". */
export function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export type GroupableMessage = { id: string; author: string; author_name: string | null; created_at: string };

/**
 * Which messages start a run: the first message, a different author or name, or more than five minutes after the one
 * before. Runs show their avatar and name once.
 */
export function startsRun<T extends GroupableMessage>(messages: T[], index: number) {
  const message = messages[index];
  const before = messages[index - 1];
  if (!before || message.author === 'system' || before.author === 'system') return true;
  if (before.author !== message.author || before.author_name !== message.author_name) return true;
  return new Date(message.created_at).getTime() - new Date(before.created_at).getTime() > 5 * 60_000;
}

/**
 * Gets a file ready to send: PDFs and photos as they are when small enough, larger photos scaled down and saved again
 * as JPEG in the browser (which also drops their metadata), anything else refused with a reason.
 */
export async function prepareChatFile(file: File): Promise<{ file: File } | { problem: string }> {
  if (file.type === 'application/pdf') return file.size <= maxChatFileBytes ? { file } : { problem: 'The PDF is larger than 4 MB.' };
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') return { problem: 'Send a photo (JPEG or PNG) or a PDF.' };
  if (file.size <= 1.5 * 1024 * 1024) return { file };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, photoEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return { problem: 'The photo could not be read.' };
    if (blob.size > maxChatFileBytes) return { problem: 'The photo is too large to send.' };
    return { file: new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) };
  } catch {
    return file.size <= maxChatFileBytes ? { file } : { problem: 'The photo is larger than 4 MB.' };
  }
}
