// Vercel function answering the API, for Afrippa (every path is rewritten here in vercel.json). Logic in src/vercel.ts.
import { fetchHandler } from '../dist/vercel.js';

export const GET = fetchHandler;
export const POST = fetchHandler;
