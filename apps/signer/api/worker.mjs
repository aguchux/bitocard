// Vercel Cron: the signer's worker (sign, broadcast, follow transfers, sweep), every minute. Logic in src/vercel.ts.
import { workerHandler } from '../dist/vercel.js';

export const GET = workerHandler;
