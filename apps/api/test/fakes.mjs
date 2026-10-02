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

/**
 * Reloadly: OAuth tokens, gift card products and operators by country. `state.giftCards` and `state.operators`
 * (by country) hold what the catalogue returns; tests change them between syncs. Set `state.fail` to a path
 * prefix to make those calls fail.
 */
export async function fakeReloadly() {
  const state = {
    giftCards: [
      {
        productId: 1,
        productName: 'Amazon US',
        denominationType: 'FIXED',
        discountPercentage: 2,
        senderFee: 0.5,
        senderCurrencyCode: 'USD',
        recipientCurrencyCode: 'USD',
        fixedRecipientDenominations: [10, 25, 50],
        fixedSenderDenominations: [10.3, 25.75, 51.5],
        brand: { brandName: 'Amazon' },
        country: { isoName: 'US' },
        logoUrls: ['https://cdn.example/amazon.png'],
        redeemInstruction: { concise: 'Redeem at amazon.com/redeem' },
      },
      {
        productId: 2,
        productName: 'Steam Global',
        denominationType: 'RANGE',
        discountPercentage: 0,
        senderFee: 0,
        senderCurrencyCode: 'USD',
        recipientCurrencyCode: 'USD',
        minRecipientDenomination: 5,
        maxRecipientDenomination: 100,
        minSenderDenomination: 5,
        maxSenderDenomination: 100,
        brand: { brandName: 'Steam' },
        country: { isoName: 'US' },
      },
    ],
    operators: {
      NG: [
        {
          operatorId: 341,
          name: 'MTN Nigeria',
          bundle: false,
          data: false,
          denominationType: 'RANGE',
          senderCurrencyCode: 'NGN',
          destinationCurrencyCode: 'NGN',
          minAmount: 50,
          maxAmount: 50000,
          localMinAmount: 50,
          localMaxAmount: 50000,
          fx: { rate: 1 },
          localDiscount: 3,
          internationalDiscount: 0,
          country: { isoName: 'NG', name: 'Nigeria' },
        },
        {
          operatorId: 342,
          name: 'Airtel Nigeria',
          bundle: false,
          data: false,
          denominationType: 'RANGE',
          senderCurrencyCode: 'USD',
          destinationCurrencyCode: 'NGN',
          minAmount: 0.1,
          maxAmount: 30,
          localMinAmount: 100,
          localMaxAmount: 45000,
          fx: { rate: 1450 },
          localDiscount: 0,
          internationalDiscount: 4,
          country: { isoName: 'NG', name: 'Nigeria' },
        },
        {
          operatorId: 343,
          name: 'MTN Nigeria Data',
          bundle: true,
          data: true,
          denominationType: 'FIXED',
          senderCurrencyCode: 'NGN',
          destinationCurrencyCode: 'NGN',
          fixedAmounts: [500, 1000],
          localFixedAmounts: [500, 1000],
          fixedAmountsDescriptions: { '500.00': '1GB 1 day', '1000.00': '2.5GB 2 days' },
          fx: { rate: 1 },
          localDiscount: 2,
          country: { isoName: 'NG', name: 'Nigeria' },
        },
      ],
    },
  };
  /**
   * Orders: `state.orderReply` decides the reply ({ status: 'SUCCESSFUL' | 'PENDING' | 'FAILED' }, or { http: 500 }
   * for an unclear error, optionally with `recorded` set to the status the transaction really has).
   */
  state.transactions = {};
  state.orderReply = { status: 'SUCCESSFUL' };
  state.nextTransactionId = 70000;
  function placeOrder(kind, body) {
    const reply = state.orderReply;
    const transaction = { transactionId: (state.nextTransactionId += 1), customIdentifier: body.customIdentifier, quantity: body.quantity, kind, request: body };
    if (reply.http) {
      if (reply.recorded) state.transactions[transaction.transactionId] = { ...transaction, status: reply.recorded };
      return { status: reply.http, body: { message: 'Simulated error', errorCode: 'SIMULATED' } };
    }
    state.transactions[transaction.transactionId] = { ...transaction, status: reply.status };
    return { body: state.transactions[transaction.transactionId] };
  }
  const service = await fakeService(({ method, url, body }) => {
    const path = url.split('?')[0];
    if (state.fail && path.startsWith(state.fail)) return { status: 500, body: { message: 'Simulated outage' } };
    if (method === 'POST' && path === '/oauth/token') {
      if (body.client_id !== 'reloadly-id' || body.client_secret !== 'reloadly-secret') return { status: 401, body: { message: 'Invalid credentials' } };
      return { body: { access_token: `token-for-${body.audience}`, expires_in: 3600, token_type: 'Bearer' } };
    }
    if (method === 'GET' && path === '/giftcards/products') return { body: { content: state.giftCards, totalPages: 1 } };
    if (method === 'POST' && (path === '/giftcards/orders' || path === '/topups/topups')) return placeOrder(path.startsWith('/giftcards') ? 'giftcard' : 'topup', body);
    const cards = /^\/giftcards\/orders\/transactions\/(\d+)\/cards$/.exec(path);
    if (method === 'GET' && cards) {
      const tx = state.transactions[cards[1]];
      if (!tx || state.cardsDown) return { status: 503, body: { message: 'Unavailable' } };
      return { body: Array.from({ length: tx.quantity ?? 1 }, (_, i) => ({ cardNumber: `AMZ-${tx.transactionId}-${i}`, pinCode: `${4000 + i}` })) };
    }
    const report = /^\/giftcards\/reports\/transactions\/(\d+)$/.exec(path);
    if (method === 'GET' && report) return state.transactions[report[1]] ? { body: state.transactions[report[1]] } : { status: 404, body: { message: 'Not found' } };
    const topupStatus = /^\/topups\/topups\/(\d+)\/status$/.exec(path);
    if (method === 'GET' && topupStatus) {
      const tx = state.transactions[topupStatus[1]];
      return tx ? { body: { status: tx.status, transaction: tx } } : { status: 404, body: { message: 'Not found' } };
    }
    if (method === 'GET' && (path === '/giftcards/reports/transactions' || path === '/topups/topups/reports/transactions')) {
      const reference = new URLSearchParams(url.split('?')[1] ?? '').get('customIdentifier');
      return { body: { content: Object.values(state.transactions).filter(tx => tx.customIdentifier === reference) } };
    }
    const operators = /^\/topups\/operators\/countries\/([A-Z]{2})$/.exec(path);
    if (method === 'GET' && operators) return { body: state.operators[operators[1]] ?? [] };
    return { status: 404, body: { message: `Fake Reloadly has no ${method} ${path}` } };
  });
  return {
    ...service,
    state,
    env: {
      RELOADLY_CLIENT_ID: 'reloadly-id',
      RELOADLY_CLIENT_SECRET: 'reloadly-secret',
      RELOADLY_AUTH_URL: service.url,
      RELOADLY_GIFTCARDS_URL: `${service.url}/giftcards`,
      RELOADLY_TOPUPS_URL: `${service.url}/topups`,
    },
  };
}

/** VTpass: service variations and smartcard or meter checks. `state.accounts` maps numbers to customers. */
export async function fakeVtpass() {
  const state = {
    variations: {
      dstv: { ServiceName: 'DSTV Subscription', variations: [{ variation_code: 'dstv-padi', name: 'DStv Padi N3,600', variation_amount: '3600.00', fixedPrice: 'Yes' }, { variation_code: 'dstv-yanga', name: 'DStv Yanga N5,100', variation_amount: '5100.00', fixedPrice: 'Yes' }] },
      gotv: { ServiceName: 'Gotv Payment', varations: [{ variation_code: 'gotv-smallie', name: 'GOtv Smallie N1,575', variation_amount: '1575.00', fixedPrice: 'Yes' }] },
      'ikeja-electric': { ServiceName: 'Ikeja Electric Payment - IKEDC', variations: [{ variation_code: 'prepaid', name: 'Prepaid', variation_amount: '0', fixedPrice: 'No' }, { variation_code: 'postpaid', name: 'Postpaid', variation_amount: '0', fixedPrice: 'No' }] },
    },
    accounts: { '1212121212': { Customer_Name: 'TEST DSTV CUSTOMER ', Current_Bouquet: 'DStv Compact', Due_Date: '2026-10-30', Renewal_Amount: 15700 } },
    /** Reply to payments: { code, status } (VTpass codes: 000 success, 099 processing, 016 failed), or { http: 500 }. */
    payReply: { code: '000', status: 'delivered' },
    requests: {},
    nextId: 100,
  };
  const service = await fakeService(({ method, url, headers, body }) => {
    const path = url.split('?')[0];
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    if (method === 'GET' && path === '/service-variations') {
      if (headers['api-key'] !== 'vt-api' || headers['public-key'] !== 'vt-public') return { status: 401, body: { response_description: 'INVALID CREDENTIALS' } };
      return { body: { response_description: '000', content: state.variations[query.get('serviceID')] ?? { variations: [] } } };
    }
    if (method === 'POST' && path === '/merchant-verify') {
      if (headers['api-key'] !== 'vt-api' || headers['secret-key'] !== 'vt-secret') return { status: 401, body: { response_description: 'INVALID CREDENTIALS' } };
      const account = state.accounts[body.billersCode];
      return { body: { code: '000', content: account ?? { error: 'This IUC number is invalid. Please check and try again.' } } };
    }
    if (method === 'POST' && path === '/pay') {
      const reply = state.payReply;
      if (reply.http) return { status: reply.http, body: { response_description: 'Simulated error' } };
      const electric = String(body.serviceID).endsWith('-electric');
      const record = {
        code: reply.code,
        response_description: reply.code === '000' ? 'TRANSACTION SUCCESSFUL' : 'TRANSACTION FAILED',
        content: { transactions: { status: reply.status, transactionId: `VT${(state.nextId += 1)}` } },
        ...(electric && reply.status === 'delivered' ? { purchased_code: 'Token : 1234-5678-9012-3456-7890', units: '79.9' } : {}),
        request: body,
      };
      state.requests[body.request_id] = record;
      return { body: record };
    }
    if (method === 'POST' && path === '/requery') {
      return { body: state.requests[body.request_id] ?? { code: '015', response_description: 'INVALID REQUEST ID' } };
    }
    return { status: 404, body: { response_description: `Fake VTpass has no ${method} ${path}` } };
  });
  return { ...service, state, env: { VTPASS_API_KEY: 'vt-api', VTPASS_PUBLIC_KEY: 'vt-public', VTPASS_SECRET_KEY: 'vt-secret', VTPASS_API_URL: service.url } };
}
