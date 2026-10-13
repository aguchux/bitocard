import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { type CryptoReconciliation, type LedgerMode, Prisma } from '../../generated/prisma/client.js';
import { InboxService } from '../../notifications/inbox.service.js';
import { fromUnits } from '../amounts.js';
import { type Chain, normaliseContract } from '../chains/client.js';
import { ledgerUnits } from '../chains/deposits.service.js';
import { CryptoWithdrawalsService } from '../withdrawals.service.js';
import type { SignerBalance } from './signer.js';

export function presentReconciliation(row: CryptoReconciliation, decimals: number) {
  return {
    object: 'crypto_reconciliation' as const,
    id: row.id,
    mode: row.mode,
    asset: row.asset,
    expected: fromUnits(row.expected, decimals),
    held: fromUnits(row.held, decimals),
    difference: `${row.difference < 0n ? '-' : ''}${fromUnits(row.difference < 0n ? -row.difference : row.difference, decimals)}`,
    status: row.status,
    detail: row.detail,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * The daily custody check. For each asset, what the ledger expects BitoCard's wallets to hold on chain (customers'
 * crypto and BitoCard's crypto fees in `crypto_custody`, less withdrawals broadcast but not yet settled, plus deposits
 * seen but not yet credited) is compared with what the signer reports its wallets hold (deposit addresses, hot, warm
 * and cold; protocol in `docs/crypto-signer.md`). A shortfall means customers' crypto is not all there: finance and
 * operations are told at once. A surplus is BitoCard's own money (a gas float, fees). Sandbox stores' simulated signer
 * holds nothing, so the sandbox is checked only against a real test signer.
 */
@Injectable()
export class CryptoReconciliationService {
  private readonly logger = new Logger(CryptoReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly withdrawals: CryptoWithdrawalsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
  ) {}

  /** Checks every asset in a mode and records the outcome. Safe to run twice (each run is its own record). */
  async run(mode: LedgerMode = 'live') {
    const signer = this.withdrawals.signer(mode);
    let balances: SignerBalance[] | null = null;
    let error: string | null = null;
    if (!signer || signer.simulated || !signer.balances) {
      error = 'No signer is set up for this mode.';
    } else {
      try {
        balances = await signer.balances(mode === 'live' ? 'mainnet' : 'testnet');
      } catch (failure) {
        error = `The signer did not report its balances: ${failure instanceof Error ? failure.message : 'error'}`;
        this.logger.warn({ err: failure }, 'Could not read the signer balances');
      }
    }
    const [assets, networks] = await Promise.all([this.prisma.cryptoAsset.findMany({ orderBy: { sortOrder: 'asc' } }), this.prisma.cryptoNetwork.findMany()]);
    const matched = new Set<SignerBalance>();
    const rows: CryptoReconciliation[] = [];
    for (const asset of assets) {
      const custody = (await this.prisma.ledgerAccount.findFirst({ where: { kind: 'crypto_custody', mode, currency: asset.code, ownerKey: 'platform' } }))?.balanceMinor ?? 0n;
      const sent = (await this.prisma.cryptoWithdrawal.aggregate({ where: { mode, asset: asset.code, status: 'broadcast' }, _sum: { amount: true } }))._sum.amount ?? 0n;
      const arriving = (await this.prisma.cryptoDeposit.aggregate({ where: { mode, asset: asset.code, status: 'pending' }, _sum: { amount: true } }))._sum.amount ?? 0n;
      const expected = custody - sent + arriving;
      const chains: Record<string, string> = {};
      let held = 0n;
      for (const balance of balances ?? []) {
        const network = networks.find(item => {
          if (item.asset !== asset.code || item.chain !== balance.chain) return false;
          const contract = item.contract ? (mode === 'live' ? item.contract : item.testContract) : null;
          if (!contract) return balance.contract === null && !item.contract;
          return balance.contract !== null && normaliseContract(balance.chain as Chain, balance.contract) === normaliseContract(balance.chain as Chain, contract);
        });
        if (!network) continue;
        matched.add(balance);
        const units = ledgerUnits(BigInt(balance.amount), balance.decimals, asset.decimals);
        held += units;
        chains[balance.chain] = fromUnits(units, asset.decimals);
      }
      // Assets with nothing on either side are left out, unless the signer could not be asked about money the ledger holds.
      if (expected === 0n && held === 0n) continue;
      const difference = balances ? held - expected : 0n;
      const status = !balances ? 'unavailable' : difference === 0n ? 'matched' : difference > 0n ? 'surplus' : 'shortfall';
      const detail = {
        custody: fromUnits(custody, asset.decimals),
        withdrawals_in_flight: fromUnits(sent, asset.decimals),
        deposits_arriving: fromUnits(arriving, asset.decimals),
        chains,
        ...(error ? { error } : {}),
      };
      const row = await this.prisma.cryptoReconciliation.create({ data: { mode, asset: asset.code, expected, held, difference, status, detail: detail as Prisma.InputJsonValue } });
      rows.push(row);
      if (status === 'shortfall') {
        await this.inbox.admins('admin.crypto.custody_shortfall', {
          title: `${asset.code} custody short by ${fromUnits(-difference, asset.decimals)}`,
          body: `The signer's wallets hold ${fromUnits(held, asset.decimals)} ${asset.code}; the ledger expects ${fromUnits(expected, asset.decimals)}. Check the wallets, sweeps and gas spending now.`,
          link: '/crypto/assets',
          mode,
          subject: `${mode}:${asset.code}:${new Date().toISOString().slice(0, 10)}`,
        });
      }
    }
    // Holdings that match no network (an unlisted token, a network switched off) are reported, never counted.
    const unmatched = (balances ?? []).filter(item => !matched.has(item) && item.amount !== '0').map(item => ({ chain: item.chain, asset: item.asset, contract: item.contract, amount: item.amount, decimals: item.decimals }));
    const decimals = new Map(assets.map(asset => [asset.code, asset.decimals]));
    return { object: 'crypto_reconciliation_run' as const, mode, error, unmatched, data: rows.map(row => presentReconciliation(row, decimals.get(row.asset) ?? 8)) };
  }

  /** The latest check of each asset in a mode. */
  async latest(mode: LedgerMode) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT ON (asset) id FROM crypto_reconciliations WHERE mode = ${mode}::"LedgerMode" ORDER BY asset, created_at DESC`;
    const found = await this.prisma.cryptoReconciliation.findMany({ where: { id: { in: rows.map(row => row.id) } }, orderBy: { asset: 'asc' } });
    const decimals = new Map((await this.prisma.cryptoAsset.findMany()).map(asset => [asset.code, asset.decimals]));
    return { object: 'list' as const, data: found.map(row => presentReconciliation(row, decimals.get(row.asset) ?? 8)) };
  }

  /** An admin runs the check now (audited). */
  async runNow(adminId: string | null, mode: LedgerMode) {
    const result = await this.run(mode);
    await this.audit.record({ actorId: adminId, action: 'crypto.reconciliation_run', targetType: 'crypto', targetId: mode, before: null, after: { statuses: result.data.map(item => `${item.asset}:${item.status}`), error: result.error } });
    return result;
  }
}
