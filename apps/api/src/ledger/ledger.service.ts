import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type AccountKind, type LedgerMode, Prisma } from '../generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;

/** Which account: its kind and currency, and its owner (a reseller, a payment provider, or BitoCard itself). */
export type AccountRef = { kind: AccountKind; currency: string; resellerId?: string; provider?: string };

/** One side of an entry. Exactly one of debit or credit, a positive amount in minor units. */
export type Line = { account: AccountRef; debit?: bigint; credit?: bigint };

export type EntryInput = {
  mode: LedgerMode;
  type: string;
  /** Unique business reference: the same event can never be posted twice. */
  reference: string;
  resellerId?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
  lines: Line[];
};

/** An entry whose accounts exist, ready to write inside a transaction. */
export type PreparedEntry = Omit<EntryInput, 'lines'> & { postings: Array<{ accountId: string; kind: AccountKind; amount: bigint }> };

/** Assets and expenses grow with debits; every other account (what BitoCard owes, revenue, tax) grows with credits. */
const debitNormal = new Set<AccountKind>(['provider_balance', 'processing_fees', 'supplier_float', 'cost_of_sales', 'promotions']);
const resellerKinds = new Set<AccountKind>(['reseller_funding', 'reseller_earnings', 'reseller_earnings_held', 'reseller_reserved', 'reseller_payouts_pending', 'reseller_allowance']);

export const insufficientFunds = () =>
  new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'insufficient_funds', 'The wallet balance is too low for this.');

function ownerKey(ref: AccountRef) {
  if (resellerKinds.has(ref.kind)) {
    if (!ref.resellerId) throw new Error(`${ref.kind} needs a reseller`);
    return `reseller:${ref.resellerId}`;
  }
  return ref.provider ? `provider:${ref.provider}` : 'platform';
}

/** Change to an account's natural balance from a posting (positive amount = debit). */
const balanceDelta = (kind: AccountKind, amount: bigint) => (debitNormal.has(kind) ? amount : -amount);

/**
 * The double-entry ledger. Every money movement is a balanced journal entry; account balances change only together
 * with their postings, in the same transaction, and reseller accounts can never go below zero.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Finds or creates an account. Runs outside money transactions; a creation race just reads the winner. */
  async accountId(mode: LedgerMode, ref: AccountRef) {
    const key = { kind: ref.kind, mode, currency: ref.currency, ownerKey: ownerKey(ref) };
    const existing = await this.prisma.ledgerAccount.findUnique({ where: { kind_mode_currency_ownerKey: key }, select: { id: true } });
    if (existing) return existing.id;
    try {
      const created = await this.prisma.ledgerAccount.create({
        data: { ...key, resellerId: resellerKinds.has(ref.kind) ? ref.resellerId : null, nonNegative: resellerKinds.has(ref.kind) },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      return (await this.prisma.ledgerAccount.findUniqueOrThrow({ where: { kind_mode_currency_ownerKey: key }, select: { id: true } })).id;
    }
  }

  /** Checks the entry balances in each currency and makes sure its accounts exist. */
  async prepare(input: EntryInput): Promise<PreparedEntry> {
    const sums = new Map<string, bigint>();
    for (const line of input.lines) {
      const amount = line.debit ?? -(line.credit ?? 0n);
      if ((line.debit === undefined) === (line.credit === undefined) || amount === 0n || (line.debit ?? line.credit ?? 0n) < 0n) {
        throw new Error(`Ledger line needs exactly one positive debit or credit (${input.reference})`);
      }
      sums.set(line.account.currency, (sums.get(line.account.currency) ?? 0n) + amount);
    }
    for (const [currency, sum] of sums) {
      if (sum !== 0n) throw new Error(`Unbalanced entry ${input.reference}: ${currency} is off by ${sum}`);
    }
    const postings = [];
    for (const line of input.lines) {
      postings.push({ accountId: await this.accountId(input.mode, line.account), kind: line.account.kind, amount: line.debit ?? -(line.credit ?? 0n) });
    }
    return { mode: input.mode, type: input.type, reference: input.reference, resellerId: input.resellerId, description: input.description, metadata: input.metadata, postings };
  }

  /** Writes a prepared entry inside `tx`. Throws insufficient_funds (and so rolls back `tx`) if a reseller account would go negative. */
  async write(tx: Tx, entry: PreparedEntry) {
    const created = await tx.journalEntry.create({
      data: {
        mode: entry.mode,
        type: entry.type,
        reference: entry.reference,
        resellerId: entry.resellerId ?? null,
        description: entry.description,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
        postings: { create: entry.postings.map(p => ({ accountId: p.accountId, amountMinor: p.amount })) },
      },
    });
    for (const posting of entry.postings) {
      const delta = balanceDelta(posting.kind, posting.amount);
      // The balance check happens in the UPDATE itself, so concurrent spends cannot both pass it.
      const updated = await tx.ledgerAccount.updateMany({
        where: { id: posting.accountId, ...(delta < 0n ? { OR: [{ nonNegative: false }, { balanceMinor: { gte: -delta } }] } : {}) },
        data: { balanceMinor: { increment: delta } },
      });
      if (updated.count !== 1) throw insufficientFunds();
    }
    return created;
  }

  /** Prepares and writes an entry in its own transaction. */
  async post(input: EntryInput) {
    const entry = await this.prepare(input);
    return this.prisma.$transaction(tx => this.write(tx, entry));
  }

  /** Locks a reseller's accounts for the rest of `tx` and returns their balances. */
  async lockBalances(tx: Tx, accountIds: string[]) {
    const rows = await tx.$queryRaw<Array<{ id: string; balance_minor: bigint }>>`
      SELECT id, balance_minor FROM ledger_accounts WHERE id = ANY(${accountIds}::uuid[]) ORDER BY id FOR UPDATE`;
    return new Map(rows.map(row => [row.id, BigInt(row.balance_minor)]));
  }

  /**
   * Integrity check: every account balance equals the sum of its postings, and every entry balances.
   * Returns the problems found (none means the ledger is consistent).
   */
  async check() {
    const accounts = await this.prisma.$queryRaw<Array<{ id: string; kind: AccountKind; balance_minor: bigint; posted: bigint | null }>>`
      SELECT a.id, a.kind, a.balance_minor, (SELECT SUM(p.amount_minor) FROM ledger_postings p WHERE p.account_id = a.id) AS posted
      FROM ledger_accounts a`;
    const accountProblems = accounts
      .filter(a => BigInt(a.balance_minor) !== balanceDelta(a.kind, BigInt(a.posted ?? 0)))
      .map(a => ({ account_id: a.id, balance: String(a.balance_minor), from_postings: String(balanceDelta(a.kind, BigInt(a.posted ?? 0))) }));
    const entries = await this.prisma.$queryRaw<Array<{ entry_id: string; currency: string; total: bigint }>>`
      SELECT p.entry_id, a.currency, SUM(p.amount_minor) AS total
      FROM ledger_postings p JOIN ledger_accounts a ON a.id = p.account_id
      GROUP BY p.entry_id, a.currency HAVING SUM(p.amount_minor) <> 0`;
    return {
      object: 'ledger_check' as const,
      ok: accountProblems.length === 0 && entries.length === 0,
      accounts_checked: accounts.length,
      account_mismatches: accountProblems,
      unbalanced_entries: entries.map(e => ({ entry_id: e.entry_id, currency: e.currency, off_by: String(e.total) })),
    };
  }
}
