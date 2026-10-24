import { type CanActivate, createParamDecorator, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../common/errors/api-error.js';
import { customerSessionHeader, CustomersService, type CustomerWithStore } from './customers.service.js';
import { houseSubdomain, storeKey } from './store-key.js';

export type CustomerCaller = { customer: CustomerWithStore; sessionId: string };

type CustomerRequest = Request & { customer?: CustomerCaller };

export const customerSignInRequired = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'unauthenticated', 'Sign in to continue.');

/**
 * Store customers' routes: the store's server sends the customer's session token in the `BitoCard-Customer-Session`
 * header (it keeps the token in its own cookie; browsers never call the API with it), and names its store in
 * `BitoCard-Store` (none: bitocard.com). A session is only good at the store it was made at, except that a bitocard.com
 * account's session is also good on every published BitoCard country store (ng.bitocard.com…), which share its
 * accounts: there the customer shops in that store (`customer.store`, so it is the seller and its settings apply), while
 * the account itself (`customer.storeId`) stays bitocard.com's. Anything else is a 401.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly customers: CustomersService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<CustomerRequest>();
    const token = req.get(customerSessionHeader);
    const session = token ? await this.customers.resolve(token) : null;
    const requested = storeKey(req) ?? houseSubdomain;
    if (!session) throw customerSignInRequired();
    if (session.customer.store.subdomain !== requested) {
      const country = session.customer.store.subdomain === houseSubdomain ? await this.customers.countryStore(requested) : null;
      if (!country) throw customerSignInRequired();
      session.customer = { ...session.customer, store: country };
    }
    req.customer = session;
    return true;
  }
}

/** The signed-in customer (routes behind `CustomerGuard`). */
export const CurrentCustomer = createParamDecorator((_data: unknown, context: ExecutionContext): CustomerCaller => {
  const req = context.switchToHttp().getRequest<CustomerRequest>();
  if (!req.customer) throw customerSignInRequired();
  return req.customer;
});
