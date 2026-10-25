import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { AppConfig } from '../config/config.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { type Credentials, encodeKey, presign, signRequest } from './sigv4.js';

/** Signed upload links last this long; the browser must start the upload before then. */
export const uploadLinkSeconds = 600;
/** Uploaded names are unique, so files never change and can be cached for good. */
export const uploadCacheControl = 'public, max-age=31536000, immutable';

type Spaces = { credentials: Credentials; bucket: string; endpoint: string; publicUrl: string; root: string };

function spacesFrom(config: AppConfig): Spaces | null {
  if (!config.SPACES_KEY || !config.SPACES_SECRET || !config.SPACES_BUCKET) return null;
  const region = config.SPACES_REGION;
  return {
    credentials: { accessKey: config.SPACES_KEY, secret: config.SPACES_SECRET, region },
    bucket: config.SPACES_BUCKET,
    endpoint: (config.SPACES_ENDPOINT ?? `https://${region}.digitaloceanspaces.com`).replace(/\/+$/, ''),
    publicUrl: (config.SPACES_PUBLIC_URL ?? `https://${config.SPACES_BUCKET}.${region}.digitaloceanspaces.com`).replace(/\/+$/, ''),
    root: config.SPACES_ROOT,
  };
}

const unavailable = () => new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'storage_unavailable', 'File storage could not be reached. Try again shortly.');

/**
 * DigitalOcean Spaces (S3-compatible) through signed requests: presigned PUT links for browsers, and HEAD, ranged GET
 * and DELETE for the API's own checks. Path-style addresses (<endpoint>/<bucket>/<key>), which Spaces supports.
 */
@Injectable()
export class MediaStorage {
  private readonly spaces: () => Spaces | null;

  constructor(integrations: IntegrationsService) {
    this.spaces = integrations.derive(spacesFrom);
  }

  configured() {
    return this.spaces() !== null;
  }

  /** The settings, or `storage_not_configured` when uploads are switched off. */
  private require() {
    const spaces = this.spaces();
    if (!spaces) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'api_error',
        'storage_not_configured',
        'File uploads are not set up yet (Settings > Integrations > File storage). An https:// image address can be used instead.',
      );
    }
    return spaces;
  }

  /** The full object key for a folder and file name, under the deployment's top folder. */
  key(folder: string, file: string) {
    return `${this.require().root}/${folder}/${file}`;
  }

  /**
   * Where the browser uploads: a private staging object. Only the API's copy at the final key is ever public, and the
   * upload link cannot reach it, so a file cannot be swapped for another after it was checked.
   */
  stagingKey(file: string) {
    return `${this.require().root}/uploads/${file}`;
  }

  publicUrl(key: string) {
    return `${this.require().publicUrl}/${encodeKey(key)}`;
  }

  private objectUrl(spaces: Spaces, key: string) {
    return new URL(`${spaces.endpoint}/${encodeKey(spaces.bucket)}/${encodeKey(key)}`);
  }

  /**
   * A link the browser PUTs the file to (its private staging key). Type, size and access are all signed, so the upload
   * must match what was declared: a different size or type is refused by the storage itself.
   */
  presignUpload(key: string, contentType: string, size: number) {
    const spaces = this.require();
    const headers = { 'content-type': contentType, 'content-length': String(size), 'x-amz-acl': 'private' };
    const url = presign({ method: 'PUT', url: this.objectUrl(spaces, key), headers, credentials: spaces.credentials, expiresIn: uploadLinkSeconds });
    // The browser sets Content-Length itself from the file.
    return { method: 'PUT' as const, url, headers: { 'Content-Type': contentType, 'x-amz-acl': 'private' } };
  }

  /**
   * Copies the uploaded staging object to its public, immutable final key (a server-side copy: the bytes as they are now).
   * SVG is published as a download (`Content-Disposition: attachment`): `<img>` tags still show it, but a browser that
   * opens its address on its own never renders it as a page, so even a public address on a BitoCard subdomain
   * (SPACES_PUBLIC_URL) can never run anything there.
   */
  async publish(from: string, to: string, contentType: string) {
    const spaces = this.require();
    const res = await this.send('PUT', to, {
      'x-amz-copy-source': `/${encodeKey(spaces.bucket)}/${encodeKey(from)}`,
      'x-amz-metadata-directive': 'REPLACE',
      'x-amz-acl': 'public-read',
      'content-type': contentType,
      'cache-control': uploadCacheControl,
      ...(contentType === 'image/svg+xml' ? { 'content-disposition': 'attachment' } : {}),
    });
    if (res.status === 404) return false;
    // S3 can answer 200 with an error in the body when a copy fails part-way.
    if (!res.ok || (await res.text()).includes('<Error>')) throw unavailable();
    return true;
  }

  /**
   * Stores bytes the API has already checked straight at their public, immutable key (for files that must pass through
   * the API to have their metadata removed, such as BitoCard Shop's photos and videos). Never SVG.
   */
  async putPublic(key: string, bytes: Buffer, contentType: string) {
    if (contentType === 'image/svg+xml') throw new Error('SVG is only published through checked uploads');
    const res = await this.send('PUT', key, { 'x-amz-acl': 'public-read', 'content-type': contentType, 'cache-control': uploadCacheControl }, bytes);
    if (!res.ok) throw unavailable();
    return this.publicUrl(key);
  }

  private async send(method: string, key: string, headers: Record<string, string> = {}, body?: Buffer) {
    const spaces = this.require();
    const url = this.objectUrl(spaces, key);
    const payloadHash = body ? createHash('sha256').update(body).digest('hex') : undefined;
    try {
      return await fetch(url, {
        method,
        headers: signRequest({ method, url, headers, credentials: spaces.credentials, ...(payloadHash ? { payloadHash } : {}) }),
        body: body ? new Uint8Array(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(body ? 60_000 : 10_000),
      });
    } catch {
      throw unavailable();
    }
  }

  /** The stored object's size and type, or null when it is not there. */
  async head(key: string) {
    const res = await this.send('HEAD', key);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw unavailable();
    return { size: Number(res.headers.get('content-length') ?? -1), contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() };
  }

  /** The first `bytes` of an object. */
  async read(key: string, bytes: number) {
    const res = await this.send('GET', key, { range: `bytes=0-${bytes - 1}` });
    if (res.status !== 200 && res.status !== 206) throw unavailable();
    return Buffer.from(await res.arrayBuffer()).subarray(0, bytes);
  }

  /** Removes an object; removing one that is not there succeeds. */
  async remove(key: string) {
    const res = await this.send('DELETE', key);
    if (!res.ok && res.status !== 404) throw unavailable();
  }
}
