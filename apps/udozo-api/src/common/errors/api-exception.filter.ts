import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError, type ApiErrorBody, type ApiErrorType } from './api-error.js';

const typeForStatus: Partial<Record<number, ApiErrorType>> = {
  400: 'invalid_request_error',
  401: 'authentication_error',
  403: 'permission_error',
  404: 'not_found_error',
  405: 'invalid_request_error',
  409: 'conflict_error',
  413: 'invalid_request_error',
  415: 'invalid_request_error',
  422: 'invalid_request_error',
  429: 'rate_limit_error',
};

/** Turns every error into BitoCard's error format. Internal details are logged, never returned. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const { status, body } = this.describe(exception);

    if (status >= 500) this.logger.error({ err: exception, path: req.path }, 'Unhandled error');
    if (res.headersSent) return;
    res.status(status).json({ error: { ...body, request_id: req.id } });
  }

  private describe(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof ApiError) return { status: exception.getStatus(), body: exception.toBody() };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const type = typeForStatus[status] ?? (status >= 500 ? 'api_error' : 'invalid_request_error');
      const code = status === 404 ? 'resource_missing' : status >= 500 ? 'internal_error' : `http_${status}`;
      const message = status === 404 ? 'No such resource or route.' : status >= 500 ? 'Something went wrong on our side.' : exception.message;
      return { status, body: { type, code, message } };
    }

    if (isDatabaseUnavailable(exception)) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: { type: 'api_error', code: 'service_unavailable', message: 'The service is temporarily unavailable. Retry with the same idempotency key.' },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { type: 'api_error', code: 'internal_error', message: 'Something went wrong on our side.' },
    };
  }
}

function isDatabaseUnavailable(exception: unknown) {
  const name = (exception as { name?: string } | null)?.name ?? '';
  return name === 'PrismaClientInitializationError' || name === 'DriverAdapterError';
}
