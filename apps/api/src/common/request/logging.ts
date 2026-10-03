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

/** Structured JSON logs, one line per request, with secrets redacted. */
export function loggerParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      genReqId: requestId,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
      autoLogging: { ignore: req => req.url === '/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    },
  };
}
