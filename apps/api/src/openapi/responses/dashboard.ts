import { apiKeyScopes } from '../../api-keys/api-keys.service.js';
import { notificationTypes } from '../../notifications/inbox.js';
import { connectableIntegrations } from '../../reseller-integrations/connectable.js';
import {
  array,
  bool,
  constant,
  int,
  list,
  listExample,
  mode,
  nullable,
  nullableStr,
  nullableTime,
  nullableUuid,
  objectSchema,
  oneOf,
  ref,
  shape,
  str,
  time,
  uuid,
} from '../schema.js';
import type { DocsArea } from './index.js';

/**
 * Endpoints the SHQ dashboard uses with a signed-in session (never API keys): sign-up, sign-in and the person's own
 * account, their notifications and push devices, and the reseller's own integrations.
 */

// -- Shared values ------------------------------------------------------------------------------------------------

const severities = ['info', 'success', 'warning', 'critical'] as const;
const resellerRoles = ['owner', 'admin', 'developer', 'finance', 'support'] as const;
/** The notification types a reseller person can receive: their reseller accounts' and their own security notices. */
const resellerNotificationTypes = Object.entries(notificationTypes)
  .filter(([, definition]) => definition.realm === 'reseller' || definition.realm === 'personal')
  .map(([type]) => type);
const integrationIds = connectableIntegrations.map(item => item.id);

const severity = oneOf('How serious it is: `info`, `success`, `warning` or `critical` (urgent).', severities);

// -- Examples -----------------------------------------------------------------------------------------------------

const userId = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const resellerId = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

const userExample = {
  object: 'user',
  id: userId,
  name: 'Ada Obi',
  email: 'ada@adadigital.ng',
  email_verified: true,
  phone: '+2348031234567',
  phone_verified: true,
  has_password: true,
  created_at: '2026-09-14T09:12:44.000Z',
};

const membershipExample = {
  object: 'membership',
  role: 'owner',
  reseller: { object: 'reseller', id: resellerId, name: 'Ada Digital', country: 'NG', status: 'active' },
};

const sessionExample = { object: 'session', user: userExample, memberships: [membershipExample] };

const notice = (message: string) => ({ object: 'notice', message });

const emailsExample = {
  object: 'list',
  data: [
    { object: 'user_email', email: 'ada@adadigital.ng', primary: true, verified: true, added_at: '2026-09-14T09:12:44.000Z' },
    { object: 'user_email', email: 'ada.obi@example.com', primary: false, verified: true, added_at: '2026-10-02T15:40:03.000Z' },
  ],
};

const notificationExample = {
  object: 'notification',
  id: '0c4e7a1b-2d3f-4a5b-8c6d-7e8f9a0b1c2d',
  type: 'top_up.credited',
  severity: 'success',
  title: 'Wallet topped up',
  body: '₦250,000.00 was added to your live wallet.',
  link: '/wallet',
  mode: 'live',
  read: false,
  read_at: null,
  created_at: '2026-10-06T08:31:10.000Z',
};

const securityNotificationExample = {
  object: 'notification',
  id: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
  type: 'security.password_changed',
  severity: 'warning',
  title: 'Your password was changed',
  body: 'Your other sessions were signed out. If this was not you, reset your password and contact support@bitocard.com.',
  link: '/settings/profile',
  mode: null,
  read: true,
  read_at: '2026-10-05T18:02:41.000Z',
  created_at: '2026-10-05T17:58:20.000Z',
};

const deviceExample = {
  object: 'device',
  id: '3e2d1c0b-9a8f-4e7d-8c6b-5a4f3e2d1c0b',
  channel: 'web_push',
  label: 'Chrome on Windows',
  current: true,
  last_pushed_at: '2026-10-06T08:31:12.000Z',
  last_seen_at: '2026-10-06T08:15:00.000Z',
  created_at: '2026-09-20T11:04:37.000Z',
};

const preferenceExample = {
  object: 'notification_preference',
  type: 'order.needs_review',
  label: 'Order outcome unclear',
  severity: 'warning',
  push: true,
  default: true,
  locked: false,
};

const connectionId = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';

const reloadlyExample = {
  object: 'integration',
  id: 'reloadly',
  kind: 'supplier',
  name: 'Reloadly',
  description: 'Gift cards, airtime and data from your own Reloadly account and prices.',
  links: [
    { label: 'Sign up', url: 'https://www.reloadly.com/registration' },
    { label: 'API docs', url: 'https://developers.reloadly.com/' },
  ],
  approval: 'review',
  fields: [
    { key: 'client_id', label: 'Client ID', secret: false, required: true, help: 'Reloadly dashboard > Developers > API settings.', value: 'R3xK9mPq2LwZ', hint: null },
    { key: 'client_secret', label: 'Client secret', secret: true, required: true, help: null, value: null, hint: '…7f3a' },
    {
      key: 'webhook_secret',
      label: 'Webhook signature secret',
      secret: true,
      required: false,
      help: 'From Reloadly’s Developers > Webhooks, once BitoCard gives you a webhook address.',
      value: null,
      hint: '…c21e',
    },
  ],
  connection: {
    object: 'connection',
    id: connectionId,
    mode: 'live',
    status: 'active',
    routing: 'preferred',
    catalogue: { synced_at: '2026-10-06T03:00:12.000Z', error: null },
    decision_note: null,
    last_check: { checked_at: '2026-10-01T10:22:05.000Z', ok: true, message: null },
    created_at: '2026-09-28T14:10:51.000Z',
    updated_at: '2026-10-06T03:00:12.000Z',
    notifications: { url: `https://api.bitocard.com/v1/webhooks/reloadly/${connectionId}`, setup: 'manual', ready: true },
  },
};

const monnifyExample = {
  object: 'integration',
  id: 'monnify',
  kind: 'payment_gateway',
  name: 'Monnify',
  description: 'Nigerian card and bank transfer checkout, paid into your own Monnify account.',
  links: [
    { label: 'Sign up', url: 'https://app.monnify.com/create-account' },
    { label: 'Get API keys', url: 'https://app.monnify.com/developer' },
    { label: 'API docs', url: 'https://developers.monnify.com/' },
  ],
  approval: 'review',
  fields: [
    { key: 'api_key', label: 'API key', secret: false, required: true, help: null, value: null, hint: null },
    { key: 'secret_key', label: 'Secret key', secret: true, required: true, help: null, value: null, hint: null },
    { key: 'contract_code', label: 'Contract code', secret: false, required: true, help: null, value: null, hint: null },
  ],
  connection: null,
};

// -- Schemas ------------------------------------------------------------------------------------------------------

const schemas = {
  Notice: objectSchema(
    'Notice',
    {
      object: constant('notice'),
      message: str('What happened, in plain English, ready to show.'),
    },
    'A confirmation that the request was accepted; the work (an email or text message) may still be on its way.',
  ),

  User: objectSchema(
    'User',
    {
      object: constant('user'),
      id: uuid('The person’s ID.'),
      name: str('Their full name.'),
      email: str('Their primary email address: they sign in with it and notices go to it.', { format: 'email' }),
      email_verified: bool('Whether the primary email address has been confirmed with a code (or by Google).'),
      phone: nullableStr('Their mobile number in E.164 form (for example `+2348031234567`), or null. Only a verified number signs in.'),
      phone_verified: bool('Whether the mobile number has been confirmed by SMS code, so it can be used to sign in.'),
      has_password: bool('Whether the account has a password. People who signed up with Google have none until they set one with "Forgot password".'),
      created_at: time('When the account was created.'),
    },
    'A person signed in to SHQ. One person can belong to several reseller accounts.',
  ),

  Membership: objectSchema(
    'Membership',
    {
      object: constant('membership'),
      role: oneOf('Their role in this reseller account. Owners can do everything; other roles see and change only their areas.', resellerRoles),
      reseller: shape(
        {
          object: constant('reseller'),
          id: uuid('The reseller account’s ID. Send it as `BitoCard-Reseller` to act in this account.'),
          name: str('The business name.'),
          country: nullableStr('The business country (ISO 3166-1 alpha-2, for example `NG`), or null before it is chosen.'),
          status: oneOf('`pending` until the identity check passes, then `active`; `suspended` if BitoCard has suspended it.', ['pending', 'active', 'suspended']),
        },
        'The reseller account.',
      ),
    },
    'A reseller account the person belongs to, and their role in it.',
  ),

  Session: objectSchema(
    'Session',
    {
      object: constant('session'),
      user: ref('User'),
      memberships: array(ref('Membership'), 'The reseller accounts they belong to, oldest first. Empty for a person who has not opened or joined one yet (they go to onboarding).'),
    },
    'The signed-in person and the reseller accounts they belong to. The session itself is the `bc_session` cookie, which is set or kept by the response.',
  ),

  SignupVerification: objectSchema(
    'SignupVerification',
    {
      object: constant('signup_verification'),
      email: str('The confirmed email address.', { format: 'email' }),
      signup_token: str('Pass this to `POST /v1/auth/signup` with the same email. Valid once, for one hour; shown only here.'),
      expires_at: time('When the token stops working.'),
    },
    'A confirmed sign-up email address, ready for creating the account.',
  ),

  DocsToken: objectSchema(
    'DocsToken',
    {
      object: constant('docs_token'),
      token: str('The token, sent as `Authorization: Bearer …` from the browser. Keep it in memory only: never store it, log it or send it to a server of your own.', {
        pattern: '^bc_docs_',
      }),
      mode: mode,
      read_only: bool('Whether only reading scopes are included. Always true for staff whose role cannot create API keys.'),
      scopes: array(oneOf('An API key scope.', apiKeyScopes), 'What the token may do: every scope, or only the `:read` ones when read-only.'),
      reseller: shape(
        {
          id: uuid('The reseller account the token acts for.'),
          name: str('Its business name.'),
        },
        'The reseller account in use when it was issued.',
      ),
      expires_at: time('When it stops working: 15 minutes after issue, or earlier if the dashboard session ends.'),
    },
    'A short-lived "Try it" token for the API documentation. It works like an API key for one reseller account and one mode, and is tied to the dashboard session that issued it.',
  ),

  UserEmail: objectSchema(
    'UserEmail',
    {
      object: constant('user_email'),
      email: str('The address.', { format: 'email' }),
      primary: bool('Whether this is the primary address (sign-in and notices). There is exactly one.'),
      verified: bool('Whether it has been confirmed. Other addresses are always confirmed; the primary one may still be waiting for its code.'),
      added_at: time('When it was added (for the primary address, when the account was created).'),
    },
    'One of the signed-in person’s email addresses.',
  ),

  Notification: objectSchema(
    'Notification',
    {
      object: constant('notification'),
      id: uuid('The notification’s ID.'),
      type: oneOf('What it is about, for example `order.needs_review` or `security.password_changed`.', resellerNotificationTypes),
      severity,
      title: str('A short title.'),
      body: str('The full message.'),
      link: nullableStr('A path in SHQ to open (for example `/orders/…`), or null.'),
      mode: nullable(oneOf('`test` for sandbox notifications, `live` for live ones.', ['test', 'live'])),
      read: bool('Whether you have read it.'),
      read_at: nullableTime('When you read it, or null.'),
      created_at: time('When it was sent.'),
    },
    'An in-app notification: something in the reseller account in use that needs your attention (by your role), or a security notice about your own account. Each person reads their own copy.',
  ),

  PushDevice: objectSchema(
    'PushDevice',
    {
      object: constant('device'),
      id: uuid('The device’s ID.'),
      channel: oneOf('How it receives pushes: `web_push` (a browser’s Web Push subscription).', ['web_push']),
      label: str('How it is shown, for example "Chrome on Windows".'),
      current: bool('Whether it was registered from this session (this browser).'),
      last_pushed_at: nullableTime('When it last accepted a push, or null.'),
      last_seen_at: time('When it was last registered or refreshed.'),
      created_at: time('When it was first registered.'),
    },
    'A browser you turned push notifications on in. It gets your notifications while you stay signed in there, and is dropped when that session ends. The subscription keys are never returned.',
  ),

  NotificationPreference: objectSchema(
    'NotificationPreference',
    {
      object: constant('notification_preference'),
      type: oneOf('The notification type.', resellerNotificationTypes),
      label: str('Its name, ready to show.'),
      severity,
      push: bool('Whether it is pushed to your devices.'),
      default: bool('Whether it is pushed when you have not chosen.'),
      locked: bool('Always pushed (urgent and security notifications); `push` cannot be turned off.'),
    },
    'Whether one notification type you can receive is pushed to your devices.',
  ),

  ResellerConnection: objectSchema(
    'ResellerConnection',
    {
      object: constant('connection'),
      id: uuid('The connection’s ID.'),
      mode: mode,
      status: oneOf(
        '`active` (in use), `pending_review` (live credentials waiting for BitoCard’s review), `rejected` (credentials erased; see `decision_note`) or `suspended` (blocked by BitoCard until reinstated).',
        ['pending_review', 'active', 'rejected', 'suspended'],
      ),
      routing: oneOf('Suppliers: `preferred` (used before BitoCard’s suppliers), `fallback` (only when BitoCard has no offer) or `off` (never).', ['preferred', 'fallback', 'off']),
      catalogue: shape(
        {
          synced_at: nullableTime('When your supplier catalogue was last synced, or null if never.'),
          error: nullableStr('Why the last sync failed, or null.'),
        },
        'Your own supplier catalogue (suppliers only).',
      ),
      decision_note: nullableStr('BitoCard’s reason for rejecting or suspending the connection, or null.'),
      last_check: nullable(
        shape(
          {
            checked_at: time('When the credentials were last checked with the provider.'),
            ok: { type: ['boolean', 'null'], description: 'Whether the provider accepted them; null if unknown.' },
            message: nullableStr('Why the check failed, or null.'),
          },
          'The last live check of the saved credentials, or null if never checked (the sandbox is never checked).',
        ),
      ),
      created_at: time('When it was first connected.'),
      updated_at: time('When it last changed.'),
      notifications: nullable(
        shape(
          {
            url: str('The address your supplier sends this connection’s order updates to.', { format: 'uri' }),
            setup: oneOf('`manual`: enter the address in your supplier’s dashboard and save its signature secret here; `automatic`: BitoCard gives it to the supplier on every order.', [
              'manual',
              'automatic',
            ]),
            ready: bool('Whether updates can be accepted yet (a manual setup needs the signature secret saved).'),
          },
          'Where your supplier sends order updates for this live connection. Null in the sandbox and for integrations without updates.',
        ),
      ),
    },
    'Your own account with the integration, in one mode. Credentials are never returned.',
  ),

  ResellerIntegration: objectSchema(
    'ResellerIntegration',
    {
      object: constant('integration'),
      id: oneOf('The integration’s ID.', integrationIds),
      kind: oneOf('`supplier` (products from your own supplier account) or `payment_gateway` (checkout paid into your own account).', ['supplier', 'payment_gateway']),
      name: str('Its name.'),
      description: str('What connecting it does.'),
      links: array(
        shape({ label: str('What the page is, for example "Sign up" or "API docs".'), url: str('The provider’s page (HTTPS).', { format: 'uri' }) }),
        'Where to sign up with the provider and find the credentials.',
      ),
      approval: oneOf('Live connections start `automatic`ally active, or wait for BitoCard’s `review`.', ['automatic', 'review']),
      fields: array(
        shape({
          key: str('The field’s name in `values` when connecting, for example `client_id`.'),
          label: str('Its label, ready to show.'),
          secret: bool('Write-only: encrypted when saved and never returned; only `hint` shows that it is set.'),
          required: bool('Whether it must be set.'),
          help: nullableStr('Where to find it in the provider’s dashboard, or null.'),
          value: nullableStr('The saved value of a non-secret field, or null. Always null for secrets.'),
          hint: nullableStr('For a saved secret, its last four characters (for example `…7f3a`), or null.'),
        }),
        'The credentials the provider issues.',
      ),
      connection: nullable(ref('ResellerConnection')),
    },
    'An integration you can connect your own account to, with your connection in the mode in use (null when not connected).',
  ),

  OwnCatalogueSync: objectSchema(
    'OwnCatalogueSync',
    {
      object: constant('own_catalogue_sync'),
      integration: oneOf('The supplier synced.', integrationIds),
      mode: mode,
      offers: int('How many of your supplier’s offers are now listed.'),
      withdrawn: int('How many offers your supplier no longer lists, now unavailable.'),
    },
    'The outcome of syncing your own supplier catalogue.',
  ),

  SupplierNotification: objectSchema(
    'SupplierNotification',
    {
      object: constant('supplier_webhook'),
      id: uuid('The notification’s ID.'),
      event_type: nullableStr('The supplier’s event type, or null.'),
      reference: nullableStr('The order reference it names, or null.'),
      supplier_transaction_id: nullableStr('Your supplier’s transaction ID, or null.'),
      order_id: nullableUuid('Your order it was matched to, or null.'),
      status: oneOf(
        '`received` (stored, waiting to be processed or retried), `processed` (the order was checked with your supplier), `unmatched` (no order matches it yet) or `failed` (processing kept failing; the order’s own checks continue).',
        ['received', 'processed', 'unmatched', 'failed'],
      ),
      attempts: int('How many times it has been processed.'),
      last_error: nullableStr('Why the last try failed, or null.'),
      next_attempt_at: nullableTime('When it is tried again, or null if it will not be.'),
      received_at: time('When it arrived.'),
      processed_at: nullableTime('When it was processed, or null.'),
    },
    'An order update your own supplier account sent to its BitoCard address. Its body is never returned.',
  ),
};

const emailList = list(ref('UserEmail'), {}, false);
const notice202 = (description: string, message: string) => ({ status: 202 as const, description, schema: 'Notice', example: notice(message) });

export const dashboardDocs: DocsArea = {
  schemas,
  responses: {
    // -- Authentication ---------------------------------------------------------------------------------------------
    'POST /v1/auth/signup/email': notice202('The code is on its way.', 'A code is on its way.'),
    'POST /v1/auth/signup/email/verify': {
      status: 200,
      description: 'The email is confirmed; use the token to create the account.',
      schema: 'SignupVerification',
      example: { object: 'signup_verification', email: 'ada@adadigital.ng', signup_token: 'EXAMPLE-signup-token-not-real-3kQ9vX2', expires_at: '2026-10-06T10:12:44.000Z' },
    },
    'POST /v1/auth/signup': {
      status: 201,
      description: 'The account is created and signed in (the session cookie is set).',
      schema: 'Session',
      example: { ...sessionExample, user: { ...userExample, phone: null, phone_verified: false, created_at: '2026-10-06T09:12:44.000Z' }, memberships: [{ ...membershipExample, reseller: { ...membershipExample.reseller, status: 'pending' } }] },
    },
    'POST /v1/auth/reseller-account': {
      status: 201,
      description: 'The reseller account is opened and you are its owner.',
      schema: 'Session',
      example: { ...sessionExample, memberships: [{ ...membershipExample, reseller: { ...membershipExample.reseller, status: 'pending' } }] },
    },
    'POST /v1/auth/signin': { status: 200, description: 'Signed in (the session cookie is set).', schema: 'Session', example: sessionExample },
    'POST /v1/auth/signout': { status: 204, description: 'Signed out; the session cookie is cleared.' },
    'GET /v1/auth/session': { status: 200, description: 'The signed-in person.', schema: 'Session', example: sessionExample },
    'POST /v1/auth/docs-token': {
      status: 200,
      description: 'A "Try it" token for the API documentation.',
      schema: 'DocsToken',
      example: {
        object: 'docs_token',
        token: 'bc_docs_EXAMPLE-ONLY-not-a-real-token.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        mode: 'test',
        read_only: false,
        scopes: [...apiKeyScopes],
        reseller: { id: resellerId, name: 'Ada Digital' },
        expires_at: '2026-10-06T09:27:44.000Z',
      },
    },
    'POST /v1/auth/email/verify': { status: 200, description: 'Your email is confirmed.', schema: 'Session', example: sessionExample },
    'POST /v1/auth/email/resend': notice202('A new code is on its way.', 'A new code is on its way.'),
    'PATCH /v1/auth/profile': { status: 200, description: 'Your name is changed.', schema: 'Session', example: sessionExample },
    'POST /v1/auth/password/change': { status: 200, description: 'Your password is changed; your other sessions are signed out.', schema: 'Notice', example: notice('Your password was changed.') },
    'GET /v1/auth/emails': { status: 200, description: 'Your email addresses, the primary one first.', schema: emailList, example: emailsExample },
    'POST /v1/auth/emails': notice202('A code is on its way to the address.', 'A code is on its way to the address.'),
    'POST /v1/auth/emails/verify': { status: 200, description: 'The address is added; your addresses now.', schema: emailList, example: emailsExample },
    'POST /v1/auth/emails/primary': {
      status: 200,
      description: 'The address is now primary; your addresses now.',
      schema: emailList,
      example: {
        object: 'list',
        data: [
          { object: 'user_email', email: 'ada.obi@example.com', primary: true, verified: true, added_at: '2026-09-14T09:12:44.000Z' },
          { object: 'user_email', email: 'ada@adadigital.ng', primary: false, verified: true, added_at: '2026-10-06T09:20:01.000Z' },
        ],
      },
    },
    'DELETE /v1/auth/emails/{email}': { status: 200, description: 'The address is removed; your addresses now.', schema: emailList, example: { object: 'list', data: [emailsExample.data[0]] } },
    'POST /v1/auth/phone': {
      status: 202,
      description: 'A code is on its way by SMS.',
      schema: shape({
        object: constant('notice'),
        message: str('What happened, in plain English, ready to show.'),
        phone: str('The number the code was sent to, in E.164 form.'),
      }),
      example: { object: 'notice', message: 'A code is on its way to +2348031234567.', phone: '+2348031234567' },
    },
    'POST /v1/auth/phone/verify': { status: 200, description: 'Your mobile number is confirmed; you can sign in with it.', schema: 'Session', example: sessionExample },
    'POST /v1/auth/password/forgot': notice202('Always reported, whether or not the account exists.', 'If an account uses this email, a reset code is on its way.'),
    'POST /v1/auth/password/reset': { status: 200, description: 'The password is changed and every session signed out.', schema: 'Notice', example: notice('Your password has been changed. Sign in with it now.') },
    'GET /v1/auth/google/start': { status: 302, description: 'Redirects the browser to Google.' },
    'GET /v1/auth/google/callback': { status: 302, description: 'Redirects the browser back to the BitoCard app it came from, signed in, or with `?auth_error=<code>`.' },

    // -- Notifications and push -------------------------------------------------------------------------------------
    'GET /v1/notifications': {
      status: 200,
      description: 'Your notifications, newest first.',
      schema: list(ref('Notification'), { unread_count: int('How many of your notifications are unread (all of them, not only this page).') }),
      example: { ...listExample([notificationExample, securityNotificationExample], true), unread_count: 1 },
    },
    'GET /v1/notifications/unread-count': {
      status: 200,
      description: 'How many notifications you have not read.',
      schema: shape({ object: constant('unread_count'), count: int('Unread notifications.') }),
      example: { object: 'unread_count', count: 3 },
    },
    'POST /v1/notifications/read-all': {
      status: 200,
      description: 'Every notification is marked read.',
      schema: shape({ object: constant('notifications_read'), updated: int('How many were unread and are now read.') }),
      example: { object: 'notifications_read', updated: 3 },
    },
    'POST /v1/notifications/{id}/read': {
      status: 200,
      description: 'The notification, marked read.',
      schema: 'Notification',
      example: { ...notificationExample, read: true, read_at: '2026-10-06T08:40:02.000Z' },
    },
    'GET /v1/devices/push-settings': {
      status: 200,
      description: 'Whether push is on, and the key to subscribe with.',
      schema: shape({
        object: constant('push_settings'),
        enabled: bool('Whether push notifications are switched on. When off, only the in-app inbox is used.'),
        public_key: nullableStr('The VAPID public key (base64url) to pass as `applicationServerKey` to `PushManager.subscribe`, or null while push is off.'),
      }),
      example: { object: 'push_settings', enabled: true, public_key: 'BExampleOnlyVapidPublicKey-not-real_3f9KqL2mN8pR4sT6vW1xY5zA7bC0dE2fG4hJ6kL8mN0pQ2rS4tU6vW8xY0z' },
    },
    'GET /v1/devices': { status: 200, description: 'Your devices, most recently seen first.', schema: list(ref('PushDevice'), {}, false), example: { object: 'list', data: [deviceExample] } },
    'POST /v1/devices': { status: 201, description: 'This browser is registered for push.', schema: 'PushDevice', example: { ...deviceExample, last_pushed_at: null } },
    'POST /v1/devices/{id}/test': {
      status: 200,
      description: 'Whether the push service accepted the test push.',
      schema: shape({
        object: constant('push_test'),
        sent: bool('Whether the push service accepted it (the browser shows it when it is online).'),
        error: nullableStr('Why it was not accepted (for example `HTTP 410`), or null.'),
      }),
      example: { object: 'push_test', sent: true, error: null },
    },
    'DELETE /v1/devices/{id}': { status: 204, description: 'The device is removed.' },
    'GET /v1/notification-preferences': {
      status: 200,
      description: 'Every notification you can get, and whether it is pushed.',
      schema: list(ref('NotificationPreference'), {}, false),
      example: {
        object: 'list',
        data: [
          preferenceExample,
          { object: 'notification_preference', type: 'top_up.credited', label: 'Wallet topped up', severity: 'success', push: false, default: false, locked: false },
          { object: 'notification_preference', type: 'security.password_changed', label: 'Password changed', severity: 'warning', push: true, default: true, locked: true },
        ],
      },
    },
    'PUT /v1/notification-preferences/{type}': { status: 200, description: 'The preference, saved.', schema: 'NotificationPreference', example: { ...preferenceExample, push: false } },

    // -- Your own integrations ----------------------------------------------------------------------------------------
    'GET /v1/integrations': {
      status: 200,
      description: 'Integrations offered in your country, with your connections in this mode.',
      schema: list(
        ref('ResellerIntegration'),
        {
          access: shape(
            {
              allowed: bool('Whether your account may connect its own integrations in this mode.'),
              reason: nullable(
                oneOf('Why not: `switch_off` (not switched on for your account), `plan` (your plan does not include it), `no_country` (choose your business country) or `not_verified` (live needs a verified account).', [
                  'switch_off',
                  'plan',
                  'not_verified',
                  'no_country',
                ]),
              ),
            },
            'Whether you can connect, and why not.',
          ),
        },
        false,
      ),
      example: { object: 'list', access: { allowed: true, reason: null }, data: [reloadlyExample, monnifyExample] },
    },
    'PUT /v1/integrations/{id}/connection': {
      status: 200,
      description: 'Connected. Secrets are never returned: only their last four characters as `hint`.',
      schema: 'ResellerIntegration',
      example: { ...reloadlyExample, connection: { ...reloadlyExample.connection, status: 'pending_review', catalogue: { synced_at: null, error: null } } },
    },
    'DELETE /v1/integrations/{id}/connection': { status: 204, description: 'Disconnected; the saved credentials are erased.' },
    'POST /v1/integrations/{id}/connection/check': {
      status: 200,
      description: 'The integration with the outcome of the check in `connection.last_check`.',
      schema: 'ResellerIntegration',
      example: { ...reloadlyExample, connection: { ...reloadlyExample.connection, last_check: { checked_at: '2026-10-06T09:05:40.000Z', ok: true, message: null } } },
    },
    'POST /v1/integrations/{id}/connection/sync': {
      status: 200,
      description: 'Your supplier catalogue is synced.',
      schema: 'OwnCatalogueSync',
      example: { object: 'own_catalogue_sync', integration: 'reloadly', mode: 'live', offers: 1284, withdrawn: 6 },
    },
    'PUT /v1/integrations/{id}/connection/routing': { status: 204, description: 'Saved.' },
    'GET /v1/integrations/{id}/connection/notifications': {
      status: 200,
      description: 'Order updates your own live supplier account sent, newest first.',
      schema: list(ref('SupplierNotification')),
      example: listExample([
        {
          object: 'supplier_webhook',
          id: 'e7f8a9b0-c1d2-4e3f-8a4b-5c6d7e8f9a0b',
          event_type: 'giftcard_transaction.status',
          reference: '202610060931BCR8K2Q',
          supplier_transaction_id: '48213',
          order_id: 'a0b1c2d3-e4f5-4a6b-8c7d-8e9f0a1b2c3d',
          status: 'processed',
          attempts: 1,
          last_error: null,
          next_attempt_at: null,
          received_at: '2026-10-06T09:31:58.000Z',
          processed_at: '2026-10-06T09:31:59.000Z',
        },
      ]),
    },
  },
};
