import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { MediaService } from './media.service.js';

/** Whose photo: a customer on udozo.com, or one of Seller HQ's or the admin's people (`users`). */
export type AvatarOwner = { kind: 'customer' | 'user'; id: string };
export type AvatarUploadInput = { filename: string; content_type: string; size: number };

/**
 * A person's profile photo (a face, a logo or an icon): asked for (`startUpload`, a signed link to PUT the file to
 * storage), then set (`set`, which checks the stored file is the image it says it is before it is used), or removed.
 * Kept in the person's own folder (`people/<customers|users>/<id>/avatars`); a replaced or removed photo's file is
 * deleted. Public: customers' photos are shown on their seller page and listings, people's in Seller HQ and the admin.
 */
@Injectable()
export class AvatarsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  private actor(owner: AvatarOwner) {
    return { realm: 'person' as const, userId: owner.id, owner: owner.kind === 'customer' ? ('customers' as const) : ('users' as const) };
  }

  private async current(owner: AvatarOwner) {
    const row = owner.kind === 'customer' ? await this.prisma.customer.findUnique({ where: { id: owner.id }, select: { avatarUrl: true } }) : await this.prisma.user.findUnique({ where: { id: owner.id }, select: { avatarUrl: true } });
    return row?.avatarUrl ?? null;
  }

  private async save(owner: AvatarOwner, url: string | null) {
    if (owner.kind === 'customer') await this.prisma.customer.update({ where: { id: owner.id }, data: { avatarUrl: url } });
    else await this.prisma.user.update({ where: { id: owner.id }, data: { avatarUrl: url } });
  }

  /** Deletes the photo files this person uploaded that are no longer theirs to show (all but `keep`). */
  private async tidy(owner: AvatarOwner, keep: string | null) {
    const old = await this.prisma.mediaAsset.findMany({ where: { purpose: 'avatar', uploadedById: owner.id, status: 'ready', ...(keep ? { url: { not: keep } } : {}) }, select: { id: true } });
    for (const asset of old) await this.media.discardFile(asset.id);
  }

  /** Whether photos can be uploaded (storage set up), and what is accepted. */
  settings() {
    return this.media.settings('person');
  }

  /** A signed link to send the photo to storage (10 minutes): PUT it there, then `set` it. */
  startUpload(owner: AvatarOwner, input: AvatarUploadInput) {
    return this.media.createUpload(this.actor(owner), { ...input, purpose: 'avatar' });
  }

  /** Checks the uploaded photo and makes it theirs: the old one's file is deleted. */
  async set(owner: AvatarOwner, mediaId: string) {
    const asset = await this.media.complete(this.actor(owner), mediaId);
    if (asset.width && asset.height && (asset.width < 64 || asset.height < 64)) {
      await this.media.discardFile(asset.id);
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'avatar_too_small', 'Choose a photo at least 64 pixels across.', 'media_id');
    }
    await this.save(owner, asset.url);
    await this.tidy(owner, asset.url);
    return { object: 'avatar' as const, avatar_url: asset.url };
  }

  /** Takes their photo off (they show their initials again); `removed` says whether there was one. */
  async remove(owner: AvatarOwner) {
    const before = await this.current(owner);
    await this.save(owner, null);
    await this.tidy(owner, null);
    return { object: 'avatar' as const, avatar_url: null, removed: before !== null };
  }
}
