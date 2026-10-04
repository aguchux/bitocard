import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { productCategories } from '../countries/countries.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { registryBrand } from '../storefront/brand-registry.js';
import type { MediaAsset, Prisma, ProductCategory } from '../generated/prisma/client.js';
import { inspectImage, sniffBytes } from './images.js';
import { extensions, type MediaPurposeKey, mediaPurposeKeys, mediaPurposes, purposesFor } from './purposes.js';
import { MediaStorage, uploadLinkSeconds } from './storage.js';

/** Who is uploading: an admin (platform files) or a reseller (their own folder). */
export type MediaActor = { realm: 'admin'; userId: string | null } | { realm: 'reseller'; userId: string | null; resellerId: string };

export type UploadInput = { purpose: string; target_id?: string; filename: string; content_type: string; size: number };
export type MediaFilter = { purpose?: string; target_id?: string; owner?: string; q?: string; limit?: number; starting_after?: string };

const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such file.');
const megabytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${bytes / (1024 * 1024)} MB` : `${bytes / 1024} KB`);

/** The library entry for a file. Resellers see only their own; admins see everything. */
export function presentMedia(asset: MediaAsset, inUse?: string[]) {
  return {
    object: 'media_asset' as const,
    id: asset.id,
    url: asset.url,
    purpose: asset.purpose,
    folder: asset.folder,
    target_id: asset.targetId,
    filename: asset.filename,
    content_type: asset.contentType,
    size: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    status: asset.status,
    created_at: asset.createdAt.toISOString(),
    ...(inUse ? { in_use: inUse } : {}),
  };
}

/**
 * Logos, icons and images in object storage (DigitalOcean Spaces). A browser asks for an upload (`createUpload`), PUTs
 * the file straight to storage with the signed link, then asks for it to be checked (`complete`): the API reads the
 * stored file back and accepts it only when it is the declared image type and size. Entities keep the public address;
 * files stay in the library, can be reused, and can be deleted once nothing uses them.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger('Media');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorage,
    private readonly audit: AuditService,
  ) {}

  /** Whether uploads are on, and what each purpose accepts (for the apps' upload buttons). */
  settings(realm: 'admin' | 'reseller') {
    return {
      object: 'media_settings' as const,
      configured: this.storage.configured(),
      purposes: purposesFor(realm).map(key => ({ purpose: key, label: mediaPurposes[key].label, max_bytes: mediaPurposes[key].maxBytes, content_types: mediaPurposes[key].types })),
    };
  }

  private purpose(actor: MediaActor, key: string) {
    if (!mediaPurposeKeys.includes(key as MediaPurposeKey) || mediaPurposes[key as MediaPurposeKey].realm !== actor.realm) {
      throw invalid('parameter_invalid', `purpose must be one of: ${purposesFor(actor.realm).join(', ')}.`, 'purpose');
    }
    return mediaPurposes[key as MediaPurposeKey];
  }

  /** Checks the brand, product, supplier or category an upload is for exists, and returns its canonical id. */
  private async target(kind: string | undefined, id: string | undefined) {
    if (!kind) return undefined;
    if (!id?.trim()) throw invalid('parameter_missing', 'target_id is required for this purpose.', 'target_id');
    const value = id.trim();
    const exists =
      kind === 'brand'
        ? (await this.prisma.brand.count({ where: { slug: value.toLowerCase() } })) + (await this.prisma.product.count({ where: { brand: value.toLowerCase() } })) > 0
        : kind === 'product'
          ? (await this.prisma.product.count({ where: { key: value } })) > 0
          : kind === 'supplier'
            ? (await this.prisma.supplier.count({ where: { code: value } })) > 0
            : kind === 'registry'
              ? registryBrand(value.toLowerCase())?.slug === value.toLowerCase()
              : productCategories.includes(value as ProductCategory);
    if (!exists) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', `No such ${kind}.`, 'target_id');
    return kind === 'brand' || kind === 'registry' ? value.toLowerCase() : value;
  }

  async createUpload(actor: MediaActor, input: UploadInput) {
    const purpose = this.purpose(actor, input.purpose);
    const contentType = input.content_type.trim().toLowerCase();
    if (!purpose.types.includes(contentType)) throw invalid('unsupported_file_type', `${purpose.label}s must be ${purpose.types.map(type => extensions[type].toUpperCase()).join(', ')} images.`, 'content_type');
    if (input.size > purpose.maxBytes) throw invalid('file_too_large', `${purpose.label}s can be at most ${megabytes(purpose.maxBytes)}.`, 'size');
    const targetId = await this.target(purpose.target, input.target_id);
    const resellerId = actor.realm === 'reseller' ? actor.resellerId : undefined;
    const id = randomUUID();
    const folder = purpose.folder(targetId, resellerId);
    const key = this.storage.key(folder, `${id}.${extensions[contentType]}`);
    const upload = this.storage.presignUpload(key, contentType, input.size);
    const asset = await this.prisma.mediaAsset.create({
      data: {
        id,
        key,
        folder: key.slice(0, key.lastIndexOf('/')),
        url: this.storage.publicUrl(key),
        purpose: input.purpose,
        targetId: targetId ?? null,
        resellerId: resellerId ?? null,
        uploadedById: actor.userId,
        filename: input.filename.trim().slice(0, 200),
        contentType,
        sizeBytes: input.size,
        expiresAt: new Date(Date.now() + uploadLinkSeconds * 1000),
      },
    });
    return { object: 'media_upload' as const, id, purpose: asset.purpose, folder: asset.folder, url: asset.url, upload, expires_at: asset.expiresAt.toISOString() };
  }

  private async owned(actor: MediaActor, id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    // Admins manage platform files and can see resellers' (to remove abuse); resellers only their own.
    if (!asset || (actor.realm === 'reseller' && asset.resellerId !== actor.resellerId)) throw notFound();
    return asset;
  }

  /** Throws away a file that failed its checks: from storage and from the library. */
  private async discard(asset: MediaAsset, message: string): Promise<never> {
    await this.storage.remove(asset.key).catch(error => this.logger.warn(`Could not remove ${asset.key}: ${error}`));
    await this.prisma.mediaAsset.deleteMany({ where: { id: asset.id, status: 'pending' } });
    throw invalid('upload_invalid', message);
  }

  /** Reads the uploaded file back and accepts it only if it is what was declared. Safe to call again. */
  async complete(actor: MediaActor, id: string) {
    const asset = await this.owned(actor, id);
    if (asset.status === 'ready') return presentMedia(asset);
    if (actor.realm === 'admin' && asset.resellerId) throw notFound();
    const stored = await this.storage.head(asset.key);
    if (!stored) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'upload_missing', 'The file has not been uploaded yet. Upload it with the signed link, then try again.');
    if (stored.size !== asset.sizeBytes || stored.contentType !== asset.contentType) await this.discard(asset, 'The uploaded file does not match the size or type that was declared.');
    const bytes = await this.storage.read(asset.key, asset.contentType === 'image/svg+xml' ? asset.sizeBytes : Math.min(asset.sizeBytes, sniffBytes));
    const info = inspectImage(bytes, asset.contentType);
    if (!info) {
      await this.discard(asset, asset.contentType === 'image/svg+xml' ? 'SVG images must be plain drawings: no scripts, event handlers, embedded HTML or outside references.' : 'The file is not a valid image of its type.');
    }
    const claimed = await this.prisma.mediaAsset.updateMany({ where: { id, status: 'pending' }, data: { status: 'ready', width: info!.width, height: info!.height, completedAt: new Date() } });
    const ready = await this.prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
    if (claimed.count && actor.realm === 'admin') {
      await this.audit.record({ actorId: actor.userId, action: 'media.uploaded', targetType: 'media', targetId: id, after: presentMedia(ready) });
    }
    return presentMedia(ready);
  }

  async list(actor: MediaActor, filter: MediaFilter) {
    const limit = filter.limit ?? 50;
    const where: Prisma.MediaAssetWhereInput = {
      status: 'ready',
      purpose: filter.purpose,
      targetId: filter.target_id,
      ...(actor.realm === 'reseller'
        ? { resellerId: actor.resellerId }
        : filter.owner === 'platform'
          ? { resellerId: null }
          : filter.owner === 'resellers'
            ? { resellerId: { not: null } }
            : filter.owner
              ? { resellerId: filter.owner }
              : {}),
      ...(filter.q ? { OR: [{ filename: { contains: filter.q, mode: 'insensitive' } }, { folder: { contains: filter.q.toLowerCase() } }, { targetId: { contains: filter.q, mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.mediaAsset.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.starting_after ? { cursor: { id: filter.starting_after }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    const uses = await this.usage(page.map(asset => asset.url));
    return { object: 'list' as const, data: page.map(asset => presentMedia(asset, uses.get(asset.url) ?? [])), has_more: rows.length > limit };
  }

  /** Where each address is used: brands, products, suppliers, categories, stores and storefront pages. */
  async usage(urls: string[]) {
    const uses = new Map<string, string[]>();
    if (!urls.length) return uses;
    const add = (url: string | null, label: string) => {
      if (url && urls.includes(url)) uses.set(url, [...(uses.get(url) ?? []), label]);
    };
    const [brands, products, suppliers, categories, stores, pages, registry] = await Promise.all([
      this.prisma.brand.findMany({ where: { OR: [{ logoUrl: { in: urls } }, { imageUrl: { in: urls } }] }, select: { slug: true, logoUrl: true, imageUrl: true } }),
      this.prisma.product.findMany({ where: { imageUrl: { in: urls } }, select: { key: true, imageUrl: true } }),
      this.prisma.supplier.findMany({ where: { logoUrl: { in: urls } }, select: { code: true, logoUrl: true } }),
      this.prisma.categoryPresentation.findMany({ where: { OR: [{ iconUrl: { in: urls } }, { imageUrl: { in: urls } }] } }),
      this.prisma.store.findMany({ where: { logoUrl: { in: urls } }, select: { subdomain: true, logoUrl: true } }),
      this.prisma.storefrontPage.findMany({ select: { key: true, draft: true, published: true } }),
      this.prisma.brandAsset.findMany({ where: { OR: [{ logoUrl: { in: urls } }, { cardUrl: { in: urls } }] } }),
    ]);
    for (const entry of registry) {
      add(entry.logoUrl, `registry:${entry.slug}:logo`);
      add(entry.cardUrl, `registry:${entry.slug}:card`);
    }
    for (const brand of brands) {
      add(brand.logoUrl, `brand:${brand.slug}:logo`);
      add(brand.imageUrl, `brand:${brand.slug}:card`);
    }
    for (const product of products) add(product.imageUrl, `product:${product.key}`);
    for (const supplier of suppliers) add(supplier.logoUrl, `supplier:${supplier.code}`);
    for (const category of categories) {
      add(category.iconUrl, `category:${category.category}:icon`);
      add(category.imageUrl, `category:${category.category}:image`);
    }
    for (const store of stores) add(store.logoUrl, `store:${store.subdomain}`);
    for (const page of pages) {
      const draft = JSON.stringify(page.draft);
      const published = JSON.stringify(page.published ?? null);
      for (const url of urls) {
        if (draft.includes(JSON.stringify(url))) add(url, `storefront:${page.key}:draft`);
        if (published.includes(JSON.stringify(url))) add(url, `storefront:${page.key}:published`);
      }
    }
    return uses;
  }

  /** Deletes a file from storage and the library, unless something still shows it. */
  async remove(actor: MediaActor, id: string) {
    const asset = await this.owned(actor, id);
    const uses = (await this.usage([asset.url])).get(asset.url) ?? [];
    if (uses.length) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'media_in_use', `The file is still used (${uses.join(', ')}). Replace it there first.`);
    }
    await this.storage.remove(asset.key);
    await this.prisma.mediaAsset.delete({ where: { id } });
    if (actor.realm === 'admin') await this.audit.record({ actorId: actor.userId, action: 'media.deleted', targetType: 'media', targetId: id, before: presentMedia(asset) });
    return { object: 'media_asset' as const, id, deleted: true };
  }

  /** Daily: removes uploads that were started but never completed, an hour after their link expired. */
  async purgeAbandoned() {
    const stale = await this.prisma.mediaAsset.findMany({ where: { status: 'pending', expiresAt: { lt: new Date(Date.now() - 3600_000) } }, take: 500 });
    let removed = 0;
    for (const asset of stale) {
      try {
        if (this.storage.configured()) await this.storage.remove(asset.key);
        await this.prisma.mediaAsset.deleteMany({ where: { id: asset.id, status: 'pending' } });
        removed += 1;
      } catch (error) {
        this.logger.warn(`Could not remove abandoned upload ${asset.key}: ${error}`);
      }
    }
    return { removed };
  }
}
