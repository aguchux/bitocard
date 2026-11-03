import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { catchError, concatMap, from, map, mergeMap, type Observable, throwError } from 'rxjs';
import type { Caller } from '../auth/caller.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CustomerCaller } from '../customers/customer-session.js';
import { deviceOf, type JourneyStep, type SignupSurface, SignupJourneysService } from './journeys.service.js';

const TRACK_SIGNUP = 'signup:track';

/** Records this route as a step of Udozo's sign-up journeys (`SignupJourneysService`), whether it goes through or not. */
export const TrackSignup = (surface: SignupSurface, step: JourneyStep) => SetMetadata(TRACK_SIGNUP, { surface, step });

type Answer = {
  exists?: boolean;
  customer?: { id?: string; email?: string; country?: string | null };
  user?: { id?: string; email?: string };
  signed_up?: boolean;
} | null;

type TrackedRequest = Request & { caller?: Caller; customer?: CustomerCaller };

/**
 * Runs on routes marked `@TrackSignup`: after the route answers (or refuses), the step is recorded with the email it was
 * for (the body's, the answer's, or the signed-in person's), the refusal's code, the country and the browser. A
 * refusal is passed on unchanged, and recording never fails the route.
 */
@Injectable()
export class SignupJourneyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly journeys: SignupJourneysService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<{ surface: SignupSurface; step: JourneyStep } | undefined>(TRACK_SIGNUP, context.getHandler());
    if (!meta) return next.handle();
    const req = context.switchToHttp().getRequest<TrackedRequest>();
    return next.handle().pipe(
      concatMap(answer => from(this.track(meta, req, answer as Answer)).pipe(map(() => answer))),
      catchError(error => from(this.track(meta, req, null, error)).pipe(mergeMap(() => throwError(() => error)))),
    );
  }

  private async track(meta: { surface: SignupSurface; step: JourneyStep }, req: TrackedRequest, answer: Answer, error?: unknown) {
    let step = meta.step;
    // Sign-in's first step counts only when the email has no account: someone who may sign up next.
    if (step === 'signin_lookup' && (error || answer?.exists !== false)) return;
    // Google: a new account is a sign-up; signing in to an existing one is a sign-in.
    if (step === 'google' && answer && !answer.signed_up) step = 'signin';
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' ? value : null);
    const identifier = text(body.identifier);
    const email = text(body.email) ?? (identifier?.includes('@') ? identifier : null) ?? answer?.customer?.email ?? answer?.user?.email ?? req.customer?.customer.email ?? (await this.sessionEmail(req));
    await this.journeys.record({
      surface: meta.surface,
      step,
      email,
      error,
      device: deviceOf(req.headers),
      country: text(body.country) ?? answer?.customer?.country ?? req.customer?.customer.country ?? null,
      accountId: answer?.customer?.id ?? req.customer?.customer.id ?? null,
    });
  }

  /** Seller HQ's onboarding steps are the signed-in person's own. */
  private async sessionEmail(req: TrackedRequest) {
    if (req.caller?.kind !== 'session' || req.caller.realm !== 'reseller') return null;
    const user = await this.prisma.user.findUnique({ where: { id: req.caller.userId }, select: { email: true } }).catch(() => null);
    return user?.email ?? null;
  }
}
