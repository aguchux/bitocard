import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../../config/config.js';

const callerId = /^[A-Za-z0-9._-]{8,64}$/;

/** Use the caller's X-Request-Id when it is well formed, otherwise issue one. Returned as the Request-Id header. */
export function requestId(req: IncomingMessage, res: ServerResponse) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && callerId.test(incoming) ? incoming : `req_${randomUUID().replaceAll('-', '')}`;
  res.setHeader('Request-Id', id);
  return id;
}

/**
 * A request address for the logs: query values replaced (`?token=…` on webhook addresses, `?preview=…` links and the
 * like are secrets), names kept so the log still says what was asked.
 */
export function redactUrl(url: string | undefined) {
  if (!url) return url;
  const at = url.indexOf('?');
  if (at < 0) return url;
  const names = [...new Set(new URLSearchParams(url.slice(at + 1)).keys())];
  return `${url.slice(0, at)}${names.length ? `?${names.map(name => `${encodeURIComponent(name)}=[redacted]`).join('&')}` : ''}`;
}

type SerializedRequest = { url?: string; query?: Record<string, unknown> } & Record<string, unknown>;

/** Structured JSON logs, one line per request, with secrets redacted. */
export function loggerParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      genReqId: requestId,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.headers["bitocard-customer-session"]',
          'req.headers["bitocard-access-pass"]',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      serializers: {
        req: (req: SerializedRequest) => ({
          ...req,
          url: redactUrl(req.url),
          ...(req.query && typeof req.query === 'object' ? { query: Object.fromEntries(Object.keys(req.query).map(name => [name, '[redacted]'])) } : {}),
        }),
      },
      autoLogging: { ignore: req => req.url === '/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    },
  };
}
