import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CryptoAsset, LedgerMode, P2pFeeRate } from '../generated/prisma/client.js';

/** The global market's code (as in P2pService, not imported from it: the two services depend on each other's file otherwise). */
const globalMarket = 'WW';

/** A rate for every market of a coin (a market's own rate wins). */
export const everyMarket = '*';
/** The most either side pays: 10%. */
export const maxFeeBps = 1000;

export type FeeRates = { buyerBps: number; sellerBps: number };

/**
 * Afrippa's P2P fees (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 4): in crypto only, both sides paying, the seller more.
 * Afrippa's admins set a buyer and a seller rate per coin, for one market (a country, or `WW` the global market) or
 * every market (`*`); a market's own rate wins. Live trading in a coin and market needs a rate (`fee_rates_unset`);
 * the sandbox falls back to the coin's P2P rate for the buyer and nothing for the seller. A seller rate below the
 * buyer's is allowed but flagged (`seller_below_buyer`).
 */
@Injectable()
export class P2pFeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async rates(asset: Pick<CryptoAsset, 'code' | 'p2pFeeBps'>, market: string, mode: LedgerMode): Promise<FeeRates> {
    const rows = await this.prisma.p2pFeeRate.findMany({ where: { asset: asset.code, market: { in: [market, everyMarket] } } });
    const row = rows.find(item => item.market === market) ?? rows.find(item => item.market === everyMarket);
    if (row) return { buyerBps: row.buyerBps, sellerBps: row.sellerBps };
    if (mode === 'live') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'fee_rates_unset', `Trading ${asset.code} is not open in this market yet.`);
    return { buyerBps: asset.p2pFeeBps, sellerBps: 0 };
  }

  async list() {
    const rows = await this.prisma.p2pFeeRate.findMany({ orderBy: [{ asset: 'asc' }, { market: 'asc' }] });
    return { object: 'list' as const, data: rows.map(present), max_bps: maxFeeBps };
  }

  /** Sets a coin's rates for a market (or every market). Finance, with step-up; audited in Afrippa's trail. */
  async set(adminId: string | null, input: { asset: string; market: string | null; buyer_bps: number; seller_bps: number }) {
    const asset = await this.prisma.cryptoAsset.findUnique({ where: { code: input.asset.toUpperCase() } });
    if (!asset) throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'asset_unavailable', 'No such coin.', 'asset');
    const market = await this.market(input.market);
    const before = await this.prisma.p2pFeeRate.findUnique({ where: { asset_market: { asset: asset.code, market } } });
    const row = await this.prisma.p2pFeeRate.upsert({
      where: { asset_market: { asset: asset.code, market } },
      create: { asset: asset.code, market, buyerBps: input.buyer_bps, sellerBps: input.seller_bps },
      update: { buyerBps: input.buyer_bps, sellerBps: input.seller_bps },
    });
    await this.audit.record({ actorId: adminId, action: 'p2p_fee_rate.set', targetType: 'p2p_fee_rate', targetId: row.id, before: before && present(before), after: present(row), platform: 'afrippa' });
    return present(row);
  }

  async remove(adminId: string | null, assetCode: string, market: string) {
    const code = market === 'all' ? everyMarket : await this.market(market);
    const row = await this.prisma.p2pFeeRate.findUnique({ where: { asset_market: { asset: assetCode.toUpperCase(), market: code } } });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such fee rate.');
    await this.prisma.p2pFeeRate.delete({ where: { id: row.id } });
    await this.audit.record({ actorId: adminId, action: 'p2p_fee_rate.removed', targetType: 'p2p_fee_rate', targetId: row.id, before: present(row), platform: 'afrippa' });
    return { object: 'p2p_fee_rate' as const, asset: row.asset, market: row.market === everyMarket ? null : row.market, removed: true };
  }

  /** A market code: a country Afrippa trades in, `WW` the global market, or null for every market. */
  private async market(raw: string | null) {
    if (raw === null) return everyMarket;
    const code = raw.toUpperCase();
    if (code === globalMarket) return code;
    if (/^[A-Z]{2}$/.test(code) && (await this.prisma.country.findUnique({ where: { code }, select: { code: true } }))) return code;
    throw new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', 'Choose a market: a country, WW for the global market, or none for every market.', 'market');
  }
}

function present(row: P2pFeeRate) {
  return {
    object: 'p2p_fee_rate' as const,
    asset: row.asset,
    market: row.market === everyMarket ? null : row.market,
    buyer_bps: row.buyerBps,
    seller_bps: row.sellerBps,
    /** The seller is meant to pay more than the buyer. */
    warnings: row.sellerBps < row.buyerBps ? ['seller_below_buyer'] : [],
    updated_at: row.updatedAt.toISOString(),
  };
}
