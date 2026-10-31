import type { Product } from './product.js';

/**
 * Scheduled jobs that belong to one product (docs/UDOZO_SPINOFF_PLAN.md); every other job runs on both instances, each
 * on its own database. Udozo's `vercel.json` schedules only Udozo's jobs and the shared ones, and the API refuses the
 * other product's (`test/vercel-crons.test.mjs` checks they agree).
 */
export const jobOwners: Readonly<Record<string, Product>> = {
  checkout: 'bitocard',
  orders: 'bitocard',
  catalogue: 'bitocard',
  'supplier-webhooks': 'bitocard',
  numbers: 'bitocard',
  esims: 'bitocard',
  vpn: 'bitocard',
  'vpn-reconcile': 'bitocard',
  crypto: 'bitocard',
  'p2p-orders': 'bitocard',
  'p2p-merchants': 'bitocard',
  'chain-health': 'bitocard',
  'crypto-reconcile': 'bitocard',
  classifieds: 'udozo',
  marketing: 'udozo',
};

/** Whether a job runs on this product's instance. */
export const jobRunsFor = (job: string, product: Product) => (jobOwners[job] ?? product) === product;
