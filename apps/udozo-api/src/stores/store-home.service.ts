import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Store } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { invalidLayout, parseLayout, type Sections } from '../storefront/layout.js';
import { designFor, starterHome } from './templates.js';

const previewLifetimeMs = 30 * 60_000;
const missing = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such store.');

/** A link that shows a store's draft home page for 30 minutes, signed so it cannot be forged. */
export function storePreviewToken(key: string, storeId: string, now = Date.now()) {
  const expires = now + previewLifetimeMs;
  return { token: `${expires}.${createHmac('sha256', key).update(`store-preview:${storeId}:${expires}`).digest('base64url')}`, expires_at: new Date(expires).toISOString() };
}

export function verifyStorePreview(key: string, storeId: string, token: string, now = Date.now()) {
  const [expiresText, signature] = token.split('.');
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < now || !signature) return false;
  const expected = createHmac('sha256', key).update(`store-preview:${storeId}:${expires}`).digest('base64url');
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** The layout a store shows: its published page (draft for a preview), else its variant's starting page; only sections its template offers. */
export function storeLayout(store: Pick<Store, 'template' | 'variant' | 'homeDraft' | 'homePublished'>, draft = false): Sections {
  const { template } = designFor(store.template, store.variant);
  const parsed = parseLayout(draft ? (store.homeDraft ?? store.homePublished) : store.homePublished, template.sections);
  return parsed.success ? parsed.data : starterHome(store.template, store.variant);
}

/**
 * A reseller store's home page in SHQ's editor: the draft (autosaved), publishing it as the next version, versions to
 * restore, starting again from the variant's page, and preview links. Only the sections the store's template offers.
 */
@Injectable()
export class StoreHomeService {
  /** Checks a template's own words before they are saved (the resale module refuses ownership claims on Resale shops). */
  private textChecks: Array<(template: string, sections: Sections) => Promise<void>> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  useTextCheck(check: (template: string, sections: Sections) => Promise<void>) {
    this.textChecks.push(check);
  }

  private async checkText(template: string, sections: Sections) {
    for (const check of this.textChecks) await check(template, sections);
  }

  private async store(resellerId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, resellerId } });
    if (!store) throw missing();
    return store;
  }

  private present(store: Store) {
    const { template, variant } = designFor(store.template, store.variant);
    const published = store.homePublished ? parseLayout(store.homePublished, template.sections) : null;
    return {
      object: 'store_home_editor' as const,
      store_id: store.id,
      template: template.key,
      variant: variant.key,
      /** Section types this store's template offers. */
      sections_allowed: template.sections,
      /** The page being edited: the draft, else what is published, else the variant's starting page. */
      draft: storeLayout(store, true),
      /** False while shoppers see the variant's starting page (nothing published since the template was chosen). */
      published: Boolean(published?.success),
      version: store.homeVersion || null,
      published_at: store.homePublishedAt?.toISOString() ?? null,
      updated_at: store.updatedAt.toISOString(),
    };
  }

  async get(resellerId: string, storeId: string) {
    return this.present(await this.store(resellerId, storeId));
  }

  /** Saves the draft (validated; defaults filled in). Shoppers see nothing until it is published. */
  async saveDraft(resellerId: string, storeId: string, sections: unknown) {
    const store = await this.store(resellerId, storeId);
    const parsed = parseLayout(sections, designFor(store.template, store.variant).template.sections);
    if (!parsed.success) throw invalidLayout(parsed.error.issues);
    await this.checkText(store.template, parsed.data);
    return this.present(await this.prisma.store.update({ where: { id: store.id }, data: { homeDraft: parsed.data as Prisma.InputJsonValue } }));
  }

  /** Publishes the draft as the next version: the store shows it within a minute. */
  async publish(resellerId: string, storeId: string, userId: string | null) {
    const store = await this.store(resellerId, storeId);
    const layout = storeLayout(store, true);
    await this.checkText(store.template, layout);
    const updated = await this.prisma.$transaction(async tx => {
      // Locked, so two people publishing at once get consecutive versions.
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${store.id}::uuid FOR UPDATE`;
      const current = await tx.store.findUniqueOrThrow({ where: { id: store.id } });
      const version = current.homeVersion + 1;
      await tx.storeHomeVersion.create({ data: { storeId: store.id, version, template: current.template, variant: current.variant, sections: layout as Prisma.InputJsonValue, publishedById: userId } });
      return tx.store.update({ where: { id: store.id }, data: { homePublished: layout as Prisma.InputJsonValue, homeDraft: layout as Prisma.InputJsonValue, homeVersion: version, homePublishedAt: new Date() } });
    });
    return this.present(updated);
  }

  /** Starts the draft again from the store's variant page (what is published stays until the next publish). */
  async reset(resellerId: string, storeId: string) {
    const store = await this.store(resellerId, storeId);
    return this.present(await this.prisma.store.update({ where: { id: store.id }, data: { homeDraft: starterHome(store.template, store.variant) as Prisma.InputJsonValue } }));
  }

  async versions(resellerId: string, storeId: string) {
    const store = await this.store(resellerId, storeId);
    const rows = await this.prisma.storeHomeVersion.findMany({ where: { storeId: store.id }, orderBy: { version: 'desc' }, take: 50 });
    return {
      object: 'list' as const,
      data: rows.map(row => ({
        object: 'store_home_version' as const,
        version: row.version,
        template: row.template,
        variant: row.variant,
        sections: Array.isArray(row.sections) ? row.sections.length : 0,
        /** Only versions made with the store's current template can be restored. */
        restorable: row.template === store.template,
        published_at: row.createdAt.toISOString(),
      })),
    };
  }

  /** Copies a published version into the draft. */
  async restore(resellerId: string, storeId: string, version: number) {
    const store = await this.store(resellerId, storeId);
    const row = await this.prisma.storeHomeVersion.findUnique({ where: { storeId_version: { storeId: store.id, version } } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such version.', 'version');
    const parsed = parseLayout(row.sections, designFor(store.template, store.variant).template.sections);
    if (row.template !== store.template || !parsed.success) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'version_other_template', 'This version was made with another template, so it cannot be restored.', 'version');
    }
    return this.present(await this.prisma.store.update({ where: { id: store.id }, data: { homeDraft: parsed.data as Prisma.InputJsonValue } }));
  }

  /** A preview link to the draft on the store's own address, valid 30 minutes. */
  async preview(resellerId: string, storeId: string) {
    const store = await this.store(resellerId, storeId);
    const key = this.integrations.env.ENCRYPTION_KEY;
    if (!key) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Previews need ENCRYPTION_KEY to be set.');
    const { token, expires_at } = storePreviewToken(key, store.id);
    const base = new URL(this.integrations.config.STOREFRONT_URL);
    return { object: 'store_home_preview' as const, url: `${base.protocol}//${store.subdomain}.${base.host}/preview?token=${encodeURIComponent(token)}`, token, expires_at };
  }
}
