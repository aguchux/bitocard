import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { cleanRichText, richTextMaxLength, richTextToPlain } from './rich-text-core.js';

/** A message as written: plain text, or rich text with its plain words beside it. */
export type MessageBody = string | { text: string; html: string };

export const textOf = (body: MessageBody) => (typeof body === 'string' ? body : body.text);

/** The columns a ticket message keeps: its plain words always, its cleaned HTML when it was rich. */
export const bodyColumns = (body: MessageBody) => (typeof body === 'string' ? { body: body.trim(), bodyHtml: null } : { body: body.text.trim(), bodyHtml: body.html });

/**
 * What a request sent: the rich text (`html`) when there is some, cleaned to the allowed tags, its words worked out
 * again from it (whatever plain text came beside it), else the plain text. Too long or empty once cleaned is refused.
 */
export function messageBody(text: string | undefined, html: string | undefined, param: string, max = 5000): MessageBody {
  if (html === undefined || html === null || html === '') {
    if (!text?.trim()) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Write a message.', param);
    return text;
  }
  if (html.length > richTextMaxLength) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'This message is too long.', `${param}_html`);
  const clean = cleanRichText(html);
  const plain = richTextToPlain(clean);
  if (!plain) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_missing', 'Write a message.', `${param}_html`);
  if (plain.length > max) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', `Keep the message under ${max} characters.`, `${param}_html`);
  return { text: plain, html: clean };
}
