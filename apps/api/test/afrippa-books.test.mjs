// Afrippa's own books (docs/CRYPTO_SPINOFF_PLAN.md, step 2 item 7): every ledger account and entry is in one product's
// books. Coins, P2P fiat locks, Afrippa's traders and its operator account are Afrippa's; an entry is Afrippa's when any
// of its accounts is. BitoCard's integrity check, overview and P&L read only BitoCard's books, and Afrippa's admins read
// Afrippa's alone.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { adminClient, afrippaAdminClient, startApp } from './helpers.mjs';

const { afrippaOperatorId, afrippaStoreId } = await import('../dist/afrippa/ids.js');
const { houseStoreId } = await import('../dist/checkout/house-ids.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { LedgerService } = await import('../dist/ledger/ledger.service.js');

let server;
let prisma;
let ledger;
let bitocardAdmin;
let afrippaAdmin;
let trader;
let shopper;
let reseller;
let counter = 0;
const ref = name => `afrippa_books_test:${name}:${(counter += 1)}`;
const platformOf = async reference => (await prisma.journalEntry.findUniqueOrThrow({ where: { reference } })).platform;
const accountPlatform = (where) => prisma.ledgerAccount.findFirstOrThrow({ where }).then(account => account.platform);

before(async () => {
  server = await startApp();
  prisma = server.app.get(PrismaService);
  ledger = server.app.get(LedgerService);
  bitocardAdmin = await adminClient(server, ['finance']);
  afrippaAdmin = await afrippaAdminClient(server, ['finance']);
  trader = await prisma.customer.create({ data: { storeId: afrippaStoreId, email: `trader-${Date.now()}@example.com`, name: 'Ada Trader' } });
  shopper = await prisma.customer.create({ data: { storeId: houseStoreId, email: `shopper-${Date.now()}@example.com`, name: 'Bola Shopper' } });
  reseller = await prisma.reseller.create({ data: { name: 'Books Test Reseller', country: 'NG', status: 'active' } });
});

after(async () => {
  await server?.close();
});

describe("Afrippa's books", () => {
  test('coins are always Afrippa\'s, whoever holds them', async () => {
    const reference = ref('coin');
    await ledger.post({
      mode: 'test',
      type: 'crypto_test_deposit',
      reference,
      description: 'Test coins',
      lines: [
        { account: { kind: 'crypto_custody', currency: 'USDT' }, debit: 5_000_000n },
        // Even a bitocard.com customer's coins.
        { account: { kind: 'crypto_wallet', currency: 'USDT', customerId: shopper.id }, credit: 5_000_000n },
      ],
    });
    assert.equal(await platformOf(reference), 'afrippa');
    assert.equal(await accountPlatform({ kind: 'crypto_custody', currency: 'USDT', mode: 'test' }), 'afrippa');
    assert.equal(await accountPlatform({ kind: 'crypto_wallet', currency: 'USDT', customerId: shopper.id }), 'afrippa');
    // A platform account in a coin (a seized freeze's counterpart) is Afrippa's by its currency.
    const seized = ref('seized');
    await ledger.post({
      mode: 'test',
      type: 'crypto_seizure',
      reference: seized,
      description: 'Seized coins',
      lines: [
        { account: { kind: 'crypto_wallet', currency: 'USDT', customerId: shopper.id }, debit: 1_000_000n },
        { account: { kind: 'adjustments', currency: 'USDT' }, credit: 1_000_000n },
      ],
    });
    assert.equal(await accountPlatform({ kind: 'adjustments', currency: 'USDT', mode: 'test' }), 'afrippa');
  });

  test("Afrippa's traders and operator account are Afrippa's; BitoCard's money stays BitoCard's", async () => {
    const traderFunds = ref('trader');
    await ledger.post({
      mode: 'live',
      type: 'adjustment',
      reference: traderFunds,
      description: 'Trader fiat (a retired path)',
      lines: [
        { account: { kind: 'adjustments', currency: 'NGN' }, debit: 1000n },
        { account: { kind: 'customer_wallet', currency: 'NGN', customerId: trader.id }, credit: 1000n },
      ],
    });
    assert.equal(await accountPlatform({ kind: 'customer_wallet', customerId: trader.id }), 'afrippa');
    assert.equal(await platformOf(traderFunds), 'afrippa', 'an entry touching Afrippa is in its books');
    assert.equal(await accountPlatform({ kind: 'adjustments', currency: 'NGN', mode: 'live' }), 'bitocard');

    const shopperFunds = ref('shopper');
    await ledger.post({
      mode: 'live',
      type: 'adjustment',
      reference: shopperFunds,
      description: 'Shopper wallet',
      lines: [
        { account: { kind: 'adjustments', currency: 'NGN' }, debit: 500n },
        { account: { kind: 'customer_wallet', currency: 'NGN', customerId: shopper.id }, credit: 500n },
      ],
    });
    assert.equal(await platformOf(shopperFunds), 'bitocard');
    assert.equal(await accountPlatform({ kind: 'customer_wallet', currency: 'NGN', customerId: shopper.id }), 'bitocard');

    const operator = ref('operator');
    await ledger.post({
      mode: 'test',
      type: 'top_up',
      reference: operator,
      description: 'Operator funding',
      lines: [
        { account: { kind: 'provider_balance', currency: 'NGN', provider: 'manual' }, debit: 300n },
        { account: { kind: 'reseller_funding', currency: 'NGN', resellerId: afrippaOperatorId }, credit: 300n },
      ],
    });
    assert.equal(await accountPlatform({ kind: 'reseller_funding', resellerId: afrippaOperatorId }), 'afrippa');
    assert.equal(await platformOf(operator), 'afrippa');
  });

  test('an entry built from account ids takes its books from its accounts', async () => {
    const prepared = await ledger.prepare({
      mode: 'test',
      type: 'p2p_trade',
      reference: ref('manual'),
      description: 'Built by hand',
      lines: [
        { account: { kind: 'crypto_wallet', currency: 'USDT', customerId: shopper.id }, debit: 100n },
        { account: { kind: 'crypto_locked', currency: 'USDT', customerId: trader.id }, credit: 100n },
      ],
    });
    assert.equal(prepared.platform, 'afrippa');
    const byHand = { ...prepared };
    delete byHand.platform;
    // Seed the lock first so the posting can take from it.
    await ledger.post({
      mode: 'test',
      type: 'crypto_test_deposit',
      reference: ref('lock'),
      description: 'Lock',
      lines: [
        { account: { kind: 'crypto_custody', currency: 'USDT' }, debit: 100n },
        { account: { kind: 'crypto_locked', currency: 'USDT', customerId: trader.id }, credit: 100n },
      ],
    });
    const written = await prisma.$transaction(tx => ledger.write(tx, byHand));
    assert.equal(written.platform, 'afrippa');
  });

  test("each product's integrity check covers its own books only", async () => {
    const bitocard = await bitocardAdmin.get('/v1/admin/ledger/check');
    assert.equal(bitocard.status, 200, JSON.stringify(bitocard.json));
    assert.deepEqual([bitocard.json.platform, bitocard.json.ok], ['bitocard', true]);
    assert.equal(bitocard.json.accounts_checked, await prisma.ledgerAccount.count({ where: { platform: 'bitocard' } }));

    const afrippa = await afrippaAdmin.get('/v1/afrippa/admin/books/check');
    assert.equal(afrippa.status, 200, JSON.stringify(afrippa.json));
    assert.deepEqual([afrippa.json.platform, afrippa.json.ok], ['afrippa', true]);
    assert.equal(afrippa.json.accounts_checked, await prisma.ledgerAccount.count({ where: { platform: 'afrippa' } }));

    // Neither product's admins reach the other's.
    assert.equal((await bitocardAdmin.get('/v1/afrippa/admin/books/check')).status, 401);
    assert.equal((await afrippaAdmin.get('/v1/admin/ledger/check')).status, 401);
  });

  test("Afrippa's books: balances, the period's movements and a trial balance per currency", async () => {
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 3_600_000).toISOString();
    const books = await afrippaAdmin.get(`/v1/afrippa/admin/books?mode=test&from=${from}&to=${to}`);
    assert.equal(books.status, 200, JSON.stringify(books.json));
    const custody = books.json.coins.find(line => line.kind === 'crypto_custody' && line.currency === 'USDT');
    assert.equal(custody.balance, '5.000100', 'coins as decimal strings in the coin');
    assert.equal(custody.debits, '5.000100');
    const usdt = books.json.trial_balance.find(line => line.currency === 'USDT');
    assert.deepEqual(usdt, { currency: 'USDT', holds: '5.000100', owes: '5.000100', balanced: true });
    const funding = books.json.money.find(line => line.kind === 'reseller_funding' && line.currency === 'NGN');
    assert.equal(funding.balance, 300, 'money in minor units');
    assert.equal(books.json.money.some(line => line.kind === 'customer_wallet'), false, "the live trader's money is not in the sandbox's books");

    for (const query of ['', '?mode=test', `?mode=demo&from=${from}&to=${to}`]) {
      assert.equal((await afrippaAdmin.get(`/v1/afrippa/admin/books${query}`)).status, 400, query);
    }
    const support = await afrippaAdminClient(server, ['support']);
    assert.equal((await support.get(`/v1/afrippa/admin/books?mode=test&from=${from}&to=${to}`)).status, 403);
  });

  test("BitoCard's overview and P&L leave Afrippa's books out", async () => {
    const floatOf = async () => (await bitocardAdmin.get('/v1/admin/overview?days=7&mode=test')).json.wallet_float.find(item => item.currency === 'NGN')?.amount ?? 0;
    const before = await floatOf();
    await ledger.post({
      mode: 'test',
      type: 'top_up',
      reference: ref('reseller'),
      description: 'Reseller funding',
      lines: [
        { account: { kind: 'provider_balance', currency: 'NGN', provider: 'manual' }, debit: 100n },
        { account: { kind: 'reseller_funding', currency: 'NGN', resellerId: reseller.id }, credit: 100n },
      ],
    });
    await ledger.post({
      mode: 'test',
      type: 'top_up',
      reference: ref('operator-again'),
      description: 'Operator funding',
      lines: [
        { account: { kind: 'provider_balance', currency: 'NGN', provider: 'manual' }, debit: 777n },
        { account: { kind: 'reseller_funding', currency: 'NGN', resellerId: afrippaOperatorId }, credit: 777n },
      ],
    });
    assert.equal((await floatOf()) - before, 100, "only BitoCard's reseller's funding counts");

    // A revenue account in Afrippa's books (none exists today; the report must never pick one up).
    const account = await prisma.ledgerAccount.create({ data: { kind: 'platform_revenue', mode: 'live', currency: 'GHS', ownerKey: 'platform:afrippa-books-test', nonNegative: false, platform: 'afrippa' } });
    const other = await prisma.ledgerAccount.create({ data: { kind: 'adjustments', mode: 'live', currency: 'GHS', ownerKey: 'platform:afrippa-books-test', nonNegative: false, platform: 'afrippa' } });
    await prisma.journalEntry.create({
      data: {
        mode: 'live',
        type: 'test',
        reference: ref('revenue'),
        description: "Afrippa's revenue",
        platform: 'afrippa',
        postings: { create: [{ accountId: account.id, amountMinor: -9900n }, { accountId: other.id, amountMinor: 9900n }] },
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    const pnl = await bitocardAdmin.get(`/v1/admin/reports/pnl?mode=live&from=${day}&to=${day}&currency=GHS`);
    assert.equal(pnl.status, 200, JSON.stringify(pnl.json));
    assert.equal(pnl.json.revenue, 0);
  });
});
