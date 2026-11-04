import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaService } from '../database/prisma.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { MediaStorage } from '../media/storage.js';
import { InboxService } from '../notifications/inbox.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { cleanWatermarkText, defaultWatermarkText, markVersion, type PhotoContext, photoUrl, type PhotoWidth } from './watermarks.js';

/** How long this instance keeps the switch and Udozo's text before reading them again (sooner after a change here). */
export const watermarkMaxAgeMs = 15_000;
/** Originals the `classifieds` job makes private per run. */
export const privatiseBatch = 500;

const invalid = (code: string, message: string, param: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${what}.`);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Text as words are matched in it, as the listing checks do: lower case, anything not a letter, number or hyphen a space. */
const words = (text: string) => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, ' ').trim()} `;

type UdozoMark = { on: boolean; text: string; version: number; updatedAt: Date; updatedById: string | null; loadedAt: number };

/**
 * Watermarked listing photos (docs/UDOZO_WATERMARK_PLAN.md): whether they are on (`photo_watermarks`), Udozo's text
 * and each store's own, where photos are served (`photoUrl`), the originals udozo.com's image route reads, and making
 * stored originals private. Presenters read the current state synchronously (`url`): this instance keeps it, brought
 * up to date before each request at most every 15 seconds, and at once after a change made here.
 */
@Injectable()
export class WatermarkService implements OnModuleInit {
  private readonly logger = new Logger('Watermarks');
  private mark: UdozoMark | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly integrations: IntegrationsService,
    private readonly storage: MediaStorage,
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    this.settings.onSwitchChanged(key => {
      if (key === 'photo_watermarks' || key === 'store_watermarks') void this.refresh(true);
    });
    await this.refresh(true);
  }

  /** Re-reads the switch and Udozo's text when this copy is older than 15 seconds (or always, with `force`). Never throws. */
  async refresh(force = false) {
    if (!force && this.mark && Date.now() - this.mark.loadedAt < watermarkMaxAgeMs) return;
    if (force) this.loading = null;
    this.loading ??= this.load().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  private async load() {
    try {
      const [on, row] = await Promise.all([this.settings.isOnGlobally('photo_watermarks'), this.prisma.watermarkSettings.findUnique({ where: { id: 1 } })]);
      this.mark = { on, text: row?.text ?? defaultWatermarkText, version: row?.version ?? 1, updatedAt: row?.updatedAt ?? new Date(0), updatedById: row?.updatedById ?? null, loadedAt: Date.now() };
    } catch (error) {
      this.logger.warn(`could not read the watermark settings: ${(error as Error).message}`);
    }
  }

  /** Whether photos are watermarked now (as this instance last read it). */
  get on() {
    return this.mark?.on ?? false;
  }

  /** udozo.com's photo context: null while watermarks are off. */
  get photos(): PhotoContext {
    if (!this.mark?.on) return null;
    return { base: this.integrations.config.STOREFRONT_URL, version: markVersion(this.mark.version) };
  }

  /** A listing photo's address everywhere outside a resale shop's own pages. */
  url(media: { id: string; url: string | null }, width?: PhotoWidth) {
    return photoUrl(media, this.photos, width);
  }

  // ---- Stores ----

  /** Whether a reseller may give their stores their own text (`store_watermarks`, Udozo only). */
  async storeTextAllowed(resellerId: string) {
    return this.config.APP_PRODUCT === 'udozo' && (await this.settings.isOn('store_watermarks', resellerId));
  }

  /** The store's own text and its version when it is shown (allowed and set), else null. */
  private async storeOwn(store: { resellerId: string; watermarkText: string | null; watermarkVersion: number }) {
    if (!store.watermarkText) return null;
    return (await this.storeTextAllowed(store.resellerId)) ? { text: store.watermarkText, version: store.watermarkVersion } : null;
  }

  /**
   * A resale shop's own pages: photos on the store's live address (its primary domain, else its subdomain), with the
   * store's mark when it has one shown. Null while watermarks are off.
   */
  async storeContext(storeId: string): Promise<PhotoContext> {
    const udozo = this.photos;
    if (!udozo || !this.mark) return udozo;
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { subdomain: true, resellerId: true, watermarkText: true, watermarkVersion: true } });
    if (!store) return udozo;
    const domain = await this.prisma.storeDomain.findFirst({ where: { storeId, primary: true, status: 'active' }, select: { name: true } });
    const site = new URL(this.integrations.config.STOREFRONT_URL);
    const base = domain ? `https://${domain.name}` : `${site.protocol}//${store.subdomain}.${site.host}`;
    const own = await this.storeOwn(store);
    return { base, version: markVersion(this.mark.version, own?.version) };
  }

  /** Checks a store's text: the text rule, then Udozo's refused words (`text_refused`). Null clears it. */
  async checkStoreText(raw: string | null, country: string | null) {
    if (raw === null || raw.trim() === '') return null;
    const cleaned = cleanWatermarkText(raw);
    if ('problem' in cleaned) throw invalid('parameter_invalid', cleaned.problem, 'watermark_text');
    const rows = await this.prisma.classifiedProhibitedWord.findMany({ where: { platform: 'bitocard', action: 'block', OR: [{ country: null }, ...(country ? [{ country }] : [])] }, select: { phrase: true } });
    const said = words(cleaned.text);
    if (rows.some(row => words(row.phrase).trim() && said.includes(words(row.phrase)))) {
      throw invalid('text_refused', 'This text uses a word Udozo does not allow. Choose another.', 'watermark_text');
    }
    return cleaned.text;
  }

  // ---- Udozo's text (admins) ----

  private async udozoRow() {
    return (await this.prisma.watermarkSettings.findUnique({ where: { id: 1 } })) ?? (await this.prisma.watermarkSettings.create({ data: { id: 1, text: defaultWatermarkText, version: 1 } }));
  }

  private presentSettings(row: { text: string; version: number; updatedAt: Date; updatedById: string | null }, on: boolean) {
    return {
      object: 'watermark_settings' as const,
      text: row.text,
      version: row.version,
      /** Whether photos are watermarked now (`photo_watermarks`). */
      enabled: on,
      updated_at: row.updatedAt.toISOString(),
      updated_by: row.updatedById,
    };
  }

  async settingsView() {
    const [row, on] = await Promise.all([this.udozoRow(), this.settings.isOnGlobally('photo_watermarks')]);
    return this.presentSettings(row, on);
  }

  /** Udozo's text: every change adds 1 to its version (new photo addresses); the same text again changes nothing. */
  async setText(actorId: string | null, raw: string) {
    const cleaned = cleanWatermarkText(raw);
    if ('problem' in cleaned) throw invalid('parameter_invalid', cleaned.problem, 'text');
    const before = await this.udozoRow();
    if (before.text === cleaned.text) return this.settingsView();
    const after = await this.prisma.watermarkSettings.update({ where: { id: 1 }, data: { text: cleaned.text, version: { increment: 1 }, updatedById: actorId } });
    await this.audit.record({ actorId, action: 'watermark.changed', targetType: 'watermark_settings', targetId: '1', before: { text: before.text, version: before.version }, after: { text: after.text, version: after.version } });
    await this.refresh(true);
    return this.settingsView();
  }

  private presentStore(store: { id: string; name: string; subdomain: string; resellerId: string; watermarkText: string | null; watermarkVersion: number; reseller: { name: string } }, allowed: boolean) {
    return {
      object: 'store_watermark' as const,
      store_id: store.id,
      store_name: store.name,
      subdomain: store.subdomain,
      reseller_id: store.resellerId,
      reseller_name: store.reseller.name,
      text: store.watermarkText,
      version: store.watermarkVersion,
      /** Whether `store_watermarks` lets the reseller's text show (off: their stores show Udozo's). */
      allowed,
    };
  }

  /** Stores with their own text, by name. */
  async storesWithText(query: { q?: string } = {}) {
    const q = query.q?.trim();
    const rows = await this.prisma.store.findMany({
      where: { watermarkText: { not: null }, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { subdomain: { contains: q.toLowerCase() } }, { watermarkText: { contains: q, mode: 'insensitive' } }] } : {}) },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, subdomain: true, resellerId: true, watermarkText: true, watermarkVersion: true, reseller: { select: { name: true } } },
    });
    const allowed = new Map<string, boolean>();
    for (const resellerId of new Set(rows.map(row => row.resellerId))) allowed.set(resellerId, await this.storeTextAllowed(resellerId));
    return { object: 'list' as const, data: rows.map(row => this.presentStore(row, allowed.get(row.resellerId) ?? false)) };
  }

  /** Admins clear a store's text (its stores show Udozo's again); the reseller is told why. */
  async clearStoreText(actorId: string | null, storeId: string, reason: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true, name: true, subdomain: true, resellerId: true, watermarkText: true, watermarkVersion: true, reseller: { select: { name: true } } } });
    if (!store) throw notFound('store');
    if (store.watermarkText === null) return this.presentStore(store, await this.storeTextAllowed(store.resellerId));
    const cleared = await this.prisma.store.updateMany({ where: { id: storeId, watermarkText: store.watermarkText }, data: { watermarkText: null, watermarkVersion: { increment: 1 } } });
    const after = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { id: true, name: true, subdomain: true, resellerId: true, watermarkText: true, watermarkVersion: true, reseller: { select: { name: true } } } });
    if (cleared.count) {
      await this.audit.record({ actorId, action: 'store.watermark_cleared', targetType: 'store', targetId: storeId, before: { watermark_text: store.watermarkText }, after: { watermark_text: null, reason } });
      await this.inbox.reseller(store.resellerId, 'store.watermark_cleared', {
        subject: `${storeId}:watermark:${after.watermarkVersion}`,
        title: `Udozo removed ${store.name}'s photo watermark`,
        body: `Its photos show Udozo's watermark again. Why: ${reason}`,
        link: `/store/${storeId}`,
      });
    }
    return this.presentStore(after, await this.storeTextAllowed(store.resellerId));
  }

  // ---- The public mark and originals (udozo.com's image route) ----

  /** The mark udozo.com draws: a store's own (by ID or subdomain) when allowed and set, else Udozo's. */
  async publicMark(storeKey?: string) {
    await this.refresh();
    const row = await this.udozoRow();
    let own: { text: string; version: number } | null = null;
    const key = storeKey?.trim().toLowerCase();
    if (key) {
      const store = await this.prisma.store.findFirst({ where: uuid.test(key) ? { id: key } : { subdomain: key }, select: { resellerId: true, watermarkText: true, watermarkVersion: true } });
      if (store) own = await this.storeOwn(store);
    }
    return { object: 'watermark' as const, text: own?.text ?? row.text, version: markVersion(row.version, own?.version) };
  }

  /** A photo's original bytes, read with credentials: never a video, never a removed or deleted listing's. Null: not found. */
  async original(id: string) {
    if (!uuid.test(id)) return null;
    const media = await this.prisma.classifiedMedia.findUnique({ where: { id }, select: { kind: true, status: true, storageKey: true, listing: { select: { status: true } } } });
    if (!media || media.kind !== 'photo' || media.status !== 'ready' || !media.storageKey || ['removed', 'deleted'].includes(media.listing.status)) return null;
    const stored = await this.storage.get(media.storageKey);
    if (!stored) return null;
    const contentType = ['image/jpeg', 'image/png'].includes(stored.contentType) ? stored.contentType : media.storageKey.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { bytes: stored.bytes, contentType };
  }

  // ---- Stored originals ----

  /** Stores a new listing photo: private while watermarks are on (its `privateAt` set), public otherwise. */
  async putPhoto(key: string, bytes: Buffer, contentType: string) {
    await this.refresh();
    if (this.on) return { url: await this.storage.putPrivate(key, bytes, contentType), privateAt: new Date() };
    return { url: await this.storage.putPublic(key, bytes, contentType), privateAt: null };
  }

  /**
   * The `classifieds` job: while watermarks are on, makes up to 500 public originals private (PutObjectAcl). A failure is
   * logged and tried again next run; a file no longer stored is marked too (nothing is left to hide).
   */
  async privatise() {
    await this.refresh(true);
    if (!this.on || !this.storage.configured()) return { made_private: 0, failed: 0, skipped: !this.on ? 'off' : 'storage_not_configured' };
    const rows = await this.prisma.classifiedMedia.findMany({ where: { kind: 'photo', privateAt: null, storageKey: { not: null } }, orderBy: { createdAt: 'asc' }, take: privatiseBatch, select: { id: true, storageKey: true } });
    let made = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await this.storage.makePrivate(row.storageKey!);
        await this.prisma.classifiedMedia.update({ where: { id: row.id }, data: { privateAt: new Date() } });
        made += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`could not make photo ${row.id} private: ${(error as Error).message}`);
      }
    }
    return { made_private: made, failed, skipped: null };
  }
}
