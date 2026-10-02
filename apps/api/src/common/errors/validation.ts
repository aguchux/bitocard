import { HttpStatus, ValidationPipe, type ValidationError } from '@nestjs/common';
import { ApiError } from './api-error';

function firstProblem(errors: ValidationError[], parent = ''): { param: string; message: string } {
  const [error] = errors;
  const param = parent ? `${parent}.${error.property}` : error.property;
  if (error.children?.length) return firstProblem(error.children, param);
  const message = Object.values(error.constraints ?? {})[0] ?? 'Invalid value.';
  return { param, message };
}

/** Validates request bodies and query strings; unknown fields are rejected. Reports the first problem with its field. */
export const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: errors => {
    const { param, message } = firstProblem(errors);
    return new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', message, param);
  },
});
