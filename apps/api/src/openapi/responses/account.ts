import { apiKeyScopes } from '../../api-keys/api-keys.service.js';
import { productCategories } from '../../countries/countries.service.js';
import { planFeatures } from '../../plans/plans.service.js';
import { optionDefinitions, switchDefinitions } from '../../settings/settings.service.js';
import { staffRoles } from '../../team/team.service.js';
import { eventDocs } from '../../webhooks/openapi.js';
import { array, bool, constant, int, list, nullableStr, nullableTime, objectSchema, oneOf, ref, shape, str, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

const resellerStatus = oneOf('`pending` until the owner passes the identity check (and, where required, BitoCard approves the account), then `active`; `suspended` if BitoCard has suspended it.', ['pending', 'active', 'suspended']);
const roles = ['owner', ...staffRoles] as const;
const scopes = array(oneOf('A scope.', apiKeyScopes), 'What the credentials may do.');
const checkStatus = oneOf(
  '`not_started`, `in_progress` (waiting for the person to finish at `url`), `in_review` (BitoCard is reviewing it), `approved`, `declined` or `expired` (not finished within 7 days).',
  ['not_started', 'in_progress', 'in_review', 'approved', 'declined', 'expired'],
);
const checkReason = nullableStr(
  'Why the check did not pass: `name_mismatch` (the record has a different name), `bvn_consent_declined`, `not_verified` (declined for another reason) or `expired`. Null otherwise.',
  { enum: ['name_mismatch', 'bvn_consent_declined', 'not_verified', 'expired', null] },
);

const optionKeys = Object.keys(optionDefinitions) as (keyof typeof optionDefinitions)[];
const switchKeys = Object.keys(switchDefinitions) as (keyof typeof switchDefinitions)[];

const options = shape(
  Object.fromEntries(
    optionKeys.map(key => {
      const values = [...optionDefinitions[key].values];
      return [
        key,
        shape(
          {
            value: nullableStr('The value in effect: your choice if your country still allows it, otherwise your country’s default. Null if the option is not available in your country yet.', { enum: [...values, null] }),
            allowed: array(oneOf('A value.', values), 'The values your country allows; empty if none yet.'),
            source: oneOf('`reseller` (your choice) or `country_default`.', ['reseller', 'country_default']),
          },
          optionDefinitions[key].description,
        ),
      ];
    }),
  ),
  'Each option: the value in effect, what your country allows, and where the value comes from.',
);

const features = shape(
  Object.fromEntries(switchKeys.map(key => [key, bool(switchDefinitions[key].description)])),
  'Features BitoCard has switched on (`true`) or off for your account. Off unless switched on.',
);

const exampleOptions = {
  gift_card_payout: { value: 'bank', allowed: ['wallet', 'bank'], source: 'reseller' },
  fixed_price_earning: { value: 'markup', allowed: ['markup', 'discount'], source: 'country_default' },
};

const exampleReseller = { object: 'reseller', id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'Ada Digital', country: 'NG', status: 'active' };

const exampleNigeria = {
  object: 'country',
  code: 'NG',
  name: 'Nigeria',
  currency: 'NGN',
  reseller_signup: true,
  reserved_accounts: true,
  markup_cap_percent: 50,
  payout_hold_days: 15,
  min_withdrawal_minor: 1_500_000,
  categories: [
    { category: 'gift_cards', customer_verification: true },
    { category: 'airtime', customer_verification: false },
    { category: 'data', customer_verification: false },
    { category: 'pay_tv', customer_verification: false },
  ],
};

const exampleInvitation = {
  object: 'invitation',
  id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  email: 'chidi@example.com',
  role: 'developer',
  expires_at: '2026-10-13T10:00:00.000Z',
  created_at: '2026-10-06T10:00:00.000Z',
};

const exampleTeam = {
  object: 'team',
  members: [
    { object: 'member', user_id: 'c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f', name: 'Ada Obi', email: 'ada@example.com', role: 'owner', joined_at: '2026-10-01T08:00:00.000Z' },
    { object: 'member', user_id: 'd4e5f6a7-b8c9-4d0e-9f1a-3b4c5d6e7f8a', name: 'Bola Ade', email: 'bola@example.com', role: 'finance', joined_at: '2026-10-03T12:30:00.000Z' },
  ],
  invitations: [exampleInvitation],
};

const verificationExample = eventDocs['customer_verification.approved'].example as Record<string, unknown>;

export const accountDocs: DocsArea = {
  schemas: {
    Reseller: objectSchema(
      'Reseller',
      {
        object: constant('reseller'),
        id: uuid('Reseller account ID.'),
        name: str('Business name.'),
        country: nullableStr('Business country (ISO 3166-1 alpha-2). Null until it is set; it cannot be changed afterwards.'),
        status: resellerStatus,
      },
      'Your reseller account (business).',
    ),
    Account: objectSchema(
      'Account',
      {
        object: constant('account'),
        reseller: ref('Reseller'),
        plan: shape(
          {
            object: constant('plan'),
            code: str('Plan code, for example `standard` or `premium`.'),
            name: str('Plan name.'),
            price: shape(
              {
                amount: int('Monthly price in US cents, charged from your wallet in your currency. 0 for the free plan.'),
                currency: constant('USD'),
                interval: constant('month'),
              },
              'The plan’s price.',
            ),
            features: array(oneOf('A plan feature.', planFeatures), 'What the plan adds, for example `chargeback_protection`.'),
          },
          'Your plan.',
        ),
        authenticated_as: {
          description: 'How this request was authenticated: an API key, a documentation "Try it" token, or a signed-in person (dashboard session).',
          oneOf: [
            shape({ type: constant('api_key'), api_key_id: uuid('The API key used.'), mode: str('The key’s mode: `test` (sandbox) or `live`.', { enum: ['test', 'live'] }), scopes }, 'An API key.'),
            shape(
              { type: constant('docs_token'), mode: str('`test` (sandbox) or `live`.', { enum: ['test', 'live'] }), scopes, expires_at: time('When the token stops working (15 minutes after it was issued).') },
              'A short-lived token issued to a signed-in person by the documentation’s "Try it" feature.',
            ),
            shape({ type: constant('session'), user_id: uuid('The signed-in person.'), role: oneOf('Their role in this reseller account.', roles) }, 'A signed-in person (dashboard).'),
          ],
        },
      },
      'The reseller account a request acts for, its plan, and how the request was authenticated.',
    ),
    ResellerVerification: objectSchema(
      'Reseller identity check',
      {
        object: constant('reseller_verification'),
        reseller_status: resellerStatus,
        verified: bool('Whether the business owner’s identity is verified.'),
        verified_at: nullableTime('When it was verified.'),
        status: checkStatus,
        url: nullableStr('The page where the owner photographs an ID document and takes a selfie, while the check is `in_progress`; otherwise null.'),
        reason: checkReason,
        started_at: nullableTime('When the latest check started; null if none has.'),
      },
      'The business owner’s identity check (ID document and face check), needed before the account goes live.',
    ),
    BvnCheck: objectSchema(
      'BVN check',
      {
        object: constant('bvn_check'),
        verified: bool('Whether the owner’s BVN is verified.'),
        verified_at: nullableTime('When it was verified.'),
        status: checkStatus,
        url: nullableStr('The bank’s consent page where the owner approves sharing their BVN record, while the check is `in_progress`; otherwise null.'),
        reason: checkReason,
        started_at: nullableTime('When the latest check started; null if none has.'),
      },
      'Nigeria: the business owner’s BVN check, needed before reserved bank accounts are opened. The BVN itself is never returned.',
    ),
    Country: objectSchema(
      'Country',
      {
        object: constant('country'),
        code: str('ISO 3166-1 alpha-2 code.', { pattern: '^[A-Z]{2}$' }),
        name: str('Country name.'),
        currency: str('ISO 4217 currency resellers here trade in.', { pattern: '^[A-Z]{3}$' }),
        reseller_signup: bool('Whether resellers based here can sign up.'),
        reserved_accounts: bool('Whether reserved bank accounts (wallet top-ups by bank transfer) are offered here.'),
        markup_cap_percent: int('Markup Protection Scheme: the most your price may be above BitoCard’s wholesale price, in percent.'),
        payout_hold_days: int('Days before a sale’s profit can be withdrawn.'),
        min_withdrawal_minor: int('Smallest withdrawal, in minor units of `currency` (for example kobo).'),
        categories: array(
          shape({
            category: oneOf('Product category.', productCategories),
            customer_verification: bool('Whether hosted storefront customers must verify their identity to buy it here.'),
          }),
          'Product categories sold here.',
        ),
      },
      'A market: its currency, the product categories sold there and the money rules its resellers work under.',
    ),
    Settings: objectSchema('Settings', { object: constant('settings'), options, features }, 'Your choices within what BitoCard allows in your country, and the features switched on for you.'),
    Invitation: objectSchema(
      'Invitation',
      {
        object: constant('invitation'),
        id: uuid('Invitation ID.'),
        email: str('Who was invited.', { format: 'email' }),
        role: oneOf('The role they will have.', staffRoles),
        expires_at: time('When the invitation link stops working (7 days after it was sent).'),
        created_at: time('When it was sent.'),
      },
      'A pending invitation to join your team.',
    ),
    Team: objectSchema(
      'Team',
      {
        object: constant('team'),
        members: array(
          shape({
            object: constant('member'),
            user_id: uuid('The person’s user ID.'),
            name: str('Their name.'),
            email: str('Their email address.', { format: 'email' }),
            role: oneOf('`owner` (one per account; cannot be changed or removed), `admin` (team and keys), `developer` (keys and webhooks), `finance` or `support`.', roles),
            joined_at: time('When they joined.'),
          }),
          'Members, in the order they joined.',
        ),
        invitations: array(ref('Invitation'), 'Pending invitations, newest first.'),
      },
      'Your team: members and pending invitations.',
    ),
  },
  responses: {
    'PATCH /v1/reseller': { status: 200, description: 'The updated business details.', schema: 'Reseller', example: exampleReseller },
    'GET /v1/account': {
      status: 200,
      description: 'The reseller account, its plan, and how the request was authenticated.',
      schema: 'Account',
      example: {
        object: 'account',
        reseller: exampleReseller,
        plan: { object: 'plan', code: 'standard', name: 'Standard', price: { amount: 0, currency: 'USD', interval: 'month' }, features: [] },
        authenticated_as: { type: 'api_key', api_key_id: '6b1f2e3d-4c5a-4b6c-8d7e-9f0a1b2c3d4e', mode: 'test', scopes: ['catalogue:read', 'quotes:write', 'orders:read', 'orders:write', 'wallet:read'] },
      },
    },
    'GET /v1/account/verification': {
      status: 200,
      description: 'The owner’s identity check.',
      schema: 'ResellerVerification',
      example: { object: 'reseller_verification', reseller_status: 'active', verified: true, verified_at: '2026-10-02T14:05:00.000Z', status: 'approved', url: null, reason: null, started_at: '2026-10-02T13:50:00.000Z' },
    },
    'POST /v1/account/verification': {
      status: 201,
      description: 'The check, with the page to send the owner to. An unfinished check started in the last day is returned again instead of a new one.',
      schema: 'ResellerVerification',
      example: { object: 'reseller_verification', reseller_status: 'pending', verified: false, verified_at: null, status: 'in_progress', url: 'https://verify.example.com/session/3f9a1c2e', reason: null, started_at: '2026-10-06T10:00:00.000Z' },
    },
    'GET /v1/account/bvn': {
      status: 200,
      description: 'The owner’s BVN check. An unfinished check is re-read from the bank first.',
      schema: 'BvnCheck',
      example: { object: 'bvn_check', verified: true, verified_at: '2026-10-03T09:12:00.000Z', status: 'approved', url: null, reason: null, started_at: '2026-10-03T09:05:00.000Z' },
    },
    'POST /v1/account/bvn': {
      status: 201,
      description: 'The check, with the bank’s consent page to send the owner to. An unfinished check started in the last day is returned again.',
      schema: 'BvnCheck',
      example: { object: 'bvn_check', verified: false, verified_at: null, status: 'in_progress', url: 'https://consent.example.com/bvn/7d2e4b', reason: null, started_at: '2026-10-06T10:05:00.000Z' },
    },
    'GET /v1/countries': {
      status: 200,
      description: 'Countries open to resellers.',
      schema: list(ref('Country'), {}, false),
      example: {
        object: 'list',
        data: [
          { ...exampleNigeria, code: 'GH', name: 'Ghana', currency: 'GHS', min_withdrawal_minor: 15_000 },
          { ...exampleNigeria, code: 'KE', name: 'Kenya', currency: 'KES', reserved_accounts: false, min_withdrawal_minor: 130_000 },
          exampleNigeria,
        ],
      },
    },
    'GET /v1/countries/{code}': { status: 200, description: 'The country.', schema: 'Country', example: exampleNigeria },
    'GET /v1/settings': {
      status: 200,
      description: 'Your settings.',
      schema: 'Settings',
      example: { object: 'settings', options: exampleOptions, features: { startup_allowance: true, welcome_bonus: false, reserved_accounts: true, own_integrations: false, manual_reseller_approval: false } },
    },
    'PUT /v1/settings/options/{key}': {
      status: 200,
      description: 'Your options after the change.',
      schema: objectSchema('Settings options', { object: constant('settings'), options }),
      example: { object: 'settings', options: exampleOptions },
    },
    'POST /v1/customers/{reference}/verification': {
      status: 201,
      description: 'The check. Send the customer to `url` (live mode); the outcome arrives as a `customer_verification.*` webhook. An approved, in-review or unfinished check for the same customer is returned instead of a new one.',
      schema: 'CustomerVerification',
      example: { ...verificationExample, status: 'in_progress', url: 'https://consent.example.com/bvn/9c1d3e', verified_name: null, reason: null, decided_at: null },
    },
    'GET /v1/customers/{reference}/verification': { status: 200, description: 'The customer’s latest check.', schema: 'CustomerVerification', example: verificationExample },
    'POST /v1/customers/{reference}/verification/simulate': {
      status: 200,
      description: 'The check with the simulated outcome (test mode only). The matching `customer_verification.*` event is sent too.',
      schema: 'CustomerVerification',
      example: { ...verificationExample, mode: 'test', verified_name: 'Chinedu Okafor' },
    },
    'GET /v1/team': { status: 200, description: 'Members and pending invitations.', schema: 'Team', example: exampleTeam },
    'POST /v1/team/invitations': { status: 201, description: 'The invitation. A link valid for 7 days is emailed; a new invitation to the same address replaces the previous one.', schema: 'Invitation', example: exampleInvitation },
    'DELETE /v1/team/invitations/{id}': { status: 204, description: 'The invitation is cancelled; its link no longer works.' },
    'POST /v1/team/invitations/accept': {
      status: 200,
      description: 'You are now a member of the inviting reseller account.',
      schema: objectSchema('Membership', {
        object: constant('membership_created'),
        reseller_id: uuid('The reseller account you joined.'),
        role: oneOf('Your role in it.', staffRoles),
      }),
      example: { object: 'membership_created', reseller_id: exampleReseller.id, role: 'developer' },
    },
    'PATCH /v1/team/members/{userId}': {
      status: 200,
      description: 'The team after the change.',
      schema: 'Team',
      example: { ...exampleTeam, members: [exampleTeam.members[0], { ...exampleTeam.members[1], role: 'admin' }] },
    },
    'DELETE /v1/team/members/{userId}': { status: 204, description: 'The member is removed and loses access at once.' },
  },
};
