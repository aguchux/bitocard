import { Controller, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AdminRoles, type Caller, CurrentCaller, RealmOnly } from '../auth/caller.js';
import { AuditService } from '../audit/audit.service.js';
import { presentStore } from '../stores/stores.service.js';
import { HouseService } from './house.service.js';

/** The signed-in admin, for the audit log. */
const adminId = (caller: Caller) => (caller.kind === 'session' ? caller.userId : null);

/**
 * A market's own country store (`<country>.bitocard.com`, `docs/BITOCARD_COUNTRY_STORES_PLAN.md`): provisioned
 * automatically the first time a checkout happens there (`StoreSellers.seller()`), but an admin can bring one up
 * ahead of that first sale — before switching `country_stores` on for the market, so root can redirect to it from
 * the moment the switch flips, instead of waiting for someone to buy something there first.
 */
@ApiExcludeController()
@RealmOnly('admin')
@AdminRoles('operations')
@Controller('admin/countries')
export class AdminCountryStoresController {
  constructor(
    private readonly house: HouseService,
    private readonly audit: AuditService,
  ) {}

  @Post(':code/store')
  async create(@CurrentCaller() caller: Caller, @Param('code') code: string) {
    const store = await this.house.storeFor(code);
    await this.audit.record({ actorId: adminId(caller), action: 'country_store.provisioned', targetType: 'store', targetId: store.id, after: store });
    return presentStore(store);
  }
}
