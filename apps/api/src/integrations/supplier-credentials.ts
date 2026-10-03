import type { IntegrationKind } from './definitions.js';

/**
 * Credentials for every supplier in the registry whose adapter is not built yet, so admins can save them as BitoCard
 * subscribes (Settings > Integrations > Suppliers). They are stored like any secret (encrypted, write-only, audited) and
 * read by the supplier's adapter once it is built (`IntegrationsService.supplier(code)`). There is no environment
 * fallback for these: they are set in the admin app only.
 *
 * The fields follow each supplier's published authentication scheme as far as it is known; confirm them against the
 * credentials the supplier actually issues (and adjust here) before building its adapter. Reloadly and VTpass have
 * their own groups in `definitions.ts`. Flutterwave virtual cards use the Flutterwave group's keys.
 */
export type SupplierCredentialField = { suffix: string; label: string; secret: boolean; kind: IntegrationKind; required: boolean; help?: string };
export type SupplierCredentialGroup = { code: string; name: string; description: string; fields: SupplierCredentialField[] };

const key = (label: string, help?: string): SupplierCredentialField => ({ suffix: 'API_KEY', label, secret: true, kind: 'text', required: true, help });
const secret = (suffix: string, label: string, help?: string): SupplierCredentialField => ({ suffix, label, secret: true, kind: 'text', required: true, help });
const id = (suffix: string, label: string, help?: string): SupplierCredentialField => ({ suffix, label, secret: false, kind: 'text', required: true, help });
const optional = (suffix: string, label: string, help?: string): SupplierCredentialField => ({ suffix, label, secret: false, kind: 'text', required: false, help });
const optionalSecret = (suffix: string, label: string, help?: string): SupplierCredentialField => ({ suffix, label, secret: true, kind: 'text', required: false, help });
const address = (help: string): SupplierCredentialField => ({ suffix: 'API_URL', label: 'API address', secret: false, kind: 'url', required: false, help });

/** In registry order: qualifying for the MVP, pilots, later, then backups. */
export const supplierCredentialGroups: SupplierCredentialGroup[] = [
  // Pay-TV and bills.
  { code: 'quickteller', name: 'Interswitch / Quickteller', description: 'Nigerian pay-TV and bills.', fields: [id('CLIENT_ID', 'Client ID'), secret('CLIENT_SECRET', 'Secret key'), optional('TERMINAL_ID', 'Terminal ID'), address('Sandbox: https://qa.interswitchng.com')] },
  { code: 'hubtel', name: 'Hubtel', description: 'Ghana pay-TV and bills.', fields: [id('CLIENT_ID', 'API client ID'), secret('CLIENT_SECRET', 'API client secret'), optional('ACCOUNT_ID', 'POS sales or merchant account ID'), address('Hubtel API base address for your account')] },
  { code: 'korba', name: 'Korba Xchange', description: 'Ghana pay-TV, electricity (ECG) and water.', fields: [id('CLIENT_ID', 'Client ID'), secret('SECRET_KEY', 'Secret key'), address('Korba API base address (sandbox or live)')] },
  { code: 'ipay_elipa', name: 'iPay Africa / eLipa', description: 'Kenya electricity (KPLC) and TV.', fields: [id('VENDOR_ID', 'Vendor ID'), secret('HASH_KEY', 'Hash key'), address('iPay API base address (sandbox or live)')] },
  // Software and eSIMs (pilots).
  { code: 'nexway', name: 'Nexway Connect', description: 'Downloadable consumer software and antivirus.', fields: [id('PARTNER_ID', 'Partner ID'), secret('SECRET_KEY', 'API secret'), address('Nexway Connect API base address (sandbox or live)')] },
  { code: 'esim_access', name: 'eSIM Access', description: 'eSIM data packages, top-ups and usage.', fields: [id('ACCESS_CODE', 'Access code'), secret('SECRET_KEY', 'Secret key', 'Signs each request.'), address('Default: https://api.esimaccess.com')] },
  { code: 'esimerge', name: 'eSimerge', description: 'eSIM data packages (second choice).', fields: [key('API key'), optionalSecret('WEBHOOK_SECRET', 'Webhook secret'), address('eSimerge API base address (sandbox or live)')] },
  // Software (later).
  { code: 'ingram_micro', name: 'Ingram Micro', description: 'Microsoft and broad software distribution.', fields: [id('CLIENT_ID', 'Client ID'), secret('CLIENT_SECRET', 'Client secret'), id('CUSTOMER_NUMBER', 'Customer number'), address('Sandbox: https://api.ingrammicro.com:443/sandbox')] },
  { code: 'td_synnex', name: 'TD SYNNEX', description: 'Software distribution (Digital Bridge, StreamOne).', fields: [id('CLIENT_ID', 'Client ID'), secret('CLIENT_SECRET', 'Client secret'), optional('ACCOUNT_ID', 'Account or reseller ID'), address('TD SYNNEX API base address (sandbox or live)')] },
  { code: 'pax8', name: 'Pax8', description: 'Business software and cloud subscriptions.', fields: [id('CLIENT_ID', 'Client ID'), secret('CLIENT_SECRET', 'Client secret'), address('Default: https://api.pax8.com')] },
  { code: 'also', name: 'ALSO Cloud Marketplace', description: 'Microsoft cloud and business security subscriptions (Europe).', fields: [id('USERNAME', 'API username'), secret('PASSWORD', 'API password'), address('ALSO marketplace API base address')] },
  // Gift card trading.
  { code: 'prestmit', name: 'Prestmit', description: 'Gift card sales and trades.', fields: [key('API key'), optionalSecret('WEBHOOK_SECRET', 'Webhook secret'), address('Prestmit API base address')] },
  { code: 'cardtonic', name: 'Cardtonic', description: 'Gift card sales and trades.', fields: [key('API key'), optionalSecret('WEBHOOK_SECRET', 'Webhook secret'), address('Cardtonic API base address')] },
  // Virtual numbers, voice and SMS.
  { code: 'didww', name: 'DIDWW', description: 'International virtual numbers, voice and SMS.', fields: [key('API key', 'Sent as the Api-Key header.'), address('Sandbox: https://sandbox-api.didww.com/v3 · Live: https://api.didww.com/v3')] },
  { code: 'telnyx', name: 'Telnyx', description: 'Global numbers and SMS.', fields: [key('API key'), optional('WEBHOOK_PUBLIC_KEY', 'Webhook public key', 'Verifies Telnyx webhook signatures.')] },
  { code: 'vonage', name: 'Vonage', description: 'Virtual numbers for messaging and calls.', fields: [key('API key'), secret('API_SECRET', 'API secret'), optionalSecret('SIGNATURE_SECRET', 'Signature secret', 'Verifies Vonage webhook signatures.')] },
  { code: 'twilio', name: 'Twilio', description: 'SMS-enabled numbers and messaging.', fields: [id('ACCOUNT_SID', 'Account SID'), secret('AUTH_TOKEN', 'Auth token', 'Also verifies Twilio webhook signatures.')] },
  { code: 'plivo', name: 'Plivo', description: 'Voice and SMS business numbers.', fields: [id('AUTH_ID', 'Auth ID'), secret('AUTH_TOKEN', 'Auth token')] },
  { code: 'africas_talking', name: "Africa's Talking", description: 'African SMS, short codes and virtual voice.', fields: [id('USERNAME', 'Username', 'Use "sandbox" for the sandbox.'), key('API key')] },
  // Virtual cards.
  { code: 'maplerad', name: 'Maplerad', description: 'Virtual cards (Nigeria).', fields: [secret('SECRET_KEY', 'Secret key'), optionalSecret('WEBHOOK_SECRET', 'Webhook secret'), address('Sandbox: https://sandbox.api.maplerad.com/v1')] },
  { code: 'onafriq', name: 'Onafriq', description: 'Virtual cards, pan-African expansion.', fields: [id('CLIENT_ID', 'Client ID'), secret('CLIENT_SECRET', 'Client secret'), address('Onafriq API base address (sandbox or live)')] },
  // Wider Africa bills.
  { code: 'cellulant', name: 'Cellulant / Tingg', description: 'Bills and pay-TV across Africa.', fields: [id('CLIENT_ID', 'Client ID'), secret('CLIENT_SECRET', 'Client secret'), optional('SERVICE_CODE', 'Service code'), address('Tingg API base address (sandbox or live)')] },
  // Backups.
  { code: 'techlink_gh', name: 'Techlink GH', description: 'Ghana pay-TV and bills (backup).', fields: [key('API key'), address('Techlink API base address')] },
  { code: 'kingflexy_gh', name: 'KiNG FLEXY GH', description: 'Ghana pay-TV and bills (backup).', fields: [key('API key'), address('KiNG FLEXY API base address')] },
  { code: 'tupay', name: 'Tupay', description: 'Kenya pay-TV (backup).', fields: [key('API key'), address('Tupay API base address')] },
  { code: 'airalo', name: 'Airalo Partners', description: 'eSIM packages (alternative).', fields: [id('CLIENT_ID', 'Client ID'), secret('CLIENT_SECRET', 'Client secret'), address('Sandbox: https://sandbox-partners-api.airalo.com')] },
  { code: 'esim_go', name: 'eSIM Go', description: 'eSIM packages (backup).', fields: [key('API key'), address('Default: https://api.esim-go.com/v2.4')] },
];

/** `DIDWW_API_KEY`, `ESIM_ACCESS_SECRET_KEY`: the supplier code in capitals, then the field. */
export const supplierCredentialKey = (code: string, suffix: string) => `${code.toUpperCase()}_${suffix}`;
