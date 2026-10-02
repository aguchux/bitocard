// Local stand-ins for the payment and exchange-rate providers, with just enough behaviour for the tests.
// Each keeps its state in plain objects the tests can inspect and change.
import { fakeService } from './helpers.mjs';

const flwOk = data => ({ body: { status: 'success', message: 'ok', data } });
const flwError = (status, message) => ({ status, body: { status: 'error', message, data: null } });

/**
 * Flutterwave v3. `state.charges` maps tx_ref to a charge ({ id, status, amount, currency, app_fee });
 * `state.transfers` maps transfer ID to a transfer; `state.rates` maps currency to units per USD.
 * Set `state.fail` to make a path fail: { '/virtual-account-numbers': 500 }.
 */
export async function fakeFlutterwave() {
  const state = { charges: {}, transfers: {}, rates: {}, fail: {}, nextId: 1000, accounts: { '0123456789': 'ADA OBI DIGITAL' } };
  const service = await fakeService(({ method, url, body }) => {
    const path = url.split('?')[0];
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    const failure = Object.entries(state.fail).find(([prefix]) => path.startsWith(prefix));
    if (failure) return flwError(failure[1], 'Simulated failure');

    if (method === 'POST' && path === '/payments') return flwOk({ link: `https://checkout.flutterwave.test/pay/${body.tx_ref}` });
    if (method === 'GET' && path === '/transactions/verify_by_reference') {
      const charge = state.charges[query.get('tx_ref')];
      return charge ? flwOk({ tx_ref: query.get('tx_ref'), ...charge }) : flwError(400, 'No transaction was found for this id');
    }
    const verify = /^\/transactions\/(\d+)\/verify$/.exec(path);
    if (method === 'GET' && verify) {
      const entry = Object.entries(state.charges).find(([, charge]) => String(charge.id) === verify[1]);
      return entry ? flwOk({ tx_ref: entry[0], ...entry[1] }) : flwError(404, 'Not found');
    }
    if (method === 'POST' && path === '/virtual-account-numbers') {
      if (body.currency === 'NGN' && !body.bvn) return flwError(400, 'BVN is required');
      return flwOk({ account_number: `78${String((state.nextId += 1)).padStart(8, '0')}`, bank_name: 'Wema Bank' });
    }
    if (method === 'GET' && path === '/transfers/rates') {
      const rate = state.rates[query.get('source_currency')];
      return rate ? flwOk({ rate, source: { currency: query.get('source_currency'), amount: rate }, destination: { currency: 'USD', amount: 1 } }) : flwError(400, 'Unsupported');
    }
    if (method === 'GET' && path.startsWith('/banks/')) return flwOk([{ id: 1, code: '058', name: 'GTBank' }, { id: 2, code: '044', name: 'Access Bank' }]);
    if (method === 'POST' && path === '/accounts/resolve') {
      const name = state.accounts[body.account_number];
      return name ? flwOk({ account_number: body.account_number, account_name: name }) : flwError(400, 'Sorry, recipient account could not be validated');
    }
    if (method === 'POST' && path === '/transfers') {
      const id = (state.nextId += 1);
      state.transfers[id] = { id, status: 'NEW', fee: 10.75, reference: body.reference, amount: body.amount, account_number: body.account_number };
      return flwOk(state.transfers[id]);
    }
    const transfer = /^\/transfers\/(\d+)$/.exec(path);
    if (method === 'GET' && transfer) return state.transfers[transfer[1]] ? flwOk(state.transfers[transfer[1]]) : flwError(404, 'Not found');
    return { status: 404, body: { status: 'error', message: `Fake Flutterwave has no ${method} ${path}` } };
  });
  return { ...service, state, env: { FLUTTERWAVE_SECRET_KEY: 'FLWSECK_TEST-fake', FLUTTERWAVE_API_URL: service.url, FLUTTERWAVE_WEBHOOK_HASH: 'flw-webhook-hash' } };
}

/** Monnify. `state.transactions` maps transactionReference to a transaction. Set `state.down` to fail everything. */
export async function fakeMonnify() {
  const state = { transactions: {}, down: false, nextAccount: 5000 };
  const ok = responseBody => ({ body: { requestSuccessful: true, responseMessage: 'success', responseBody } });
  const service = await fakeService(({ method, url, body }) => {
    if (state.down) return { status: 503, body: { requestSuccessful: false, responseMessage: 'Unavailable' } };
    const path = url.split('?')[0];
    if (method === 'POST' && path === '/api/v1/auth/login') return ok({ accessToken: 'monnify-token', expiresIn: 3600 });
    if (method === 'POST' && path === '/api/v2/bank-transfer/reserved-accounts') {
      return ok({
        accountReference: body.accountReference,
        accounts: [{ bankName: 'Moniepoint MFB', accountNumber: `60${String((state.nextAccount += 1)).padStart(8, '0')}`, accountName: body.accountName }],
      });
    }
    const tx = /^\/api\/v2\/transactions\/(.+)$/.exec(path);
    if (method === 'GET' && tx) {
      const found = state.transactions[decodeURIComponent(tx[1])];
      return found ? ok(found) : { status: 404, body: { requestSuccessful: false, responseMessage: 'Not found' } };
    }
    return { status: 404, body: { requestSuccessful: false, responseMessage: `Fake Monnify has no ${method} ${path}` } };
  });
  return { ...service, state, env: { MONNIFY_API_KEY: 'MK_TEST_fake', MONNIFY_SECRET_KEY: 'monnify-secret', MONNIFY_CONTRACT_CODE: '1234567890', MONNIFY_API_URL: service.url } };
}

/** Open Exchange Rates latest.json. `state.rates` maps currency to units per USD. */
export async function fakeOpenExchangeRates() {
  const state = { rates: {}, down: false };
  const service = await fakeService(({ url }) => {
    if (state.down) return { status: 503, body: { error: true } };
    if (!url.startsWith('/latest.json')) return { status: 404, body: {} };
    return { body: { base: 'USD', timestamp: Math.floor(Date.now() / 1000), rates: state.rates } };
  });
  return { ...service, state, env: { OPEN_EXCHANGE_RATES_APP_ID: 'oxr-test', OPEN_EXCHANGE_RATES_API_URL: service.url } };
}
