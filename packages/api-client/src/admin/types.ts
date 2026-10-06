/**
 * Response shapes of the admin API (`/v1/admin/...`). Admin endpoints are left out of the public OpenAPI document,
 * so these mirror the API presenters by hand; the API tests pin the presenters. Money is in integer minor units.
 */
export type Mode = 'test' | 'live';
export type List<T> = { object: 'list'; data: T[]; has_more?: boolean };
export type Page = { limit?: number; starting_after?: string };

export const productCategories = ['gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'esim', 'software', 'virtual_numbers', 'virtual_cards', 'mobile_money'] as const;
export type ProductCategory = (typeof productCategories)[number];

export const adminRoles = ['super_admin', 'operations', 'finance', 'support'] as const;
export type AdminRole = (typeof adminRoles)[number];

// -- Sign-in -------------------------------------------------------------------------------------------------------

export type Admin = { object: 'admin'; id: string; name: string; email: string; roles: AdminRole[] };
export type AdminSession = { object: 'admin_session'; admin: Admin; recovery_codes?: string[] };
export type MfaChallenge = { object: 'mfa_challenge'; challenge_token: string; mfa_setup_required: boolean; expires_in: number };
export type MfaSetup = { object: 'mfa_setup'; secret: string; otpauth_uri: string };

// -- Overview and activity ----------------------------------------------------------------------------------------

export type SupplierHealth = 'operational' | 'degraded' | 'disabled';
export type Overview = {
  object: 'admin_overview';
  mode: Mode;
  days: number;
  from: string;
  to: string;
  currencies: string[];
  totals: Array<{ currency: string; gross: number; orders: number; previous_gross: number; previous_orders: number }>;
  series: Array<{ currency: string; points: Array<{ date: string; gross: number; orders: number }> }>;
  wallet_float: Array<{ currency: string; amount: number }>;
  /** Every market converted to USD (minor units, cents) at the latest reference rates, for reporting. */
  usd: {
    currency: 'USD';
    rates_as_of: string | null;
    /** Currencies left out because no exchange rate is stored for them. */
    unconverted: string[];
    total: { gross: number; orders: number; previous_gross: number; previous_orders: number };
    series: Array<{ date: string; gross: number; orders: number }>;
    wallet_float: number;
  };
  resellers: { active: number; pending: number; joined: number; previously_joined: number };
  attention: { orders_needing_review: number; orders_processing: number; verifications_in_review: number; supplier_problems: number };
  suppliers: Array<{ code: string; name: string; categories: ProductCategory[]; enabled: boolean; configured: boolean; health: SupplierHealth; last_synced_at: string | null; last_sync_error: string | null }>;
  recent_orders: Array<{
    id: string;
    receipt_number: string | null;
    reseller: { id: string; name: string };
    product: { name: string; category: ProductCategory; country: string };
    customer_reference: string | null;
    price: number;
    currency: string;
    status: OrderStatus;
    needs_review: boolean;
    created_at: string;
  }>;
};

export type AuditEntry = {
  object: 'audit_entry';
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  actor: { id: string; name: string | null; email: string | null } | null;
  before: unknown;
  after: unknown;
  created_at: string;
};

// -- Resellers and identity checks --------------------------------------------------------------------------------

export type ResellerStatus = 'pending' | 'active' | 'suspended';
export type Plan = { object: 'plan'; code: string; name: string; price: { amount: number; currency: string; interval: string }; features: string[] };
export type ResellerSummary = { object: 'reseller'; id: string; name: string; country: string | null; status: ResellerStatus; verified_at: string | null; plan: string; created_at: string };
export type ResellerDetail = {
  object: 'reseller';
  id: string;
  name: string;
  country: string | null;
  status: ResellerStatus;
  verified_at: string | null;
  verified_name: string | null;
  plan: Plan;
  members: Array<{ user_id: string; name: string; email: string | null; role: string }>;
  stores: Array<{ id: string; name: string; subdomain: string; status: string }>;
  options: Record<string, { value: string; allowed: string[] } | unknown>;
  features: Record<string, boolean>;
  created_at: string;
};
/** The $500 startup allowance (US cents): restricted, never cash. */
export type StartupAllowance = { currency: 'USD'; granted: number; remaining: number; status: 'active' | 'used' | 'revoked'; granted_at: string; revoked_at: string | null };
export type ResellerWallet = Record<string, unknown> & { currency: string; available: number; startup_allowance: StartupAllowance | null };

export type VerificationStatus = 'in_progress' | 'approved' | 'declined' | 'in_review' | 'expired';
export type Verification = {
  object: 'verification';
  id: string;
  subject: 'reseller' | 'customer';
  reseller_id: string;
  reseller_name: string | null;
  mode: Mode;
  customer_reference: string | null;
  method: 'document' | 'bvn';
  provider: string;
  provider_reference: string;
  status: VerificationStatus;
  country: string;
  expected_name: string | null;
  verified_name: string | null;
  document_country: string | null;
  reason: string | null;
  consent_at: string;
  decided_by_id: string | null;
  decided_at: string | null;
  created_at: string;
};

// -- Orders -------------------------------------------------------------------------------------------------------

export type OrderStatus = 'processing' | 'completed' | 'failed' | 'refunded';
export type Order = {
  object: 'order';
  id: string;
  mode: Mode;
  status: OrderStatus;
  quote_id: string;
  product: { id: string; name: string; category: ProductCategory };
  face_value: number;
  face_currency: string;
  quantity: number;
  currency: string;
  wholesale: number;
  tax: number;
  charged: number;
  price: number;
  reseller_profit: number;
  recipient: Record<string, string> | null;
  customer_reference: string | null;
  failure_reason: string | null;
  receipt_number: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
export type AdminOrder = Order & { reseller_id: string; needs_review: boolean; supplier: string };
export type AdminOrderDetail = Order & {
  reseller_id: string;
  needs_review: boolean;
  supplier: { code: string; reference: string; transaction_id: string | null; cost: number; currency: string };
  checks: number;
  next_check_at: string | null;
  attempts: Array<{ supplier: string; reference: string; action: 'place' | 'check'; outcome: string; detail: string | null; at: string }>;
  /** Supplier notifications about this order (never their bodies). */
  notifications: Array<{ id: string; supplier: string; event_type: string | null; status: SupplierWebhookStatus; received_at: string }>;
  ledger: Array<{ type: string; reference: string; at: string; postings: Array<{ account: string; owner: string; currency: string; amount: number }> }>;
};

// -- Catalogue and suppliers --------------------------------------------------------------------------------------

export type SupplierStatus = 'mvp_live' | 'mvp_qualify' | 'pilot' | 'later' | 'backup';
export type Supplier = {
  object: 'supplier';
  code: string;
  name: string;
  /** Admin-only logo; never shown to customers. */
  logo_url: string | null;
  categories: ProductCategory[];
  coverage: string;
  status: SupplierStatus;
  enabled: boolean;
  configured: boolean;
  funding: {
    billing_model: string | null;
    currency: string | null;
    min_first_deposit_minor: number | null;
    min_top_up_minor: number | null;
    fees: string | null;
    refunds: string | null;
    resale_approved: boolean;
  };
  requires_ip_allowlist: boolean | null;
  notes: string | null;
  markets?: Array<{ country: string; category: ProductCategory; enabled: boolean }>;
  last_synced_at: string | null;
  last_sync_error: string | null;
};
export type SupplierOffer = {
  id: string;
  supplier: string;
  sku: string;
  cost_currency: string;
  cost_ratio: string;
  cost_fee_minor: number;
  discount_bps: number;
  priority: number;
  available: boolean;
  synced_at: string;
};
export type AdminProduct = {
  object: 'admin_product';
  id: string;
  key: string;
  category: ProductCategory;
  country: string;
  name: string;
  brand: string;
  /** From the supplier's catalogue. */
  logo_url: string | null;
  /** Set by an admin; shown instead of the supplier's logo. */
  image_url: string | null;
  face_currency: string;
  active: boolean;
  /** Shown on BitoCard's own store (bitocard.com). Resellers' catalogues are not affected. */
  listed: boolean;
  listed_at: string | null;
  /** The brand's gift card design (uploaded, registry or bundled), shown when the product has no image of its own. */
  card_url: string | null;
  offers: SupplierOffer[];
};
/** Admin product filters: a supplier's offers and BitoCard store listing among them. */
export type AdminProductFilter = { category?: ProductCategory; country?: string; q?: string; supplier?: string; listed?: boolean };
/** Products, with how many match the filters and how many of those are listed. */
export type AdminProductList = List<AdminProduct> & { total: number; listed: number };
export type PricingRule = {
  object: 'pricing_rule';
  id: string;
  category: ProductCategory | null;
  country: string | null;
  product_id: string | null;
  margin_bps: number;
  reseller_discount_bps: number | null;
  updated_at: string;
};

// -- Settings -----------------------------------------------------------------------------------------------------

export type SwitchRow = { object: 'switch'; key: string; scope: 'global' | 'country' | 'reseller'; country_code: string | null; reseller_id: string | null; enabled: boolean };
export type Switches = List<SwitchRow> & { definitions: Record<string, { scopes: string[]; description: string }> };
export type Country = {
  object: 'country';
  code: string;
  name: string;
  currency: string;
  reseller_signup: boolean;
  reserved_accounts: boolean;
  markup_cap_percent: number | null;
  payout_hold_days: number;
  min_withdrawal_minor: number;
  categories: Array<{ category: ProductCategory; enabled: boolean; customer_verification: boolean; taxable: boolean }>;
};

/** Where a setting's value comes from: set in the admin app, the API's environment, the built-in default, or nowhere. */
export type IntegrationSource = 'admin' | 'environment' | 'default' | 'unset';
export type IntegrationField = {
  key: string;
  label: string;
  kind: 'text' | 'url' | 'email' | 'number' | 'flag';
  /** Secrets are write-only: `value` is always null and `hint` shows the last four characters. */
  secret: boolean;
  required: boolean;
  help: string | null;
  source: IntegrationSource;
  value: string | number | boolean | null;
  hint: string | null;
  updated_at: string | null;
};
export type Integration = {
  object: 'integration';
  id: string;
  name: string;
  description: string;
  status: 'connected' | 'incomplete' | 'not_connected';
  section: 'platform' | 'suppliers';
  /** False while the supplier's adapter is not built: credentials are saved for later and not used yet. */
  adapter_ready: boolean;
  /** The address to paste into the provider's dashboard, when it sends webhooks. */
  webhook_url: string | null;
  /** Where to sign up with the provider and find the credentials. */
  links: Array<{ label: string; url: string }>;
  updated_at: string | null;
  fields: IntegrationField[];
};

export type SupplierWebhookStatus = 'received' | 'processed' | 'unmatched' | 'failed';
/** A notification a supplier sent (for example a Reloadly transaction status), and what became of it. */
export type SupplierWebhook = {
  object: 'supplier_webhook';
  id: string;
  supplier: string;
  /** A reseller's own connection it was sent to; null for BitoCard's own account. */
  connection_id: string | null;
  event_type: string | null;
  reference: string | null;
  supplier_transaction_id: string | null;
  order_id: string | null;
  status: SupplierWebhookStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  received_at: string;
  processed_at: string | null;
};
