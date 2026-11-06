import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import type { CustomerCaller } from '../customers/customer-session.js';
import { deviceOf } from '../signups/journeys.service.js';
import { type ApiStep, PostingJourneysService } from './journeys.service.js';

const TRACK_POSTING = 'posting:track';

/** Records this listing route as a step of the seller's posting journey (`PostingJourneysService`), through or refused. */
export const TrackPosting = (step: ApiStep) => SetMetadata(TRACK_POSTING, step);

type TrackedRequest = Request & { customer?: CustomerCaller; params: Record<string, string | undefined> };

/**
 * Runs on routes marked `@TrackPosting`: once the route answers (or refuses), the step is handed to the posting
 * journeys to record after the reply, never awaited, so the route is neither slowed nor changed. A refusal is passed
 * on unchanged.
 */
@Injectable()
export class PostingJourneyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly journeys: PostingJourneysService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const step = this.reflector.get<ApiStep | undefined>(TRACK_POSTING, context.getHandler());
    if (!step) return next.handle();
    const req = context.switchToHttp().getRequest<TrackedRequest>();
    const record = (answer: unknown, error?: unknown) => {
      const customer = req.customer?.customer;
      if (!customer) return;
      this.journeys.api({
        step,
        customerId: customer.id,
        country: customer.country ?? null,
        listingId: req.params?.id ?? null,
        answer: answer && typeof answer === 'object' && step !== 'photo' && step !== 'video' ? (answer as never) : null,
        error,
        device: deviceOf(req.headers),
      });
    };
    return next.handle().pipe(tap({ next: answer => record(answer), error: error => record(null, error) }));
  }
}
