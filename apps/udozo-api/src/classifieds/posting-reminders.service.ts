import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { PostingJourneysService } from '../postings/journeys.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ListingsService, missingParts } from './listings.service.js';
import { ShopEmails } from './shop-emails.service.js';

const hourMs = 60 * 60 * 1000;
/** Drafts reminded at most per kind and run of the job (the rest wait for the next run). */
const batch = 200;
/** Reminders to post a complete draft, at most. */
export const readyReminderCount = 3;

type Candidate = { id: string; title: string; customer_id: string; store_id: string };
type Draft = Candidate & { category_id: string | null; area_id: string | null; condition: string | null; price_kind: string; price_minor: bigint | null; photos: number };

/** A title fit for a subject line. */
const short = (title: string) => (title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title);

/** Labels joined as people write them: "a, b and c". */
export function listText(items: string[]) {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** What an unfinished draft still lacks, as the seller reads it. */
export function stillToAdd(draft: Pick<Draft, 'category_id' | 'area_id' | 'title' | 'condition' | 'price_kind' | 'price_minor' | 'photos'>, minPhotos: number) {
  const missing = missingParts({ categoryId: draft.category_id, areaId: draft.area_id, title: draft.title, condition: draft.condition, priceKind: draft.price_kind, priceMinor: draft.price_minor }).map(([, label]) => label);
  const photos = minPhotos - draft.photos;
  if (photos > 0) missing.push(photos === 1 ? 'one more photo' : `${photos} more photos`);
  return missing;
}

/** The words of each reminder: finishing an unfinished draft, then the three to post a complete one. */
export function reminderWords(kind: 'unfinished' | 1 | 2 | 3, title: string, missing: string[] = []) {
  const name = `“${short(title)}”`;
  const stop = 'Not selling it any more? Delete the draft and we will stop reminding you.';
  if (kind === 'unfinished') {
    return { title: `Finish your ad for ${name}`, body: `You started posting ${name} on Udozo. Add ${listText(missing)}, then post it so buyers near you can find it. ${stop}`, action: 'Finish my ad' };
  }
  const titles = { 1: `Your ad for ${name} is ready to post`, 2: `Post ${name} so buyers can find it`, 3: `Last reminder: ${name} is not posted yet` };
  return { title: titles[kind], body: `Everything is filled in. Post it from your account and buyers near you can see it. ${stop}`, action: 'Post my ad' };
}

/**
 * Reminders to finish posting (`classifieds_post_reminders`, a market at a time), run by the `classifieds` job: a
 * draft with its title, category and a photo but not complete gets one reminder `unfinished_reminder_hours` after it
 * was last changed; a complete draft (everything submitting needs, the market's photos, none failed) gets up to three
 * to post it, the first `ready_reminder_1_hours` after it was last changed, the second and third that many hours after
 * the reminder before. Each is an inbox notice and an email, claimed on the listing first (so a job run twice sends
 * nothing twice) without touching when the seller last changed it. Only active sellers with a confirmed email who are
 * not suspended; a deleted, submitted or sent back ad is never reminded.
 */
@Injectable()
export class PostingRemindersService {
  private readonly logger = new Logger(PostingRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly listings: ListingsService,
    private readonly inbox: InboxService,
    private readonly emails: ShopEmails,
    private readonly postings: PostingJourneysService,
  ) {}

  async run(now = new Date()) {
    const result = { unfinished: 0, ready: 0, markets: 0 };
    const countries = await this.prisma.$queryRaw<{ country: string }[]>`SELECT DISTINCT "country" FROM "classified_listings" WHERE "status" = 'draft'`;
    for (const { country } of countries) {
      const on = (await this.settings.isOnForCountry('classifieds', country).catch(() => false)) && (await this.settings.isOnForCountry('classifieds_post_reminders', country).catch(() => false));
      if (!on) continue;
      result.markets += 1;
      const market = await this.listings.marketSettings(country);
      result.unfinished += await this.unfinished(country, market.minPhotos, market.unfinishedReminderHours, now);
      result.ready += await this.ready(country, market.minPhotos, [market.readyReminder1Hours, market.readyReminder2Hours, market.readyReminder3Hours], now);
    }
    return result;
  }

  /** Unfinished drafts quiet for the market's hours, never reminded, never complete: one reminder each. */
  private async unfinished(country: string, minPhotos: number, hours: number, now: Date) {
    const before = new Date(now.getTime() - hours * hourMs);
    const drafts = await this.prisma.$queryRaw<Draft[]>`
      SELECT l."id", l."title", l."customer_id", c."store_id", l."category_id", l."area_id", l."condition", l."price_kind", l."price_minor", p."photos"
      FROM "classified_listings" l
      JOIN "customers" c ON c."id" = l."customer_id" AND c."status" = 'active' AND c."email_verified_at" IS NOT NULL
      LEFT JOIN "classified_sellers" s ON s."customer_id" = l."customer_id"
      CROSS JOIN LATERAL (SELECT count(*)::int AS "photos" FROM "classified_media" m WHERE m."listing_id" = l."id" AND m."kind" = 'photo' AND m."status" = 'ready') p
      WHERE l."status" = 'draft' AND (l."on_shop" OR l."resale") AND l."country" = ${country} AND s."suspended_at" IS NULL
        AND l."unfinished_reminded_at" IS NULL AND l."ready_reminders" = 0 AND l."updated_at" <= ${before}
        AND l."title" IS NOT NULL AND l."category_id" IS NOT NULL AND p."photos" >= 1
        AND NOT (l."area_id" IS NOT NULL AND l."condition" IS NOT NULL AND (l."price_kind" = 'on_request' OR l."price_minor" IS NOT NULL) AND p."photos" >= ${minPhotos})
      ORDER BY l."updated_at"
      LIMIT ${batch}`;
    let sent = 0;
    for (const draft of drafts) {
      const missing = stillToAdd(draft, minPhotos);
      // Complete in all but a failed photo: the reminders to post it (once the photo is fixed) are for it instead.
      if (!missing.length) continue;
      const claimed = await this.prisma.$executeRaw`
        UPDATE "classified_listings" SET "unfinished_reminded_at" = ${now}
        WHERE "id" = ${draft.id}::uuid AND "status" = 'draft' AND "unfinished_reminded_at" IS NULL`;
      if (!claimed) continue;
      await this.tell(draft, 'unfinished', reminderWords('unfinished', draft.title, missing));
      sent += 1;
    }
    return sent;
  }

  /** Complete drafts not posted: the next of three reminders once its hours have passed. */
  private async ready(country: string, minPhotos: number, hours: number[], now: Date) {
    const [first, second, third] = hours.map(value => new Date(now.getTime() - value * hourMs));
    const drafts = await this.prisma.$queryRaw<(Candidate & { ready_reminders: number })[]>`
      SELECT l."id", l."title", l."customer_id", c."store_id", l."ready_reminders"
      FROM "classified_listings" l
      JOIN "customers" c ON c."id" = l."customer_id" AND c."status" = 'active' AND c."email_verified_at" IS NOT NULL
      LEFT JOIN "classified_sellers" s ON s."customer_id" = l."customer_id"
      WHERE l."status" = 'draft' AND (l."on_shop" OR l."resale") AND l."country" = ${country} AND s."suspended_at" IS NULL
        AND l."title" IS NOT NULL AND l."category_id" IS NOT NULL AND l."area_id" IS NOT NULL AND l."condition" IS NOT NULL
        AND (l."price_kind" = 'on_request' OR l."price_minor" IS NOT NULL)
        AND (SELECT count(*) FROM "classified_media" m WHERE m."listing_id" = l."id" AND m."kind" = 'photo' AND m."status" = 'ready') >= ${minPhotos}
        AND NOT EXISTS (SELECT 1 FROM "classified_media" m WHERE m."listing_id" = l."id" AND m."kind" = 'photo' AND m."status" = 'failed')
        AND ((l."ready_reminders" = 0 AND l."updated_at" <= ${first})
          OR (l."ready_reminders" = 1 AND l."ready_reminded_at" <= ${second})
          OR (l."ready_reminders" = 2 AND l."ready_reminded_at" <= ${third}))
      ORDER BY l."updated_at"
      LIMIT ${batch}`;
    let sent = 0;
    for (const draft of drafts) {
      const next = draft.ready_reminders + 1;
      if (next > readyReminderCount) continue;
      const claimed = await this.prisma.$executeRaw`
        UPDATE "classified_listings" SET "ready_reminders" = ${next}, "ready_reminded_at" = ${now}
        WHERE "id" = ${draft.id}::uuid AND "status" = 'draft' AND "ready_reminders" = ${draft.ready_reminders}`;
      if (!claimed) continue;
      await this.tell(draft, `ready_${next}` as 'ready_1', reminderWords(next as 1 | 2 | 3, draft.title));
      sent += 1;
    }
    return sent;
  }

  /** The inbox notice (pushed where the seller allows it) and the email, never failing the run. */
  private async tell(draft: Candidate, kind: 'unfinished' | 'ready_1' | 'ready_2' | 'ready_3', words: { title: string; body: string; action: string }) {
    const path = `/account/listings/${draft.id}`;
    try {
      await this.inbox.customer({ customerId: draft.customer_id, storeId: draft.store_id }, 'customer.classifieds.post_reminder', { subject: `${draft.id}:${kind}`, title: words.title, body: words.body, link: path });
      this.emails.customer(draft.customer_id, { title: words.title, body: words.body, path, action: words.action });
      this.postings.reminded(draft.id, kind);
    } catch (error) {
      this.logger.warn({ err: error, listing: draft.id }, 'Could not send a posting reminder');
    }
  }
}
