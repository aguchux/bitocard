import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { base58, base58check, bech32, bech32m } from '@scure/base';
import { sha256 as sha256Bytes } from '@noble/hashes/sha2.js';
import { AuditService } from '../audit/audit.service.js';
import { numericCode, sameDigest, sha256 } from '../common/crypto.js';
import { ApiError } from '../common/errors/api-error.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { type CryptoAsset, type CryptoNetwork, type CryptoWithdrawal, type CryptoWithdrawalAddress, type LedgerMode, Prisma } from '../generated/prisma/client.js';
import { IntegrationsService, secureUrl } from '../integrations/integrations.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { cryptoAddressAddedEmail, cryptoWithdrawalCodeEmail } from '../notifications/templates.js';
import { fromUnits, toUnits } from './amounts.js';
import { type Chain, chainFamily, chainNames, chains, isEvm, normaliseAddress, normaliseContract } from './chains/client.js';
import { CryptoDepositsService } from './chains/deposits.service.js';
import { signerInSandbox } from './custody/check.js';
import { type Screening, screenerKeys, screeners } from './custody/screening.js';
import { type CryptoSigner, RemoteSigner, SignerError, signerFields, SimulatedSigner, type SignerTransfer } from './custody/signer.js';
import { CryptoWalletsService, cryptoFeesRef, notFound } from './crypto-wallets.service.js';
import { checksumAddress, tronToHex } from './derive.js';

const minute = 60_000;
const hour = 60 * minute;
/** A new address can be withdrawn to 24 hours after it is added. */
export const addressWaitMs = 24 * hour;
/** A saved address is screened again before a withdrawal once its last check is this old: lists change. */
export const rescreenAfterMs = 24 * hour;
const codeLifetimeMs = 30 * minute;
const resendAfterMs = minute;
const maxCodeAttempts = 5;
const maxAddresses = 20;
/** Payment-page top-ups (cards, mobile money) can be reversed for weeks: withdrawals soon after one wait for an admin. */
const reversibleWindowMs = 60 * 24 * hour;
/** Checks of a transfer with the signer, then the chain: quickly at first, then less often. */
const checkScheduleMs = [minute, 2 * minute, 5 * minute, 10 * minute, 30 * minute];
/** Admins are told once a withdrawal has waited this long for the signer or the chain. */
const stuckAfterMs = 2 * hour;
/** Withdrawals go on the chains BitoCard can check them on (Solana waits for its chain reader). */
export const withdrawalChains: readonly Chain[] = ['ETHEREUM', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM', 'TRON', 'BITCOIN', 'LITECOIN', 'DOGECOIN'];

const unavailable = (message: string, param?: string) => new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'withdrawals_unavailable', message, param);
const invalid = (code: string, message: string, param?: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', code, message, param);
const codeDigest = (id: string, code: string) => sha256(`crypto_withdrawal:${id}:${code}`);
const open = ['awaiting_code', 'review', 'queued', 'submitting', 'broadcast', 'completed'];

const bitcoinCheck = base58check(sha256Bytes);

/**
 * Each Bitcoin-style chain's address forms on its main and test networks: the SegWit prefix (none for Dogecoin, which
 * has no SegWit) and the base58check version bytes of its legacy pay-to-key-hash and script-hash addresses.
 */
const utxoForms: Record<'BITCOIN' | 'LITECOIN' | 'DOGECOIN', { live: { hrp: string | null; versions: number[] }; test: { hrp: string | null; versions: number[] } }> = {
  BITCOIN: { live: { hrp: 'bc', versions: [0x00, 0x05] }, test: { hrp: 'tb', versions: [0x6f, 0xc4] } },
  // Litecoin: L… and M… (and the old 3…); testnet m/n… and Q….
  LITECOIN: { live: { hrp: 'ltc', versions: [0x30, 0x32, 0x05] }, test: { hrp: 'tltc', versions: [0x6f, 0x3a, 0xc4] } },
  // Dogecoin: D… and A…/9…; testnet n… and 2….
  DOGECOIN: { live: { hrp: null, versions: [0x1e, 0x16] }, test: { hrp: null, versions: [0x71, 0xc4] } },
};

/**
 * A withdrawal address in its standard form, or null when it is not a valid address on that chain's network (main
 * networks for live stores, test networks for sandbox stores): EVM checksummed (a mixed-case address must have a valid
 * checksum), TRON base58check, Bitcoin and Litecoin SegWit (bech32), Taproot (bech32m) and legacy (base58check),
 * Dogecoin legacy, Solana base58.
 */
export function withdrawalAddress(chain: Chain, input: string, testnet: boolean): string | null {
  const address = input.trim();
  try {
    if (isEvm(chain)) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(address) || /^0x0{40}$/.test(address)) return null;
      const lower = address === address.toLowerCase() || address === `0x${address.slice(2).toUpperCase()}`;
      if (!lower && checksumAddress(address) !== address) return null;
      return checksumAddress(address);
    }
    if (chain === 'TRON') return tronToHex(address) ? address : null;
    if (chain === 'SOLANA') return base58.decode(address).length === 32 ? address : null;
    if (chain !== 'BITCOIN' && chain !== 'LITECOIN' && chain !== 'DOGECOIN') return null;
    const forms = utxoForms[chain][testnet ? 'test' : 'live'];
    const lower = address.toLowerCase();
    const hrp = forms.hrp;
    if (hrp && lower.startsWith(`${hrp}1`)) {
      if (address !== lower && address !== address.toUpperCase()) return null;
      const version = (() => {
        try {
          const decoded = bech32.decode(lower as `${string}1${string}`);
          return decoded.prefix === hrp && decoded.words[0] === 0 ? { words: decoded.words, v: 0 } : null;
        } catch {
          const decoded = bech32m.decode(lower as `${string}1${string}`);
          return decoded.prefix === hrp && decoded.words[0] >= 1 && decoded.words[0] <= 16 ? { words: decoded.words, v: decoded.words[0] } : null;
        }
      })();
      if (!version) return null;
      const program = bech32.fromWords(version.words.slice(1));
      if (version.v === 0 ? program.length !== 20 && program.length !== 32 : program.length < 2 || program.length > 40 || (version.v === 1 && program.length !== 32)) return null;
      return lower;
    }
    const bytes = bitcoinCheck.decode(address);
    return bytes.length === 21 && forms.versions.includes(bytes[0]) ? address : null;
  } catch {
    return null;
  }
}

/** Ledger units as the chain's units (the inverse of `ledgerUnits`; exact). */
export function chainUnits(amount: bigint, chainDecimals: number, assetDecimals: number) {
  if (chainDecimals >= assetDecimals) return amount * 10n ** BigInt(chainDecimals - assetDecimals);
  const factor = 10n ** BigInt(assetDecimals - chainDecimals);
  if (amount % factor !== 0n) throw invalid('parameter_invalid', `This network takes at most ${chainDecimals} decimal places.`, 'amount');
  return amount / factor;
}

/**
 * On-chain withdrawals. A customer saves an address (usable after 24 hours, screened against sanctions lists, never a
 * BitoCard deposit address), then asks to send an amount: its amount plus BitoCard's network fee moves from their
 * wallet to `crypto_withdrawing` at once, within the asset's 24-hour limit, and an emailed code naming the amount and
 * address confirms it. Large amounts, unscreened addresses and customers who recently topped up by a reversible method
 * wait for an admin (finance approves, operations or finance reject).
 *
 * BitoCard's signer sends it under a reference that never changes, so asking again after a timeout never sends twice
 * (unclear is not failed). Once the signer has broadcast it, the transfer is re-read from the chain through the chain
 * providers and settled after its network's confirmations: the amount out of `crypto_custody`, the fee to `crypto_fees`.
 * Only the signer's definite failure (nothing sent) returns the money to the wallet.
 */
@Injectable()
export class CryptoWithdrawalsService {
  private readonly logger = new Logger(CryptoWithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly integrations: IntegrationsService,
    private readonly wallets: CryptoWalletsService,
    private readonly deposits: CryptoDepositsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  // -- Signer and screening -------------------------------------------------------------------------------------

  /** The signer for a mode: the one set up for it (its Sandbox switch on for test), else simulated in test, else none. */
  signer(mode: LedgerMode): CryptoSigner | null {
    const values = this.integrations.values(signerFields.map(item => item.key));
    if (values.CRYPTO_SIGNER_URL && values.CRYPTO_SIGNER_SECRET && secureUrl(values.CRYPTO_SIGNER_URL) && signerInSandbox(values) === (mode === 'test')) return new RemoteSigner(values.CRYPTO_SIGNER_URL, values.CRYPTO_SIGNER_SECRET);
    return mode === 'test' ? new SimulatedSigner() : null;
  }

  /** Screens an address with the first screener that answers; `unscreened` when none is set up or none answered. */
  async screen(address: string): Promise<Screening | { status: 'unscreened'; provider: null; detail: string | null }> {
    const values = this.integrations.values(screenerKeys);
    let detail: string | null = null;
    for (const item of screeners.filter(entry => entry.configured(values))) {
      try {
        return await item.screen(values, address);
      } catch (error) {
        detail = `${item.name}: ${error instanceof Error ? error.message : 'error'}`;
        this.logger.warn({ provider: item.id, err: error }, 'Sanctions screening failed');
      }
    }
    return { status: 'unscreened', provider: null, detail };
  }

  // -- Addresses ------------------------------------------------------------------------------------------------

  async addresses(customer: CustomerWithStore) {
    const { mode } = await this.wallets.context(customer);
    const rows = await this.prisma.cryptoWithdrawalAddress.findMany({ where: { customerId: customer.id, mode }, orderBy: { createdAt: 'desc' } });
    return { object: 'list' as const, data: rows.map(presentAddress) };
  }

  async addAddress(customer: CustomerWithStore, input: { chain: string; address: string; label: string }) {
    const context = await this.wallets.requireHolder(customer, 'withdrawing crypto');
    const chain = input.chain.toUpperCase() as Chain;
    if (!withdrawalChains.includes(chain)) throw unavailable(`Withdrawals on ${chainNames[chain] ?? 'this network'} are not open yet.`, 'chain');
    const address = withdrawalAddress(chain, input.address, context.mode === 'test');
    if (!address) {
      throw invalid('address_invalid', `This is not a valid ${chainNames[chain]} address${context.mode === 'test' ? ' on its test network' : ''}. Check it and try again.`, 'address');
    }
    const family = chainFamily[chain];
    const internal = await this.prisma.cryptoAddress.findFirst({ where: { family, address: { equals: address, mode: family === 'evm' ? 'insensitive' : 'default' } }, select: { id: true } });
    if (internal) throw invalid('address_internal', 'This is a BitoCard deposit address. Send to an address outside BitoCard.', 'address');
    if ((await this.prisma.cryptoWithdrawalAddress.count({ where: { customerId: customer.id, mode: context.mode } })) >= maxAddresses) {
      throw invalid('too_many_addresses', `You can save up to ${maxAddresses} addresses. Remove one first.`);
    }
    const screening = await this.screen(address);
    if (screening.status === 'flagged') await this.refuseFlagged(customer, context.mode, chain, address, screening, 'address');
    const usableFrom = new Date(Date.now() + addressWaitMs);
    let row: CryptoWithdrawalAddress;
    try {
      row = await this.prisma.cryptoWithdrawalAddress.create({
        data: { customerId: customer.id, mode: context.mode, chain, address, label: input.label.trim(), usableFrom, screening: screening.status, screenedBy: screening.provider, screenedAt: screening.provider ? new Date() : null },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'address_exists', 'You already saved this address.', 'address');
      throw error;
    }
    const when = usableFrom.toUTCString().replace(':00 GMT', ' UTC');
    await this.email
      .send(cryptoAddressAddedEmail(customer.email, { store: customer.store.name, label: row.label, network: chainNames[chain], address, usableFrom: when }))
      .catch(error => this.logger.warn({ err: error, customerId: customer.id }, 'Could not email the address notice'));
    await this.inbox.customer({ customerId: customer.id, storeId: customer.storeId }, 'customer.crypto.address_added', {
      title: 'Withdrawal address added',
      body: `"${row.label}" (${chainNames[chain]}) can be used from ${when}. If this was not you, remove it and change your password.`,
      link: '/account/crypto/withdraw',
      mode: context.mode,
      subject: row.id,
    });
    return presentAddress(row);
  }

  /** Admins are told about a sanctioned address, and it is refused. */
  private async refuseFlagged(customer: CustomerWithStore, mode: LedgerMode, chain: Chain, address: string, screening: { provider: string | null; detail?: string | null }, param: string): Promise<never> {
    await this.inbox.admins('admin.crypto.address_flagged', {
      title: 'Withdrawal address on a sanctions list',
      body: `${customer.email} tried to use ${address} (${chainNames[chain]}), which ${screening.provider} reports: ${screening.detail ?? 'sanctioned'}. It was refused.`,
      link: `/crypto/customers/${customer.id}`,
      mode,
      subject: `${customer.id}:${chain}:${address}`,
    });
    throw invalid('address_refused', 'This address cannot be used for withdrawals.', param);
  }

  /**
   * A saved address screened over a day ago is screened again before it is used. A flagged answer is kept and refuses
   * it; when no screener answers, this withdrawal is treated as unscreened (live: reviewed) and the old answer kept.
   */
  private async rescreened(customer: CustomerWithStore, row: CryptoWithdrawalAddress): Promise<CryptoWithdrawalAddress> {
    if (row.screening === 'flagged' || (row.screenedAt && Date.now() - row.screenedAt.getTime() < rescreenAfterMs)) return row;
    const screening = await this.screen(row.address);
    if (!screening.provider) return { ...row, screening: 'unscreened' };
    const fresh = await this.prisma.cryptoWithdrawalAddress.update({ where: { id: row.id }, data: { screening: screening.status, screenedBy: screening.provider, screenedAt: new Date() } });
    if (fresh.screening === 'flagged') await this.refuseFlagged(customer, row.mode, row.chain as Chain, row.address, screening, 'address_id');
    return fresh;
  }

  async removeAddress(customer: CustomerWithStore, id: string) {
    const removed = await this.prisma.cryptoWithdrawalAddress.deleteMany({ where: { id, customerId: customer.id } });
    if (!removed.count) throw notFound('address');
    return { object: 'crypto_withdrawal_address' as const, id, deleted: true };
  }

  // -- Networks and limits --------------------------------------------------------------------------------------

  private contractFor(network: CryptoNetwork, mode: LedgerMode) {
    return network.contract ? (mode === 'live' ? network.contract : network.testContract) : null;
  }

  /** What has been withdrawn (or is on its way) in the last 24 hours, in ledger units. */
  private async usedToday(tx: Prisma.TransactionClient | PrismaService, customerId: string, mode: LedgerMode, asset: string) {
    const sum = await tx.cryptoWithdrawal.aggregate({ where: { customerId, mode, asset, status: { in: open }, createdAt: { gt: new Date(Date.now() - 24 * hour) } }, _sum: { amount: true } });
    return sum._sum.amount ?? 0n;
  }

  /** The networks an asset can be withdrawn on now, with their fee and minimum, and the customer's daily limit. */
  async networks(customer: CustomerWithStore, assetCode: string) {
    const context = await this.wallets.requireHolder(customer, 'withdrawing crypto');
    const asset = await this.wallets.asset(assetCode, 'asset', true);
    const signer = this.signer(context.mode);
    const networks = await this.prisma.cryptoNetwork.findMany({ where: { asset: asset.code, withdrawalsEnabled: true }, orderBy: { chain: 'asc' } });
    const usable = signer ? networks.filter(item => withdrawalChains.includes(item.chain as Chain) && (!item.contract || this.contractFor(item, context.mode))) : [];
    const limit = toUnits(asset.withdrawalDailyLimit, asset.decimals);
    const used = await this.usedToday(this.prisma, customer.id, context.mode, asset.code);
    return {
      object: 'crypto_withdrawal_networks' as const,
      asset: asset.code,
      daily_limit: fromUnits(limit, asset.decimals),
      remaining_today: fromUnits(limit > used ? limit - used : 0n, asset.decimals),
      data: usable.map(item => ({
        object: 'crypto_network' as const,
        chain: item.chain,
        name: chainNames[item.chain as Chain],
        fee: fromUnits(toUnits(item.withdrawalFee, asset.decimals), asset.decimals),
        minimum: fromUnits(toUnits(item.minWithdrawal, asset.decimals), asset.decimals),
        confirmations: item.confirmations,
      })),
    };
  }

  // -- Withdrawals ----------------------------------------------------------------------------------------------

  /** Why a withdrawal must wait for an admin, or null. */
  private async reviewReason(customerId: string, mode: LedgerMode, asset: CryptoAsset, amount: bigint, address: CryptoWithdrawalAddress) {
    const from = toUnits(asset.withdrawalReviewFrom, asset.decimals);
    if (from > 0n && amount >= from) return 'amount';
    if (mode !== 'live') return null;
    if (address.screening !== 'clear') return 'unscreened';
    const reversible = await this.prisma.payment.count({
      where: { customerId, mode, purpose: 'customer_top_up', status: 'succeeded', reservedAccountId: null, completedAt: { gt: new Date(Date.now() - reversibleWindowMs) } },
    });
    return reversible ? 'recent_card_top_up' : null;
  }

  /** Previews or asks for a withdrawal; asking moves the amount and fee out of the wallet and emails the code. */
  async create(customer: CustomerWithStore, input: { asset: string; chain: string; address_id: string; amount: string; preview?: boolean }) {
    const context = await this.wallets.requireHolder(customer, 'withdrawing crypto');
    const asset = await this.wallets.asset(input.asset, 'asset', true);
    const chain = input.chain.toUpperCase() as Chain;
    const network = chains.includes(chain) ? await this.prisma.cryptoNetwork.findUnique({ where: { asset_chain: { asset: asset.code, chain } } }) : null;
    if (!network?.withdrawalsEnabled || !withdrawalChains.includes(chain)) throw unavailable(`${asset.code} withdrawals on this network are not open.`, 'chain');
    if (network.contract && !this.contractFor(network, context.mode)) throw unavailable(`${asset.code} on ${chainNames[chain]} has no test network token yet.`, 'chain');
    if (!this.signer(context.mode)) throw unavailable('Crypto withdrawals are not open yet.');
    const saved = await this.prisma.cryptoWithdrawalAddress.findFirst({ where: { id: input.address_id, customerId: customer.id, mode: context.mode } });
    if (!saved) throw notFound('address');
    const address = input.preview ? saved : await this.rescreened(customer, saved);
    if (address.chain !== chain) throw invalid('address_wrong_network', `This address is for ${chainNames[address.chain as Chain]}, not ${chainNames[chain]}.`, 'address_id');
    if (address.screening === 'flagged') throw invalid('address_refused', 'This address cannot be used for withdrawals.', 'address_id');
    if (address.usableFrom > new Date()) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'address_not_ready', `New addresses can be used 24 hours after they are added: this one from ${address.usableFrom.toISOString()}.`, 'address_id');
    }
    const amount = toUnits(input.amount, asset.decimals);
    if (amount <= 0n) throw invalid('parameter_invalid', 'Enter an amount above zero.', 'amount');
    const minimum = toUnits(network.minWithdrawal, asset.decimals);
    if (amount < minimum) throw invalid('amount_too_small', `The smallest ${asset.code} withdrawal on ${chainNames[chain]} is ${fromUnits(minimum, asset.decimals)}.`, 'amount');
    const fee = toUnits(network.withdrawalFee, asset.decimals);
    const rawAmount = chainUnits(amount, network.decimals, asset.decimals);
    const limit = toUnits(asset.withdrawalDailyLimit, asset.decimals);
    const reason = await this.reviewReason(customer.id, context.mode, asset, amount, address);
    const overLimit = (used: bigint) => {
      if (used + amount > limit) {
        throw invalid('withdrawal_limit', `You can withdraw up to ${fromUnits(limit, asset.decimals)} ${asset.code} in 24 hours; ${fromUnits(limit > used ? limit - used : 0n, asset.decimals)} is left.`, 'amount');
      }
    };
    if (input.preview) {
      overLimit(await this.usedToday(this.prisma, customer.id, context.mode, asset.code));
      return {
        object: 'crypto_withdrawal_preview' as const,
        mode: context.mode,
        asset: asset.code,
        chain,
        network: chainNames[chain],
        address: address.address,
        amount: fromUnits(amount, asset.decimals),
        fee: fromUnits(fee, asset.decimals),
        total: fromUnits(amount + fee, asset.decimals),
        needs_approval: reason !== null,
      };
    }

    const id = randomUUID();
    const code = numericCode();
    const walletId = await this.ledger.accountId(context.mode, this.wallets.ref(customer.id, 'crypto_wallet', asset.code));
    const withdrawingId = await this.ledger.accountId(context.mode, this.wallets.ref(customer.id, 'crypto_withdrawing', asset.code));
    const created = await this.prisma.$transaction(async tx => {
      // Locking the wallet serialises this customer's withdrawals of the asset, so parallel requests cannot pass the limit together.
      await this.ledger.lockBalances(tx, [walletId, withdrawingId]);
      overLimit(await this.usedToday(tx, customer.id, context.mode, asset.code));
      const row = await tx.cryptoWithdrawal.create({
        data: {
          id,
          customerId: customer.id,
          mode: context.mode,
          asset: asset.code,
          chain,
          addressId: address.id,
          address: address.address,
          amount,
          fee,
          rawAmount: rawAmount.toString(),
          reviewReason: reason,
          signerReference: `bc_cw_${id.replace(/-/g, '')}`,
          codeHash: codeDigest(id, code),
          codeExpiresAt: new Date(Date.now() + codeLifetimeMs),
          codeSentAt: new Date(),
        },
      });
      await this.ledger.write(tx, {
        mode: context.mode,
        type: 'crypto_withdrawal',
        reference: `crypto_withdrawal:${id}`,
        description: `${asset.code} withdrawal on ${chainNames[chain]}`,
        metadata: { withdrawal_id: id },
        postings: [
          { accountId: walletId, kind: 'crypto_wallet', amount: amount + fee },
          { accountId: withdrawingId, kind: 'crypto_withdrawing', amount: -(amount + fee) },
        ],
      });
      return row;
    });
    await this.sendCode(customer, created, asset, code);
    return this.present(created, asset);
  }

  private async sendCode(customer: CustomerWithStore, row: CryptoWithdrawal, asset: Pick<CryptoAsset, 'decimals'>, code: string) {
    await this.email
      .send(cryptoWithdrawalCodeEmail(customer.email, { store: customer.store.name, code, amount: fromUnits(row.amount, asset.decimals), asset: row.asset, network: chainNames[row.chain as Chain], address: row.address }))
      .catch(error => this.logger.warn({ err: error, withdrawal: row.id }, 'Could not email the withdrawal code'));
  }

  private async own(customer: CustomerWithStore, id: string) {
    const row = await this.prisma.cryptoWithdrawal.findFirst({ where: { id, customerId: customer.id } });
    if (!row) throw notFound('withdrawal');
    return row;
  }

  async resendCode(customer: CustomerWithStore, id: string) {
    const row = await this.own(customer, id);
    if (row.status !== 'awaiting_code') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'withdrawal_not_awaiting_code', 'This withdrawal is not waiting for a code.');
    if (row.codeSentAt && Date.now() - row.codeSentAt.getTime() < resendAfterMs) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limit_error', 'code_recently_sent', 'A code was just sent. Wait a minute before asking for another.');
    }
    const code = numericCode();
    const updated = await this.prisma.cryptoWithdrawal.updateMany({
      where: { id: row.id, status: 'awaiting_code' },
      data: { codeHash: codeDigest(row.id, code), codeExpiresAt: new Date(Date.now() + codeLifetimeMs), codeAttempts: 0, codeSentAt: new Date() },
    });
    if (!updated.count) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'withdrawal_not_awaiting_code', 'This withdrawal is not waiting for a code.');
    const asset = await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: row.asset } });
    await this.sendCode(customer, row, asset, code);
    return this.present(await this.prisma.cryptoWithdrawal.findUniqueOrThrow({ where: { id: row.id } }), asset);
  }

  /** The emailed code confirms the withdrawal: it then waits for an admin or goes to the signer. */
  async confirm(customer: CustomerWithStore, id: string, code: string) {
    const context = await this.wallets.requireHolder(customer, 'withdrawing crypto');
    const row = await this.own(customer, id);
    if (row.status !== 'awaiting_code' || !row.codeHash) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'withdrawal_not_awaiting_code', 'This withdrawal is not waiting for a code.');
    if (!row.codeExpiresAt || row.codeExpiresAt <= new Date()) throw invalid('code_expired', 'That code has expired. Ask for a new one.', 'code');
    // Claim an attempt before comparing, in one statement, so parallel guesses never get past the limit.
    const attempt = await this.prisma.cryptoWithdrawal.updateMany({ where: { id: row.id, status: 'awaiting_code', codeAttempts: { lt: maxCodeAttempts } }, data: { codeAttempts: { increment: 1 } } });
    if (!attempt.count) throw invalid('code_attempts_exceeded', 'Too many wrong attempts. Ask for a new code.', 'code');
    if (!sameDigest(row.codeHash, codeDigest(row.id, code))) throw invalid('code_invalid', 'That code is not valid. Check it or ask for a new one.', 'code');
    const next = row.reviewReason ? 'review' : 'queued';
    const claimed = await this.prisma.cryptoWithdrawal.updateMany({ where: { id: row.id, status: 'awaiting_code', codeHash: row.codeHash }, data: { status: next, codeHash: null, nextCheckAt: null } });
    if (!claimed.count) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'withdrawal_not_awaiting_code', 'This withdrawal is not waiting for a code.');
    const asset = await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: row.asset } });
    if (next === 'review') {
      await this.inbox.admins('admin.crypto.withdrawal_review', {
        title: `Approve a ${row.asset} withdrawal`,
        body: `CW-${String(row.number).padStart(6, '0')}: ${fromUnits(row.amount, asset.decimals)} ${row.asset} on ${chainNames[row.chain as Chain]} for ${customer.email} (${reviewReasons[row.reviewReason!] ?? row.reviewReason}).`,
        link: '/crypto/withdrawals',
        mode: context.mode,
        subject: row.id,
      });
    } else {
      waitUntil(this.submit(row.id).catch(error => this.logger.warn({ err: error, withdrawal: row.id }, 'Could not send a crypto withdrawal')));
    }
    return this.present(await this.prisma.cryptoWithdrawal.findUniqueOrThrow({ where: { id: row.id } }), asset);
  }

  /** The customer cancels before it is sent (waiting for the code or an admin): the money goes back to the wallet. */
  async cancel(customer: CustomerWithStore, id: string) {
    const row = await this.own(customer, id);
    const done = await this.release(row, ['awaiting_code', 'review'], 'cancelled', null);
    if (!done) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'withdrawal_not_cancellable', 'This withdrawal is already on its way and cannot be cancelled.');
    return this.present(done, await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: row.asset } }));
  }

  async list(customer: CustomerWithStore) {
    const { mode } = await this.wallets.context(customer);
    const rows = await this.prisma.cryptoWithdrawal.findMany({ where: { customerId: customer.id, mode }, orderBy: { createdAt: 'desc' }, take: 25 });
    const assets = await this.assetMap();
    return { object: 'list' as const, data: rows.map(row => this.present(row, assets.get(row.asset)!)) };
  }

  async get(customer: CustomerWithStore, id: string) {
    const row = await this.own(customer, id);
    return this.present(row, await this.prisma.cryptoAsset.findUniqueOrThrow({ where: { code: row.asset } }));
  }

  private async assetMap() {
    return new Map((await this.prisma.cryptoAsset.findMany()).map(asset => [asset.code, asset]));
  }

  // -- Moving money ---------------------------------------------------------------------------------------------

  /**
   * Returns what the withdrawal holds to the wallet, once, moving it from one of `from` to `status`. Null when it was not
   * in one of those statuses (another request got there first).
   */
  private async release(row: CryptoWithdrawal, from: string[], status: 'cancelled' | 'rejected' | 'failed', error: string | null, review?: { adminId: string | null; note: string }) {
    const withdrawingId = await this.ledger.accountId(row.mode, this.wallets.ref(row.customerId, 'crypto_withdrawing', row.asset));
    const walletId = await this.ledger.accountId(row.mode, this.wallets.ref(row.customerId, 'crypto_wallet', row.asset));
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.cryptoWithdrawal.updateMany({
        where: { id: row.id, status: { in: from } },
        data: { status, error, codeHash: null, nextCheckAt: null, ...(review ? { reviewedBy: review.adminId, reviewNote: review.note, reviewedAt: new Date() } : {}) },
      });
      if (!claimed.count) return null;
      await this.ledger.write(tx, {
        mode: row.mode,
        type: 'crypto_withdrawal_release',
        reference: `crypto_withdrawal:${row.id}:released`,
        description: `${row.asset} withdrawal ${status}: returned to the wallet`,
        metadata: { withdrawal_id: row.id },
        postings: [
          { accountId: withdrawingId, kind: 'crypto_withdrawing', amount: row.amount + row.fee },
          { accountId: walletId, kind: 'crypto_wallet', amount: -(row.amount + row.fee) },
        ],
      });
      return tx.cryptoWithdrawal.findUniqueOrThrow({ where: { id: row.id } });
    });
    if (done && status !== 'cancelled') await this.tellCustomer(done, 'customer.crypto.withdrawal_failed');
    return done;
  }

  /** Settles a confirmed transfer once: the amount out of custody, the fee to BitoCard's crypto fees. */
  private async complete(row: CryptoWithdrawal, confirmations: number) {
    const withdrawingId = await this.ledger.accountId(row.mode, this.wallets.ref(row.customerId, 'crypto_withdrawing', row.asset));
    const custodyId = await this.ledger.accountId(row.mode, { kind: 'crypto_custody', currency: row.asset });
    const feesId = row.fee > 0n ? await this.ledger.accountId(row.mode, cryptoFeesRef(row.asset)) : null;
    const done = await this.prisma.$transaction(async tx => {
      const claimed = await tx.cryptoWithdrawal.updateMany({ where: { id: row.id, status: 'broadcast' }, data: { status: 'completed', confirmations, completedAt: new Date(), nextCheckAt: null, error: null } });
      if (!claimed.count) return null;
      await this.ledger.write(tx, {
        mode: row.mode,
        type: 'crypto_withdrawal_sent',
        reference: `crypto_withdrawal:${row.id}:sent`,
        description: `${row.asset} withdrawal on ${chainNames[row.chain as Chain]} confirmed`,
        metadata: { withdrawal_id: row.id, tx_hash: row.txHash },
        postings: [
          { accountId: withdrawingId, kind: 'crypto_withdrawing', amount: row.amount + row.fee },
          { accountId: custodyId, kind: 'crypto_custody', amount: -row.amount },
          ...(feesId ? [{ accountId: feesId, kind: 'crypto_fees' as const, amount: -row.fee }] : []),
        ],
      });
      return tx.cryptoWithdrawal.findUniqueOrThrow({ where: { id: row.id } });
    });
    if (done) await this.tellCustomer(done, 'customer.crypto.withdrawal_sent');
    return done;
  }

  private async tellCustomer(row: CryptoWithdrawal, type: 'customer.crypto.withdrawal_sent' | 'customer.crypto.withdrawal_failed') {
    const customer = await this.prisma.customer.findUnique({ where: { id: row.customerId }, select: { storeId: true } });
    const asset = await this.prisma.cryptoAsset.findUnique({ where: { code: row.asset } });
    if (!customer || !asset) return;
    const amount = `${fromUnits(row.amount, asset.decimals)} ${row.asset}`;
    await this.inbox.customer({ customerId: row.customerId, storeId: customer.storeId }, type, {
      subject: row.id,
      title: type === 'customer.crypto.withdrawal_sent' ? `${amount} sent` : `${amount} not sent`,
      body:
        type === 'customer.crypto.withdrawal_sent'
          ? `Your withdrawal on ${chainNames[row.chain as Chain]} is confirmed on chain.`
          : `Your withdrawal was ${row.status === 'rejected' ? 'not approved' : 'not sent'}. The ${row.asset} is back in your wallet.`,
      link: '/account/crypto/withdraw',
      mode: row.mode,
    });
  }

  // -- Sending --------------------------------------------------------------------------------------------------

  private delay(attempts: number) {
    return checkScheduleMs[Math.min(attempts, checkScheduleMs.length - 1)];
  }

  /**
   * Sends a queued withdrawal through the signer, or asks again for one whose answer was unclear (the same reference,
   * so the signer never sends twice). Claimed with `next_check_at`, so two runs never ask at once.
   */
  async submit(id: string) {
    const now = new Date();
    const claimed = await this.prisma.cryptoWithdrawal.updateMany({
      where: { id, OR: [{ status: 'queued' }, { status: 'submitting', OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] }] },
      data: { status: 'submitting', attempts: { increment: 1 }, nextCheckAt: new Date(now.getTime() + 3 * minute) },
    });
    if (!claimed.count) return;
    const row = await this.prisma.cryptoWithdrawal.findUniqueOrThrow({ where: { id } });
    const signer = this.signer(row.mode);
    if (!signer) return this.unclear(row, 'No signer is set up for this mode.');
    const network = await this.prisma.cryptoNetwork.findUniqueOrThrow({ where: { asset_chain: { asset: row.asset, chain: row.chain } } });
    const owner = await this.prisma.customer.findUniqueOrThrow({ where: { id: row.customerId }, select: { cryptoFrozenAt: true } });
    if (owner.cryptoFrozenAt) {
      // A frozen account sends nothing more. Only one the signer never received can be returned; one it did is followed up.
      const known = row.attempts > 1 ? await signer.status(row.signerReference).catch(() => undefined) : null;
      if (known === null) return void (await this.release(row, ['submitting'], 'failed', 'The crypto account was frozen before it was sent.'));
      if (known) return this.apply(row, known);
      return this.unclear(row, 'The crypto account is frozen; waiting for the signer.');
    }
    try {
      const transfer = await signer.send({
        reference: row.signerReference,
        chain: row.chain as Chain,
        network: row.mode === 'live' ? 'mainnet' : 'testnet',
        asset: row.asset,
        contract: this.contractFor(network, row.mode),
        to: row.address,
        rawAmount: row.rawAmount,
        decimals: network.decimals,
      });
      await this.apply(row, transfer);
    } catch (error) {
      if (error instanceof SignerError && error.definite) {
        await this.release(row, ['submitting'], 'failed', `The signer refused it: ${error.message}`.slice(0, 300));
        return;
      }
      await this.unclear(row, error instanceof Error ? error.message : 'error');
    }
  }

  /** What the signer said about a transfer: failed (nothing sent) returns the money; a hash moves it to broadcast. */
  private async apply(row: CryptoWithdrawal, transfer: SignerTransfer) {
    if (transfer.status === 'failed') {
      await this.release(row, ['submitting', 'broadcast'], 'failed', `Not sent: ${transfer.reason ?? 'the signer reported a failure'}`.slice(0, 300));
      return;
    }
    if (!transfer.txHash) return this.unclear(row, 'The signer has not broadcast it yet.');
    await this.prisma.cryptoWithdrawal.updateMany({
      where: { id: row.id, status: { in: ['submitting', 'broadcast'] } },
      data: { status: 'broadcast', txHash: transfer.txHash, error: null, nextCheckAt: new Date(Date.now() + (transfer.status === 'confirmed' ? 0 : minute)) },
    });
  }

  /** An unclear answer: the withdrawal keeps its status and is asked about again later; admins are told once if it drags on. */
  private async unclear(row: CryptoWithdrawal, message: string) {
    await this.prisma.cryptoWithdrawal.updateMany({ where: { id: row.id, status: row.status }, data: { error: message.slice(0, 300), nextCheckAt: new Date(Date.now() + this.delay(row.attempts)) } });
    await this.flagIfStuck(row);
  }

  private async flagIfStuck(row: CryptoWithdrawal) {
    if (row.needsReviewAt || Date.now() - (row.reviewedAt ?? row.createdAt).getTime() < stuckAfterMs) return;
    const flagged = await this.prisma.cryptoWithdrawal.updateMany({ where: { id: row.id, needsReviewAt: null }, data: { needsReviewAt: new Date() } });
    if (!flagged.count) return;
    await this.inbox.admins('admin.crypto.withdrawal_stuck', {
      title: `${row.asset} withdrawal unconfirmed`,
      body: `CW-${String(row.number).padStart(6, '0')} (${chainNames[row.chain as Chain]}) is still ${row.status} after ${Math.round((Date.now() - row.createdAt.getTime()) / hour)} hours. Check it with the signer and the chain.`,
      link: '/crypto/withdrawals',
      mode: row.mode,
      subject: row.id,
    });
  }

  /**
   * A broadcast withdrawal: the signer is asked how it stands (a replacement transaction updates the hash; a definite
   * failure returns the money), then the transfer is re-read from the chain and settled once it has its confirmations.
   * Simulated sandbox transfers settle without a chain.
   */
  async check(id: string) {
    const now = new Date();
    const claimed = await this.prisma.cryptoWithdrawal.updateMany({
      where: { id, status: 'broadcast', OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] },
      data: { attempts: { increment: 1 }, nextCheckAt: new Date(now.getTime() + 3 * minute) },
    });
    if (!claimed.count) return;
    let row = await this.prisma.cryptoWithdrawal.findUniqueOrThrow({ where: { id } });
    const signer = this.signer(row.mode);
    if (!signer) return this.unclear(row, 'No signer is set up for this mode.');
    try {
      const transfer = await signer.status(row.signerReference);
      // A withdrawal a real signer sent is never settled by the simulated one (its signer removed or switched to live).
      if (signer.simulated && row.txHash && transfer?.txHash !== row.txHash) return this.unclear(row, 'Sent by a signer that is no longer set up for this mode.');
      if (transfer?.status === 'failed') return void (await this.apply(row, transfer));
      if (transfer?.txHash && transfer.txHash !== row.txHash) {
        await this.prisma.cryptoWithdrawal.update({ where: { id }, data: { txHash: transfer.txHash } });
        row = { ...row, txHash: transfer.txHash };
      }
      if (signer.simulated) return void (await this.complete(row, 0));
    } catch (error) {
      // The chain is the record of what was sent: carry on and read it.
      this.logger.warn({ err: error, withdrawal: id }, 'The signer did not answer about a withdrawal');
    }
    if (!row.txHash) return this.unclear(row, 'No transaction hash yet.');
    const chain = row.chain as Chain;
    const routes = await this.deposits.routes(chain, row.mode);
    if (!routes.length) return this.unclear(row, `No chain provider is set up for ${chainNames[chain]}.`);
    const network = await this.prisma.cryptoNetwork.findUniqueOrThrow({ where: { asset_chain: { asset: row.asset, chain } } });
    const contract = this.contractFor(network, row.mode);
    try {
      const { value } = await this.deposits.ask(chain, routes, async client => ({ inspection: await client.inspect(row.txHash!), latest: await client.latestBlock() }));
      const { inspection, latest } = value;
      const sent = inspection?.ok
        ? inspection.transfers.some(
            item =>
              normaliseAddress(chain, item.to) === normaliseAddress(chain, row.address) &&
              item.raw.toString() === row.rawAmount &&
              (contract ? item.contract !== null && normaliseContract(chain, item.contract) === normaliseContract(chain, contract) : item.contract === null),
          )
        : false;
      if (!sent || inspection?.block === null || inspection?.block === undefined) {
        return this.unclear(row, inspection && !inspection.ok ? 'The transaction failed on chain; waiting for the signer.' : inspection ? 'Waiting for the transfer to be mined.' : 'The chain does not show the transaction yet.');
      }
      const confirmations = Number(latest - inspection.block + 1n);
      if (confirmations < network.confirmations) {
        await this.prisma.cryptoWithdrawal.updateMany({ where: { id, status: 'broadcast' }, data: { confirmations, error: null, nextCheckAt: new Date(Date.now() + minute) } });
        return;
      }
      await this.complete(row, confirmations);
    } catch (error) {
      await this.unclear(row, error instanceof Error ? error.message : 'error');
    }
  }

  /** The `crypto` job's part: expired codes cancelled, queued and unclear ones sent, broadcast ones checked. Safe to run twice. */
  async job() {
    const now = new Date();
    const expired = await this.prisma.cryptoWithdrawal.findMany({ where: { status: 'awaiting_code', codeExpiresAt: { lt: now } }, take: 100 });
    for (const row of expired) await this.release(row, ['awaiting_code'], 'cancelled', 'The code was not entered in time.');
    const due = await this.prisma.cryptoWithdrawal.findMany({
      where: { status: { in: ['queued', 'submitting', 'broadcast'] }, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    let sent = 0;
    for (const row of due) {
      try {
        if (row.status === 'broadcast') await this.check(row.id);
        else await this.submit(row.id);
        sent += 1;
      } catch (error) {
        this.logger.warn({ err: error, withdrawal: row.id }, 'Could not move a crypto withdrawal on');
      }
    }
    return { expired: expired.length, checked: sent, tracked: (await this.trackDeposits('live')) + (await this.trackDeposits('test')) };
  }

  /**
   * Tells the mode's signer about the addresses deposits arrived at, once each, so it sweeps them to its hot wallet
   * and counts them in its balances (the custody check). A signer that refuses an address (its keys and the API's
   * xpub differ) is logged loudly and asked again next run; nothing else waits on it.
   */
  async trackDeposits(mode: LedgerMode) {
    const signer = this.signer(mode);
    if (!signer?.track || signer.simulated) return 0;
    const rows = await this.prisma.cryptoDeposit.findMany({ where: { mode, signerTrackedAt: null, status: { in: ['pending', 'credited'] } }, orderBy: { createdAt: 'asc' }, take: 50 });
    let tracked = 0;
    const done = new Set<string>();
    for (const row of rows) {
      const chain = row.chain as Chain;
      if (done.has(`${chain}:${row.address}`)) continue;
      done.add(`${chain}:${row.address}`);
      const family = chainFamily[chain];
      const address = family ? await this.prisma.cryptoAddress.findFirst({ where: { mode, family, address: row.address }, select: { index: true } }) : null;
      if (!address) continue;
      try {
        await signer.track({ chain, network: mode === 'live' ? 'mainnet' : 'testnet', index: address.index, address: row.address });
        // Every deposit to the same address on the same chain is covered by the one call.
        const marked = await this.prisma.cryptoDeposit.updateMany({ where: { mode, chain: row.chain, address: row.address, signerTrackedAt: null, status: { in: ['pending', 'credited'] } }, data: { signerTrackedAt: new Date() } });
        tracked += marked.count;
      } catch (error) {
        this.logger.error({ err: error, deposit: row.id, chain }, 'The signer did not take a deposit address');
      }
    }
    return tracked;
  }

  // -- Admin ----------------------------------------------------------------------------------------------------

  async adminList(query: { mode?: LedgerMode; status?: string; customer_id?: string; id?: string }) {
    const rows = await this.prisma.cryptoWithdrawal.findMany({
      where: { ...(query.id ? { id: query.id } : {}), ...(query.mode ? { mode: query.mode } : {}), ...(query.status ? { status: query.status } : {}), ...(query.customer_id ? { customerId: query.customer_id } : {}) },
      include: { customer: { select: { email: true } }, savedAddress: { select: { screening: true, screenedBy: true, label: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const assets = await this.assetMap();
    return {
      object: 'list' as const,
      data: rows.map(row => ({
        ...this.present(row, assets.get(row.asset)!),
        customer: { id: row.customerId, email: row.customer.email },
        screening: row.savedAddress?.screening ?? null,
        screened_by: row.savedAddress?.screenedBy ?? null,
        signer_reference: row.signerReference,
        attempts: row.attempts,
        error: row.error,
        needs_review: row.needsReviewAt !== null,
        reviewed_at: row.reviewedAt?.toISOString() ?? null,
        review_note: row.reviewNote,
      })),
    };
  }

  /** Finance approves a withdrawal waiting for review: it goes to the signer. */
  async approve(adminId: string | null, id: string, note: string) {
    const row = await this.prisma.cryptoWithdrawal.findUnique({ where: { id } });
    if (!row) throw notFound('withdrawal');
    const claimed = await this.prisma.cryptoWithdrawal.updateMany({ where: { id, status: 'review' }, data: { status: 'queued', reviewedBy: adminId, reviewNote: note, reviewedAt: new Date(), nextCheckAt: null } });
    if (!claimed.count) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'withdrawal_not_in_review', 'This withdrawal is not waiting for approval.');
    await this.audit.record({ actorId: adminId, action: 'crypto.withdrawal_approved', targetType: 'crypto_withdrawal', targetId: id, before: { status: 'review' }, after: { status: 'queued', note } });
    waitUntil(this.submit(id).catch(error => this.logger.warn({ err: error, withdrawal: id }, 'Could not send a crypto withdrawal')));
    return (await this.adminList({ id })).data[0];
  }

  /** Operations or finance turn down a withdrawal waiting for review: the money goes back to the customer's wallet. */
  async reject(adminId: string | null, id: string, note: string) {
    const row = await this.prisma.cryptoWithdrawal.findUnique({ where: { id } });
    if (!row) throw notFound('withdrawal');
    const done = await this.release(row, ['review'], 'rejected', null, { adminId, note });
    if (!done) throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'withdrawal_not_in_review', 'This withdrawal is not waiting for approval.');
    await this.audit.record({ actorId: adminId, action: 'crypto.withdrawal_rejected', targetType: 'crypto_withdrawal', targetId: id, before: { status: 'review' }, after: { status: 'rejected', note } });
    return (await this.adminList({ id })).data[0];
  }

  /** Operations ask the signer and the chain about a withdrawal now (for one flagged as stuck). */
  async recheck(adminId: string | null, id: string) {
    const row = await this.prisma.cryptoWithdrawal.findUnique({ where: { id } });
    if (!row) throw notFound('withdrawal');
    // Ask now unless a run holds it (its claim lasts 3 minutes from its last change): two sends must never run at once.
    await this.prisma.cryptoWithdrawal.updateMany({ where: { id, status: { in: ['submitting', 'broadcast'] }, updatedAt: { lte: new Date(Date.now() - 3 * minute) } }, data: { nextCheckAt: null } });
    if (row.status === 'broadcast') await this.check(id);
    else if (row.status === 'submitting') await this.submit(id);
    await this.audit.record({ actorId: adminId, action: 'crypto.withdrawal_rechecked', targetType: 'crypto_withdrawal', targetId: id, before: { status: row.status }, after: null });
    return (await this.adminList({ id })).data[0];
  }

  // -- Presenting -----------------------------------------------------------------------------------------------

  present(row: CryptoWithdrawal, asset: Pick<CryptoAsset, 'decimals'>) {
    return {
      object: 'crypto_withdrawal' as const,
      id: row.id,
      number: `CW-${String(row.number).padStart(6, '0')}`,
      mode: row.mode,
      asset: row.asset,
      chain: row.chain,
      network: chainNames[row.chain as Chain],
      address: row.address,
      amount: fromUnits(row.amount, asset.decimals),
      fee: fromUnits(row.fee, asset.decimals),
      total: fromUnits(row.amount + row.fee, asset.decimals),
      status: row.status,
      /** Why it waits for BitoCard's approval (amount, unscreened, recent_card_top_up), while it does. */
      review_reason: row.status === 'review' ? row.reviewReason : null,
      tx_hash: row.txHash,
      confirmations: row.confirmations,
      created_at: row.createdAt.toISOString(),
      completed_at: row.completedAt?.toISOString() ?? null,
    };
  }
}

const reviewReasons: Record<string, string> = { amount: 'large amount', unscreened: 'the address could not be screened', recent_card_top_up: 'recent card or mobile money top-up' };

export function presentAddress(row: CryptoWithdrawalAddress) {
  return {
    object: 'crypto_withdrawal_address' as const,
    id: row.id,
    mode: row.mode,
    chain: row.chain,
    network: chainNames[row.chain as Chain],
    address: row.address,
    label: row.label,
    usable_from: row.usableFrom.toISOString(),
    ready: row.usableFrom <= new Date(),
    created_at: row.createdAt.toISOString(),
  };
}
