import { array, bool, constant, int, nullableInt, nullableStr, nullableTime, objectSchema, oneOf, ref, shape, str, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

/** A store's own domains (`/v1/stores/{store}/domains`, SHQ sessions only), and the storefront's lookup by domain. */
const usd = (what: string) => shape({ amount: int(`${what}, in US cents.`), currency: constant('USD') });
const dnsRecordFields = {
  type: str('Record type, for example `A`, `CNAME`, `MX` or `TXT`.'),
  name: str('The name under the domain (`@` or empty for the domain itself).'),
  value: str('The record’s value.'),
};

const domain = objectSchema(
  'StoreDomain',
  {
    object: constant('store_domain'),
    id: uuid('Domain ID.'),
    name: str('The domain, in lower case.'),
    url: str('Its address.'),
    source: oneOf('`purchased` (bought here) or `connected` (bought elsewhere).', ['purchased', 'connected']),
    status: oneOf(
      '`purchasing` (waiting for the registrar), `pending` (waiting for DNS or verification), `active` (your store is served on it), `failed` (the purchase failed; nothing was taken), `expired` or `suspended`.',
      ['purchasing', 'pending', 'active', 'failed', 'expired', 'suspended', 'removed'],
    ),
    dns_mode: oneOf('`vercel` (BitoCard’s DNS: edit records here) or `external` (your own DNS host).', ['vercel', 'external']),
    primary: bool('The store’s main address: links, payment returns and emails use it.'),
    verified: bool('Whether ownership is verified.'),
    configured: bool('Whether its DNS points to your store and HTTPS can be issued.'),
    instructions: array(shape(dnsRecordFields), 'What to set at your DNS host while it is not connected (empty once it works, or on BitoCard’s DNS).'),
    nameservers: { type: ['array', 'null'], items: str('A nameserver.'), description: 'Point the domain to these nameservers to manage its DNS here (connected domains); null on BitoCard’s DNS.' },
    expires_at: nullableTime('When a domain bought here expires; null for connected ones.'),
    auto_renew: { type: ['boolean', 'null'], description: 'Domains bought here: renewed automatically from your wallet 14 days before expiry. Null for connected ones.' },
    price: { anyOf: [usd('What you paid for it'), { type: 'null' }], description: 'What you paid for its registration, in US cents; null for connected ones.' },
    renewal_error: nullableStr('Why the last renewal did not happen (`insufficient_funds`, `renewal_failed`, `renewal_pending` while it is being confirmed), else null.'),
    mail_provider: { type: ['string', 'null'], enum: ['google', 'microsoft', 'zoho', null], description: 'Where its email goes (Google Workspace, Microsoft 365 or Zoho Mail), else null.' },
    email_sending: {
      anyOf: [
        shape({
          status: str('Resend’s status: `not_started`, `pending`, `verified`, `failed` or `temporary_failure`. Order emails come from `from` once verified.'),
          from: str('The address order emails come from.'),
          records: array(shape({ ...dnsRecordFields, priority: nullableInt('MX priority.'), status: nullableStr('Whether the record was found.') }), 'The records sending needs (written for you on BitoCard’s DNS).'),
        }),
        { type: 'null' },
      ],
      description: 'Sending order emails from the domain, once asked for; else null.',
    },
    last_checked_at: nullableTime('When BitoCard last checked it.'),
    last_error: nullableStr('What went wrong at the last check or purchase step, else null.'),
    created_at: time('When it was added.'),
  },
  'One of your store’s domains: bought here or connected, with what to set while it is not connected yet.',
);

const domainExample = {
  object: 'store_domain',
  id: '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f',
  name: 'adadigital.com',
  url: 'https://adadigital.com',
  source: 'purchased',
  status: 'active',
  dns_mode: 'vercel',
  primary: true,
  verified: true,
  configured: true,
  instructions: [],
  nameservers: null,
  expires_at: '2027-10-18T10:00:00.000Z',
  auto_renew: true,
  price: { amount: 1350, currency: 'USD' },
  renewal_error: null,
  mail_provider: 'google',
  email_sending: { status: 'verified', from: 'orders@adadigital.com', records: [{ type: 'TXT', name: 'resend._domainkey', value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC', priority: null, status: 'verified' }] },
  last_checked_at: '2026-10-18T10:15:00.000Z',
  last_error: null,
  created_at: '2026-10-18T10:00:00.000Z',
};
const connectedExample = {
  ...domainExample,
  id: '7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'shop.adadigital.ng',
  url: 'https://shop.adadigital.ng',
  source: 'connected',
  status: 'pending',
  dns_mode: 'external',
  primary: false,
  verified: true,
  configured: false,
  instructions: [{ type: 'A', name: '@', value: '76.76.21.21' }, { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com' }],
  nameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'],
  expires_at: null,
  auto_renew: null,
  price: null,
  mail_provider: null,
  email_sending: null,
};

const offer = objectSchema('DomainOffer', {
  object: constant('domain_offer'),
  domain: str('The domain.'),
  available: bool('Whether it can be bought.'),
  price: { anyOf: [usd('The first year'), { type: 'null' }], description: 'The first year’s price (Vercel’s plus BitoCard’s margin), in US cents; null when not available.' },
  renewal_price: { anyOf: [usd('Each renewal'), { type: 'null' }], description: 'Each year after, in US cents; null when not available.' },
});

const record = objectSchema('DnsRecord', {
  object: constant('dns_record'),
  id: str('Record ID.'),
  name: str('The name under the domain (empty for the domain itself).'),
  type: str('Record type.'),
  value: str('The record’s value.'),
  ttl: nullableInt('Seconds.'),
  priority: nullableInt('MX priority.'),
  protected: bool('Kept by BitoCard for your store or email: not changed or deleted here.'),
});
const recordExample = { object: 'dns_record', id: 'rec_3e1a7b9c2d4f', name: 'blog', type: 'CNAME', value: 'hosting.example.net', ttl: 3600, priority: null, protected: false };

const importRecord = shape({ ...dnsRecordFields, ttl: int('Seconds.'), priority: nullableInt('MX priority.') });

export const domainsDocs: DocsArea = {
  schemas: { StoreDomain: domain, DomainOffer: offer, DnsRecord: record },
  responses: {
    'GET /v1/stores/{store}/domains': {
      status: 200,
      description: 'The store’s domains, whether buying is open and the endings sold.',
      schema: shape({
        object: constant('list'),
        data: array(ref('StoreDomain')),
        buying: shape({ available: bool('Whether domains can be bought here now (otherwise connect one you own).'), tlds: array(str('An ending, for example `com`.')) }),
        max_domains: nullableInt('The most domains a store can have on your plan; null when the plan has no limit.'),
      }),
      example: { object: 'list', data: [domainExample, connectedExample], buying: { available: true, tlds: ['com'] }, max_domains: 5 },
    },
    'GET /v1/stores/{store}/domains/search': {
      status: 200,
      description: 'The name in each ending sold, with availability and prices.',
      schema: shape({ object: constant('list'), data: array(ref('DomainOffer')) }),
      example: { object: 'list', data: [{ object: 'domain_offer', domain: 'adadigital.com', available: true, price: { amount: 1350, currency: 'USD' }, renewal_price: { amount: 1350, currency: 'USD' } }] },
    },
    'POST /v1/stores/{store}/domains/purchase': { status: 201, description: 'The domain, `purchasing` until the registrar confirms (usually seconds), then connected to the store.', schema: 'StoreDomain', example: { ...domainExample, status: 'pending', primary: false, mail_provider: null, email_sending: null } },
    'POST /v1/stores/{store}/domains': { status: 201, description: 'The domain, added to the store and waiting for your DNS.', schema: 'StoreDomain', example: connectedExample },
    'POST /v1/stores/{store}/domains/{id}/check': { status: 200, description: 'The domain as it is now.', schema: 'StoreDomain', example: domainExample },
    'PATCH /v1/stores/{store}/domains/{id}': { status: 200, description: 'The updated domain.', schema: 'StoreDomain', example: domainExample },
    'DELETE /v1/stores/{store}/domains/{id}': { status: 200, description: 'The domain is disconnected from the store.', schema: shape({ object: constant('store_domain'), id: uuid('Domain ID.'), deleted: { type: 'boolean', const: true, description: 'Always true.' } }), example: { object: 'store_domain', id: connectedExample.id, deleted: true } },
    'POST /v1/stores/{store}/domains/{id}/renew': { status: 200, description: 'The domain, renewed for a year.', schema: 'StoreDomain', example: { ...domainExample, expires_at: '2028-10-18T10:00:00.000Z' } },
    'POST /v1/stores/{store}/domains/{id}/transfer-code': {
      status: 200,
      description: 'The code to give your new registrar.',
      schema: shape({ object: constant('domain_transfer_code'), domain: str('The domain.'), code: str('The transfer (auth) code. Keep it private.') }),
      example: { object: 'domain_transfer_code', domain: 'adadigital.com', code: 'Xk7#pQ2m!vR9' },
    },
    'GET /v1/stores/{store}/domains/{id}/records': { status: 200, description: 'The domain’s DNS records.', schema: shape({ object: constant('list'), data: array(ref('DnsRecord')) }), example: { object: 'list', data: [recordExample, { ...recordExample, id: 'rec_9d8c7b6a5f4e', name: '', type: 'MX', value: 'smtp.google.com', priority: 1, protected: true }] } },
    'POST /v1/stores/{store}/domains/{id}/records': { status: 201, description: 'The record, added.', schema: 'DnsRecord', example: recordExample },
    'DELETE /v1/stores/{store}/domains/{id}/records/{record}': { status: 200, description: 'The record is deleted.', schema: shape({ object: constant('dns_record'), id: str('Record ID.'), deleted: { type: 'boolean', const: true, description: 'Always true.' } }), example: { object: 'dns_record', id: recordExample.id, deleted: true } },
    'GET /v1/stores/{store}/domains/{id}/dns-import': {
      status: 200,
      description: 'The public records found, and the nameservers to set once they are copied.',
      schema: shape({ object: constant('dns_import'), domain: str('The domain.'), records: array(importRecord), nameservers: array(str('A nameserver.')) }),
      example: { object: 'dns_import', domain: 'shop.adadigital.ng', records: [{ type: 'MX', name: '', value: 'mx.zoho.com', ttl: 3600, priority: 10 }, { type: 'TXT', name: '', value: 'v=spf1 include:zohomail.com ~all', ttl: 3600, priority: null }], nameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'] },
    },
    'POST /v1/stores/{store}/domains/{id}/dns-import': {
      status: 200,
      description: 'How many records were copied, and the nameservers to set now.',
      schema: shape({ object: constant('dns_import'), domain: str('The domain.'), created: int('Records copied (ones already there are skipped).'), nameservers: array(str('A nameserver.')) }),
      example: { object: 'dns_import', domain: 'shop.adadigital.ng', created: 2, nameservers: ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'] },
    },
    'PUT /v1/stores/{store}/domains/{id}/mail-provider': {
      status: 200,
      description: 'The records the provider needs, and whether BitoCard wrote them (BitoCard’s DNS) or you add them.',
      schema: shape({
        object: constant('mail_setup'),
        domain: str('The domain.'),
        provider: { type: ['string', 'null'], enum: ['google', 'microsoft', 'zoho', null], description: 'The provider now set, or null.' },
        provider_name: nullableStr('Its name.'),
        written: bool('Whether BitoCard wrote the records (domains on BitoCard’s DNS).'),
        records: array(shape({ ...dnsRecordFields, priority: nullableInt('MX priority.') })),
      }),
      example: { object: 'mail_setup', domain: 'adadigital.com', provider: 'google', provider_name: 'Google Workspace', written: true, records: [{ type: 'MX', name: '@', value: 'smtp.google.com', priority: 1 }, { type: 'TXT', name: '@', value: 'v=spf1 include:_spf.google.com ~all', priority: null }] },
    },
    'POST /v1/stores/{store}/domains/{id}/email-sending': { status: 200, description: 'The domain, with sending set up (verified once its records are found).', schema: 'StoreDomain', example: domainExample },
    'GET /v1/storefronts/domains/{domain}': {
      status: 200,
      description: 'The store served on the domain (active domains of published stores only).',
      schema: shape({ object: constant('storefront_domain'), domain: str('The domain.'), subdomain: str('The store’s BitoCard subdomain.') }),
      example: { object: 'storefront_domain', domain: 'adadigital.com', subdomain: 'adadigital' },
    },
  },
};
