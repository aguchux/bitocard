import { createParamDecorator, type ExecutionContext, HttpStatus } from '@nestjs/common';
import type { CallerRequest } from '../auth/caller';
import { ApiError } from '../common/errors/api-error';
import type { LedgerMode } from '../generated/prisma/client';

export const MODE_HEADER = 'bitocard-mode';

/**
 * Sandbox or live money. An API key decides it (bc_test_ or bc_live_); a signed-in person sees live unless the
 * dashboard sends `BitoCard-Mode: test`. An API key cannot switch mode with the header.
 */
export function modeOf(req: CallerRequest): LedgerMode {
  const caller = req.caller;
  const requested = req.get(MODE_HEADER);
  if (caller?.kind === 'api_key') {
    if (requested && requested !== caller.mode) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'mode_mismatch', `This is a ${caller.mode} key; it cannot act in ${requested} mode.`);
    }
    return caller.mode;
  }
  if (requested === undefined || requested === 'live') return 'live';
  if (requested === 'test') return 'test';
  throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'BitoCard-Mode must be test or live.');
}

/** The caller's ledger mode as a handler parameter. */
export const Mode = createParamDecorator((_data: unknown, context: ExecutionContext) => modeOf(context.switchToHttp().getRequest<CallerRequest>()));

/** Money amounts in API responses: integer minor units (for example kobo). */
export const minor = (value: bigint | number) => Number(value);
