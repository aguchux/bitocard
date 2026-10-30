import { SetMetadata } from '@nestjs/common';
import type { AppConfig } from '../config/config.js';
import type { Realm } from '../generated/prisma/client.js';

/**
 * The product an API instance serves (`APP_PRODUCT`; docs/UDOZO_SPINOFF_PLAN.md). The same code runs as BitoCard's API
 * (api.bitocard.com, with Afrippa inside it) and, with its own database and Redis, as Udozo's (api.udozo.com: the
 * marketplace and B2B reselling that left BitoCard).
 */
export const products = ['bitocard', 'udozo'] as const;
export type Product = (typeof products)[number];

/** What names the product to the people and systems that use it. */
export type ProductInfo = {
  name: 'BitoCard' | 'Udozo';
  /** The admins' authenticator entry and the footer of the admins' emails. */
  adminIssuer: string;
  /** Session cookies by realm (Afrippa's admins keep theirs: Afrippa lives inside BitoCard's instance). */
  cookies: Record<Realm, string>;
  /** API keys: `<prefix>test_…` and `<prefix>live_…`. */
  apiKeyPrefix: string;
  /** The header each webhook delivery is signed in. */
  signatureHeader: string;
};

export const productInfo: Record<Product, ProductInfo> = {
  bitocard: {
    name: 'BitoCard',
    adminIssuer: 'BitoCard Admin',
    cookies: { reseller: 'bc_session', admin: 'bc_admin_session', afrippa_admin: 'afr_admin_session' },
    apiKeyPrefix: 'bc_',
    signatureHeader: 'BitoCard-Signature',
  },
  udozo: {
    name: 'Udozo',
    adminIssuer: 'Udozo Admin',
    cookies: { reseller: 'udz_session', admin: 'udz_admin_session', afrippa_admin: 'afr_admin_session' },
    apiKeyPrefix: 'udz_',
    signatureHeader: 'Udozo-Signature',
  },
};

export const productOf = (config: Pick<AppConfig, 'APP_PRODUCT'>): ProductInfo => productInfo[config.APP_PRODUCT];

/** Whether a token has the shape of one of this product's API keys. */
export function isApiKeyShape(token: string, config: Pick<AppConfig, 'APP_PRODUCT'>) {
  const prefix = productOf(config).apiKeyPrefix;
  return token.startsWith(prefix) && /^(test|live)_[A-Za-z0-9_-]{20,}$/.test(token.slice(prefix.length));
}

export const PRODUCT_ONLY = 'product:only';

/**
 * A controller or route that belongs to one product only. Unmarked routes are shared: both instances serve them (each
 * on its own database). On the other product's instance it answers as an unknown route (`ProductRoutesGuard`) and is
 * left out of that instance's OpenAPI document.
 */
export const ProductOnly = (product: Product) => SetMetadata(PRODUCT_ONLY, product);
