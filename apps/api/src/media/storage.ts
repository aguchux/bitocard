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

  publicUrl(key: string) {
    return `${this.require().publicUrl}/${encodeKey(key)}`;
  }

  private objectUrl(spaces: Spaces, key: string) {
    return new URL(`${spaces.endpoint}/${encodeKey(spaces.bucket)}/${encodeKey(key)}`);
  }

  /**
   * A link the browser PUTs the file to. Type, size, public-read and caching are all signed, so the upload must match
   * what was declared: a different size or type is refused by the storage itself.
   */
  presignUpload(key: string, contentType: string, size: number) {
    const spaces = this.require();
    const headers = { 'content-type': contentType, 'content-length': String(size), 'x-amz-acl': 'public-read', 'cache-control': uploadCacheControl };
    const url = presign({ method: 'PUT', url: this.objectUrl(spaces, key), headers, credentials: spaces.credentials, expiresIn: uploadLinkSeconds });
    // The browser sets Content-Length itself from the file.
    return { method: 'PUT' as const, url, headers: { 'Content-Type': contentType, 'x-amz-acl': 'public-read', 'Cache-Control': uploadCacheControl } };
  }

  private async send(method: string, key: string, headers: Record<string, string> = {}) {
    const spaces = this.require();
    const url = this.objectUrl(spaces, key);
    try {
      return await fetch(url, { method, headers: signRequest({ method, url, headers, credentials: spaces.credentials }), redirect: 'error', signal: AbortSignal.timeout(10_000) });
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
