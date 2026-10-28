// Afrippa traders' saved payment methods (docs/CRYPTO_SPINOFF_PLAN.md, step 3 item 1): where buyers pay them directly.
// Details are encrypted and lists show only a hint; the holder is the trader's own verified name live (never typed);
// a new method is usable after 24 hours, and adding one emails the trader and leaves a security notice.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startApp } from './helpers.mjs';

const { signAfrippaRequest } = await import('../dist/afrippa/signature.js');
const { afrippaOperatorId, afrippaStoreId } = await import('../dist/afrippa/ids.js');
const { PaymentMethodsService } = await import('../dist/afrippa/payment-methods.service.js');
const { PrismaService } = await import('../dist/database/prisma.service.js');
const { EmailService } = await import('../dist/notifications/email.service.js');

const secret = 'afrippa-payments-secret-afrippa-payments-sec';
let server;
let prisma;
let counter = 0;

before(async () => {
  server = await startApp({ env: { CRYPTO_ROUTES: 'closed', AFRIPPA_SERVER_SECRET: secret } });
  prisma = server.app.get(PrismaService);
});

after(async () => {
  await server?.close();
});

/** Requests as Afrippa's server sends them: signed, with the trader's session. */
function afrippaServer(token = null) {
  const request = async (method, path, body, { signed = true } = {}) => {
    const raw = body === undefined ? undefined : JSON.stringify(body);
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(signed ? { 'afrippa-signature': signAfrippaRequest(secret, { method, url: path, body: raw }) } : {}),
        ...(raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `pm-${Date.now()}-${Math.random()}` } : {}),
      },
      body: raw,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body = {}, options) => request('POST', path, body, options),
    delete: (path, options) => request('DELETE', path, undefined, options),
  };
}

const outbox = () => server.app.get(EmailService).outbox;
const lastCodeTo = email => /\b(\d{6})\b/.exec(outbox().filter(item => item.to === email).at(-1).subject)[1];

/** A trader with two-step set up, signed in and with their email confirmed. */
async function trader({ twoStep = true } = {}) {
  const client = afrippaServer();
  const email = `pm-trader${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await client.post('/v1/afrippa/account/signup', { name: 'Ada Trader', email, password: 'correct horse battery', country: 'NG' });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await prisma.customer.update({ where: { id: signup.json.customer.id }, data: { emailVerifiedAt: new Date() } });
  if (twoStep) {
    await prisma.customerCode.updateMany({ where: { customer: { email } }, data: { createdAt: new Date(Date.now() - 120_000) } });
    assert.equal((await client.post('/v1/afrippa/account/two-step/setup', { method: 'email' })).status, 200);
    assert.equal((await client.post('/v1/afrippa/account/two-step/setup/confirm', { code: lastCodeTo(email) })).status, 200);
  }
  return { client, email, id: signup.json.customer.id };
}

const bank = { kind: 'bank', currency: 'NGN', bank_name: 'Example Bank', account_number: '0123 456-789' };
const path = '/v1/afrippa/p2p/payment-methods';

describe("Afrippa traders' payment methods", () => {
  test('a bank account is saved encrypted, shown as a hint, usable after 24 hours, and the trader is told', async () => {
    const ada = await trader();
    const added = await ada.client.post(path, bank);
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual(
      { kind: added.json.kind, currency: added.json.currency, label: added.json.label, hint: added.json.hint, holder: added.json.holder_name, usable: added.json.usable },
      { kind: 'bank', currency: 'NGN', label: 'Example Bank', hint: '•••• 6789', holder: 'Ada Trader', usable: false },
    );
    const wait = new Date(added.json.usable_from).getTime() - Date.now();
    assert.ok(wait > 23.9 * 3_600_000 && wait <= 24 * 3_600_000, 'usable after 24 hours');

    const list = await ada.client.get(path);
    assert.equal(list.status, 200);
    assert.equal(list.json.data.length, 1);
    assert.ok(list.json.named_providers.some(provider => provider.code === 'wise'));
    assert.equal(JSON.stringify(list.json).includes('0123456789'), false, 'the account number never leaves in a list');
    const row = await prisma.p2pPaymentMethod.findUniqueOrThrow({ where: { id: added.json.id } });
    assert.equal(row.detailsEncrypted.includes('0123456789'), false, 'encrypted at rest');
    assert.equal(row.mode, 'test', "Afrippa's store is in the sandbox until it is switched live");

    // Shown in full only for an order (step 3's orders).
    const details = await server.app.get(PaymentMethodsService).reveal(added.json.id);
    assert.deepEqual(details, { kind: 'bank', bank_name: 'Example Bank', bank_code: null, account_number: '0123456789', holder_name: 'Ada Trader', currency: 'NGN' });

    const mail = outbox().filter(item => item.to === ada.email).at(-1);
    assert.equal(mail.subject, 'A payment method was added to your Afrippa account');
    assert.equal(mail.from, 'afrippa:outbox');
    const notice = await prisma.notification.findFirst({ where: { customerId: ada.id, type: 'customer.security.payment_method_added' } });
    assert.ok(notice);

    // The same account again, however it is typed, is refused.
    const again = await ada.client.post(path, { ...bank, account_number: '0123456789' });
    assert.deepEqual([again.status, again.json.error.code], [409, 'payment_method_exists']);
  });

  test('mobile money wallets and named services, each checked', async () => {
    const ada = await trader();
    const wallet = await ada.client.post(path, { kind: 'mobile_money', currency: 'NGN', network: 'MTN MoMo', phone: '0803 123 4567' });
    assert.equal(wallet.status, 201, JSON.stringify(wallet.json));
    assert.deepEqual([wallet.json.label, wallet.json.hint], ['MTN MoMo', '•••• 4567']);
    assert.equal((await server.app.get(PaymentMethodsService).reveal(wallet.json.id)).phone, '+2348031234567');
    const wise = await ada.client.post(path, { kind: 'named', currency: 'GBP', provider: 'Wise', handle: 'ada@example.com' });
    assert.equal(wise.status, 201, JSON.stringify(wise.json));
    assert.deepEqual([wise.json.label, wise.json.hint, wise.json.currency], ['Wise', 'ad•••', 'GBP']);

    const refusals = [
      [{ ...bank, account_number: '12ab' }, 'account_number'],
      [{ ...bank, bank_name: ' ' }, 'bank_name'],
      [{ ...bank, currency: 'XYZ' }, 'currency'],
      [{ kind: 'mobile_money', currency: 'NGN', network: 'MTN', phone: '+44 7700 900123' }, 'phone'],
      [{ kind: 'named', currency: 'USD', provider: 'westernbank', handle: 'ada' }, 'provider'],
      [{ kind: 'named', currency: 'USD', provider: 'paypal', handle: 'a b' }, 'handle'],
    ];
    for (const [body, param] of refusals) {
      const refused = await ada.client.post(path, body);
      assert.equal(refused.status, 400, `${param}: ${JSON.stringify(refused.json)}`);
      assert.equal(refused.json.error.param, param);
    }
    // The holder is never typed.
    assert.equal((await ada.client.post(path, { ...bank, account_number: '5550001111', holder_name: 'Someone Else' })).status, 400);
  });

  test('at most ten, removed by their owner only', async () => {
    const ada = await trader();
    const ids = [];
    for (let index = 0; index < 10; index += 1) {
      const added = await ada.client.post(path, { ...bank, account_number: `100000000${index}` });
      assert.equal(added.status, 201, JSON.stringify(added.json));
      ids.push(added.json.id);
    }
    const eleventh = await ada.client.post(path, { ...bank, account_number: '2000000000' });
    assert.deepEqual([eleventh.status, eleventh.json.error.code], [409, 'too_many_payment_methods']);

    const bola = await trader();
    assert.equal((await bola.client.delete(`${path}/${ids[0]}`)).status, 404, "another trader's is not theirs to remove");
    assert.equal((await ada.client.delete(`${path}/${ids[0]}`)).status, 200);
    assert.equal((await ada.client.delete(`${path}/${ids[0]}`)).status, 404);
    assert.equal((await ada.client.get(path)).json.data.length, 9);
    assert.ok((await prisma.p2pPaymentMethod.findUniqueOrThrow({ where: { id: ids[0] } })).removedAt, 'kept for the orders that used it');
    // Removed, the same account can be saved again.
    assert.equal((await ada.client.post(path, { ...bank, account_number: '1000000000' })).status, 201);
  });

  test("live, the holder is the trader's verified name, and an unverified trader cannot add one", async () => {
    await prisma.store.update({ where: { id: afrippaStoreId }, data: { checkoutMode: 'live' } });
    try {
      const ada = await trader();
      const refused = await ada.client.post(path, bank);
      assert.deepEqual([refused.status, refused.json.error.code], [403, 'customer_verification_required']);
      await prisma.identityVerification.create({
        data: {
          subject: 'customer',
          resellerId: afrippaOperatorId,
          mode: 'live',
          customerReference: ada.id,
          method: 'document',
          provider: 'bitocard',
          providerReference: `pm-test-${ada.id}`,
          status: 'approved',
          country: 'NG',
          consentAt: new Date(),
          verifiedName: 'ADA CHIDINMA TRADER',
        },
      });
      const added = await ada.client.post(path, bank);
      assert.equal(added.status, 201, JSON.stringify(added.json));
      assert.equal(added.json.holder_name, 'ADA CHIDINMA TRADER');
    } finally {
      await prisma.store.update({ where: { id: afrippaStoreId }, data: { checkoutMode: 'test' } });
    }
  });

  test("only Afrippa's signed server, with a trader signed in and past two-step, reaches them", async () => {
    const ada = await trader();
    assert.equal((await ada.client.get(path, { signed: false })).status, 404);
    assert.equal((await afrippaServer().get(path)).status, 401);
    const pending = await trader({ twoStep: false });
    const refused = await pending.client.get(path);
    assert.deepEqual([refused.status, refused.json.error.code], [401, 'mfa_required']);
  });
});
