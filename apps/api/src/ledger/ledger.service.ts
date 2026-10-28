import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors/api-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { type AccountKind, type LedgerMode, type Platform, Prisma } from '../generated/prisma/client.js';

export type Tx = Prisma.TransactionClient;

/** Which account: its kind and currency, and its owner (a reseller, a payment provider, or BitoCard itself). */
/** `shard` splits a busy platform account into several rows (balances are their sum), so posts to it do not queue on one row. */
export type AccountRef = { kind: AccountKind; currency: string; resellerId?: string; customerId?: string; provider?: string; shard?: number };

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

/**
 * An entry whose accounts exist, ready to write inside a transaction. `platform` is whose books it is in, worked out
 * from its accounts by `prepare`; an entry built by hand from account ids leaves it out and `write` reads it.
 */
export type PreparedEntry = Omit<EntryInput, 'lines'> & { postings: Array<{ accountId: string; kind: AccountKind; amount: bigint }>; platform?: Platform };

/** Assets and expenses grow with debits; every other account (what BitoCard owes, revenue, tax) grows with credits. */
const debitNormal = new Set<AccountKind>(['reseller_owed', 'provider_balance', 'processing_fees', 'supplier_float', 'cost_of_sales', 'promotions', 'crypto_custody', 'crypto_promotions']);
const resellerKinds = new Set<AccountKind>([
  'reseller_funding',
  'reseller_earnings',
  'reseller_earnings_held',
  'reseller_reserved',
  'reseller_payouts_pending',
  'reseller_allowance',
  'reseller_owed',
  'customer_payments',
  // Exchange desks' reserves (BitoCard's sit on its house accounts).
  'reserve_fiat',
  'reserve_crypto',
  'reseller_crypto',
  // Premium resellers' coins on their way out on chain.
  'reseller_crypto_withdrawing',
]);
/** A store customer's own money and crypto: their wallets, P2P proceeds and what they have locked or an admin froze, never below zero. */
const customerKinds = new Set<AccountKind>(['customer_wallet', 'customer_wallet_locked', 'customer_withdrawable', 'p2p_fiat_locked', 'crypto_wallet', 'crypto_locked', 'crypto_frozen', 'crypto_withdrawing', 'customer_payouts_pending', 'crypto_spin_rewards', 'spin_rewards', 'crypto_escrow']);
/**
 * Accounts in Afrippa's books whoever owns them (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 7): BitoCard keeps no
 * crypto, and P2P is Afrippa's. Any account in a coin is Afrippa's too, and so is every account of Afrippa's traders
 * (customers of an Afrippa store) or of an Afrippa reseller (its operator account).
 */
export const afrippaKinds = new Set<AccountKind>([
  'crypto_wallet',
  'crypto_locked',
  'crypto_frozen',
  'crypto_custody',
  'crypto_fees',
  'crypto_withdrawing',
  'crypto_spin_rewards',
  'crypto_promotions',
  'reserve_crypto',
  'reseller_crypto',
  'reseller_crypto_withdrawing',
  'p2p_fiat_locked',
  'crypto_escrow',
]);

export const insufficientFunds = () =>
  new ApiError(HttpStatus.PAYMENT_REQUIRED, 'invalid_request_error', 'insufficient_funds', 'The wallet balance is too low for this.');

function ownerKey(ref: AccountRef) {
  if (customerKinds.has(ref.kind)) {
    if (!ref.customerId) throw new Error(`${ref.kind} needs a customer`);
    return `customer:${ref.customerId}`;
  }
  if (resellerKinds.has(ref.kind)) {
    if (!ref.resellerId) throw new Error(`${ref.kind} needs a reseller`);
    return `reseller:${ref.resellerId}`;
  }
  if (ref.provider) return `provider:${ref.provider}`;
  return ref.shard ? `platform:${ref.shard}` : 'platform';
}

/** Change to an account's natural balance from a posting (positive amount = debit). */
const balanceDelta = (kind: AccountKind, amount: bigint) => (debitNormal.has(kind) ? amount : -amount);

/** Assets and expenses (what is held or spent) grow with debits; the rest (what is owed or earned) with credits. */
export const isDebitNormal = (kind: AccountKind) => debitNormal.has(kind);

/**
 * The double-entry ledger. Every money movement is a balanced journal entry; account balances change only together
 * with their postings, in the same transaction, and reseller accounts can never go below zero.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Finds or creates an account. Runs outside money transactions; a creation race just reads the winner. */
  async accountId(mode: LedgerMode, ref: AccountRef) {
    return (await this.account(mode, ref)).id;
  }

  /** The account and whose books it is in, created on first use. */
  private async account(mode: LedgerMode, ref: AccountRef): Promise<{ id: string; platform: Platform }> {
    const key = { kind: ref.kind, mode, currency: ref.currency, ownerKey: ownerKey(ref) };
    const select = { id: true, platform: true } as const;
    const existing = await this.prisma.ledgerAccount.findUnique({ where: { kind_mode_currency_ownerKey: key }, select });
    if (existing) return existing;
    try {
      return await this.prisma.ledgerAccount.create({
        data: {
          ...key,
          resellerId: resellerKinds.has(ref.kind) ? ref.resellerId : null,
          customerId: customerKinds.has(ref.kind) ? ref.customerId : null,
          nonNegative: resellerKinds.has(ref.kind) || customerKinds.has(ref.kind),
          platform: await this.platformOf(ref),
        },
        select,
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      return this.prisma.ledgerAccount.findUniqueOrThrow({ where: { kind_mode_currency_ownerKey: key }, select });
    }
  }

  /** Whose books a new account is in (see `afrippaKinds`). */
  private async platformOf(ref: AccountRef): Promise<Platform> {
    if (afrippaKinds.has(ref.kind)) return 'afrippa';
    if (customerKinds.has(ref.kind) && ref.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: ref.customerId }, select: { store: { select: { platform: true } } } });
      if (customer?.store.platform === 'afrippa') return 'afrippa';
    }
    if (resellerKinds.has(ref.kind) && ref.resellerId) {
      const reseller = await this.prisma.reseller.findUnique({ where: { id: ref.resellerId }, select: { platform: true } });
      if (reseller?.platform === 'afrippa') return 'afrippa';
    }
    if (await this.prisma.cryptoAsset.findUnique({ where: { code: ref.currency }, select: { code: true } })) return 'afrippa';
    return 'bitocard';
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
    let platform: Platform = 'bitocard';
    for (const line of input.lines) {
      const account = await this.account(input.mode, line.account);
      if (account.platform === 'afrippa') platform = 'afrippa';
      postings.push({ accountId: account.id, kind: line.account.kind, amount: line.debit ?? -(line.credit ?? 0n) });
    }
    return { mode: input.mode, type: input.type, reference: input.reference, resellerId: input.resellerId, description: input.description, metadata: input.metadata, postings, platform };
  }

  /** Writes a prepared entry inside `tx`. Throws insufficient_funds (and so rolls back `tx`) if a reseller or customer account would go negative. */
  async write(tx: Tx, entry: PreparedEntry) {
    // Afrippa's when any of its accounts is.
    const platform: Platform =
      entry.platform ??
      ((await tx.ledgerAccount.count({ where: { id: { in: entry.postings.map(p => p.accountId) }, platform: 'afrippa' } })) > 0 ? 'afrippa' : 'bitocard');
    const created = await tx.journalEntry.create({
      data: {
        platform,
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
   * Integrity check of one product's books: every account balance equals the sum of its postings, and every entry
   * balances. Returns the problems found (none means the books are consistent).
   */
  async check(platform: Platform = 'bitocard') {
    const accounts = await this.prisma.$queryRaw<Array<{ id: string; kind: AccountKind; balance_minor: bigint; posted: bigint | null }>>`
      SELECT a.id, a.kind, a.balance_minor, (SELECT SUM(p.amount_minor) FROM ledger_postings p WHERE p.account_id = a.id) AS posted
      FROM ledger_accounts a WHERE a.platform = ${platform}::"Platform"`;
    const accountProblems = accounts
      .filter(a => BigInt(a.balance_minor) !== balanceDelta(a.kind, BigInt(a.posted ?? 0)))
      .map(a => ({ account_id: a.id, balance: String(a.balance_minor), from_postings: String(balanceDelta(a.kind, BigInt(a.posted ?? 0))) }));
    const entries = await this.prisma.$queryRaw<Array<{ entry_id: string; currency: string; total: bigint }>>`
      SELECT p.entry_id, a.currency, SUM(p.amount_minor) AS total
      FROM ledger_postings p JOIN ledger_accounts a ON a.id = p.account_id JOIN journal_entries e ON e.id = p.entry_id
      WHERE e.platform = ${platform}::"Platform"
      GROUP BY p.entry_id, a.currency HAVING SUM(p.amount_minor) <> 0`;
    return {
      object: 'ledger_check' as const,
      platform,
      ok: accountProblems.length === 0 && entries.length === 0,
      accounts_checked: accounts.length,
      account_mismatches: accountProblems,
      unbalanced_entries: entries.map(e => ({ entry_id: e.entry_id, currency: e.currency, off_by: String(e.total) })),
    };
  }
}
