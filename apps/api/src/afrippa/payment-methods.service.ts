import { createHmac } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { normalisePhone } from '../auth/auth.service.js';
import { StoreSellers } from '../checkout/store-sellers.js';
import { Encryption } from '../common/encryption.js';
import { ApiError } from '../common/errors/api-error.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { CustomerWithStore } from '../customers/customers.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { LedgerMode, P2pPaymentMethod, P2pPaymentMethodKind } from '../generated/prisma/client.js';
import { IdentityService } from '../identity/identity.service.js';
import { EmailService } from '../notifications/email.service.js';
import { InboxService } from '../notifications/inbox.service.js';
import { paymentMethodAddedEmail } from '../notifications/templates.js';
import { afrippaOperatorId } from './ids.js';

/** Named services a trader can say they are paid through: labels only, never integrations. */
export const namedProviders = {
  wise: 'Wise',
  payoneer: 'Payoneer',
  paypal: 'PayPal',
  revolut: 'Revolut',
  skrill: 'Skrill',
  chipper_cash: 'Chipper Cash',
  grey: 'Grey',
} as const;
export type NamedProvider = keyof typeof namedProviders;
/** Services whose payments the payer can reverse after the coins are released: sellers are warned. */
export const reversibleProviders = new Set<string>([namedProviders.paypal]);
export const isReversible = (method: { kind: string; label: string }) => method.kind === 'named' && reversibleProviders.has(method.label);

/** At most this many saved at once; a new one is usable this long after it is added. */
export const maxPaymentMethods = 10;
export const paymentMethodWaitMs = 24 * 60 * 60 * 1000;
/** Besides the markets' own currencies, the ones named services pay in. */
const extraCurrencies = ['USD', 'EUR', 'GBP'];

export type PaymentMethodInput = {
  kind: P2pPaymentMethodKind;
  currency: string;
  bank_name?: string;
  bank_code?: string;
  account_number?: string;
  network?: string;
  phone?: string;
  provider?: string;
  handle?: string;
};

/** The details a payment method keeps (encrypted), by kind. */
export type PaymentDetails =
  | { kind: 'bank'; bank_name: string; bank_code: string | null; account_number: string }
  | { kind: 'mobile_money'; network: string; phone: string }
  | { kind: 'named'; provider: NamedProvider; handle: string };

const invalid = (param: string, message: string) => new ApiError(HttpStatus.BAD_REQUEST, 'invalid_request_error', 'parameter_invalid', message, param);
const clean = (value: string | undefined) => (value ?? '').trim().replace(/\s+/g, ' ');

/**
 * Afrippa traders' saved payment methods (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 1): where a buyer pays them directly
 * (Afrippa never touches the money). A bank account, a mobile money wallet or a named service, per currency; the
 * details encrypted, lists showing only a hint, the details shown to the counterparty only inside an open order (step
 * 3's orders). The holder is the trader's own verified name live (never typed: a stolen session cannot add someone
 * else's account under a made-up name), and a new method is usable only after 24 hours, with an email and a security
 * notice each time one is added.
 */
@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger('PaymentMethods');

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoreSellers,
    private readonly identity: IdentityService,
    private readonly email: EmailService,
    private readonly inbox: InboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private mode(customer: CustomerWithStore): LedgerMode {
    return this.stores.mode(customer.store);
  }

  async list(customer: CustomerWithStore) {
    const rows = await this.prisma.p2pPaymentMethod.findMany({ where: { customerId: customer.id, mode: this.mode(customer), removedAt: null }, orderBy: { createdAt: 'asc' } });
    return {
      object: 'list' as const,
      data: rows.map(row => this.present(row)),
      limit: maxPaymentMethods,
      named_providers: Object.entries(namedProviders).map(([code, name]) => ({ code, name })),
    };
  }

  async add(customer: CustomerWithStore, input: PaymentMethodInput) {
    const mode = this.mode(customer);
    if (!customer.emailVerifiedAt) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'email_not_verified', 'Confirm your email first: enter the code we emailed you.');
    }
    const fresh = await this.prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { cryptoFrozenAt: true, country: true, name: true } });
    if (fresh.cryptoFrozenAt) throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'crypto_account_frozen', 'Your account is frozen. Contact the Afrippa team.');
    // Live, the holder is the name the identity check verified; in the sandbox, the account's own name.
    const holderName = mode === 'live' ? await this.identity.customerVerifiedName(afrippaOperatorId, 'live', customer.id) : fresh.name;
    if (!holderName) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'permission_error', 'customer_verification_required', 'Verify your identity before adding a payment method.');
    }
    const currency = await this.currency(input.currency);
    const details = this.details(input, fresh.country);
    const fingerprint = createHmac('sha256', this.key()).update(JSON.stringify(['p2p_payment_method', currency, details])).digest('hex');

    const count = await this.prisma.p2pPaymentMethod.count({ where: { customerId: customer.id, mode, removedAt: null } });
    if (count >= maxPaymentMethods) {
      throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'too_many_payment_methods', `You can keep up to ${maxPaymentMethods} payment methods. Remove one first.`);
    }
    let row: P2pPaymentMethod;
    try {
      row = await this.prisma.p2pPaymentMethod.create({
        data: {
          customerId: customer.id,
          mode,
          kind: details.kind,
          currency,
          label: labelOf(details),
          hint: hintOf(details),
          holderName,
          detailsEncrypted: this.encryption().encrypt(JSON.stringify(details)),
          fingerprint,
          usableFrom: new Date(Date.now() + paymentMethodWaitMs),
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ApiError(HttpStatus.CONFLICT, 'conflict_error', 'payment_method_exists', 'You have already saved this payment method.');
      throw error;
    }
    await this.tell(customer, row);
    return this.present(row);
  }

  async remove(customer: CustomerWithStore, id: string) {
    const removed = await this.prisma.p2pPaymentMethod.updateMany({ where: { id, customerId: customer.id, mode: this.mode(customer), removedAt: null }, data: { removedAt: new Date() } });
    if (removed.count === 0) throw new ApiError(HttpStatus.NOT_FOUND, 'not_found_error', 'resource_missing', 'No such payment method.', 'id');
    return { object: 'p2p_payment_method' as const, id, removed: true };
  }

  /** A method's full details, for showing to the counterparty inside an open order (never in lists). */
  async reveal(id: string): Promise<PaymentDetails & { holder_name: string; currency: string }> {
    const row = await this.prisma.p2pPaymentMethod.findUniqueOrThrow({ where: { id } });
    return { ...(JSON.parse(this.encryption().decrypt(row.detailsEncrypted)) as PaymentDetails), holder_name: row.holderName, currency: row.currency };
  }

  present(row: P2pPaymentMethod) {
    return {
      object: 'p2p_payment_method' as const,
      id: row.id,
      kind: row.kind,
      currency: row.currency,
      label: row.label,
      hint: row.hint,
      holder_name: row.holderName,
      /** Payments through it can be reversed by the payer after release (PayPal). */
      reversible: isReversible(row),
      usable: row.usableFrom <= new Date(),
      usable_from: row.usableFrom.toISOString(),
      created_at: row.createdAt.toISOString(),
    };
  }

  private async currency(raw: string) {
    const currency = clean(raw).toUpperCase();
    if (extraCurrencies.includes(currency)) return currency;
    if (/^[A-Z]{3}$/.test(currency) && (await this.prisma.country.count({ where: { currency } }))) return currency;
    throw invalid('currency', 'Choose a currency Afrippa trades in.');
  }

  private details(input: PaymentMethodInput, country: string | null): PaymentDetails {
    switch (input.kind) {
      case 'bank': {
        const bankName = clean(input.bank_name);
        const accountNumber = (input.account_number ?? '').replace(/[\s-]/g, '');
        const bankCode = clean(input.bank_code) || null;
        if (bankName.length < 2 || bankName.length > 80) throw invalid('bank_name', 'Enter the bank’s name.');
        if (!/^\d{6,20}$/.test(accountNumber)) throw invalid('account_number', 'Enter the account number: 6 to 20 digits.');
        if (bankCode && !/^[A-Za-z0-9]{2,20}$/.test(bankCode)) throw invalid('bank_code', 'The bank code is letters and digits only.');
        return { kind: 'bank', bank_name: bankName, bank_code: bankCode, account_number: accountNumber };
      }
      case 'mobile_money': {
        const network = clean(input.network);
        if (network.length < 2 || network.length > 40) throw invalid('network', 'Enter the mobile money network.');
        if (!input.phone) throw invalid('phone', 'Enter the wallet’s mobile number.');
        return { kind: 'mobile_money', network, phone: normalisePhone(input.phone, country) };
      }
      case 'named': {
        const provider = clean(input.provider).toLowerCase() as NamedProvider;
        if (!(provider in namedProviders)) throw invalid('provider', 'Choose a service from the list.');
        const handle = clean(input.handle);
        if (handle.length < 3 || handle.length > 120 || /\s/.test(handle)) throw invalid('handle', 'Enter the email, username or account ID you are paid at.');
        return { kind: 'named', provider, handle };
      }
      default:
        throw invalid('kind', 'Choose a bank account, a mobile money wallet or a named service.');
    }
  }

  private async tell(customer: CustomerWithStore, row: P2pPaymentMethod) {
    const what = `${row.label} ${row.hint} (${row.currency})`;
    await this.email
      .sendFor('afrippa', paymentMethodAddedEmail(customer.email, what, row.usableFrom))
      .catch((error: unknown) => this.logger.error({ err: error }, 'Could not send the payment method notice'));
    await this.inbox.customer({ customerId: customer.id, storeId: customer.storeId }, 'customer.security.payment_method_added', {
      subject: `payment_method:${row.id}`,
      title: 'Payment method added',
      body: `${what} was added to your account. It can be used from ${row.usableFrom.toUTCString()}. If this was not you, remove it and change your password.`,
      link: '/account/payment-methods',
      mode: row.mode,
    });
  }

  private key() {
    if (!this.config.ENCRYPTION_KEY) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'api_error', 'encryption_not_configured', 'Payment methods are not available yet.');
    return this.config.ENCRYPTION_KEY;
  }

  private encryption() {
    return new Encryption(this.key());
  }
}

function labelOf(details: PaymentDetails) {
  if (details.kind === 'bank') return details.bank_name;
  if (details.kind === 'mobile_money') return details.network;
  return namedProviders[details.provider];
}

/** What lists show: the last four digits, or the start of a handle. */
function hintOf(details: PaymentDetails) {
  if (details.kind === 'bank') return `•••• ${details.account_number.slice(-4)}`;
  if (details.kind === 'mobile_money') return `•••• ${details.phone.slice(-4)}`;
  return `${details.handle.slice(0, 2)}•••`;
}
