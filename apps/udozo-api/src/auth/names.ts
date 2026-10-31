import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches, ValidateIf } from 'class-validator';

/**
 * People's names on Udozo: a first name and a last name, kept apart so they can be matched to an identity document
 * (which names them apart too). `name` stays the two joined, for everything that shows or emails a whole name.
 * Accounts from before the two were asked were split by the migration (first word, then the rest) and are asked to
 * confirm them (`name_confirmed: false` until they save their profile).
 */

/** A name part as typed: spaces tidied. */
export const tidyName = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Letters (any script), with spaces, hyphens, apostrophes and full stops inside: "Ngozi", "Mary-Jane", "O'Neil". */
export const namePattern = /^[\p{L}\p{M}][\p{L}\p{M}'’. -]*$/u;

/**
 * A first or last name field of a request body: 1 to 60 letters (with spaces, hyphens and apostrophes inside), checked
 * when `when` says the body names the person apart (by default, whenever it is sent).
 */
export const NamePart = (label: 'first_name' | 'last_name', when: (body: Record<string, unknown>) => boolean = body => body[label] !== undefined) =>
  applyDecorators(
    ValidateIf(when),
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? tidyName(value) : value)),
    IsString(),
    Length(1, 60),
    Matches(namePattern, { message: `${label} must be a name, in letters` }),
  );

/** A body naming the person apart, as sign-up does: both parts, unless an older client sends the whole `name`. */
export const namedApart = (body: Record<string, unknown>) => body.name === undefined || body.first_name !== undefined || body.last_name !== undefined;

/** A body changing the name (a profile): both parts together, when either is sent. */
export const renaming = (body: Record<string, unknown>) => body.first_name !== undefined || body.last_name !== undefined;

/** The whole name for a first and last name. */
export const fullName = (firstName: string, lastName: string | null | undefined) => tidyName([firstName, lastName ?? ''].join(' '));

/** A whole name split the way the migration split older ones: the first word, then the rest (null if none). */
export function splitFullName(name: string) {
  const [first = '', ...rest] = tidyName(name).split(' ');
  return { firstName: first, lastName: rest.join(' ') || null };
}

/**
 * What to save for a first and last name, confirmed as given; or, from an older client sending the whole `name`, that
 * name split, left for the person to confirm.
 */
export function nameData(input: { first_name?: string | null; last_name?: string | null; name?: string | null }, now = new Date()) {
  if (input.first_name || input.last_name) {
    const firstName = tidyName(input.first_name ?? '');
    const lastName = tidyName(input.last_name ?? '') || null;
    return { firstName, lastName, name: fullName(firstName, lastName), nameConfirmedAt: lastName ? now : null };
  }
  const name = tidyName(input.name ?? '');
  return { ...splitFullName(name), name, nameConfirmedAt: null };
}

/** Whether a request body changes the name at all. */
export const namesGiven = (input: { first_name?: string | null; last_name?: string | null; name?: string | null }) => Boolean(input.first_name || input.last_name || input.name);

/** A person's first and last name, worked out from the whole name for a row saved without them. */
export function namesOf(row: { name: string; firstName?: string | null; lastName?: string | null; nameConfirmedAt?: Date | null }) {
  const split = row.firstName ? { firstName: row.firstName, lastName: row.lastName ?? null } : splitFullName(row.name);
  return { first_name: split.firstName, last_name: split.lastName, name_confirmed: Boolean(row.nameConfirmedAt) && Boolean(split.lastName) };
}

/** A Google account's first and last name (else its whole name, split), unconfirmed: they may not be as on the ID. */
export function googleNames(claims: { name?: string; given_name?: string; family_name?: string }, email: string) {
  const first = tidyName(claims.given_name ?? '');
  const last = tidyName(claims.family_name ?? '') || null;
  if (first) return { firstName: first, lastName: last, name: fullName(first, last), nameConfirmedAt: null };
  const name = tidyName(claims.name ?? '') || email.split('@')[0]!;
  return { ...splitFullName(name), name, nameConfirmedAt: null };
}
