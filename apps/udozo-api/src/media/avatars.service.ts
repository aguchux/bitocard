import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { MediaService } from './media.service.js';

/** Whose photo: a customer on udozo.com, or one of Seller HQ's or the admin's people (`users`). */
export type AvatarOwner = { kind: 'customer' | 'user'; id: string };
export type AvatarUploadInput = { filename: string; content_type: string; size: number };

/**
 * The two pictures of a person: their profile photo (`avatar`, square, everyone) and a udozo.com customer's profile
 * cover (`banner`, the wide picture across the top of their seller page, 4:1). Each with its upload purpose, the
 * smallest it may be, and the column it is kept in.
 */
const pictures = {
  avatar: { purpose: 'avatar' as const, minWidth: 64, minHeight: 64, tooSmall: 'avatar_too_small', tooSmallText: 'Choose a photo at least 64 pixels across.', customersOnly: false },
  banner: { purpose: 'profile_banner' as const, minWidth: 600, minHeight: 150, tooSmall: 'banner_too_small', tooSmallText: 'Choose a picture at least 600 pixels wide and 150 high.', customersOnly: true },
};
export type ProfilePicture = keyof typeof pictures;

/**
 * A person's profile photo (a face, a logo or an icon), and a customer's profile cover: asked for (`startUpload`, a
 * signed link to PUT the file to storage), then set (`set`, which checks the stored file is the image it says it is
 * before it is used), or removed. Kept in the person's own folder (`people/<customers|users>/<id>/avatars|banners`); a
 * replaced or removed picture's file is deleted. Public: customers' photos are shown on their seller page and listings,
 * their cover on their seller page, people's photos in Seller HQ and the admin.
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

  private allowed(owner: AvatarOwner, which: ProfilePicture) {
    if (pictures[which].customersOnly && owner.kind !== 'customer') throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such picture.');
    return pictures[which];
  }

  private async current(owner: AvatarOwner, which: ProfilePicture) {
    if (owner.kind === 'customer') {
      const row = await this.prisma.customer.findUnique({ where: { id: owner.id }, select: { avatarUrl: true, bannerUrl: true } });
      return (which === 'banner' ? row?.bannerUrl : row?.avatarUrl) ?? null;
    }
    return (await this.prisma.user.findUnique({ where: { id: owner.id }, select: { avatarUrl: true } }))?.avatarUrl ?? null;
  }

  private async save(owner: AvatarOwner, which: ProfilePicture, url: string | null) {
    if (owner.kind === 'customer') await this.prisma.customer.update({ where: { id: owner.id }, data: which === 'banner' ? { bannerUrl: url } : { avatarUrl: url } });
    else await this.prisma.user.update({ where: { id: owner.id }, data: { avatarUrl: url } });
  }

  /** Deletes the picture files of this kind the person uploaded that are no longer theirs to show (all but `keep`). */
  private async tidy(owner: AvatarOwner, which: ProfilePicture, keep: string | null) {
    const old = await this.prisma.mediaAsset.findMany({ where: { purpose: pictures[which].purpose, uploadedById: owner.id, status: 'ready', ...(keep ? { url: { not: keep } } : {}) }, select: { id: true } });
    for (const asset of old) await this.media.discardFile(asset.id);
  }

  /** Whether pictures can be uploaded (storage set up), and what is accepted. */
  settings() {
    return this.media.settings('person');
  }

  /** A signed link to send the picture to storage (10 minutes): PUT it there, then `set` it. */
  startUpload(owner: AvatarOwner, input: AvatarUploadInput, which: ProfilePicture = 'avatar') {
    return this.media.createUpload(this.actor(owner), { ...input, purpose: this.allowed(owner, which).purpose });
  }

  /** Checks the uploaded picture and makes it theirs: the old one's file is deleted. */
  async set(owner: AvatarOwner, mediaId: string, which: ProfilePicture = 'avatar') {
    const picture = this.allowed(owner, which);
    // Only a picture of this kind: never another of the person's uploads (a profile photo set as a cover).
    const upload = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId }, select: { purpose: true } });
    if (upload && upload.purpose !== picture.purpose) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'That upload could not be found.', 'media_id');
    const asset = await this.media.complete(this.actor(owner), mediaId);
    if (asset.width && asset.height && (asset.width < picture.minWidth || asset.height < picture.minHeight)) {
      await this.media.discardFile(asset.id);
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', picture.tooSmall, picture.tooSmallText, 'media_id');
    }
    await this.save(owner, which, asset.url);
    await this.tidy(owner, which, asset.url);
    return which === 'banner' ? { object: 'profile_banner' as const, banner_url: asset.url } : { object: 'avatar' as const, avatar_url: asset.url };
  }

  /** Takes their photo off (they show their initials again); `removed` says whether there was one. */
  async remove(owner: AvatarOwner) {
    const before = await this.current(owner, 'avatar');
    await this.save(owner, 'avatar', null);
    await this.tidy(owner, 'avatar', null);
    return { object: 'avatar' as const, avatar_url: null, removed: before !== null };
  }

  /** Takes a customer's cover off (Udozo's own banner shows again); `removed` says whether there was one. */
  async removeBanner(owner: AvatarOwner) {
    this.allowed(owner, 'banner');
    const before = await this.current(owner, 'banner');
    await this.save(owner, 'banner', null);
    await this.tidy(owner, 'banner', null);
    return { object: 'profile_banner' as const, banner_url: null, removed: before !== null };
  }
}
