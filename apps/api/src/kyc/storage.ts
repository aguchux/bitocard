import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import type { AppConfig } from '../config/config.js';
import type { Platform } from '../generated/prisma/client.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { type Credentials, encodeKey, signRequest } from '../media/sigv4.js';

type Bucket = { credentials: Credentials; bucket: string; endpoint: string; root: string };

function bucketFrom(config: AppConfig): Bucket | null {
  if (!config.KYC_SPACES_KEY || !config.KYC_SPACES_SECRET || !config.KYC_SPACES_BUCKET) return null;
  const region = config.KYC_SPACES_REGION;
  return {
    credentials: { accessKey: config.KYC_SPACES_KEY, secret: config.KYC_SPACES_SECRET, region },
    bucket: config.KYC_SPACES_BUCKET,
    endpoint: (config.KYC_SPACES_ENDPOINT ?? `https://${region}.digitaloceanspaces.com`).replace(/\/+$/, ''),
    root: config.KYC_SPACES_ROOT,
  };
}

const unavailable = () => new ApiError(HttpStatus.BAD_GATEWAY, 'api_error', 'storage_unavailable', 'Document storage could not be reached. Try again shortly.');
/** Format marker of a sealed document: version 1, AES-256-GCM. */
const magic = Buffer.from('BCK1');

/**
 * BitoCard Verify's documents in their own private bucket. Every file is sealed by the API before it leaves
 * (AES-256-GCM with a key derived from ENCRYPTION_KEY, the object's key as associated data, so a sealed file cannot be
 * moved to another case and still open), stored `private`, and only ever read back through the API. The bucket never
 * sees a readable file, and no link to an object is ever given out.
 */
@Injectable()
export class KycStorage {
  private readonly bucket: () => Bucket | null;

  constructor(private readonly integrations: IntegrationsService) {
    this.bucket = integrations.derive(bucketFrom);
  }

  private readonly scoped = new Map<Platform, KycStorage>();

  /**
   * The same private storage for a product: its own bucket (that product's Private files settings, never another's),
   * sealed the same way. BitoCard's is this one.
   */
  forPlatform(platform: Platform): KycStorage {
    if (platform === 'bitocard') return this;
    let storage = this.scoped.get(platform);
    if (!storage) {
      storage = Object.create(KycStorage.prototype) as KycStorage;
      Object.assign(storage, { integrations: this.integrations, bucket: this.integrations.deriveFor(platform, bucketFrom), scoped: this.scoped });
      this.scoped.set(platform, storage);
    }
    return storage;
  }

  configured() {
    return this.bucket() !== null;
  }

  private require() {
    const bucket = this.bucket();
    if (!bucket) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'storage_not_configured', 'Document uploads are not set up yet. Try again later.');
    return bucket;
  }

  /** Where a case's file lives: under the case, named by a random id (never the person's name or the file's). */
  key(caseId: string, file: string) {
    return `${this.require().root}/kyc/${caseId}/${file}`;
  }

  /** Where a file sent in a chat lives: under the chat, named by a random id (never the file's own name). */
  chatKey(chatId: string, file: string) {
    return `${this.require().root}/chat/${chatId}/${file}`;
  }

  /** Where a file sent in an Afrippa order's room lives: under the order, named by the message's id. */
  orderRoomKey(orderId: string, messageId: string) {
    return `${this.require().root}/p2p-orders/${orderId}/${messageId}`;
  }

  /** Where a photo sent in a BitoCard Shop chat lives: under the chat, named by a random id. */
  shopChatKey(conversationId: string, file: string) {
    return `${this.require().root}/shop-chat/${conversationId}/${file}`;
  }

  private dataKey() {
    const secret = this.integrations.env.ENCRYPTION_KEY;
    if (!secret) throw new Error('ENCRYPTION_KEY is not configured');
    return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'base64'), Buffer.alloc(0), Buffer.from('bitocard-verify-documents'), 32));
  }

  seal(key: string, plain: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.dataKey(), iv);
    cipher.setAAD(Buffer.from(key));
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([magic, iv, cipher.getAuthTag(), data]);
  }

  open(key: string, sealed: Buffer) {
    if (sealed.length < 32 || !sealed.subarray(0, 4).equals(magic)) throw new Error('Not a sealed document');
    const decipher = createDecipheriv('aes-256-gcm', this.dataKey(), sealed.subarray(4, 16));
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(sealed.subarray(16, 32));
    return Buffer.concat([decipher.update(sealed.subarray(32)), decipher.final()]);
  }

  private async send(method: 'PUT' | 'GET' | 'DELETE', key: string, body?: Buffer) {
    const bucket = this.require();
    const url = new URL(`${bucket.endpoint}/${encodeKey(bucket.bucket)}/${encodeKey(key)}`);
    const headers: Record<string, string> = body ? { 'content-type': 'application/octet-stream', 'x-amz-acl': 'private' } : {};
    const payloadHash = body ? createHash('sha256').update(body).digest('hex') : undefined;
    try {
      return await fetch(url, {
        method,
        headers: signRequest({ method, url, headers, credentials: bucket.credentials, ...(payloadHash ? { payloadHash } : {}) }),
        body: body ? new Uint8Array(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw unavailable();
    }
  }

  /** Seals and stores a file, private. */
  async put(key: string, plain: Buffer) {
    const res = await this.send('PUT', key, this.seal(key, plain));
    if (!res.ok) throw unavailable();
  }

  /** A stored file, opened; null when it is not there (deleted by retention). */
  async get(key: string) {
    const res = await this.send('GET', key);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw unavailable();
    return this.open(key, Buffer.from(await res.arrayBuffer()));
  }

  /** Removes a file; removing one that is not there succeeds. */
  async remove(key: string) {
    const res = await this.send('DELETE', key);
    if (!res.ok && res.status !== 404) throw unavailable();
  }
}
