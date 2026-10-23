import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { day } from './trend.js';

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

/** Daily reports (growth) cover at most a year and a day, so a chart never has more points than that. */
export const maxDailyRangeDays = 366;

/**
 * A report's period from its query: `from` inclusive, `to` exclusive, except that a plain date for `to` (what the
 * apps' date pickers send, `2026-10-23`) means the whole of that day, so "to today" includes today and "last month"
 * includes its last day. The end must come after the start; `maxDays` caps the length where a report is per day.
 */
export function reportRange(from: string, to: string, maxDays?: number) {
  const start = new Date(from);
  const end = new Date(dateOnly.test(to) ? new Date(to).getTime() + day : new Date(to).getTime());
  if (end <= start) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'The end of the period must be after its start.', 'to');
  if (maxDays && end.getTime() - start.getTime() > maxDays * day) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'range_too_long', `Choose a period of ${maxDays} days or less.`, 'from');
  }
  return { from: start, to: end };
}

/** A statement with more lines than a file can usefully hold asks for a shorter period instead of being cut short. */
export const statementTooLarge = (max: number) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'statement_too_large', `This period has more than ${max.toLocaleString('en-GB')} lines. Choose a shorter period.`, 'from');
