import type { DenominationType, ProductCategory } from '../generated/prisma/client.js';

/** One product as a supplier offers it, already in BitoCard terms. Amounts are minor units. */
export type CatalogueItem = {
  /** The supplier identifier, unique per supplier. */
  sku: string;
  /** BitoCard product key: equivalent offers from different suppliers share it. */
  productKey: string;
  category: ProductCategory;
  country: string;
  brand: string;
  name: string;
  faceCurrency: string;
  denominationType: DenominationType;
  fixedValues: bigint[];
  minValue?: bigint;
  maxValue?: bigint;
  /** `account`: a customer account number other than a meter or smartcard (internet subscriptions), checked like them. */
  recipientType: 'phone' | 'smartcard' | 'meter' | 'account' | 'none';
  description?: string;
  redeemInstructions?: string;
  logoUrl?: string;
  costCurrency: string;
  /** Cost per unit of face value in the cost currency, as a decimal string. */
  costRatio: string;
  /** Fixed fee per item, minor units of the cost currency. */
  costFee: bigint;
  meta?: Record<string, unknown>;
};

/** What to sync: one category, for one country (null for categories bought worldwide, such as gift cards). */
export type CatalogueScope = { category: ProductCategory; country: string | null };

export type RecipientCheck =
  | { valid: true; accountName: string; details: Record<string, string> }
  | { valid: false; reason: string };

/** What the customer receives. Codes and PINs are secrets: encrypted at rest, never logged or sent in webhooks. */
export type Delivery = { kind: 'gift_card' | 'licence_key' | 'token' | 'confirmation' | 'vpn_account'; code?: string; pin?: string; serial?: string; details?: Record<string, string> };

/**
 * A supplier outcome. `pending` means not yet confirmed (including timeouts and unclear replies): the order waits
 * and is checked again with the same supplier, never sent elsewhere while it might still complete.
 */
export type FulfilmentResult = {
  status: 'completed' | 'failed' | 'pending';
  supplierTransactionId?: string;
  deliveries?: Delivery[];
  /** Internal detail for admins; never shown to resellers. */
  detail?: string;
  /** Fixed-term VPN accounts created by the order (internal lifecycle IDs and state; credentials are a delivery). */
  vpns?: SuppliedVpnSubscription[];
  /** What the supplier says it charged for the whole order, when its reply says (for reconciliation; internal). */
  reportedCost?: { amountMinor: bigint; currency: string };
};

/** A VPN account a supplier issued. Its username/password are delivered separately and encrypted as `vpn_account`. */
export type SuppliedVpnSubscription = {
  supplierAccountId: string;
  status: 'active' | 'disabled' | 'expired' | 'unknown';
  supplierStatus: string | null;
  startsAt: Date | null;
  expiresAt: Date;
};

export type VpnState = {
  supplierAccountId: string;
  status: SuppliedVpnSubscription['status'];
  supplierStatus: string | null;
  expiresAt: Date | null;
};

/** Managing a VPN account after issue. It stays with the supplier that created it. */
export interface VpnSupplier {
  status(supplierAccountId: string): Promise<VpnState>;
  enable(supplierAccountId: string): Promise<VpnState>;
  disable(supplierAccountId: string): Promise<VpnState>;
  changePassword(supplierAccountId: string, password: string): Promise<VpnState>;
  expire(supplierAccountId: string, expiresOn: string): Promise<VpnState>;
}

export type FulfilmentRequest = {
  /** Our unique reference for this attempt, sent to the supplier so it can be looked up later. */
  reference: string;
  sku: string;
  meta: Record<string, unknown>;
  category: ProductCategory;
  country: string;
  faceValue: bigint;
  faceCurrency: string;
  quantity: number;
  recipient: { phone?: string; account_number?: string; transaction_type?: string; email?: string };
  /** Prepared and encrypted before a VPN supplier is called; transient and never logged or stored in offer metadata. */
  vpnCredentials?: { username: string; password: string; expiresAt: Date };
};

/**
 * A supplier behind BitoCard's interface. Supplier names, credentials, raw responses and errors stay inside the
 * adapter; the rest of the API sees only BitoCard products and outcomes.
 */
export interface SupplierAdapter {
  readonly code: string;
  /** Live credentials are configured. Without them the supplier is used only in the sandbox. */
  configured(): boolean;
  /** Categories this adapter can sync. */
  readonly syncs: ProductCategory[];
  /**
   * Optional: its offers serve only their own country (a product for Kenya only Kenyan resellers and their customers,
   * in their own currency), whatever the reseller's plan allows abroad.
   */
  readonly domesticOnly?: boolean;
  catalogue(scope: CatalogueScope): Promise<CatalogueItem[]>;
  /** Optional: what the last catalogue fetch found, so a sync that brings back nothing can say why. */
  syncReport?(): string | null;
  /** Pay-TV and bills: confirm a smartcard or meter number before a quote. */
  validateRecipient?(meta: Record<string, unknown>, accountNumber: string): Promise<RecipientCheck>;
  /** Airtime and data: the mobile network a phone number belongs to, by the supplier's own lookup. Null if it cannot tell. */
  detectOperator?(phone: string, country: string): Promise<{ brand: string; name: string } | null>;
  /**
   * Places an order. Throws ProviderError with `definite` only when the supplier clearly refused it before
   * accepting; anything unclear must come back as `pending` (or an unclear error) so it is checked, not retried.
   */
  placeOrder?(request: FulfilmentRequest): Promise<FulfilmentResult>;
  /** The current outcome of an order placed earlier, by our reference (and the supplier ID if known). */
  orderStatus?(request: FulfilmentRequest, supplierTransactionId?: string): Promise<FulfilmentResult>;
  /** VPN suppliers: status, expiry, access control and password replacement for an issued account. */
  readonly vpn?: VpnSupplier;
}

/** A supplier whose API access is not confirmed yet: present in the registry, never configured, offers nothing. */
export class StubAdapter implements SupplierAdapter {
  readonly syncs: ProductCategory[] = [];
  constructor(readonly code: string) {}

  configured() {
    return false;
  }

  async catalogue() {
    return [];
  }
}

/** Lower-case words joined by hyphens: "MTN Nigeria" with "Nigeria" removed becomes "mtn". */
export function slug(value: string, remove: string[] = []) {
  let text = value.toLowerCase();
  for (const word of remove) text = text.replaceAll(word.toLowerCase(), ' ');
  return text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/** Major units (number or string) to minor units. */
export const minorOf = (value: number | string | null | undefined) => BigInt(Math.round(Number(value ?? 0) * 100));
