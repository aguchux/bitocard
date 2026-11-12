import { connect, constants as http2 } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';
import { pemKey } from '../auth/apple.js';
import type { AppConfig } from '../config/config.js';

/**
 * Push to Udozo's app (docs/UDOZO_MOBILE_APP_PLAN.md): Firebase Cloud Messaging's HTTP v1 API for Android and Apple's
 * APNs for iPhones, with BitoCard's own keys (no other push service in between). Never throws: the result says whether
 * to try again and whether the token is gone, as for browsers.
 */
export type NativeResult = { ok: true } | { ok: false; gone: boolean; retry: boolean; error: string };

/** What a notification carries to a phone: what the inbox shows and a path in the app, never codes or anyone's words. */
export type NativeNotice = { id: string; type: string; title: string; body: string; link: string | null; severity: string };

/** What rings a closed app: the call and who is calling (their public name), never a number. */
export type NativeCall = { callId: string; caller: string; about: string | null };

type FcmConfig = Pick<AppConfig, 'FCM_SERVICE_ACCOUNT' | 'FCM_API_URL'>;
type ApnsConfig = Pick<AppConfig, 'APNS_KEY_ID' | 'APNS_TEAM_ID' | 'APNS_PRIVATE_KEY' | 'APNS_TOPIC' | 'APNS_SANDBOX' | 'APNS_API_URL'>;

const timeoutMs = 10_000;

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri: string };

/** The Firebase service account's JSON, or null when it is not set or not one. */
export function serviceAccount(config: FcmConfig): ServiceAccount | null {
  if (!config.FCM_SERVICE_ACCOUNT) return null;
  try {
    const value = JSON.parse(config.FCM_SERVICE_ACCOUNT) as Partial<ServiceAccount>;
    if (!value.project_id || !value.client_email || !value.private_key) return null;
    return { project_id: value.project_id, client_email: value.client_email, private_key: value.private_key, token_uri: value.token_uri || 'https://oauth2.googleapis.com/token' };
  } catch {
    return null;
  }
}

export const fcmReady = (config: FcmConfig) => serviceAccount(config) !== null;
export const apnsReady = (config: ApnsConfig) => Boolean(config.APNS_KEY_ID && config.APNS_TEAM_ID && config.APNS_PRIVATE_KEY && config.APNS_TOPIC);

/** FCM's data values must be strings. */
const strings = (value: Record<string, string | null>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null)) as Record<string, string>;

export class FcmSender {
  private access: { token: string; until: number; key: string } | null = null;

  /** An OAuth access token for Firebase Messaging, from the service account (a signed JWT exchanged with Google), kept until just before it ends. */
  private async accessToken(account: ServiceAccount) {
    const key = `${account.client_email}|${account.token_uri}`;
    if (this.access && this.access.key === key && this.access.until > Date.now()) return this.access.token;
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(account.client_email)
      .setAudience(account.token_uri)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(await importPKCS8(account.private_key.replace(/\\n/g, '\n'), 'RS256'));
    const res = await fetch(account.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!res.ok || !body?.access_token) throw new Error(`Google refused the service account (HTTP ${res.status})`);
    this.access = { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000, key };
    return body.access_token;
  }

  private async send(config: FcmConfig, message: Record<string, unknown>): Promise<NativeResult> {
    const account = serviceAccount(config);
    if (!account) return { ok: false, gone: false, retry: false, error: 'FCM is not set up' };
    try {
      const res = await fetch(`${config.FCM_API_URL.replace(/\/+$/, '')}/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.accessToken(account)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => null)) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null;
      const code = body?.error?.details?.find(item => item.errorCode)?.errorCode ?? body?.error?.status ?? '';
      // UNREGISTERED: the app was removed or the token replaced. INVALID_ARGUMENT on a token: never a valid one.
      const gone = res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT');
      return { ok: false, gone, retry: res.status === 429 || res.status >= 500, error: `FCM HTTP ${res.status}${code ? ` ${code}` : ''}` };
    } catch (error) {
      this.access = null;
      return { ok: false, gone: false, retry: true, error: (error as Error).message.slice(0, 300) };
    }
  }

  notify(config: FcmConfig, token: string, notice: NativeNotice) {
    return this.send(config, {
      token,
      notification: { title: notice.title, body: notice.body.slice(0, 300) },
      data: strings({ id: notice.id, type: notice.type, link: notice.link }),
      android: { priority: notice.severity === 'critical' ? 'high' : 'normal', ttl: '86400s', notification: { channel_id: 'notices' } },
    });
  }

  /** Rings a closed app: a high-priority data message the app turns into the system's call screen. Useless after the ring. */
  ring(config: FcmConfig, token: string, call: NativeCall) {
    return this.send(config, { token, data: strings({ kind: 'call', call_id: call.callId, caller: call.caller, about: call.about }), android: { priority: 'high', ttl: '45s' } });
  }

  /** Stops the ringing on a phone that did not answer (answered elsewhere, cancelled, missed). */
  hangUp(config: FcmConfig, token: string, callId: string, reason: 'answered' | 'ended') {
    return this.send(config, { token, data: { kind: 'call_ended', call_id: callId, reason }, android: { priority: 'high', ttl: '60s' } });
  }
}

export class ApnsSender {
  private jwt: { token: string; until: number; key: string } | null = null;

  /** APNs' provider token: ES256, the key's ID and the team, valid an hour; renewed after 40 minutes, as Apple asks. */
  private async providerToken(config: ApnsConfig) {
    const key = `${config.APNS_TEAM_ID}|${config.APNS_KEY_ID}`;
    if (this.jwt && this.jwt.key === key && this.jwt.until > Date.now()) return this.jwt.token;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: config.APNS_KEY_ID })
      .setIssuer(config.APNS_TEAM_ID!)
      .setIssuedAt()
      .sign(await importPKCS8(pemKey(config.APNS_PRIVATE_KEY ?? ''), 'ES256'));
    this.jwt = { token, until: Date.now() + 40 * 60_000, key };
    return token;
  }

  private address(config: ApnsConfig) {
    return config.APNS_API_URL ?? (config.APNS_SANDBOX ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
  }

  /** One request to APNs over HTTP/2 (which it requires). */
  private async send(config: ApnsConfig, token: string, input: { type: 'alert' | 'voip'; priority: 5 | 10; expiration: number; payload: unknown }): Promise<NativeResult> {
    if (!apnsReady(config)) return { ok: false, gone: false, retry: false, error: 'APNs is not set up' };
    if (!/^[0-9a-f]{64,200}$/i.test(token)) return { ok: false, gone: true, retry: false, error: 'Not an APNs token' };
    let bearer: string;
    try {
      bearer = await this.providerToken(config);
    } catch (error) {
      return { ok: false, gone: false, retry: false, error: `APNs key: ${(error as Error).message.slice(0, 200)}` };
    }
    const topic = input.type === 'voip' ? `${config.APNS_TOPIC}.voip` : config.APNS_TOPIC!;
    return new Promise<NativeResult>(resolve => {
      const session = connect(this.address(config));
      const done = (result: NativeResult) => {
        clearTimeout(timer);
        session.close();
        resolve(result);
      };
      const timer = setTimeout(() => done({ ok: false, gone: false, retry: true, error: 'APNs timed out' }), timeoutMs);
      session.on('error', error => done({ ok: false, gone: false, retry: true, error: error.message.slice(0, 300) }));
      const stream = session.request({
        [http2.HTTP2_HEADER_METHOD]: 'POST',
        [http2.HTTP2_HEADER_PATH]: `/3/device/${token}`,
        authorization: `bearer ${bearer}`,
        'apns-topic': topic,
        'apns-push-type': input.type,
        'apns-priority': String(input.priority),
        'apns-expiration': String(input.expiration),
        'content-type': 'application/json',
      });
      let status = 0;
      let body = '';
      stream.on('response', headers => (status = Number(headers[http2.HTTP2_HEADER_STATUS])));
      stream.setEncoding('utf8');
      stream.on('data', chunk => (body += chunk));
      stream.on('error', error => done({ ok: false, gone: false, retry: true, error: error.message.slice(0, 300) }));
      stream.on('end', () => {
        if (status === 200) return done({ ok: true });
        let reason = '';
        try {
          reason = String((JSON.parse(body) as { reason?: string }).reason ?? '');
        } catch {
          /* no body */
        }
        // 410 Unregistered; BadDeviceToken and DeviceTokenNotForTopic: never this app's token.
        const gone = status === 410 || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic' || reason === 'Unregistered';
        if (reason === 'ExpiredProviderToken' || reason === 'InvalidProviderToken') this.jwt = null;
        done({ ok: false, gone, retry: status === 429 || status >= 500 || reason === 'ExpiredProviderToken', error: `APNs HTTP ${status}${reason ? ` ${reason}` : ''}` });
      });
      stream.end(JSON.stringify(input.payload));
    });
  }

  notify(config: ApnsConfig, token: string, notice: NativeNotice) {
    return this.send(config, token, {
      type: 'alert',
      priority: notice.severity === 'critical' ? 10 : 5,
      expiration: Math.floor(Date.now() / 1000) + 24 * 3600,
      payload: { aps: { alert: { title: notice.title, body: notice.body.slice(0, 300) }, sound: 'default', 'thread-id': notice.type }, id: notice.id, type: notice.type, link: notice.link },
    });
  }

  /** A VoIP push (PushKit), only ever for a call: the app must report it to CallKit at once, as Apple requires. */
  ring(config: ApnsConfig, token: string, call: NativeCall) {
    return this.send(config, token, { type: 'voip', priority: 10, expiration: 0, payload: { kind: 'call', call_id: call.callId, caller: call.caller, about: call.about } });
  }
}
