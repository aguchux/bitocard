import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { checkDocument, maxDocumentBytes, stripJpeg } from '../kyc/files.js';
import { MediaStorage } from '../media/storage.js';
import { ListingsService } from './listings.service.js';
import { invalid } from './rules.js';
import { FfmpegTranscoder, maxVideoBytes, type VideoTranscoder, VideoRefused, videoKind } from './video.js';

export type MediaUpload = { buffer: Buffer; mimetype: string; size: number; originalname?: string };

/** Photos smaller than this on their short side are too small to judge an item by. */
export const minPhotoSide = 320;
/** A video still processing after this long is marked failed (the server restarted mid-way); the seller adds it again. */
export const videoTimeoutMs = 30 * 60_000;

const editable = ['draft', 'pending_review', 'active', 'rejected'];
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', code, message);

/**
 * A listing's photos and its one video, uploaded through the API so their metadata (GPS positions above all) is removed
 * before anything is public: photos are checked from their bytes and stripped (`checkDocument`), videos re-encoded with
 * ffmpeg after the reply. Both are then published to the public media bucket under the listing's folder.
 */
@Injectable()
export class ListingMediaService {
  private readonly logger = new Logger(ListingMediaService.name);
  /** Replaced in tests (no ffmpeg there). */
  transcoder: VideoTranscoder = new FfmpegTranscoder();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MediaStorage,
    private readonly listings: ListingsService,
  ) {}

  private requireStorage() {
    if (!this.storage.configured()) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'storage_not_configured', 'Photos cannot be added yet. Try again later.');
  }

  private async editableListing(customer: CustomerWithStore, id: string) {
    await this.listings.sellerCountry(customer);
    const listing = await this.prisma.classifiedListing.findUnique({ where: { id }, include: { media: true } });
    if (!listing || listing.customerId !== customer.id || listing.status === 'deleted') throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such listing.');
    if (!editable.includes(listing.status)) throw conflict('listing_closed', 'This listing can no longer be changed.');
    return listing;
  }

  private folder(listing: { country: string; id: string }) {
    return `classifieds/${listing.country.toLowerCase()}/${listing.id}`;
  }

  async addPhoto(customer: CustomerWithStore, id: string, file: MediaUpload | undefined) {
    this.requireStorage();
    const listing = await this.editableListing(customer, id);
    if (!file) throw invalid('parameter_missing', 'Choose a photo.', 'file');
    if (file.size > maxDocumentBytes) throw invalid('file_too_large', 'Photos can be at most 4 MB.', 'file');
    const checked = checkDocument(file.buffer, file.mimetype, false);
    if ('problem' in checked) throw invalid('file_invalid', checked.problem, 'file');
    if (checked.width !== null && checked.height !== null && Math.min(checked.width, checked.height) < minPhotoSide) {
      throw invalid('photo_too_small', `Photos need to be at least ${minPhotoSide} pixels on their short side.`, 'file');
    }
    const hash = createHash('sha256').update(checked.bytes).digest('hex');
    const same = listing.media.find(item => item.kind === 'photo' && item.contentHash === hash);
    if (same) return this.present(same);
    const settings = await this.listings.marketSettings(listing.country);
    if (listing.media.filter(item => item.kind === 'photo').length >= settings.maxPhotos) throw conflict('too_many_photos', `A listing can have at most ${settings.maxPhotos} photos.`);

    const key = this.storage.key(this.folder(listing), `${randomUUID()}.${checked.contentType === 'image/png' ? 'png' : 'jpg'}`);
    const url = await this.storage.putPublic(key, checked.bytes, checked.contentType);
    const position = Math.max(-1, ...listing.media.filter(item => item.kind === 'photo').map(item => item.position)) + 1;
    const media = await this.prisma.classifiedMedia.create({
      data: { listingId: listing.id, kind: 'photo', position, url, storageKey: key, width: checked.width, height: checked.height, contentHash: hash, status: 'ready' },
    });
    // A new photo on a live listing is checked like the rest (another seller's photo sends it to review).
    if (listing.status === 'active') await this.listings.recheck(listing.id);
    return this.present(media);
  }

  /** Stores the video as processing and re-encodes it after the reply. */
  async addVideo(customer: CustomerWithStore, id: string, file: MediaUpload | undefined) {
    this.requireStorage();
    const listing = await this.editableListing(customer, id);
    if (!file) throw invalid('parameter_missing', 'Choose a video.', 'file');
    if (file.size > maxVideoBytes) throw invalid('file_too_large', 'Videos can be at most 50 MB.', 'file');
    if (!videoKind(file.buffer, file.mimetype)) throw invalid('file_invalid', 'Choose an MP4, MOV or WebM video.', 'file');
    if (listing.media.some(item => item.kind === 'video')) throw conflict('video_exists', 'This listing already has a video. Remove it first.');
    let media;
    try {
      media = await this.prisma.classifiedMedia.create({ data: { listingId: listing.id, kind: 'video', status: 'processing' } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('video_exists', 'This listing already has a video. Remove it first.');
      throw error;
    }
    void this.process(media.id, listing, file.buffer);
    return this.present(media);
  }

  /** Re-encodes, publishes the video and its poster, and marks it ready; or failed, saying why. */
  async process(mediaId: string, listing: { id: string; country: string }, input: Buffer) {
    try {
      const done = await this.transcoder.transcode(input);
      const folder = this.folder(listing);
      const name = randomUUID();
      const key = this.storage.key(folder, `${name}.mp4`);
      const url = await this.storage.putPublic(key, done.video, 'video/mp4');
      const posterUrl = await this.storage.putPublic(this.storage.key(folder, `${name}.jpg`), stripJpeg(done.poster) ?? done.poster, 'image/jpeg');
      const saved = await this.prisma.classifiedMedia.updateMany({
        where: { id: mediaId, status: 'processing' },
        data: { status: 'ready', url, storageKey: key, posterUrl, durationMs: done.durationMs, width: done.width, height: done.height },
      });
      // Removed while it was processing: the published files go too.
      if (!saved.count) await Promise.all([this.storage.remove(key), this.storage.remove(this.storage.key(folder, `${name}.jpg`))]).catch(() => undefined);
    } catch (error) {
      const reason = error instanceof VideoRefused ? error.message : 'This video could not be processed. Try another.';
      if (!(error instanceof VideoRefused)) this.logger.warn(`video ${mediaId} failed: ${(error as Error).message}`);
      await this.prisma.classifiedMedia.updateMany({ where: { id: mediaId, status: 'processing' }, data: { status: 'failed', failureReason: reason } });
    }
  }

  /** The photos in the order given (every photo, each once); the first is the cover. */
  async reorder(customer: CustomerWithStore, id: string, order: string[]) {
    const listing = await this.editableListing(customer, id);
    const photos = listing.media.filter(item => item.kind === 'photo');
    if (order.length !== photos.length || new Set(order).size !== order.length || !order.every(mediaId => photos.some(photo => photo.id === mediaId))) {
      throw invalid('parameter_invalid', 'List every photo of the listing once, in the order to show them.', 'order');
    }
    await this.prisma.$transaction(order.map((mediaId, position) => this.prisma.classifiedMedia.update({ where: { id: mediaId }, data: { position } })));
    return this.listings.get(customer, id);
  }

  async remove(customer: CustomerWithStore, id: string, mediaId: string) {
    const listing = await this.editableListing(customer, id);
    const media = listing.media.find(item => item.id === mediaId);
    if (!media) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such photo or video.');
    if (media.kind === 'photo' && media.status === 'ready' && listing.status !== 'draft') {
      const settings = await this.listings.marketSettings(listing.country);
      const left = listing.media.filter(item => item.kind === 'photo' && item.status === 'ready' && item.id !== mediaId).length;
      if (left < settings.minPhotos) throw invalid('photos_required', `A listing needs at least ${settings.minPhotos} photos. Add another before removing this one.`, 'photos');
    }
    await this.prisma.classifiedMedia.delete({ where: { id: mediaId } });
    await this.removeStored(media);
  }

  /** The published files of removed media (best effort: a leftover object is harmless, never shown). */
  async removeStored(media: { storageKey: string | null; posterUrl: string | null }) {
    if (!media.storageKey) return;
    const keys = [media.storageKey, ...(media.posterUrl ? [media.storageKey.replace(/\.mp4$/, '.jpg')] : [])];
    await Promise.all(keys.map(key => this.storage.remove(key))).catch(error => this.logger.warn(`could not remove ${keys.join(', ')}: ${(error as Error).message}`));
  }

  /** The scheduled job: videos still processing long after upload (the server restarted) are marked failed. */
  async failStale(now = new Date()) {
    const stale = await this.prisma.classifiedMedia.updateMany({
      where: { kind: 'video', status: 'processing', createdAt: { lt: new Date(now.getTime() - videoTimeoutMs) } },
      data: { status: 'failed', failureReason: 'This video took too long to process. Add it again.' },
    });
    return stale.count;
  }

  present(media: { id: string; kind: string; position: number; url: string | null; width: number | null; height: number | null; status: string; posterUrl: string | null; durationMs: number | null; failureReason: string | null }) {
    return {
      object: 'classified_media' as const,
      id: media.id,
      kind: media.kind,
      position: media.position,
      url: media.url,
      width: media.width,
      height: media.height,
      status: media.status,
      failure_reason: media.failureReason,
      ...(media.kind === 'video' ? { poster_url: media.posterUrl, duration_ms: media.durationMs } : {}),
    };
  }
}
