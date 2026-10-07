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
 * `BitoCard-Store` (none: bitocard.com). A session is only good at the store it was made at. Anything else is a 401.
 */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly customers: CustomersService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<CustomerRequest>();
    const token = req.get(customerSessionHeader);
    const session = token ? await this.customers.resolve(token) : null;
    if (!session || session.customer.store.subdomain !== (storeKey(req) ?? houseSubdomain)) throw customerSignInRequired();
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
