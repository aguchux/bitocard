import { eventObjectSchemas } from '../../webhooks/openapi.js';
import { array, bool, constant, int, list, listExample, mode, money, nullable, nullableInt, nullableStr, nullableTime, num, objectSchema, oneOf, ref, type Schema, shape, str, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

/**
 * Wallet, top-ups, reserved bank accounts, BitoCard fees, exchange rates, payouts and plans. Amounts are integer minor
 * units (kobo, pesewas, cents); fee rates are parts per billion. Top-ups and payouts reuse the webhook objects.
 */

const transactionTypes = [
  'top_up',
  'deposit',
  'hold',
  'hold_release',
  'hold_capture',
  'earnings',
  'earnings_release',
  'payout',
  'payout_reversal',
  'order_refund',
  'platform_fee',
  'platform_fee_refund',
  'adjustment',
  'allowance_granted',
  'allowance_revoked',
] as const;

const categories = ['gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'esim', 'software', 'virtual_numbers', 'virtual_cards', 'mobile_money'] as const;
const feeKinds = ['supplier_order', 'gateway_payment'] as const;
const planFeatures = ['chargeback_protection', 'priority_support', 'international_selling', 'own_integrations'] as const;

const currency = str('ISO 4217 currency of the amounts, your wallet currency (for example `NGN`, `GHS` or `KES`).');
const nano = (description: string) => str(`${description} In billionths of a minor unit, as a string of digits so no precision is lost.`, { pattern: '^\\d+$' });
const nullableNano = (description: string) => nullableStr(`${description} In billionths of a minor unit, as a string of digits.`, { pattern: '^\\d+$' });
const ratePpb = int('The rate in parts per billion of the base: 1 is 0.0000001%, 1,000,000 is 0.1%, 100,000,000 (the highest) is 10%.', { minimum: 0, maximum: 100_000_000 });
const ratePercent = str('The same rate as an exact percentage, for example `0.25`.', { pattern: '^\\d+(\\.\\d+)?$' });

// ---- Wallet

const startupAllowance = shape(
  {
    currency: constant('USD'),
    granted: int('The allowance granted, in US cents (50000 = US$500).'),
    remaining: int('What is left, in US cents.'),
    status: oneOf('`active` while some remains, `used` once spent, `revoked` when BitoCard took back what remained.', ['active', 'used', 'revoked']),
    granted_at: time('When it was granted.'),
    revoked_at: nullableTime('When it was revoked, if it was.'),
  },
  'The one-time startup allowance. It pays only the wholesale cost of customer-paid orders and is never cash: it is not part of `available` and cannot be withdrawn.',
);

const Wallet = objectSchema(
  'Wallet',
  {
    object: constant('wallet'),
    mode,
    currency,
    available: money('What you can spend on wholesale cost now: topped-up funds plus withdrawable earnings'),
    reserved: money('Held for orders still in progress'),
    earnings: shape(
      {
        withdrawable: money('Profit past the payout hold: can be withdrawn or spent (already included in `available`)'),
        on_hold: money('Profit still inside the payout hold'),
        next_release_at: nullableTime('When the next profit on hold becomes withdrawable; null when nothing is on hold.'),
      },
      'Your profit from sales.',
    ),
    payouts_in_progress: money('Withdrawals on their way to your bank'),
    minimum_withdrawal: money('The smallest withdrawal allowed in your country'),
    startup_allowance: nullable(startupAllowance),
  },
  'Your wallet in one mode. Live and sandbox wallets are separate; amounts are integer minor units of `currency`.',
);

const WalletTransaction = objectSchema(
  'WalletTransaction',
  {
    object: constant('wallet_transaction'),
    id: uuid('Transaction ID (a ledger entry).'),
    type: oneOf(
      'What happened: `top_up` (checkout payment), `deposit` (bank transfer into your reserved account), `hold` (wholesale cost held for an order, plan or fee), `hold_release` (a hold returned), `hold_capture` (a hold taken: order delivered or plan paid), `earnings` (sale profit, on hold), `earnings_release` (profit became withdrawable), `payout` (withdrawal set aside or paid), `payout_reversal` (failed withdrawal returned), `order_refund`, `platform_fee`, `platform_fee_refund`, `adjustment` (a correction by BitoCard), `allowance_granted` or `allowance_revoked` (the startup allowance).',
      transactionTypes,
    ),
    description: str('A plain description, for example `Wallet top-up` or `Order delivered: MTN Nigeria airtime`.'),
    currency: nullableStr('Currency of the changes below; `USD` for startup allowance entries. Null only if the entry touched none of your balances.'),
    amount: money('Change to `available` (negative when money left it)'),
    reserved_change: money('Change to `reserved`'),
    earnings_on_hold_change: money('Change to earnings on hold'),
    allowance_change: int('Change to the startup allowance, in US cents. Never part of `amount`.'),
    fee: {
      ...shape(
        {
          id: uuid('The fee charge (see `GET /v1/wallet/fees`).'),
          source: {
            ...shape({ type: oneOf('`order` or `payment`.', ['order', 'payment']), id: nullableStr('ID of the order or payment.') }),
            type: ['object', 'null'],
            description: 'What the fee was on.',
          },
        },
        'For `platform_fee`, `platform_fee_refund` and the hold returned before a fee: the BitoCard fee it belongs to. Null otherwise.',
      ),
      type: ['object', 'null'],
    },
    created_at: time('When it was posted.'),
  },
  'One movement of money in your wallet. Every movement is a balanced ledger entry and is never edited afterwards.',
);

// ---- Top-ups and reserved accounts

const ReservedAccount = objectSchema(
  'ReservedAccount',
  {
    object: constant('reserved_account'),
    id: uuid('Reserved account ID.'),
    mode,
    currency,
    bank_name: str('The bank holding the account.'),
    account_number: str('The account number to transfer to. It belongs to your wallet only.'),
    account_name: str('The account name payers see.'),
    created_at: time('When it was opened.'),
  },
  'A bank account reserved for your wallet: transfers into it top up the wallet once the bank confirms them.',
);

const SimulatedDeposit = objectSchema(
  'SimulatedDeposit',
  {
    object: constant('simulated_deposit'),
    credited: bool('Whether the wallet was credited (a `top_up.succeeded` event follows).'),
    amount: money('The simulated transfer'),
    currency,
  },
  'The result of a simulated bank transfer (sandbox only).',
);

// ---- Fees

const FeeCharge = objectSchema(
  'FeeCharge',
  {
    object: constant('fee_charge'),
    id: uuid('Fee charge ID.'),
    mode,
    kind: oneOf('`supplier_order` (an order through your own supplier) or `gateway_payment` (a payment through your own gateway).', feeKinds),
    status: oneOf('`held` (the most it can be is held from your wallet), `charged`, `released` (the transaction failed: nothing charged) or `refunded`.', ['held', 'charged', 'released', 'refunded']),
    currency,
    source: shape({ type: oneOf('`order` or `payment`.', ['order', 'payment']), id: str('ID of the order or payment.') }, 'What the fee is on.'),
    category: nullable(oneOf('Product category of the order; null for gateway payments.', categories)),
    rate_ppb: ratePpb,
    rate_percent: ratePercent,
    base: money('What the rate applies to (the order cost or face value, or the payment)'),
    min_fee: nullableInt('The minimum fee per transaction, in minor units of `currency`, if the rate has one.'),
    exact_nano: nano('The exact fee: `base` x `rate_ppb`, never rounded.'),
    held: money('Held from your wallet before the transaction: the exact fee rounded up, or the minimum fee'),
    charged: nullableInt('What was charged, in minor units of `currency`: whole units of the carried fraction plus the exact fee. Null until charged.'),
    carry_before_nano: nullableNano('Your carried fraction before this charge. Null until charged.'),
    carry_after_nano: nullableNano('The fraction left over after this charge, carried to your next fee (always below one minor unit). Null until charged.'),
    refund_reason: nullableStr('Why BitoCard refunded it.'),
    created_at: time('When the fee was held.'),
    settled_at: nullableTime('When it was charged or released.'),
  },
  'BitoCard’s fee on one transaction through your own integrations. Fees are exact: the part below one minor unit is carried to your next fee, never rounded up.',
);

const feeKindTotals = shape({
  kind: oneOf('Fee kind.', feeKinds),
  transactions: int('Fees charged.'),
  base: money('Total base of those fees'),
  charged: money('Charged'),
  refunded: money('Refunded'),
});

const FeeStatement = objectSchema(
  'FeeStatement',
  {
    object: constant('fee_statement'),
    month: str('The UTC month, `YYYY-MM`.', { pattern: '^\\d{4}-(0[1-9]|1[0-2])$' }),
    mode,
    currency,
    fees: shape(
      {
        transactions: int('Fees charged in the month (including those later refunded).'),
        charged: money('Total charged'),
        refunded: money('Total refunded'),
        net: money('Charged less refunded'),
        by_kind: array(feeKindTotals, 'The same totals per fee kind.'),
      },
      'BitoCard fees on your own-integration transactions.',
    ),
    subscription: money('Plan charges paid in the month'),
    total: money('Net fees plus plan charges'),
    carried_nano: nano('The fraction accrued but not yet charged, now (always below one minor unit).'),
  },
  'What BitoCard charged you in one month: fees and plan charges.',
);

const FeeRate = objectSchema(
  'FeeRate',
  {
    object: constant('fee_rate'),
    kind: oneOf('Fee kind.', feeKinds),
    category: nullable(oneOf('Product category; null for any category without its own rate (and always for gateway payments).', categories)),
    rate_ppb: ratePpb,
    rate_percent: ratePercent,
    min_fee: nullableInt('The minimum fee per transaction in minor units of your wallet currency, if any.'),
  },
  'A BitoCard fee rate that applies to you now, for your country and plan. Zero means no fee.',
);

// ---- Exchange rates

const decimal = (description: string) => nullableStr(`${description} A decimal string (up to 6 places); null when unavailable.`, { pattern: '^\\d+(\\.\\d+)?$' });

const ExchangeRate = objectSchema(
  'ExchangeRate',
  {
    object: constant('exchange_rate'),
    base: constant('USD'),
    currency: str('ISO 4217 currency.'),
    available: bool('False while conversions are paused (stale or disagreeing reference rates): quotes and plan charges needing this currency are refused.'),
    pay: decimal('Units of the currency charged per US dollar, margin included: used when you pay in this currency for a US dollar amount.'),
    receive: decimal('Units of the currency received per US dollar, margin deducted: used when US dollars are converted into this currency.'),
    margin_percent: num('BitoCard’s disclosed conversion margin, in percent.'),
    as_of: nullableTime('When the oldest rate used was fetched; null when unavailable.'),
  },
  'BitoCard’s rate between the US dollar and one currency.',
);

// ---- Banks, bank accounts and payouts

const Bank = objectSchema('Bank', { code: str('The code to send as `bank_code`.'), name: str('Bank or mobile money service name.') }, 'A bank you can be paid out to.');

const bankAccountFields: Record<string, Schema> = {
  object: constant('bank_account'),
  id: uuid('Bank account ID.'),
  mode,
  country: str('ISO 3166-1 alpha-2 country of the account.'),
  currency,
  bank_code: str('Bank code from the bank list.'),
  bank_name: str('Bank name.'),
  account_number_last4: str('Last four digits of the account number; the full number is never shown again.'),
  account_name: str('The account holder’s name, as the bank has it.'),
  payouts_available_from: time('When payouts to it can start: 24 hours after a live account is added; at once in the sandbox.'),
  created_at: time('When it was added.'),
};

const BankAccount = objectSchema('BankAccount', bankAccountFields, 'A bank account your earnings are paid out to. The bank confirms the account and supplies its name.');

const removedBankAccount = objectSchema(
  'Removed bank account',
  { ...bankAccountFields, removed: { type: 'boolean', const: true, description: 'Always `true`.' } },
  'The bank account, now removed.',
);

const payoutProperties = (eventObjectSchemas.Payout as { properties: Record<string, Schema> }).properties;
const PayoutDetail = objectSchema(
  'Payout with its bank account',
  {
    ...payoutProperties,
    status: oneOf('`pending` while it starts, `processing` while the bank transfer is on its way, then `paid` or `failed`.', ['pending', 'processing', 'paid', 'failed']),
    bank_account: shape(
      {
        bank_name: str('Bank name.'),
        account_number_last4: str('Last four digits of the account number.'),
        removed: bool('Whether the account has since been removed (the payout still names it).'),
      },
      'The account paid. Webhook payloads leave this out.',
    ),
  },
  'A withdrawal of your earnings to a bank account.',
);

// ---- Plans

const Plan = objectSchema(
  'Plan',
  {
    object: constant('plan'),
    code: str('Plan code, for example `standard` or `premium`.'),
    name: str('Plan name.'),
    price: shape(
      {
        amount: int('Monthly price in US cents (0 for Standard). Charged in your currency at the `pay` rate when billed.'),
        currency: constant('USD'),
        interval: constant('month'),
      },
      'The price.',
    ),
    features: array(oneOf('A plan feature.', planFeatures), 'What the plan adds: `chargeback_protection`, `priority_support`, `international_selling`, `own_integrations`.'),
  },
  'A reseller plan.',
);

const Subscription = objectSchema(
  'Subscription',
  {
    object: constant('subscription'),
    plan: ref('Plan'),
    renews_at: nullableTime('When the plan is next charged; null when it is not billed (Standard, or a plan set by BitoCard).'),
    cancel_at_period_end: bool('True when the plan ends at the end of the paid month instead of renewing.'),
    past_due_since: nullableTime('When a renewal failed for lack of funds; the plan stays on for a grace period of 7 days.'),
  },
  'Your current plan.',
);

// ---- Examples

const resellerTopUp = (overrides: Record<string, unknown> = {}) => ({
  object: 'top_up',
  id: '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d',
  mode: 'live',
  status: 'succeeded',
  source: 'checkout',
  amount: 5_000_000,
  currency: 'NGN',
  checkout_url: null,
  failure_reason: null,
  created_at: '2026-10-06T08:00:00.000Z',
  completed_at: '2026-10-06T08:01:12.000Z',
  ...overrides,
});

const pendingTopUp = resellerTopUp({
  id: '1f2e3d4c-5b6a-4987-8a6b-5c4d3e2f1a0b',
  status: 'pending',
  checkout_url: 'https://checkout.flutterwave.com/v3/hosted/pay/bc7f2a91d0e4',
  created_at: '2026-10-06T10:42:05.318Z',
  completed_at: null,
});

const wallet = {
  object: 'wallet',
  mode: 'live',
  currency: 'NGN',
  available: 12_450_000,
  reserved: 97_000,
  earnings: { withdrawable: 2_300_000, on_hold: 415_000, next_release_at: '2026-10-21T09:15:04.870Z' },
  payouts_in_progress: 0,
  minimum_withdrawal: 1_500_000,
  startup_allowance: { currency: 'USD', granted: 50_000, remaining: 41_250, status: 'active', granted_at: '2026-10-01T12:00:00.000Z', revoked_at: null },
};

const transaction = (overrides: Record<string, unknown>) => ({
  object: 'wallet_transaction',
  currency: 'NGN',
  amount: 0,
  reserved_change: 0,
  earnings_on_hold_change: 0,
  allowance_change: 0,
  fee: null,
  ...overrides,
});

const transactions = [
  transaction({ id: '6b1d2c3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e', type: 'platform_fee', description: 'BitoCard fee: order through your own supplier', amount: -3_087, fee: { id: 'e4d3c2b1-a0f9-4e8d-b7c6-a5b4c3d2e1f0', source: { type: 'order', id: '2c7a9e14-5b3d-4f6a-8e1c-0d9b7a5f3e21' } }, created_at: '2026-10-06T09:20:11.402Z' }),
  transaction({ id: 'a7f3e2d1-c0b9-4a8f-9e7d-6c5b4a3f2e1d', type: 'hold', description: 'Order: MTN Nigeria airtime', amount: -97_000, reserved_change: 97_000, created_at: '2026-10-06T09:15:02.250Z' }),
  transaction({ id: '0e9d8c7b-6a5f-4e4d-8c3b-2a1f0e9d8c7b', type: 'top_up', description: 'Wallet top-up', amount: 5_000_000, created_at: '2026-10-06T08:01:12.000Z' }),
];

const reservedAccount = {
  object: 'reserved_account',
  id: 'd2c1b0a9-f8e7-4d6c-b5a4-c3b2a1f0e9d8',
  mode: 'live',
  currency: 'NGN',
  bank_name: 'Wema Bank',
  account_number: '7824019356',
  account_name: 'Ada Digital Ventures',
  created_at: '2026-10-02T14:30:00.000Z',
};

const feeCharge = {
  object: 'fee_charge',
  id: 'e4d3c2b1-a0f9-4e8d-b7c6-a5b4c3d2e1f0',
  mode: 'live',
  kind: 'supplier_order',
  status: 'charged',
  currency: 'NGN',
  source: { type: 'order', id: '2c7a9e14-5b3d-4f6a-8e1c-0d9b7a5f3e21' },
  category: 'gift_cards',
  rate_ppb: 2_500_000,
  rate_percent: '0.25',
  base: 1_234_567,
  min_fee: null,
  exact_nano: '3086417500000',
  held: 3_087,
  charged: 3_087,
  carry_before_nano: '700000000',
  carry_after_nano: '117500000',
  refund_reason: null,
  created_at: '2026-10-06T09:20:09.118Z',
  settled_at: '2026-10-06T09:20:11.402Z',
};

const feeRates = [
  { object: 'fee_rate', kind: 'supplier_order', category: null, rate_ppb: 2_500_000, rate_percent: '0.25', min_fee: null },
  { object: 'fee_rate', kind: 'supplier_order', category: 'gift_cards', rate_ppb: 5_000_000, rate_percent: '0.5', min_fee: 5_000 },
  { object: 'fee_rate', kind: 'supplier_order', category: 'airtime', rate_ppb: 1_000_000, rate_percent: '0.1', min_fee: null },
  { object: 'fee_rate', kind: 'gateway_payment', category: null, rate_ppb: 150_000, rate_percent: '0.015', min_fee: null },
];

const bankAccount = {
  object: 'bank_account',
  id: '7e6d5c4b-3a2f-4e1d-9c0b-8a7f6e5d4c3b',
  mode: 'live',
  country: 'NG',
  currency: 'NGN',
  bank_code: '044',
  bank_name: 'Access Bank',
  account_number_last4: '4821',
  account_name: 'ADA DIGITAL VENTURES',
  payouts_available_from: '2026-10-04T11:20:00.000Z',
  created_at: '2026-10-03T11:20:00.000Z',
};

const payout = (overrides: Record<string, unknown> = {}) => ({
  object: 'payout',
  id: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
  mode: 'live',
  status: 'paid',
  amount: 2_500_000,
  currency: 'NGN',
  bank_account_id: '7e6d5c4b-3a2f-4e1d-9c0b-8a7f6e5d4c3b',
  bank_account: { bank_name: 'Access Bank', account_number_last4: '4821', removed: false },
  failure_reason: null,
  created_at: '2026-10-21T10:00:00.000Z',
  completed_at: '2026-10-21T10:02:30.000Z',
  ...overrides,
});

const standardPlan = { object: 'plan', code: 'standard', name: 'Standard', price: { amount: 0, currency: 'USD', interval: 'month' }, features: [] };
const premiumPlan = {
  object: 'plan',
  code: 'premium',
  name: 'Premium',
  price: { amount: 2_500, currency: 'USD', interval: 'month' },
  features: ['chargeback_protection', 'priority_support', 'international_selling', 'own_integrations'],
};

const subscription = { object: 'subscription', plan: premiumPlan, renews_at: '2026-11-06T09:00:00.000Z', cancel_at_period_end: false, past_due_since: null };

const noMore = (item: Schema) => list(item, {}, false);

export const moneyDocs: DocsArea = {
  schemas: { Wallet, WalletTransaction, ReservedAccount, SimulatedDeposit, FeeCharge, FeeStatement, FeeRate, ExchangeRate, Bank, BankAccount, PayoutDetail, Plan, Subscription },
  responses: {
    'GET /v1/wallet': { status: 200, description: 'Your wallet in the mode of the key or session.', schema: 'Wallet', example: wallet },
    'GET /v1/wallet/transactions': { status: 200, description: 'Wallet transactions, newest first.', schema: list(ref('WalletTransaction')), example: listExample(transactions, true) },
    'POST /v1/wallet/top-ups': {
      status: 201,
      description: 'The top-up, `pending` with a `checkout_url` to send the payer to. The wallet is credited when the payment is confirmed (`top_up.succeeded`).',
      schema: 'TopUp',
      example: pendingTopUp,
    },
    'GET /v1/wallet/top-ups': {
      status: 200,
      description: 'Checkout top-ups and bank transfers into your reserved accounts, newest first.',
      schema: list(ref('TopUp')),
      example: listExample([pendingTopUp, resellerTopUp({ id: '8c7b6a5f-4e3d-4c2b-9a1f-0e9d8c7b6a5f', source: 'bank_transfer', amount: 2_000_000, created_at: '2026-10-05T16:22:40.000Z', completed_at: '2026-10-05T16:22:40.000Z' }), resellerTopUp()]),
    },
    'GET /v1/wallet/top-ups/{id}': { status: 200, description: 'The top-up. A pending live top-up is checked with the payment provider first.', schema: 'TopUp', example: resellerTopUp() },
    'POST /v1/wallet/top-ups/{id}/simulate': {
      status: 200,
      description: 'The sandbox top-up with its simulated outcome.',
      schema: 'TopUp',
      example: resellerTopUp({ id: '1f2e3d4c-5b6a-4987-8a6b-5c4d3e2f1a0b', mode: 'test', checkout_url: null, created_at: '2026-10-06T10:42:05.318Z', completed_at: '2026-10-06T10:43:20.004Z' }),
    },
    'GET /v1/wallet/reserved-accounts': { status: 200, description: 'Your reserved bank accounts in this mode (none until created).', schema: noMore(ref('ReservedAccount')), example: { object: 'list', data: [reservedAccount] } },
    'POST /v1/wallet/reserved-accounts': {
      status: 201,
      description: 'Your reserved bank accounts: newly opened, or the existing ones if you already have them.',
      schema: noMore(ref('ReservedAccount')),
      example: { object: 'list', data: [reservedAccount] },
    },
    'POST /v1/wallet/reserved-accounts/{id}/simulate-deposit': {
      status: 200,
      description: 'Whether the simulated transfer was credited to your sandbox wallet.',
      schema: 'SimulatedDeposit',
      example: { object: 'simulated_deposit', credited: true, amount: 70_000_00, currency: 'NGN' },
    },
    'GET /v1/wallet/fees': { status: 200, description: 'BitoCard fees on your own-integration transactions, newest first.', schema: list(ref('FeeCharge')), example: listExample([feeCharge]) },
    'GET /v1/wallet/fees/statement': {
      status: 200,
      description: 'Your statement for the month.',
      schema: 'FeeStatement',
      example: {
        object: 'fee_statement',
        month: '2026-10',
        mode: 'live',
        currency: 'NGN',
        fees: {
          transactions: 42,
          charged: 186_420,
          refunded: 3_087,
          net: 183_333,
          by_kind: [
            { kind: 'supplier_order', transactions: 38, base: 61_480_000, charged: 165_870, refunded: 3_087 },
            { kind: 'gateway_payment', transactions: 4, base: 13_700_000, charged: 20_550, refunded: 0 },
          ],
        },
        subscription: 3_806_250,
        total: 3_989_583,
        carried_nano: '117500000',
      },
    },
    'GET /v1/wallet/fee-rates': { status: 200, description: 'Your rates per fee kind and category.', schema: noMore(ref('FeeRate')), example: { object: 'list', data: feeRates } },
    'GET /v1/exchange-rates': {
      status: 200,
      description: 'BitoCard’s rate for each currency against the US dollar.',
      schema: noMore(ref('ExchangeRate')),
      example: {
        object: 'list',
        data: [
          { object: 'exchange_rate', base: 'USD', currency: 'GHS', available: true, pay: '15.986', receive: '15.4555', margin_percent: 1.5, as_of: '2026-10-06T09:00:00.000Z' },
          { object: 'exchange_rate', base: 'USD', currency: 'KES', available: false, pay: null, receive: null, margin_percent: 1.5, as_of: null },
          { object: 'exchange_rate', base: 'USD', currency: 'NGN', available: true, pay: '1522.5', receive: '1477.5', margin_percent: 1.5, as_of: '2026-10-06T09:00:00.000Z' },
        ],
      },
    },
    'GET /v1/banks': {
      status: 200,
      description: 'Banks and mobile money services in your country.',
      schema: noMore(ref('Bank')),
      example: {
        object: 'list',
        data: [
          { code: '044', name: 'Access Bank' },
          { code: '058', name: 'Guaranty Trust Bank' },
          { code: '057', name: 'Zenith Bank' },
          { code: '50515', name: 'Moniepoint MFB' },
        ],
      },
    },
    'GET /v1/bank-accounts': { status: 200, description: 'Your payout bank accounts in this mode (at most 5).', schema: noMore(ref('BankAccount')), example: { object: 'list', data: [bankAccount] } },
    'POST /v1/bank-accounts': { status: 201, description: 'The added bank account, with the name the bank holds for it.', schema: 'BankAccount', example: bankAccount },
    'DELETE /v1/bank-accounts/{id}': { status: 200, description: 'The removed bank account. Past payouts still name it.', schema: removedBankAccount, example: { ...bankAccount, removed: true } },
    'GET /v1/payouts': { status: 200, description: 'Your withdrawals, newest first.', schema: list(ref('PayoutDetail')), example: listExample([payout()]) },
    'POST /v1/payouts': {
      status: 201,
      description: 'The withdrawal: usually `processing` while the bank transfer is on its way (`payout.paid` or `payout.failed` follows). The amount has moved from withdrawable earnings to payouts in progress.',
      schema: 'PayoutDetail',
      example: payout({ status: 'processing', completed_at: null }),
    },
    'GET /v1/payouts/{id}': { status: 200, description: 'The withdrawal.', schema: 'PayoutDetail', example: payout() },
    'POST /v1/payouts/{id}/simulate': {
      status: 200,
      description: 'The sandbox withdrawal with its simulated outcome.',
      schema: 'PayoutDetail',
      example: payout({ mode: 'test', status: 'failed', failure_reason: 'Simulated failure.' }),
    },
    'GET /v1/plans': { status: 200, description: 'The reseller plans, cheapest first.', schema: noMore(ref('Plan')), example: { object: 'list', data: [standardPlan, premiumPlan] } },
    'GET /v1/subscription': { status: 200, description: 'Your current plan.', schema: 'Subscription', example: subscription },
    'POST /v1/subscription': { status: 200, description: 'Your plan after the change.', schema: 'Subscription', example: subscription },
  },
};
