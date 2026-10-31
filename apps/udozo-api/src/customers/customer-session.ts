import { type CanActivate, createParamDecorator, type ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afrippaSignedRoutes } from '../afrippa/gate.guard.js';
import { ROUTE_TWO_STEP_PENDING } from '../auth/caller.js';
import type { Request } from 'express';
import { ApiError } from '../common/errors/api-error.js';
import { customerSessionHeader, CustomersService, type CustomerWithStore } from './customers.service.js';
import { houseSubdomain, storeKey } from './store-key.js';

/** `mfaVerifiedAt`: when the session finished two-step sign-in (Afrippa's traders, for whom it is required). */
export type CustomerCaller = { customer: CustomerWithStore; sessionId: string; mfaVerifiedAt?: Date | null; mfaReconfirmedAt?: Date | null };

/** An Afrippa trader's session that has not finished two-step sign-in yet (it is required for every trader). */
export const twoStepPendingFor = (session: CustomerCaller) => session.customer.store.platform === 'afrippa' && !session.mfaVerifiedAt;

/**
 * Udozo's customers confirm their mobile number at sign-up (texted through their country's SMS provider), and an
 * account without one (an older account, or a sign-up that stopped after the email) confirms it before anything else.
 * Only where the country can text: elsewhere the number stays unconfirmed and nothing waits for it.
 */
export const phonePendingFor = (session: CustomerCaller, product: string) =>
  product === 'udozo' && session.customer.store.platform !== 'afrippa' && !session.customer.phoneVerifiedAt && Boolean(session.customer.market?.smsProvider);

const ROUTE_PHONE_PENDING = 'customer:phone-pending';
/** A customer route that takes a session whose mobile number is still to be confirmed (the account's own steps). */
export const AllowPhonePending = () => SetMetadata(ROUTE_PHONE_PENDING, true);

type CustomerRequest = Request & { customer?: CustomerCaller };

export const customerSignInRequired = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'unauthenticated', 'Sign in to continue.');

/**
 * Store customers' routes: the store's server sends the customer's session token in the `BitoCard-Customer-Session`
 * header (it keeps the token in its own cookie; browsers never call the API with it), and names its store in
 * `BitoCard-Store` (none: bitocard.com). A session is only good at the store it was made at, except that a bitocard.com
 * account's session is also good on every published BitoCard country store (ng.bitocard.com…), which share its
 * accounts: there the customer shops in that store (`customer.store`, so it is the seller and its settings apply), while
 * the account itself (`customer.storeId`) stays bitocard.com's. Anything else is a 401.
 *
 * Afrippa's traders' sessions count only on Afrippa's own routes (`afrippaSignedRoutes`, reached through its signed
 * server), never on BitoCard's, whatever store a request names.
 *
 * Afrippa's traders must finish two-step sign-in on a session before using it: until then only routes marked
 * `@AllowTwoStepPending()` (the two-step steps, reading the account, confirming the email or phone, signing out) take
 * it, and everything else answers `mfa_required` (401).
 *
 * On Udozo, a customer whose mobile number is still to be confirmed (`phonePendingFor`) reaches only routes marked
 * `@AllowPhonePending()` (their account: reading it, confirming the email and phone, the profile, signing out), and
 * everything else answers `phone_not_verified` (403).
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(
    private readonly customers: CustomersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<CustomerRequest>();
    const allowPending = this.reflector.getAllAndOverride<boolean>(ROUTE_TWO_STEP_PENDING, [context.getHandler(), context.getClass()]) ?? false;
    const allowPhonePending = this.reflector.getAllAndOverride<boolean>(ROUTE_PHONE_PENDING, [context.getHandler(), context.getClass()]) ?? false;
    const session = await customerFor(this.customers, req, { allowPending: true });
    if (!session) throw customerSignInRequired();
    if (twoStepPendingFor(session) && !allowPending) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'mfa_required', 'Finish signing in with your two-step code.');
    }
    if (!allowPhonePending && phonePendingFor(session, this.customers.product)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'phone_not_verified', 'Confirm your mobile number to continue.', 'phone');
    }
    req.customer = session;
    return true;
  }
}

/**
 * The customer a request's session belongs to at the store it names (see `CustomerGuard`), or null: for routes that
 * serve signed-out people too. A trader's session still waiting for its two-step code counts as signed out unless
 * `allowPending`.
 */
export async function customerFor(customers: CustomersService, req: Request, options: { allowPending?: boolean } = {}): Promise<CustomerCaller | null> {
  const token = req.get(customerSessionHeader);
  const session = token ? await customers.resolve(token) : null;
  if (!session) return null;
  if (session.customer.store.platform === 'afrippa' && !afrippaSignedRoutes.test(req.path)) return null;
  const requested = storeKey(req) ?? houseSubdomain;
  if (session.customer.store.subdomain !== requested) {
    // A house account (bitocard.com's, or Udozo's) also shops at the stores that share its accounts.
    const shared = session.customer.store.subdomain === houseSubdomain ? await customers.sharedStore(requested) : null;
    if (!shared) return null;
    session.customer = { ...session.customer, store: shared };
  }
  if (twoStepPendingFor(session) && !options.allowPending) return null;
  return session;
}

/** The signed-in customer (routes behind `CustomerGuard`). */
export const CurrentCustomer = createParamDecorator((_data: unknown, context: ExecutionContext): CustomerCaller => {
  const req = context.switchToHttp().getRequest<CustomerRequest>();
  if (!req.customer) throw customerSignInRequired();
  return req.customer;
});
