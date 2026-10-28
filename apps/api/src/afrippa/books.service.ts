import { Injectable } from '@nestjs/common';
import { fromUnits } from '../crypto/amounts.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AccountKind, LedgerMode } from '../generated/prisma/client.js';
import { isDebitNormal, LedgerService } from '../ledger/ledger.service.js';

type Line = { kind: AccountKind; currency: string; accounts: number; balance: string | number; debits: string | number; credits: string | number };
type Row = { kind: AccountKind; currency: string; accounts: bigint; balance: bigint | null; debits: bigint | null; credits: bigint | null };

/**
 * Afrippa's own books (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 7): only ledger accounts and entries tagged Afrippa's,
 * which BitoCard's reports, overview and integrity check never read. Per kind and currency: how many accounts, what
 * they hold now, and what was debited and credited in the period; per currency, whether the books balance (what
 * Afrippa holds and spends against what it owes and earns). Coins are decimal strings in the coin's units; money is
 * integer minor units, as everywhere else in the API.
 */
@Injectable()
export class AfrippaBooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async books(input: { mode: LedgerMode; from: Date; to: Date }) {
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT a.kind, a.currency, COUNT(*) AS accounts, SUM(a.balance_minor) AS balance,
        SUM(m.debits) AS debits, SUM(m.credits) AS credits
      FROM ledger_accounts a
      LEFT JOIN LATERAL (
        SELECT SUM(GREATEST(p.amount_minor, 0)) AS debits, SUM(GREATEST(-p.amount_minor, 0)) AS credits
        FROM ledger_postings p JOIN journal_entries e ON e.id = p.entry_id
        WHERE p.account_id = a.id AND e.created_at >= ${input.from} AND e.created_at < ${input.to}
      ) m ON TRUE
      WHERE a.platform = 'afrippa' AND a.mode = ${input.mode}::"LedgerMode"
      GROUP BY a.kind, a.currency
      ORDER BY a.currency, a.kind`;
    const decimals = new Map((await this.prisma.cryptoAsset.findMany({ select: { code: true, decimals: true } })).map(asset => [asset.code, asset.decimals]));
    const coins: Line[] = [];
    const money: Line[] = [];
    const sides = new Map<string, { holds: bigint; owes: bigint }>();
    for (const row of rows) {
      const balance = BigInt(row.balance ?? 0);
      const side = sides.get(row.currency) ?? { holds: 0n, owes: 0n };
      if (isDebitNormal(row.kind)) side.holds += balance;
      else side.owes += balance;
      sides.set(row.currency, side);
      const places = decimals.get(row.currency);
      const amount = (units: bigint) => (places === undefined ? Number(units) : fromUnits(units, places));
      const line = { kind: row.kind, currency: row.currency, accounts: Number(row.accounts), balance: amount(balance), debits: amount(BigInt(row.debits ?? 0)), credits: amount(BigInt(row.credits ?? 0)) };
      (places === undefined ? money : coins).push(line);
    }
    const trial = [...sides].map(([currency, side]) => {
      const places = decimals.get(currency);
      const amount = (units: bigint) => (places === undefined ? Number(units) : fromUnits(units, places));
      return { currency, holds: amount(side.holds), owes: amount(side.owes), balanced: side.holds === side.owes };
    });
    return { object: 'afrippa_books' as const, mode: input.mode, from: input.from.toISOString(), to: input.to.toISOString(), coins, money, trial_balance: trial };
  }

  check() {
    return this.ledger.check('afrippa');
  }
}
