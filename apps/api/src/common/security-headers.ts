import type { NextFunction, Request, Response } from 'express';

// Mirrors @bitocard/next-config for private apps: the API is never indexed.
const headers: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Robots-Tag': 'noindex, nofollow',
};

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set(headers);
  next();
}
