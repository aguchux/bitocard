import { createHmac } from 'node:crypto';
import type { AppConfig } from '../config/config.js';

/** A failure during the Facebook round trip: the site, or Seller HQ, shows the person why by its code. */
export class FacebookSignInError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** What Facebook says about the person: the app-scoped id, and the email and names they shared. */
export type FacebookProfile = { id: string; email: string | null; firstName: string | null; lastName: string | null; name: string | null };

type Config = Pick<AppConfig, 'FACEBOOK_DIALOG_URL' | 'FACEBOOK_GRAPH_URL'>;

/** Facebook Login's consent page (the manual flow, a code for this server to exchange), asking only for the email and public profile. */
export function facebookAuthorizationUrl(config: Pick<AppConfig, 'FACEBOOK_DIALOG_URL'>, input: { appId: string; redirectUri: string; state: string }) {
  const url = new URL(config.FACEBOOK_DIALOG_URL);
  url.search = new URLSearchParams({ client_id: input.appId, redirect_uri: input.redirectUri, state: input.state, response_type: 'code', scope: 'email,public_profile' }).toString();
  return url.toString();
}

/** Graph calls are signed with `appsecret_proof`, so a stolen token is useless without the app's secret. */
export const appSecretProof = (token: string, secret: string) => createHmac('sha256', secret).update(token).digest('hex');

async function graphJson(url: URL): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  } catch {
    throw new FacebookSignInError('facebook_failed');
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) throw new FacebookSignInError('facebook_failed');
  return body;
}

/**
 * Exchanges the code Facebook returned (with the app's own secret and the same redirect address), then reads who signed
 * in, with `appsecret_proof`. The token is used only for that and never kept. Facebook gives no email for an account
 * without one, or when the person declined to share it: that sign-in is refused, since every Udozo account has an email.
 */
export async function facebookProfile(config: Config, input: { code: string; appId: string; appSecret: string; redirectUri: string }): Promise<FacebookProfile> {
  const exchange = new URL(`${config.FACEBOOK_GRAPH_URL}/oauth/access_token`);
  exchange.search = new URLSearchParams({ client_id: input.appId, client_secret: input.appSecret, redirect_uri: input.redirectUri, code: input.code }).toString();
  const token = (await graphJson(exchange)).access_token;
  if (typeof token !== 'string' || !token) throw new FacebookSignInError('facebook_failed');
  const me = new URL(`${config.FACEBOOK_GRAPH_URL}/me`);
  me.search = new URLSearchParams({ fields: 'id,email,first_name,last_name,name', access_token: token, appsecret_proof: appSecretProof(token, input.appSecret) }).toString();
  const profile = await graphJson(me);
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const id = text(profile.id);
  if (!id) throw new FacebookSignInError('facebook_failed');
  const email = text(profile.email)?.toLowerCase() ?? null;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new FacebookSignInError('facebook_email_missing');
  return { id, email, firstName: text(profile.first_name), lastName: text(profile.last_name), name: text(profile.name) };
}
