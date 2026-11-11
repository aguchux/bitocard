import { type CanActivate, createParamDecorator, type ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { levelOf, type PosPermission } from './permissions.js';
import { deviceHeader, PosStaffService, type PosStaffContext, staffSessionHeader } from './staff.service.js';

const ROUTE_POS_ALLOWS = 'pos:allows';

/**
 * What a staff route needs: any one of these permissions at `yes` (or at `approval` where `approval` is set, the route
 * then asking for a manager's PIN itself). Every route of `PosStaffController` names one.
 */
export const PosAllows = (permissions: PosPermission | PosPermission[], options: { approval?: boolean } = {}) =>
  SetMetadata(ROUTE_POS_ALLOWS, { permissions: [permissions].flat(), approval: Boolean(options.approval) });

export type PosStaffRequest = Request & { posStaff?: PosStaffContext; posSessionId?: string; posDeviceId?: string; posDevice?: { id: string; accountId: string; tillId: string } };

export const staffSignInRequired = () => new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'pos_sign_in_required', 'Sign in at the till with your PIN.');
export const permissionRequired = () => new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'pos_permission_required', 'Your role does not allow this. Ask a manager or the shop owner.');

/**
 * Udozo POS staff's routes (docs/UDOZO_POS_PLAN.md, milestone 5). The till's server sends the member of staff's session
 * in its own header, `Udozo-Pos-Session`, and nothing else counts here: a customer's session is never a staff session,
 * and `CustomerGuard` reads only its own header, so a staff session never reaches a customer, wallet, payout or Connect
 * route. The route's permission is then held to the role (`@PosAllows`).
 */
@Injectable()
export class PosGuard implements CanActivate {
  constructor(
    private readonly staff: PosStaffService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<PosStaffRequest>();
    const token = req.get(staffSessionHeader);
    const found = token ? await this.staff.resolve(token, id => this.owner(id)) : null;
    if (!found) throw staffSignInRequired();
    const allows = this.reflector.getAllAndOverride<{ permissions: PosPermission[]; approval: boolean } | undefined>(ROUTE_POS_ALLOWS, [context.getHandler(), context.getClass()]);
    // A route that names no permission is refused: nothing is open to every role by mistake.
    if (!allows) throw permissionRequired();
    const ok = allows.permissions.some(permission => {
      const level = levelOf(found.role, permission);
      return level === 'yes' || level === 'cashiers' || (allows.approval && level === 'approval');
    });
    if (!ok && allows.permissions.length) throw permissionRequired();
    req.posStaff = found;
    req.posSessionId = found.sessionId;
    return true;
  }

  /** The owner's Udozo account the staff work for (still active), as the till's services take it. */
  private async owner(customerId: string): Promise<CustomerWithStore | null> {
    const owner = await this.prisma.customer.findUnique({ where: { id: customerId }, include: { store: { include: { reseller: { select: { house: true } } } }, market: true } });
    return owner && owner.status === 'active' ? owner : null;
  }
}

/** A till's linked device (`Udozo-Pos-Device`), for the name tiles and PIN sign-in on it. */
@Injectable()
export class PosDeviceGuard implements CanActivate {
  constructor(private readonly staff: PosStaffService) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<PosStaffRequest>();
    const device = await this.staff.device(req.get(deviceHeader));
    if (!device) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'device_not_linked', 'This device is not linked to a till. Link it with a code from Settings > Shops & tills.');
    req.posDevice = { id: device.id, accountId: device.accountId, tillId: device.tillId };
    req.posDeviceId = device.id;
    return true;
  }
}

/** The signed-in member of staff (routes behind `PosGuard`). */
export const CurrentStaff = createParamDecorator((_data: unknown, context: ExecutionContext): PosStaffContext => {
  const req = context.switchToHttp().getRequest<PosStaffRequest>();
  if (!req.posStaff) throw staffSignInRequired();
  return req.posStaff;
});

/** The linked device (routes behind `PosDeviceGuard`). */
export const CurrentDevice = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const req = context.switchToHttp().getRequest<PosStaffRequest>();
  if (!req.posDevice) throw new ApiError(HttpStatus.UNAUTHORIZED, 'authentication_error', 'device_not_linked', 'This device is not linked to a till.');
  return req.posDevice;
});
