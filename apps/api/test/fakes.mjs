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
  // `bvns` maps a BVN to the name on its record; `bvnChecks` maps a consent reference to { bvn, status }.
  // `refunds` maps refund ID to a refund ({ id, tx_id, status }); new ones take `refundStatus`.
  const state = { charges: {}, transfers: {}, refunds: {}, refundStatus: 'completed', rates: {}, fail: {}, nextId: 1000, accounts: { '0123456789': 'ADA OBI DIGITAL', '0987654321': 'JOHN STRANGER' }, bvns: {}, bvnChecks: {} };
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
    if (method === 'POST' && path === '/bvn/verifications') {
      if (!/^\d{11}$/.test(body.bvn ?? '')) return flwError(400, 'Invalid BVN');
      const reference = `FLWBVN${(state.nextId += 1)}`;
      state.bvnChecks[reference] = { bvn: body.bvn, status: 'PENDING', redirect_url: body.redirect_url };
      return flwOk({ url: `https://nibss-consent.flutterwave.test/cms/BvnConsent?session=${reference}`, reference });
    }
    const bvnCheck = /^\/bvn\/verifications\/([A-Z0-9]+)$/.exec(path);
    if (method === 'GET' && bvnCheck) {
      const check = state.bvnChecks[bvnCheck[1]];
      if (!check) return flwError(404, 'Not found');
      const [first_name, last_name] = (state.bvns[check.bvn] ?? 'Unknown Person').split(' ');
      return flwOk({ status: check.status, reference: bvnCheck[1], ...(check.status === 'COMPLETED' ? { first_name, last_name, bvn_data: { bvn: check.bvn } } : {}) });
    }
    const transfer = /^\/transfers\/(\d+)$/.exec(path);
    if (method === 'GET' && transfer) return state.transfers[transfer[1]] ? flwOk(state.transfers[transfer[1]]) : flwError(404, 'Not found');
    const refundTx = /^\/transactions\/(\d+)\/refund$/.exec(path);
    if (method === 'POST' && refundTx) {
      const id = (state.nextId += 1);
      state.refunds[id] = { id, tx_id: Number(refundTx[1]), amount_refunded: body.amount, status: state.refundStatus };
      return flwOk(state.refunds[id]);
    }
    if (method === 'GET' && path === '/refunds') return flwOk(Object.values(state.refunds).filter(refund => String(refund.tx_id) === query.get('id')));
    const refund = /^\/refunds\/(\d+)$/.exec(path);
    if (method === 'GET' && refund) return state.refunds[refund[1]] ? flwOk(state.refunds[refund[1]]) : flwError(404, 'Not found');
    return { status: 404, body: { status: 'error', message: `Fake Flutterwave has no ${method} ${path}` } };
  });
  return { ...service, state, env: { FLUTTERWAVE_SECRET_KEY: 'FLWSECK-fake', FLUTTERWAVE_API_URL: service.url, FLUTTERWAVE_WEBHOOK_HASH: 'flw-webhook-hash' } };
}

/** Monnify. `state.transactions` maps transactionReference to a transaction. Set `state.down` to fail everything. */
export async function fakeMonnify() {
  // `checkouts` maps our paymentReference to { transactionReference, amount, currency, status }; `refunds` by refundReference.
  const state = { transactions: {}, checkouts: {}, refunds: {}, down: false, nextAccount: 5000 };
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
    if (method === 'POST' && path === '/api/v1/merchant/transactions/init-transaction') {
      const transactionReference = `MNFY|${Object.keys(state.checkouts).length + 1}|${Date.now()}`;
      state.checkouts[body.paymentReference] = { transactionReference, amount: body.amount, currency: body.currencyCode, status: 'PENDING', body };
      return ok({ transactionReference, paymentReference: body.paymentReference, checkoutUrl: `https://sandbox.sdk.monnify.com/checkout/${encodeURIComponent(transactionReference)}` });
    }
    if (method === 'GET' && path === '/api/v2/merchant/transactions/query') {
      const reference = new URLSearchParams(url.split('?')[1] ?? '').get('paymentReference');
      const found = state.checkouts[reference];
      if (!found) return { status: 404, body: { requestSuccessful: false, responseMessage: 'Could not find transaction' } };
      const paid = found.status === 'PAID';
      return ok({
        transactionReference: found.transactionReference,
        paymentReference: reference,
        paymentStatus: found.status,
        amountPaid: paid ? found.amount : 0,
        settlementAmount: paid ? found.amount - 50 : 0,
        currencyCode: found.currency,
      });
    }
    if (method === 'POST' && path === '/api/v1/refunds/initiate-refund') {
      // Like Monnify, a reference already used is refused.
      if (state.refunds[body.refundReference]) return { status: 400, body: { requestSuccessful: false, responseMessage: 'Duplicate refund reference' } };
      state.refunds[body.refundReference] = { ...body, refundStatus: 'COMPLETED' };
      return ok({ refundReference: body.refundReference, refundStatus: 'COMPLETED' });
    }
    const refund = /^\/api\/v1\/refunds\/(.+)$/.exec(path);
    if (method === 'GET' && refund) {
      const found = state.refunds[decodeURIComponent(refund[1])];
      return found ? ok({ refundReference: found.refundReference, refundStatus: found.refundStatus }) : { status: 404, body: { requestSuccessful: false, responseMessage: 'Not found' } };
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
    // `state.balanceCost` (major units, the account currency): what a top-up reply says it took from the balance.
    const balanceInfo = kind === 'topup' && state.balanceCost !== undefined ? { balanceInfo: { cost: state.balanceCost, currencyCode: 'NGN' } } : {};
    state.transactions[transaction.transactionId] = { ...transaction, ...balanceInfo, status: reply.status };
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
        // `state.totalAmount` (naira): what VTpass says it charged after its commission.
        content: { transactions: { status: reply.status, transactionId: `VT${(state.nextId += 1)}`, ...(state.totalAmount === undefined ? {} : { total_amount: state.totalAmount }) } },
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

/**
 * Vercel Queues. Records sent messages (`state.sent`: topic, payload, delay, idempotency key) and lease calls
 * (`state.acknowledged`, `state.visibility`), and turns a sent message into the push callback Vercel would make.
 */
export async function fakeVercelQueue() {
  const state = { sent: [], acknowledged: [], visibility: [], nextId: 1 };
  const service = await fakeService(({ method, url, headers, body }) => {
    const send = /^\/api\/v3\/topic\/([^/]+)$/.exec(url);
    if (method === 'POST' && send) {
      if (headers.authorization !== 'Bearer queue-token') return { status: 401, body: 'unauthorized' };
      const messageId = `msg-${state.nextId++}`;
      state.sent.push({
        messageId,
        topic: decodeURIComponent(send[1]),
        payload: body,
        delaySeconds: Number(headers['vqs-delay-seconds'] ?? 0),
        idempotencyKey: headers['vqs-idempotency-key'],
      });
      return { status: 201, body: { messageId } };
    }
    const lease = /^\/api\/v3\/topic\/([^/]+)\/consumer\/([^/]+)\/lease\/([^/]+)$/.exec(url);
    if (lease && method === 'DELETE') {
      state.acknowledged.push(decodeURIComponent(lease[3]));
      return { status: 204, body: '' };
    }
    if (lease && method === 'PATCH') {
      state.visibility.push({ receiptHandle: decodeURIComponent(lease[3]), ...body });
      return { body: {} };
    }
    return { status: 404, body: 'not found' };
  });
  /** The CloudEvent (binary mode) Vercel pushes to the consumer function for a sent message. */
  const callback = (message, receiptHandle = `rh-${message.messageId}`) => ({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'ce-type': 'com.vercel.queue.v2beta',
      'ce-vqsqueuename': message.topic,
      'ce-vqsconsumergroup': 'webhook-consumer',
      'ce-vqsmessageid': message.messageId,
      'ce-vqsreceipthandle': receiptHandle,
      'ce-vqsdeliverycount': '1',
      'ce-vqscreatedat': new Date().toISOString(),
      'ce-vqsregion': 'iad1',
    },
    body: JSON.stringify(message.payload),
  });
  return { ...service, state, callback, env: { WEBHOOK_QUEUE: 'vercel', WEBHOOK_QUEUE_URL: service.url, WEBHOOK_QUEUE_TOKEN: 'queue-token' } };
}

/**
 * Didit v3 sessions. `state.sessions` maps session_id to { status, first_name, last_name, issuing_state, vendor_data };
 * change a session's status and names to play out the check. Webhooks are signed with `secret`.
 */
export async function fakeDidit() {
  const state = { sessions: {}, nextId: 1, created: [] };
  const service = await fakeService(({ method, url, headers, body }) => {
    if (headers['x-api-key'] !== 'didit-key') return { status: 403, body: { detail: 'Invalid API key' } };
    if (method === 'POST' && url === '/v3/session/') {
      const session_id = `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`;
      state.sessions[session_id] = { status: 'Not Started', vendor_data: body.vendor_data, expected: body.expected_details ?? null };
      state.created.push(body);
      return { status: 201, body: { session_id, url: `https://verify.didit.test/session/${session_id}`, status: 'Not Started', workflow_id: body.workflow_id, vendor_data: body.vendor_data } };
    }
    const decision = /^\/v3\/session\/([^/]+)\/decision\/$/.exec(url);
    if (method === 'GET' && decision) {
      const session = state.sessions[decision[1]];
      if (!session) return { status: 404, body: { detail: 'Not found' } };
      const document = session.first_name ? [{ first_name: session.first_name, last_name: session.last_name, issuing_state: session.issuing_state ?? 'NGA', document_number: 'A12345678', status: session.status }] : null;
      return { body: { session_id: decision[1], status: session.status, vendor_data: session.vendor_data, id_verifications: document, reviews: session.review ? [{ comment: session.review }] : [] } };
    }
    return { status: 404, body: { detail: `Fake Didit has no ${method} ${url}` } };
  });
  return { ...service, state, secret: 'didit-webhook-secret', env: { DIDIT_API_KEY: 'didit-key', DIDIT_WORKFLOW_ID: 'wf-test', DIDIT_WEBHOOK_SECRET: 'didit-webhook-secret', DIDIT_API_URL: service.url } };
}

/**
 * DIDWW (JSON:API). `state.groups` are DID groups with their SKUs; `state.orderReply` decides what a new order does
 * ('Completed' | 'Pending' | 'Canceled', or { http: 500, recorded } for an unclear reply after the order was recorded).
 * Completing an order (`complete(id)`) assigns it a number. Every request must carry the API key.
 */
export async function fakeDidww() {
  const country = { id: 'country-gb', type: 'countries', attributes: { name: 'United Kingdom', iso: 'GB', prefix: '44' } };
  const local = { id: 'type-local', type: 'did_group_types', attributes: { name: 'Local' } };
  const tollFree = { id: 'type-tollfree', type: 'did_group_types', attributes: { name: 'Toll-free' } };
  const sku = (id, setup, monthly, channels) => ({ id, type: 'stock_keeping_units', attributes: { setup_price: setup, monthly_price: monthly, channels_included_count: channels } });
  const group = (id, attributes, type, skus, meta = {}) => ({ id, attributes: { allow_additional_channels: true, ...attributes }, type, skus, meta: { needs_registration: false, is_available: true, ...meta } });
  const state = {
    groups: [
      // DIDWW API 2026-04-16 feature names.
      group('grp-london', { prefix: '20', features: ['voice_in', 'sms_in', 'p2p', 'a2p', 't38'], is_metered: false, area_name: 'London' }, local, [sku('sku-london-0', '0.0', '1.5', 0), sku('sku-london-2', '0.5', '3.0', 2)]),
      // Regulated, metered and fax-only groups are never sold.
      group('grp-manchester', { prefix: '161', features: ['voice'], is_metered: false, area_name: 'Manchester' }, local, [sku('sku-manchester', '0', '1', 0)], { needs_registration: true }),
      group('grp-freephone', { prefix: '800', features: ['voice'], is_metered: true, area_name: '' }, tollFree, [sku('sku-freephone', '0', '5', 0)]),
      group('grp-fax', { prefix: '113', features: ['t38'], is_metered: false, area_name: 'Leeds' }, local, [sku('sku-fax', '0', '1', 0)]),
      // Only numbers receiving SMS codes from apps are sold: not voice-only numbers, nor SMS from people only.
      group('grp-voice', { prefix: '121', features: ['voice_in', 'voice_out'], is_metered: false, area_name: 'Birmingham' }, local, [sku('sku-voice', '0', '1', 0)]),
      group('grp-people', { prefix: '141', features: ['sms_in', 'p2p'], is_metered: false, area_name: 'Glasgow' }, local, [sku('sku-people', '0', '1', 0)]),
    ],
    orders: {},
    dids: [],
    orderReply: 'Completed',
    next: 1000,
    /** API keys the fake accepts: BitoCard's, plus any a test adds for a reseller's own account. */
    keys: ['didww-key'],
  };
  const resource = order => ({ id: order.id, type: 'orders', attributes: { status: order.status, reference: order.reference, amount: order.amount, callback_url: order.callback_url, callback_method: order.callback_method, created_at: order.created_at } });
  const complete = id => {
    const order = state.orders[id];
    order.status = 'Completed';
    state.dids.push({ id: `did-${id}`, type: 'dids', attributes: { number: `4420790${String((state.next += 1)).padStart(5, '0')}`, expires_at: '2026-11-03T00:00:00.000Z' }, order: id });
    return order;
  };
  // Outgoing SMS (the HTTP OUT trunk: Basic sms-user:sms-pass) are kept in `state.sms`; `state.smsReply` is 'ok' or an HTTP status.
  state.sms = [];
  state.smsReply = 'ok';
  const service = await fakeService(({ method, url, headers, body }) => {
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    if (method === 'POST' && path === '/outbound_messages') {
      if (headers.authorization !== `Basic ${Buffer.from('sms-user:sms-pass').toString('base64')}`) return { status: 401, body: { errors: [{ title: 'Unauthorized' }] } };
      if (state.smsReply !== 'ok') return { status: state.smsReply, body: { errors: [{ title: 'Refused' }] } };
      const id = `sms-${(state.next += 1)}`;
      state.sms.push({ id, ...body.data.attributes });
      return { status: 202, body: { data: { type: 'outbound_messages', id } } };
    }
    if (!state.keys.includes(headers['api-key'])) return { status: 401, body: { errors: [{ title: 'Unauthorized', detail: 'Invalid API key' }] } };
    if (state.fail && path.startsWith(state.fail)) return { status: 500, body: { errors: [{ title: 'Simulated outage' }] } };
    if (method === 'GET' && path === '/balance') return { body: { data: { id: 'balance', type: 'balances', attributes: { total_balance: '100.0' } } } };
    if (method === 'GET' && path === '/countries') return { body: { data: query.get('filter[iso]') === 'GB' ? [country] : [] } };
    if (method === 'GET' && path === '/did_groups') {
      const groups = state.groups.filter(
        g =>
          query.get('filter[country.id]') === country.id &&
          (query.get('filter[needs_registration]') !== 'false' || !g.meta.needs_registration) &&
          (query.get('filter[is_metered]') !== 'false' || !g.attributes.is_metered),
      );
      const size = Number(query.get('page[size]') ?? 50);
      const page = groups.slice((Number(query.get('page[number]') ?? 1) - 1) * size).slice(0, size);
      return {
        body: {
          data: page.map(g => ({
            id: g.id,
            type: 'did_groups',
            attributes: g.attributes,
            relationships: { did_group_type: { data: { id: g.type.id, type: g.type.type } }, stock_keeping_units: { data: g.skus.map(s => ({ id: s.id, type: s.type })) } },
            meta: g.meta,
          })),
          included: [...new Map(page.flatMap(g => [g.type, ...g.skus]).map(item => [item.id, item])).values()],
        },
      };
    }
    if (method === 'POST' && path === '/orders') {
      const attributes = body.data.attributes;
      const item = attributes.items[0].attributes;
      const skuFound = state.groups.flatMap(g => g.skus).find(s => s.id === item.sku_id);
      if (!skuFound) return { status: 422, body: { errors: [{ title: 'is invalid', detail: 'sku_id - is invalid' }] } };
      const reply = state.orderReply;
      const id = `order-${(state.next += 1)}`;
      const order = { id, reference: `ABC-${state.next}`, status: 'Pending', amount: String(Number(skuFound.attributes.setup_price) + Number(skuFound.attributes.monthly_price)), callback_url: attributes.callback_url, callback_method: attributes.callback_method, created_at: new Date().toISOString(), request: body };
      state.orders[id] = order;
      const status = typeof reply === 'object' ? reply.recorded : reply;
      if (status === 'Completed') complete(id);
      else if (status) order.status = status;
      if (typeof reply === 'object') {
        if (!reply.recorded) delete state.orders[id];
        return { status: reply.http, body: { errors: [{ title: 'Simulated error' }] } };
      }
      return { status: 201, body: { data: resource(order) } };
    }
    const one = /^\/orders\/([\w-]+)$/.exec(path);
    if (method === 'GET' && one) return state.orders[one[1]] ? { body: { data: resource(state.orders[one[1]]) } } : { status: 404, body: { errors: [{ title: 'Not found' }] } };
    if (method === 'GET' && path === '/orders') {
      const orders = Object.values(state.orders).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { body: { data: orders.map(resource) } };
    }
    if (method === 'GET' && path === '/dids') return { body: { data: state.dids.filter(d => d.order === query.get('filter[order.id]')).map(did => ({ id: did.id, type: did.type, attributes: did.attributes })) } };
    // One number: read it, or change its renewals left (`billing_cycles_count`) and `terminated`.
    const did = /^\/dids\/([\w-]+)$/.exec(path);
    if (did) {
      const found = state.dids.find(item => item.id === did[1]);
      if (!found) return { status: 404, body: { errors: [{ title: 'Not found' }] } };
      if (method === 'PATCH') {
        // `state.patchReply`: an HTTP status to answer with; 500 after applying the change (a reply lost on the way).
        if (state.patchReply && state.patchReply < 500) return { status: state.patchReply, body: { errors: [{ title: 'Refused' }] } };
        found.attributes = { ...found.attributes, ...body.data.attributes };
        found.patches = [...(found.patches ?? []), body.data.attributes];
        if (state.patchReply) return { status: state.patchReply, body: { errors: [{ title: 'Internal error' }] } };
      }
      return { body: { data: { id: found.id, type: 'dids', attributes: { billing_cycles_count: 0, terminated: false, ...found.attributes } } } };
    }
    return { status: 404, body: { errors: [{ title: `Fake DIDWW has no ${method} ${path}` }] } };
  });
  return {
    ...service,
    state,
    complete,
    env: { DIDWW_API_KEY: 'didww-key', DIDWW_API_URL: service.url, DIDWW_COUNTRIES: 'GB', DIDWW_SMS_URL: service.url, DIDWW_SMS_USERNAME: 'sms-user', DIDWW_SMS_PASSWORD: 'sms-pass', DIDWW_SMS_WEBHOOK_TOKEN: 'didww-sms-token-0123456789' },
  };
}

/**
 * Zendit: voucher and top-up offers, purchases by our transaction ID. `state.reply` is the status new purchases get
 * ('DONE', 'PENDING', 'FAILED', or { http } to refuse); `state.purchases` maps transaction ID to { kind, body, status }.
 */
export async function fakeZendit() {
  const usd = (value, extra = {}) => ({ currency: 'USD', currencyDivisor: 100, fee: 0, feePct: 0, discount: 0, ...value, ...extra });
  const offer = (fields) => ({ enabled: true, productType: 'VOUCHER', subTypes: ['Shopping'], requiredFields: [], shortNotes: '', notes: '', regions: ['North America'], ...fields });
  const state = {
    vouchers: [
      offer({ offerId: 'AMZ-US-25', brand: 'AMAZON_US', brandName: 'Amazon', country: 'US', priceType: 'FIXED', send: { currency: 'USD', currencyDivisor: 100, fixed: 2500 }, cost: usd({ fixed: 2400 }) }),
      offer({ offerId: 'AMZ-US-50', brand: 'AMAZON_US', brandName: 'Amazon', country: 'US', priceType: 'FIXED', send: { currency: 'USD', currencyDivisor: 100, fixed: 5000 }, cost: usd({ fixed: 4750 }, { fee: 10 }) }),
      // Needs the customer's email: never synced.
      offer({ offerId: 'NFX-US-30', brand: 'NETFLIX_US', brandName: 'Netflix', country: 'US', priceType: 'FIXED', requiredFields: ['recipient.email'], send: { currency: 'USD', currencyDivisor: 100, fixed: 3000 }, cost: usd({ fixed: 2900 }) }),
      // A utility payment: not a gift card.
      offer({ offerId: 'UTIL-1', brand: 'POWER', brandName: 'Power Co', country: 'US', priceType: 'FIXED', subTypes: ['Utilities'], send: { currency: 'USD', currencyDivisor: 100, fixed: 1000 }, cost: usd({ fixed: 990 }) }),
      offer({ offerId: 'OFF-1', brand: 'GONE', brandName: 'Gone', country: 'US', priceType: 'FIXED', enabled: false, send: { currency: 'USD', currencyDivisor: 100, fixed: 1000 }, cost: usd({ fixed: 900 }) }),
    ],
    topups: [
      { offerId: 'MTN-NG-ANY', brand: 'MTN_NG', brandName: 'MTN Nigeria', country: 'NG', enabled: true, priceType: 'RANGE', productType: 'TOPUP', subTypes: ['Mobile Top Up'], send: { currency: 'NGN', currencyDivisor: 100, min: 10000, max: 5000000 }, cost: usd({ min: 6, max: 3000 }) },
      { offerId: 'MTN-NG-1GB', brand: 'MTN_NG', brandName: 'MTN Nigeria', country: 'NG', enabled: true, priceType: 'FIXED', productType: 'TOPUP', subTypes: ['Mobile Data'], shortNotes: '1GB 30 days', dataGB: 1, send: { currency: 'NGN', currencyDivisor: 100, fixed: 100000 }, cost: usd({ fixed: 60 }) },
    ],
    purchases: {},
    reply: 'DONE',
    next: 1000,
  };
  const page = (list, query) => {
    const limit = Number(query.get('_limit'));
    const offset = Number(query.get('_offset'));
    return { body: { limit, offset, total: list.length, list: list.slice(offset, offset + limit) } };
  };
  const view = (id, purchase) => ({
    transactionId: id,
    status: purchase.status,
    offerId: purchase.body.offerId,
    ...(purchase.kind === 'vouchers' && purchase.status === 'DONE' ? { receipt: { epin: `ZEN-${purchase.n}`, voucherId: `V${purchase.n}`, redemptionUrl: 'https://redeem.example/x', expiresAt: '2027-10-01T00:00:00Z' } } : {}),
    ...(purchase.status === 'FAILED' ? { error: { code: 'X', message: 'Simulated failure', description: '' } } : {}),
  });
  const service = await fakeService(({ method, url, headers, body }) => {
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    if (headers.authorization !== 'Bearer zendit-key') return { status: 401, body: { errorCode: 'UNAUTHORIZED', message: 'Invalid API key', fields: {} } };
    if (method === 'GET' && path === '/vouchers/offers') return page(state.vouchers, query);
    if (method === 'GET' && path === '/topups/offers') return page(state.topups.filter(item => !query.get('country') || item.country === query.get('country')), query);
    const buy = /^\/(vouchers|topups)\/purchases$/.exec(path);
    if (method === 'POST' && buy) {
      if (state.purchases[body.transactionId]) return { status: 400, body: { errorCode: 'DUPLICATE', message: 'Duplicate transaction ID', fields: {} } };
      if (typeof state.reply === 'object') return { status: state.reply.http, body: { errorCode: 'REFUSED', message: 'Simulated refusal', fields: {} } };
      state.purchases[body.transactionId] = { kind: buy[1], body, status: state.reply, n: (state.next += 1) };
      return { body: { transactionId: body.transactionId, status: 'ACCEPTED' } };
    }
    const one = /^\/(vouchers|topups)\/purchases\/(\w+)$/.exec(path);
    if (method === 'GET' && one) {
      const purchase = state.purchases[one[2]];
      return purchase ? { body: view(one[2], purchase) } : { status: 404, body: { errorCode: 'NOT_FOUND', message: 'Not found', fields: {} } };
    }
    return { status: 404, body: { errorCode: 'NOT_FOUND', message: `Fake Zendit has no ${method} ${path}`, fields: {} } };
  });
  return { ...service, state, env: { ZENDIT_API_KEY: 'zendit-key', ZENDIT_API_URL: service.url, ZENDIT_WEBHOOK_SECRET: 'zendit-hook' } };
}

/**
 * pawaPay v2: the active configuration (payout providers by country) and payouts by payoutId. `state.reply` is what a
 * new payout becomes ('COMPLETED', 'PROCESSING', 'FAILED', or 'REJECTED' at initiation); `state.payouts` maps payoutId
 * to { body, status }.
 */
export async function fakePawapay() {
  const provider = (code, name, currency, min, max, decimals = 'NONE', status = 'OPERATIONAL') => ({
    provider: code,
    displayName: name,
    logo: `https://static-content.pawapay.io/company_logos/${name.toLowerCase()}.png`,
    currencies: [{ currency, displayName: currency, operationTypes: { PAYOUT: { minAmount: min, maxAmount: max, decimalsInAmount: decimals, status }, DEPOSIT: { minAmount: min, maxAmount: max, decimalsInAmount: decimals, status } } }],
  });
  const state = {
    countries: [
      { country: 'GHA', prefix: '233', displayName: { en: 'Ghana' }, providers: [provider('MTN_MOMO_GHA', 'MTN', 'GHS', '1', '5000'), provider('VODAFONE_GHA', 'Telecel', 'GHS', '1', '3000', 'NONE', 'CLOSED')] },
      { country: 'KEN', prefix: '254', displayName: { en: 'Kenya' }, providers: [provider('MPESA_KEN', 'M-Pesa', 'KES', '10', '150000')] },
      { country: 'ZMB', prefix: '260', displayName: { en: 'Zambia' }, providers: [provider('AIRTEL_OAPI_ZMB', 'Airtel', 'ZMW', '1', '10000', 'TWO_PLACES')] },
    ],
    payouts: {},
    reply: 'COMPLETED',
    // Payment page deposits by depositId ({ body, status }), and refunds by refundId.
    deposits: {},
    refunds: {},
    noDeposits: new Set(),
  };
  const service = await fakeService(({ method, url, headers, body }) => {
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    if (headers.authorization !== 'Bearer pawapay-token') return { status: 401, body: { failureReason: { failureCode: 'AUTHENTICATION_ERROR', failureMessage: 'Invalid token' } } };
    if (method === 'GET' && path === '/v2/active-conf') {
      const type = query.get('operationType');
      if (type === 'PAYOUT') return { body: { companyName: 'BitoCard', countries: state.countries } };
      // Deposits: every country unless switched off here (alpha-3 codes), as in pawaPay's dashboard.
      if (type === 'DEPOSIT') return { body: { companyName: 'BitoCard', countries: state.countries.filter(country => !state.noDeposits.has(country.country)) } };
      return { status: 400, body: {} };
    }
    if (method === 'POST' && path === '/v2/payouts') {
      if (state.payouts[body.payoutId]) return { body: { payoutId: body.payoutId, status: 'DUPLICATE_IGNORED' } };
      if (state.reply === 'REJECTED') return { body: { payoutId: body.payoutId, status: 'REJECTED', failureReason: { failureCode: 'INVALID_PHONE_NUMBER', failureMessage: 'Not a valid MSISDN' } } };
      state.payouts[body.payoutId] = { body, status: state.reply };
      return { body: { payoutId: body.payoutId, status: 'ACCEPTED', created: new Date().toISOString() } };
    }
    if (method === 'POST' && path === '/v2/paymentpage') {
      if (state.refusePaymentPage) return { status: 403, body: { failureReason: { failureCode: 'AUTHORISATION_ERROR', failureMessage: 'Payment page is not enabled for this account' } } };
      state.deposits[body.depositId] = { body, status: null };
      return { body: { redirectUrl: `https://paywith.pawapay.io/?token=${body.depositId}` } };
    }
    const deposit = /^\/v2\/deposits\/([\w-]+)$/.exec(path);
    if (method === 'GET' && deposit) {
      const found = state.deposits[deposit[1]];
      if (!found?.status) return { body: { status: 'NOT_FOUND' } };
      return {
        body: {
          status: 'FOUND',
          data: {
            depositId: deposit[1],
            status: found.status,
            amount: found.body.amountDetails.amount,
            currency: found.body.amountDetails.currency,
            ...(found.status === 'FAILED' ? { failureReason: { failureCode: 'PAYER_NOT_FOUND', failureMessage: 'The payer declined' } } : {}),
          },
        },
      };
    }
    if (method === 'POST' && path === '/v2/refunds') {
      state.refunds[body.refundId] = { body, status: 'COMPLETED' };
      return { body: { refundId: body.refundId, status: 'ACCEPTED' } };
    }
    const refund = /^\/v2\/refunds\/([\w-]+)$/.exec(path);
    if (method === 'GET' && refund) {
      const found = state.refunds[refund[1]];
      return found ? { body: { status: 'FOUND', data: { refundId: refund[1], status: found.status } } } : { body: { status: 'NOT_FOUND' } };
    }
    const one = /^\/v2\/payouts\/([\w-]+)$/.exec(path);
    if (method === 'GET' && one) {
      const payout = state.payouts[one[1]];
      if (!payout) return { body: { status: 'NOT_FOUND' } };
      return {
        body: {
          status: 'FOUND',
          data: {
            payoutId: one[1],
            status: payout.status,
            amount: payout.body.amount,
            currency: payout.body.currency,
            clientReferenceId: payout.body.clientReferenceId,
            ...(payout.status === 'COMPLETED' ? { providerTransactionId: `PT-${one[1].slice(0, 8)}` } : {}),
            ...(payout.status === 'FAILED' ? { failureReason: { failureCode: 'RECIPIENT_NOT_FOUND', failureMessage: 'Wallet not found' } } : {}),
          },
        },
      };
    }
    return { status: 404, body: { failureReason: { failureCode: 'NOT_FOUND', failureMessage: `Fake pawaPay has no ${method} ${path}` } } };
  });
  return { ...service, state, env: { PAWAPAY_API_TOKEN: 'pawapay-token', PAWAPAY_API_URL: service.url, PAWAPAY_PAYOUT_FEE_PERCENT: '1.5', PAWAPAY_CALLBACK_TOKEN: 'pawapay-callback' } };
}

/**
 * Stripe: Checkout Sessions, refunds and the balance (key checks). `state.sessions` maps session ID to its form fields
 * and `status`/`payment_status`, which tests set to simulate payment; `state.refunds` maps refund ID to its fields.
 */
export async function fakeStripe() {
  // `feeCurrency` and `exchangeRate` describe the balance transaction (the account's settlement currency); `byKey` maps
  // idempotency keys to the refund they made, so a repeat returns it, as Stripe does.
  // `disputes` maps a dispute ID to { amount, currency, status, payment_intent, reason }.
  const state = { sessions: {}, refunds: {}, disputes: {}, byKey: {}, next: 1, fee: 0, feeCurrency: null, exchangeRate: null };
  const form = body => (typeof body === 'string' ? Object.fromEntries(new URLSearchParams(body)) : {});
  const service = await fakeService(({ method, url, headers, body }) => {
    const path = url.split('?')[0];
    if (!/^Bearer sk_(live|test)_/.test(headers.authorization ?? '')) return { status: 401, body: { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } } };
    if (method === 'GET' && path === '/v1/balance') return { body: { object: 'balance', available: [] } };
    if (method === 'POST' && path === '/v1/checkout/sessions') {
      const fields = form(body);
      const id = `cs_test_${(state.next += 1)}`;
      state.sessions[id] = { fields, status: 'open', payment_status: 'unpaid', payment_intent: `pi_${state.next}`, key: headers.authorization.slice(7) };
      return { body: { id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, status: 'open', payment_status: 'unpaid' } };
    }
    if (method === 'GET' && path === '/v1/checkout/sessions') {
      const intent = new URLSearchParams(url.split('?')[1] ?? '').get('payment_intent');
      return { body: { object: 'list', data: Object.entries(state.sessions).filter(([, session]) => session.payment_intent === intent).map(([id]) => ({ id, object: 'checkout.session' })) } };
    }
    const dispute = /^\/v1\/disputes\/([\w-]+)$/.exec(path);
    if (method === 'GET' && dispute) {
      const found = state.disputes[dispute[1]];
      return found ? { body: { id: dispute[1], object: 'dispute', ...found } } : { status: 404, body: { error: { message: 'No such dispute' } } };
    }
    const one = /^\/v1\/checkout\/sessions\/([\w-]+)$/.exec(path);
    if (method === 'GET' && one) {
      const session = state.sessions[one[1]];
      if (!session) return { status: 404, body: { error: { message: 'No such checkout.session' } } };
      return {
        body: {
          id: one[1],
          object: 'checkout.session',
          status: session.status,
          payment_status: session.payment_status,
          amount_total: Number(session.fields['line_items[0][price_data][unit_amount]']),
          currency: session.fields['line_items[0][price_data][currency]'],
          client_reference_id: session.fields.client_reference_id,
          payment_intent: url.includes('expand')
            ? {
                id: session.payment_intent,
                latest_charge: {
                  balance_transaction: { fee: state.fee, currency: state.feeCurrency ?? session.fields['line_items[0][price_data][currency]'], exchange_rate: state.exchangeRate },
                },
              }
            : session.payment_intent,
        },
      };
    }
    if (method === 'POST' && path === '/v1/refunds') {
      const fields = form(body);
      const key = headers['idempotency-key'];
      const id = (key && state.byKey[key]) || `re_${(state.next += 1)}`;
      if (key) state.byKey[key] = id;
      state.refunds[id] = { ...fields, status: 'succeeded', key: headers.authorization.slice(7), idempotencyKey: key };
      return { body: { id, object: 'refund', status: 'succeeded', amount: Number(fields.amount) } };
    }
    return { status: 404, body: { error: { message: `Fake Stripe has no ${method} ${path}` } } };
  });
  return { ...service, state, env: { STRIPE_SECRET_KEY: 'sk_live_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake', STRIPE_API_URL: service.url } };
}
