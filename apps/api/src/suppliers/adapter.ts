import type { DenominationType, ProductCategory } from '../generated/prisma/client.js';
import type { FeatureRules, ProductFeature } from '../catalogue/features.js';

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
  /** What the product can do, in BitoCard's names (`src/catalogue/features.ts`). */
  features?: ProductFeature[];
  costCurrency: string;
  /** Cost per unit of face value in the cost currency, as a decimal string. */
  costRatio: string;
  /** Fixed fee per item, minor units of the cost currency. */
  costFee: bigint;
  meta?: Record<string, unknown>;
};

/** What to sync: one category, for one country (null for categories bought worldwide, such as gift cards). */
/** `features`: the admin's feature rules for the supplier (only adapters with `gatedFeatures` read them). */
export type CatalogueScope = { category: ProductCategory; country: string | null; features?: FeatureRules };

export type RecipientCheck =
  | { valid: true; accountName: string; details: Record<string, string> }
  | { valid: false; reason: string };

/**
 * What the customer receives. Codes and PINs are secrets: encrypted at rest, never logged or sent in webhooks. An `esim`'s
 * code is its LPA activation string (`LPA:1$<SM-DP+ address>$<activation code>`): whoever holds it owns the eSIM.
 */
export type Delivery = { kind: 'gift_card' | 'licence_key' | 'token' | 'confirmation' | 'virtual_number' | 'esim' | 'vpn_account'; code?: string; pin?: string; serial?: string; details?: Record<string, string> };

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
  /** Virtual numbers bought by the order, with the supplier's own IDs for them (internal: never shown). */
  numbers?: SuppliedNumber[];
  /** eSIMs delivered by the order, with the supplier's own IDs for them (internal: never shown). */
  esims?: SuppliedEsim[];
  /** Fixed-term VPN accounts created by the order (internal lifecycle IDs and state; credentials are a delivery). */
  vpns?: SuppliedVpnSubscription[];
  /** What the supplier says it charged for the whole order, when its reply says (for reconciliation; internal). */
  reportedCost?: { amountMinor: bigint; currency: string };
};

/** A number a supplier sold us: kept to renew, release and route its SMS. */
export type SuppliedNumber = { supplierNumberId: string; number: string; expiresAt: Date | null; monthlyCostMinor: bigint; costCurrency: string };

/** An eSIM a supplier issued: kept for its status, data use, top-ups and cancelling. */
export type SuppliedEsim = { supplierEsimId: string; iccid: string; expiresAt: Date | null; totalBytes: bigint | null; topUps: EsimTopUpKind };

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

/** Whether an eSIM takes top-ups: `data` (more data), `days` (a day pass extended by days) or `none`. */
export type EsimTopUpKind = 'none' | 'data' | 'days';

/** Where an eSIM stands at its supplier, as BitoCard names it. */
export type EsimState = {
  /** ready (not installed), installed, active, used_up, expired, cancelled, revoked or suspended. */
  status: string;
  supplierStatus: string | null;
  profileStatus: string | null;
  totalBytes: bigint | null;
  usedBytes: bigint | null;
  expiresAt: Date | null;
};

/** A top-up an eSIM can take: the supplier's package (internal), what it adds and its cost. */
export type EsimTopUpOption = { supplierPackage: string; name: string; data: string; days: number; perDay: boolean; costMinor: bigint; costCurrency: string };

/** Managing eSIMs already issued. An eSIM stays with the supplier that issued it. */
export interface EsimSupplier {
  /** Its current status, data use and expiry. */
  status(supplierEsimId: string): Promise<EsimState>;
  /** What top-ups it can take now (empty when none). */
  topUpOptions(esim: { supplierEsimId: string; iccid: string }): Promise<EsimTopUpOption[]>;
  /**
   * Adds a top-up. `reference` is our transaction ID: asking again with it is the same top-up. Throws ProviderError,
   * definite only when the supplier clearly refused it; an unclear error is checked again with `status`.
   */
  topUp(input: { supplierEsimId: string; supplierPackage: string; reference: string; costMinor: bigint; days: number | null }): Promise<EsimState>;
  /** Cancels an eSIM never installed; the supplier refunds BitoCard. Definite ProviderError when it refuses. */
  cancel(supplierEsimId: string): Promise<void>;
}

/** Managing numbers already bought. A number stays with the supplier that sold it. */
export interface NumberSupplier {
  /**
   * What to ask for to pay one more period (DIDWW: the renewals-left count plus one). Saved before `renewNumber`, so a
   * retry after an unclear answer asks for exactly the same.
   */
  nextRenewal(supplierNumberId: string): Promise<number>;
  /**
   * Pays up to `cycles` (from `nextRenewal`), restoring a paused number. Asking twice for the same `cycles` renews once.
   * Returns when it is now paid up to, if known.
   */
  renewNumber(supplierNumberId: string, cycles: number): Promise<{ expiresAt: Date | null }>;
  /** Gives the number up for good. */
  releaseNumber(supplierNumberId: string): Promise<void>;
  /** Sends an SMS from one of our numbers; the supplier reports its price later. */
  sendSms?(input: { from: string; to: string; text: string }): Promise<{ supplierMessageId: string }>;
  smsConfigured?(): boolean;
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
  catalogue(scope: CatalogueScope): Promise<CatalogueItem[]>;
  /** Optional: what the last catalogue fetch found, so a sync that brings back nothing can say why. */
  syncReport?(): string | null;
  /** Features an admin can require or exclude for this supplier's products, and the rules used until they do. */
  readonly gatedFeatures?: readonly ProductFeature[];
  readonly defaultFeatureRules?: FeatureRules;
  /** Pay-TV and bills: confirm a smartcard or meter number before a quote. */
  validateRecipient?(meta: Record<string, unknown>, accountNumber: string): Promise<RecipientCheck>;
  /**
   * Places an order. Throws ProviderError with `definite` only when the supplier clearly refused it before
   * accepting; anything unclear must come back as `pending` (or an unclear error) so it is checked, not retried.
   */
  placeOrder?(request: FulfilmentRequest): Promise<FulfilmentResult>;
  /** The current outcome of an order placed earlier, by our reference (and the supplier ID if known). */
  orderStatus?(request: FulfilmentRequest, supplierTransactionId?: string): Promise<FulfilmentResult>;
  /** Virtual number suppliers: renewing, releasing and SMS for numbers already bought. */
  readonly numbers?: NumberSupplier;
  /** eSIM suppliers: status, usage, top-ups and cancelling for eSIMs already issued. */
  readonly esims?: EsimSupplier;
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
