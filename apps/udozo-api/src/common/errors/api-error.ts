import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error categories returned to API callers. Every error response has the shape
 * { "error": { "type", "code", "message", "param"?, "request_id" } } and is documented in the docs app.
 */
export type ApiErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'not_found_error'
  | 'conflict_error'
  | 'idempotency_error'
  | 'rate_limit_error'
  | 'api_error';

export type ApiErrorBody = { type: ApiErrorType; code: string; message: string; param?: string };

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly type: ApiErrorType,
    readonly code: string,
    message: string,
    readonly param?: string,
  ) {
    super(message, status);
  }

  toBody(): ApiErrorBody {
    return { type: this.type, code: this.code, message: this.message, ...(this.param ? { param: this.param } : {}) };
  }
}
