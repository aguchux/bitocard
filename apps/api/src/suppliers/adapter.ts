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
  recipientType: 'phone' | 'smartcard' | 'meter' | 'none';
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

/** What the customer receives. Codes and PINs are secrets: encrypted at rest, never logged or sent in webhooks. */
export type Delivery = { kind: 'gift_card' | 'licence_key' | 'token' | 'confirmation' | 'virtual_number'; code?: string; pin?: string; serial?: string; details?: Record<string, string> };

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
  /** What the supplier says it charged for the whole order, when its reply says (for reconciliation; internal). */
  reportedCost?: { amountMinor: bigint; currency: string };
};

/** A number a supplier sold us: kept to renew, release and route its SMS. */
export type SuppliedNumber = { supplierNumberId: string; number: string; expiresAt: Date | null; monthlyCostMinor: bigint; costCurrency: string };

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
  recipient: { phone?: string; account_number?: string; transaction_type?: string };
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
