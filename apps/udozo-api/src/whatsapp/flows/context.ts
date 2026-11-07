import { Prisma } from '../../generated/prisma/client.js';
import type { CustomerWithStore } from '../../customers/customers.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { WhatsappContact } from '../../generated/prisma/client.js';
import type { Inbound } from '../inbound.js';
import type { QueueOptions, QueuedPayload } from '../outbox.service.js';

export type FlowName = 'find' | 'chat_start' | 'chat' | 'sell' | 'wanted' | 'wanted_note';
export type FlowState = Record<string, unknown>;

/** One message being handled: who wrote (and their account, when linked), what they sent, and how to answer. */
export type BotContext = {
  contact: WhatsappContact;
  customer: CustomerWithStore | null;
  /** The account's country, else the number's. */
  country: string;
  input: Inbound;
  state: FlowState;
  /** Udozo's site (udozo.com), for links. */
  site: string;
  say: (message: QueuedPayload['message'], options?: QueueOptions) => Promise<void>;
  setFlow: (flow: FlowName | null, state?: FlowState) => Promise<void>;
  /** Says why something needs an account and how to connect one. */
  needAccount: () => Promise<void>;
};

/** The text typed (or a button's title), trimmed. */
export const typed = (ctx: BotContext) => ctx.input.text.trim();

/** A message from an ApiError (written for people), else a plain apology. */
export const problemText = (error: unknown) => {
  const message = (error as { message?: unknown; getResponse?: () => unknown })?.message;
  const status = (error as { status?: number }).status ?? (error as { getStatus?: () => number }).getStatus?.();
  return typeof message === 'string' && status && status < 500 ? message : 'Something went wrong on our side. Try again in a moment.';
};

/** A price typed as people write it: 450000, 450,000, ₦450k, 4.5m, 1.2 million. Minor units, or null. */
export function readPrice(text: string): number | null {
  const clean = text.toLowerCase().replace(/[,\s₦₵$£]|ngn|ghs|kes|naira|cedis?|shillings?|ksh/g, '');
  const match = /^(\d+(?:\.\d+)?)(k|m|million|thousand)?$/.exec(clean);
  if (!match) return null;
  const scale = match[2] === 'k' || match[2] === 'thousand' ? 1_000 : match[2] === 'm' || match[2] === 'million' ? 1_000_000 : 1;
  const value = Math.round(Number(match[1]) * scale * 100);
  return Number.isSafeInteger(value) && value > 0 && value < 1e15 ? value : null;
}

/** Top categories open in a country, in their order. */
export function topCategories(prisma: PrismaService, country: string) {
  return prisma.classifiedCategory.findMany({
    where: { parentId: null, enabled: true, countries: { some: { country, enabled: true } } },
    orderBy: { position: 'asc' },
    select: { id: true, slug: true, name: true },
  });
}

/** A top category's subcategories open in a country. */
export function subcategories(prisma: PrismaService, parentId: string, country: string) {
  return prisma.classifiedCategory.findMany({
    where: { parentId, enabled: true, countries: { some: { country, enabled: true } } },
    orderBy: { position: 'asc' },
    select: { id: true, slug: true, name: true },
  });
}

/** Subcategories whose name or search words fit what was typed, best first (at most 9). */
export async function matchSubcategories(prisma: PrismaService, country: string, text: string) {
  const q = text.toLowerCase().replace(/[%_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (q.length < 2) return [];
  return prisma.$queryRaw<Array<{ id: string; slug: string; name: string }>>`
    SELECT c."id", c."slug", c."name" FROM "classified_categories" c
    JOIN "classified_category_countries" cc ON cc."category_id" = c."id" AND cc."country" = ${country} AND cc."enabled"
    WHERE c."parent_id" IS NOT NULL AND c."enabled" AND (
      lower(c."name") LIKE ${`%${q}%`}
      OR EXISTS (SELECT 1 FROM unnest(c."keywords") k WHERE k LIKE ${`${q}%`} OR position(k in ${q}) > 0)
    )
    ORDER BY (lower(c."name") LIKE ${`${q}%`}) DESC, (lower(c."name") LIKE ${`%${q}%`}) DESC, c."position"
    LIMIT 9`;
}

/** Areas (never whole states) whose name starts with or contains what was typed, best first (at most 9). */
export function matchAreas(prisma: PrismaService, country: string, text: string) {
  const q = text.replace(/[%_]/g, '').trim().slice(0, 60);
  if (q.length < 2) return Promise.resolve([] as Array<{ id: string; name: string; parent: { name: string } | null }>);
  return prisma.classifiedArea.findMany({
    where: { country, kind: 'area', enabled: true, name: { contains: q, mode: Prisma.QueryMode.insensitive } },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    take: 9,
    select: { id: true, name: true, slug: true, parent: { select: { name: true, slug: true } } },
  });
}

/** "Wuse, FCT". */
export const placeName = (area: { name: string; parent: { name: string } | null } | null) => (area ? (area.parent ? `${area.name}, ${area.parent.name}` : area.name) : null);
