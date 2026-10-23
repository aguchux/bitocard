// Local stand-ins for the payment and exchange-rate providers, with just enough behaviour for the tests.
// Each keeps its state in plain objects the tests can inspect and change.
import { fakeService } from './helpers.mjs';

const flwOk = data => ({ body: { status: 'success', message: 'ok', data } });
const flwError = (status, message) => ({ status, body: { status: 'error', message, data: null } });

/**
 * Flutterwave v3. `state.charges` maps tx_ref to a charge ({ id, status, amount, currency, app_fee });
 * `state.transfers` maps transfer ID to a transfer; `state.rates` maps currency to units per USD.
 * Set `state.fail` to make a path fail: { '/virtual-account-numbers': 500 }. `state.virtualAccounts` keeps every
 * account opened (by account number); `state.loseReply` opens the next one but answers 502, as a reply lost on the
 * way back. `GET /transactions` lists `state.charges` (successful ones, by `status`), `state.pageSize` a page.
 */
export async function fakeFlutterwave() {
  // `bvns` maps a BVN to the name on its record; `bvnChecks` maps a consent reference to { bvn, status }.
  // `refunds` maps refund ID to a refund ({ id, tx_id, status }); new ones take `refundStatus`.
  const state = { charges: {}, virtualAccounts: {}, loseReply: false, pageSize: 50, transfers: {}, refunds: {}, refundStatus: 'completed', rates: {}, fail: {}, nextId: 1000, accounts: { '0123456789': 'ADA OBI DIGITAL', '0987654321': 'JOHN STRANGER' }, bvns: {}, bvnChecks: {} };
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
      if ((body.currency ?? 'NGN') === 'NGN' && !body.bvn) return flwError(400, 'BVN is required');
      if (body.currency === 'GHS' && !(body.firstname && body.lastname && body.phonenumber)) return flwError(400, 'firstname, lastname and phonenumber are required');
      const id = (state.nextId += 1);
      const account = {
        response_code: '02',
        response_message: 'Transaction in progress',
        flw_ref: `FLW-${id}`,
        order_ref: `URF_${id}`,
        account_number: `78${String(id).padStart(8, '0')}`,
        account_status: 'active',
        frequency: 'N/A',
        bank_name: body.currency === 'GHS' ? 'First Bank Ghana' : 'Wema Bank',
        created_at: new Date().toISOString(),
        expiry_date: 'N/A',
        note: `Please make a bank transfer to ${body.narration} FLW`,
        amount: '0.00',
        tx_ref: body.tx_ref,
      };
      state.virtualAccounts[account.account_number] = account;
      if (state.loseReply) {
        state.loseReply = false;
        return { status: 502, body: { status: 'error', message: 'Bad gateway' } };
      }
      return { body: { status: 'success', message: 'Virtual account created', data: account } };
    }
    if (method === 'GET' && path === '/transactions') {
      const page = Number(query.get('page') ?? 1);
      const rows = Object.entries(state.charges)
        .filter(([, charge]) => !query.get('status') || charge.status === query.get('status'))
        .map(([tx_ref, charge]) => ({ tx_ref, payment_type: 'bank_transfer', ...charge }));
      const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
      return { body: { status: 'success', message: 'Transactions fetched', meta: { page_info: { total: rows.length, current_page: page, total_pages: pages } }, data: rows.slice((page - 1) * state.pageSize, page * state.pageSize) } };
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
    const autoDetect = /^\/topups\/operators\/auto-detect\/phone\/([^/]+)\/countries\/([A-Z]{2})$/.exec(path);
    if (method === 'GET' && autoDetect) {
      const [, phone, country] = autoDetect;
      const match = state.autoDetect?.[`${country}:${phone}`];
      return match ? { body: match } : { status: 404, body: { message: 'No matching operator found' } };
    }
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
    if (method === 'POST' && path === '/v2/predict-provider') {
      // By dialling code; `state.predict` maps a phone (no +) to another provider.
      const country = state.countries.find(item => body.phoneNumber.startsWith(item.prefix));
      if (!country) return { status: 400, body: { failureReason: { failureCode: 'INVALID_PHONE_NUMBER', failureMessage: 'Unknown number' } } };
      return { body: { country: country.country, provider: state.predict?.[body.phoneNumber] ?? country.providers[0].provider, phoneNumber: body.phoneNumber } };
    }
    if (method === 'POST' && path === '/v2/payouts') {
      if (state.payouts[body.payoutId]) return { body: { payoutId: body.payoutId, status: 'DUPLICATE_IGNORED' } };
      if (state.reply === 'REJECTED') return { body: { payoutId: body.payoutId, status: 'REJECTED', failureReason: { failureCode: 'INVALID_PHONE_NUMBER', failureMessage: 'Not a valid MSISDN' } } };
      state.payouts[body.payoutId] = { body, status: state.reply };
      return { body: { payoutId: body.payoutId, status: 'ACCEPTED', created: new Date().toISOString() } };
    }
    if (method === 'POST' && path === '/v2/paymentpage') {
      if (state.rejectPaymentPage) return { body: { depositId: body.depositId, status: 'REJECTED', failureReason: { failureCode: 'PAYMENT_NOT_APPROVED', failureMessage: 'Deposits are not enabled for this country' } } };
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
  // `refuseCurrencies`: currencies the account cannot take (lower case), refused as Stripe does; `attempts` every session asked for.
  const state = { sessions: {}, refunds: {}, disputes: {}, byKey: {}, next: 1, fee: 0, feeCurrency: null, exchangeRate: null, refuseCurrencies: new Set(), attempts: [], managedPayments: false };
  const form = body => (typeof body === 'string' ? Object.fromEntries(new URLSearchParams(body)) : {});
  const service = await fakeService(({ method, url, headers, body }) => {
    const path = url.split('?')[0];
    if (!/^Bearer sk_(live|test)_/.test(headers.authorization ?? '')) return { status: 401, body: { error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } } };
    if (method === 'GET' && path === '/v1/balance') return { body: { object: 'balance', available: [] } };
    if (method === 'POST' && path === '/v1/checkout/sessions') {
      const fields = form(body);
      state.attempts.push(fields['line_items[0][price_data][currency]']);
      if (state.refuseCurrencies.has(fields['line_items[0][price_data][currency]'])) {
        const currency = fields['line_items[0][price_data][currency]'];
        return { status: 400, body: { error: { type: 'invalid_request_error', message: `Invalid currency: ${currency}. You can change your account to process transactions in ${currency} by adding a bank account for this currency at https://dashboard.stripe.com/account. Your account currently supports these currencies: usd, ngn.` } } };
      }
      // Stripe Managed Payments on: every line item needs a product tax code.
      if (state.managedPayments && !fields['line_items[0][price_data][product_data][tax_code]']) {
        return { status: 400, body: { error: { type: 'invalid_request_error', message: 'Invalid line_items[0]: the product tax code is missing. Set the tax_code field of the product to an eligible product tax code.' } } };
      }
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

/**
 * eSIM Access: signed POSTs (`RT-*` headers, checked like the real API), the package lists (fixed plans, day passes and
 * top-ups), orders by transactionId (a repeat returns the same order, `periodNum` for day passes), the profile query
 * (by order or eSIM), top-ups (by transactionId, once) and cancelling unused eSIMs (refunded to the balance).
 * `state.allocating` makes the query answer 200010 (profiles still being allocated); `state.balance` in US dollars x
 * 10,000 (an order or top-up beyond it is 200007); `state.profiles` holds each eSIM's states by esimTranNo.
 */
export async function fakeEsimAccess() {
  const { createHmac } = await import('node:crypto');
  const accessCode = 'esim-access-code';
  const secretKey = 'esim-secret-key';
  const pkg = (packageCode, slug, name, price, location, volumeGb, days, extra = {}) => ({
    packageCode, slug, name, price, currencyCode: 'USD', volume: volumeGb * 1024 ** 3, unusedValidTime: 180, duration: days, durationUnit: 'DAY', location, description: name, activeType: 1, dataType: 1, smsStatus: 0, speed: '4G/5G', supportTopUpType: 2,
    locationNetworkList: location.split(',').map(code => ({ locationName: code, operatorList: [{ operatorName: `${code} Mobile`, networkType: '4G' }] })), ...extra,
  });
  const state = {
    packages: [
      pkg('CKH491', 'JP_1_7', 'Japan 1GB 7Days', 15050, 'JP', 1, 7),
      pkg('CKH530', 'EU-42_5_30', 'Europe (42 areas) 5GB 30Days', 89000, 'FR,DE,ES,IT,PT,NL,BE,AT,GR,IE', 5, 30),
      pkg('CKH999', 'NO_PRICE', 'Broken package', 0, 'GB', 1, 7),
    ],
    dayPasses: [pkg('CKH700', 'JP-D_1', 'Japan 1GB/Day', 2000, 'JP', 1, 1, { dataType: 2, supportTopUpType: 3 })],
    topUpPackages: [pkg('CKT491', 'TOPUP_JP_1_7', 'Japan 1GB 7Days top up', 12000, 'JP', 1, 7)],
    profiles: {},
    topUps: {},
    orders: {},
    allocating: false,
    balance: 1_000_000_000,
    count: 0,
  };
  const ok = obj => ({ body: { success: true, errorCode: '0', errorMsg: null, obj } });
  const error = (errorCode, errorMsg) => ({ body: { success: false, errorCode, errorMsg, obj: null } });
  const service = await fakeService(({ method, url, headers, raw, body }) => {
    if (method !== 'POST') return error('000103', 'Method not supported');
    const signed = createHmac('sha256', secretKey).update(`${headers['rt-timestamp']}${headers['rt-requestid']}${headers['rt-accesscode']}${raw.toString('utf8')}`).digest('hex');
    if (headers['rt-accesscode'] !== accessCode || headers['rt-signature'] !== signed) return error('101003', 'Request signature mismatch.');
    const path = url.replace('/api/v1/open/', '');
    if (path === 'balance/query') return ok({ balance: state.balance });
    if (path === 'package/list') {
      if (body.type === 'TOPUP') return ok({ packageList: body.iccid ? state.topUpPackages : [] });
      return ok({ packageList: String(body.dataType) === '2' ? state.dayPasses : state.packages });
    }
    if (path === 'esim/order') {
      const existing = state.orders[body.transactionId];
      if (existing) return ok({ orderNo: existing.orderNo, transactionId: body.transactionId });
      const [line] = body.packageInfoList;
      const found = [...state.packages, ...state.dayPasses].find(item => item.slug === line.packageCode || item.packageCode === line.packageCode);
      if (!found) return error('310241', 'The packageCode does not exist.');
      if (line.price !== undefined && line.price !== found.price) return error('200005', 'Package price error. Check price.');
      const total = found.price * line.count * (line.periodNum ?? 1);
      if (body.amount !== undefined && body.amount !== total) return error('200006', 'Order amount error.');
      if (total > state.balance) return error('200007', 'Insufficient account balance');
      state.balance -= total;
      state.count += 1;
      const orderNo = `B2610110000${String(state.count).padStart(4, '0')}`;
      state.orders[body.transactionId] = { orderNo, package: found, count: line.count, body, status: 'GOT_RESOURCE' };
      return ok({ orderNo, transactionId: body.transactionId });
    }
    if (path === 'esim/query' && body.esimTranNo) {
      const profile = state.profiles[body.esimTranNo];
      if (!profile) return error('310272', 'The esimTranNo does not exist.');
      return ok({ esimList: [{ esimTranNo: body.esimTranNo, ...profile }] });
    }
    if (path === 'esim/topup') {
      const profile = state.profiles[body.esimTranNo];
      if (!profile) return error('310272', 'The esimTranNo does not exist.');
      const found = state.topUpPackages.find(item => item.slug === body.packageCode || item.packageCode === body.packageCode);
      if (!found) return error('310241', 'The packageCode does not exist.');
      if (body.amount !== undefined && Number(body.amount) !== found.price) return error('200005', 'Package price error. Check price.');
      if (!state.topUps[body.transactionId]) {
        if (found.price > state.balance) return error('200007', 'Insufficient account balance');
        state.balance -= found.price;
        profile.totalVolume += found.volume;
        if (profile.esimStatus === 'USED_UP') profile.esimStatus = 'IN_USE';
        state.topUps[body.transactionId] = { body, esimTranNo: body.esimTranNo };
      }
      return ok({ transactionId: body.transactionId, iccid: profile.iccid, expiredTime: profile.expiredTime, totalVolume: profile.totalVolume, totalDuration: 14, orderUsage: profile.orderUsage });
    }
    if (path === 'esim/cancel') {
      const profile = state.profiles[body.esimTranNo];
      if (!profile) return error('310272', 'The esimTranNo does not exist.');
      if (profile.smdpStatus !== 'RELEASED' || profile.esimStatus !== 'GOT_RESOURCE') return error('310403', 'The eSIM cannot be cancelled.');
      profile.esimStatus = 'CANCEL';
      state.balance += profile.price;
      return ok({});
    }
    if (path === 'esim/query') {
      const order = Object.values(state.orders).find(item => item.orderNo === body.orderNo);
      if (!order) return error('310272', 'The orderNo does not exist.');
      if (state.allocating) return error('200010', 'Profile is being downloaded for the order.');
      const esimList = Array.from({ length: order.count }, (_, index) => {
        const esimTranNo = `${order.orderNo.slice(1)}${index}`;
        state.profiles[esimTranNo] ??= {
          orderNo: order.orderNo,
          iccid: `894310817000${order.orderNo.slice(-4)}${index}`,
          ac: `LPA:1$rsp-eu.example.com$MATCH${order.orderNo.slice(-4)}${index}`,
          qrCodeUrl: `https://p.qrsim.net/${order.orderNo}${index}.png`,
          smdpStatus: 'RELEASED',
          esimStatus: order.status,
          apn: 'drei.at',
          expiredTime: '2027-04-09T18:34:17+0000',
          totalVolume: order.package.volume,
          totalDuration: order.package.duration,
          durationUnit: 'DAY',
          orderUsage: 0,
          price: order.package.price * (order.body.packageInfoList[0].periodNum ?? 1),
        };
        const profile = { ...state.profiles[esimTranNo] };
        delete profile.price;
        return { esimTranNo, ...profile };
      });
      return ok({ esimList });
    }
    return error('000001', `Fake eSIM Access has no ${path}`);
  });
  return { ...service, state, env: { ESIM_ACCESS_ACCESS_CODE: accessCode, ESIM_ACCESS_SECRET_KEY: secretKey, ESIM_ACCESS_API_URL: service.url, ESIM_ACCESS_WEBHOOK_TOKEN: 'esim-webhook-token-0123456789' } };
}

/**
 * Africa's Talking: airtime (a form post, `Sent` until the network confirms), Mobile Data (JSON, `Queued`), the
 * transaction lookup and the balance check, on one address for both hosts. `state.airtime`/`state.data` set the reply.
 */
export async function fakeAfricasTalking() {
  const state = { airtime: 'Sent', data: 'Queued', transactions: {}, sends: [], next: 1 };
  const service = await fakeService(({ method, url, headers, body, raw }) => {
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    if (headers.apikey !== 'at-key') return { status: 401, body: 'The supplied authentication is invalid', headers: { 'content-type': 'text/plain' } };
    if (method === 'GET' && path === '/version1/user') {
      return query.get('username') === 'bitocard' ? { body: { UserData: { balance: 'KES 12500.0000' } } } : { status: 401, body: { errorMessage: 'Invalid username' } };
    }
    if (method === 'POST' && path === '/version1/airtime/send') {
      const form = new URLSearchParams(raw.toString('utf8'));
      const [recipient] = JSON.parse(form.get('recipients'));
      state.sends.push({ kind: 'airtime', form: Object.fromEntries(form), recipient, idempotencyKey: headers['idempotency-key'] });
      const requestId = `ATQid_${state.next++}`;
      const [currency, amount] = recipient.amount.split(' ');
      const discount = (Number(amount) * 0.05).toFixed(4);
      if (state.airtime !== 'Failed') state.transactions[requestId] = state.airtime === 'Success' ? 'Success' : 'Pending';
      return {
        status: 201,
        body: {
          errorMessage: 'None',
          numSent: state.airtime === 'Failed' ? 0 : 1,
          totalAmount: `${currency} ${Number(amount).toFixed(4)}`,
          totalDiscount: `${currency} ${discount}`,
          responses: [
            {
              phoneNumber: recipient.phoneNumber,
              errorMessage: state.airtime === 'Failed' ? 'Invalid phone number' : 'None',
              amount: `${currency} ${Number(amount).toFixed(4)}`,
              discount: `${currency} ${discount}`,
              status: state.airtime,
              requestId: state.airtime === 'Failed' ? 'None' : requestId,
            },
          ],
        },
      };
    }
    if (method === 'POST' && path === '/mobile/data/request') {
      state.sends.push({ kind: 'data', body, idempotencyKey: headers['idempotency-key'] });
      const transactionId = `ATPid_${state.next++}`;
      const accepted = state.data === 'Queued';
      if (accepted) state.transactions[transactionId] = 'Queued';
      return { status: 201, body: { entries: [{ phoneNumber: body.recipients[0].phoneNumber, provider: 'Safaricom', status: state.data, transactionId: accepted ? transactionId : 'None', value: 'KES 250.0000' }] } };
    }
    if (method === 'GET' && path === '/query/transaction/find') {
      const status = state.transactions[query.get('transactionId')];
      if (!status) return { body: { status: 'Failure', errorMessage: 'Transaction not found' } };
      return { body: { status: 'Success', data: { transactionId: query.get('transactionId'), status, description: status === 'Failed' ? 'Network refused' : 'Done', providerRefId: status === 'Success' ? 'SFC123456' : 'None' } } };
    }
    return { status: 404, body: { errorMessage: `Fake Africa's Talking has no ${path}` } };
  });
  return {
    ...service,
    state,
    env: {
      AFRICAS_TALKING_USERNAME: 'bitocard',
      AFRICAS_TALKING_API_KEY: 'at-key',
      AFRICAS_TALKING_API_URL: service.url,
      AFRICAS_TALKING_DATA_URL: service.url,
      AFRICAS_TALKING_AIRTIME_DISCOUNT_PERCENT: '4',
      AFRICAS_TALKING_DATA_PRODUCT: 'BitoCard Data',
      AFRICAS_TALKING_DATA_PLANS: 'KE safaricom 1GB Month 299 250; KE airtel 500MB Week 99 80; KE nonsense',
      AFRICAS_TALKING_CALLBACK_TOKEN: 'at-callback',
    },
  };
}


/**
 * Vercel (registrar, project domains, domain config and DNS), Resend's domains API and DNS over HTTPS, on one address.
 * `state.taken` holds names already registered elsewhere; `state.configured` connected names whose DNS points to the
 * store; `state.owned` names on Vercel's DNS (bought, or nameservers moved).
 */
export async function fakeDomains() {
  const state = {
    taken: new Set(['taken.com']),
    owned: {},
    projectDomains: {},
    configured: new Set(),
    unverified: new Set(),
    records: {},
    orders: {},
    orderStatus: 'completed',
    buyReply: 'ok',
    renewReply: 'ok',
    renewals: 0,
    sending: {},
    sendingStatus: 'pending',
    emails: [],
    publicDns: {},
    next: 1,
  };
  const intended = ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'];
  const notFound = { status: 404, body: { error: { code: 'not_found', message: 'Not found' } } };
  const service = await fakeService(({ method, url, headers, body }) => {
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    if (path === '/dns-query') return { body: { Status: 0, Answer: state.publicDns[`${query.get('name')}|${query.get('type')}`] ?? [] } };
    if (path.startsWith('/domains') || path === '/emails') {
      if (headers.authorization !== 'Bearer resend-key') return { status: 401, body: { message: 'Invalid API key' } };
      if (method === 'POST' && path === '/emails') {
        state.emails.push(body);
        return { body: { id: `em_${state.next++}` } };
      }
      if (method === 'POST' && path === '/domains') {
        const id = `rd_${state.next++}`;
        state.sending[id] = {
          id,
          name: body.name,
          records: [
            { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: 'p=MIGfMA0GCSqGSIb3DQEB', ttl: 'Auto', status: 'not_started' },
            { record: 'SPF', name: 'send', type: 'MX', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10, ttl: 'Auto', status: 'not_started' },
            { record: 'SPF', name: 'send', type: 'TXT', value: 'v=spf1 include:amazonses.com ~all', ttl: 'Auto', status: 'not_started' },
          ],
        };
        return { status: 201, body: { ...state.sending[id], status: 'not_started' } };
      }
      const one = /^\/domains\/([\w-]+)(\/verify)?$/.exec(path);
      if (one && state.sending[one[1]]) return one[2] ? { body: { object: 'domain', id: one[1] } } : { body: { ...state.sending[one[1]], status: state.sendingStatus } };
      return { status: 404, body: { message: 'Not found' } };
    }
    if (headers.authorization !== 'Bearer vercel-token') return { status: 403, body: { error: { code: 'forbidden', message: 'Not authorized' } } };
    if (query.get('teamId') !== 'team_bitocard') return { status: 403, body: { error: { code: 'forbidden', message: 'Wrong team' } } };
    if (method === 'GET' && path === '/v9/projects/bitocard-storefront') return { body: { id: 'prj_store', name: 'bitocard-storefront' } };
    let match;
    if ((match = /^\/v1\/registrar\/domains\/([^/]+)\/availability$/.exec(path))) return { body: { available: !state.taken.has(match[1]) && !state.owned[match[1]] } };
    if ((match = /^\/v1\/registrar\/domains\/([^/]+)\/price$/.exec(path))) return { body: { years: 1, purchasePrice: 11.25, renewalPrice: 12.5, transferPrice: 11.25 } };
    if (method === 'POST' && (match = /^\/v1\/registrar\/domains\/([^/]+)\/buy$/.exec(path))) {
      if (state.buyReply === 'refuse') return { status: 400, body: { error: { code: 'domain_not_available', message: 'Domain is not available' } } };
      if (Math.abs(body.expectedPrice - 11.25) > 0.001 || body.autoRenew !== false) return { status: 400, body: { error: { code: 'price_mismatch', message: 'Expected price does not match' } } };
      const orderId = `ord_${state.next++}`;
      state.orders[orderId] = { domain: match[1], contact: body.contactInformation };
      state.owned[match[1]] = { expiresAt: Date.now() + 365 * 24 * 3600_000 };
      return { body: { orderId } };
    }
    if ((match = /^\/v1\/registrar\/orders\/([^/]+)$/.exec(path))) {
      const order = state.orders[match[1]];
      return order ? { body: { orderId: match[1], status: state.orderStatus, domains: [{ domainName: order.domain, status: state.orderStatus }] } } : notFound;
    }
    if (method === 'POST' && (match = /^\/v1\/registrar\/domains\/([^/]+)\/renew$/.exec(path))) {
      if (state.renewReply === 'refuse') return { status: 400, body: { error: { code: 'renewal_failed', message: 'Cannot renew' } } };
      if (state.renewReply === 'timeout') return { status: 504, body: { error: { code: 'timeout', message: 'Gateway timeout' } } };
      state.renewals += 1;
      state.owned[match[1]].expiresAt += 365 * 24 * 3600_000;
      return { body: { orderId: `ord_${state.next++}` } };
    }
    if (/^\/v1\/registrar\/domains\/([^/]+)\/auth-code$/.test(path)) return { body: { authCode: 'AUTH-7Kp2' } };
    if (method === 'POST' && path === '/v10/projects/bitocard-storefront/domains') {
      state.projectDomains[body.name] = { name: body.name, verified: !state.unverified.has(body.name) };
      return { body: { ...state.projectDomains[body.name], verification: [] } };
    }
    if ((match = /^\/v9\/projects\/bitocard-storefront\/domains\/([^/]+?)(\/verify)?$/.exec(path))) {
      const name = decodeURIComponent(match[1]);
      if (method === 'DELETE') {
        delete state.projectDomains[name];
        return { body: {} };
      }
      const found = state.projectDomains[name];
      if (!found) return notFound;
      found.verified = !state.unverified.has(name);
      return { body: { ...found, verification: found.verified ? [] : [{ type: 'TXT', domain: `_vercel.${name}`, value: 'vc-domain-verify=abc', reason: 'pending_domain_verification' }] } };
    }
    if ((match = /^\/v6\/domains\/([^/]+)\/config$/.exec(path))) {
      const name = decodeURIComponent(match[1]);
      return { body: { misconfigured: !(state.configured.has(name) || state.owned[name]), configuredBy: state.configured.has(name) ? 'A' : null, acceptedChallenges: [], recommendedIPv4: [{ rank: 1, value: ['76.76.21.21'] }], recommendedCNAME: [{ rank: 1, value: 'cname.vercel-dns.com.' }] } };
    }
    if ((match = /^\/v5\/domains\/([^/]+)$/.exec(path))) {
      const name = decodeURIComponent(match[1]);
      const owned = state.owned[name];
      if (!owned && !state.projectDomains[name]) return notFound;
      return { body: { domain: { name, serviceType: owned ? 'zeit.world' : 'external', nameservers: owned ? intended : ['ns1.registrar.example'], intendedNameservers: intended, expiresAt: owned?.expiresAt ?? null } } };
    }
    if ((match = /^\/v4\/domains\/([^/]+)\/records$/.exec(path))) return { body: { records: state.records[decodeURIComponent(match[1])] ?? [] } };
    if (method === 'POST' && (match = /^\/v2\/domains\/([^/]+)\/records$/.exec(path))) {
      const name = decodeURIComponent(match[1]);
      const id = `rec_${state.next++}`;
      (state.records[name] ??= []).push({ id, name: body.name, type: body.type, value: body.value, ttl: body.ttl, ...(body.mxPriority !== undefined ? { mxPriority: body.mxPriority } : {}), ...(body.comment ? { comment: body.comment } : {}) });
      return { body: { uid: id } };
    }
    if (method === 'DELETE' && (match = /^\/v2\/domains\/([^/]+)\/records\/([^/]+)$/.exec(path))) {
      const name = decodeURIComponent(match[1]);
      state.records[name] = (state.records[name] ?? []).filter(record => record.id !== match[2]);
      return { body: {} };
    }
    return { status: 404, body: { error: { code: 'not_found', message: `Fake Vercel has no ${method} ${path}` } } };
  });
  return {
    ...service,
    state,
    env: {
      VERCEL_API_TOKEN: 'vercel-token',
      VERCEL_TEAM_ID: 'team_bitocard',
      VERCEL_STOREFRONT_PROJECT: 'bitocard-storefront',
      VERCEL_API_URL: service.url,
      DOMAIN_MARGIN_PERCENT: '20',
      DOMAIN_DNS_LOOKUP_URL: `${service.url}/dns-query`,
      RESEND_API_KEY: 'resend-key',
      RESEND_API_URL: service.url,
    },
  };
}

/**
 * Remita Vending Bills (RemitaConnect gateway): categories, providers per category, products (two per page, filtered by
 * country and category), account checks, vends and requeries under /api/v1/vending. `state.reply` sets the next vend's
 * answer: `ok`, `pending` ("03"), `refuse` ("11", insufficient balance) or `lost` (vended, but the reply is a gateway
 * timeout). `state.vends[reference]` is what a requery finds; a repeat of a reference is answered "94" (duplicate).
 */
export async function fakeRemita() {
  const electricity = new Set(['101', '102', '201']);
  const products = [
    { code: '101', name: 'Eko PREPAID', provider: 'ekedc', categoryCode: 'electricity', countryCode: 'NGA', feeType: 'DYNAMIC', amount: 0.0 },
    { code: '102', name: 'Eko POSTPAID', provider: 'ekedc', categoryCode: 'electricity', countryCode: 'NGA', feeType: 'DYNAMIC', amount: 0.0 },
    { code: '201', name: 'Ikeja Prepaid', provider: 'ikedc', categoryCode: 'electricity', countryCode: 'NGA', feeType: 'DYNAMIC', amount: 0.0 },
    { code: 'dstv-padi', name: 'DStv Padi', provider: 'dstv', categoryCode: 'cable_tv', countryCode: 'NGA', feeType: 'FIXED', amount: 4400 },
    { code: 'gotv-smallie', name: 'GOtv Smallie', provider: 'gotv', categoryCode: 'cable_tv', countryCode: 'NGA', feeType: 'FIXED', amount: 1900 },
    { code: 'mtn-vtu', name: 'MTN Airtime', provider: 'mtn', categoryCode: 'airtime', countryCode: 'NGA', feeType: 'DYNAMIC', amount: 0.0 },
    { code: 'mtn-gh-vtu', name: 'MTN Ghana Airtime', provider: 'mtn_gh', categoryCode: 'airtime', countryCode: 'GHA', feeType: 'DYNAMIC', amount: 0.0 },
    { code: 'mtn-1gb', name: 'MTN 1GB 30 Days', provider: 'mtn', categoryCode: 'internet_data_subscription', countryCode: 'NGA', feeType: 'FIXED', amount: 1000 },
    { code: 'smile-5gb', name: 'Smile 5GB', provider: 'smile', categoryCode: 'internet_data_subscription', countryCode: 'NGA', feeType: 'FIXED', amount: 5000 },
  ];
  const categories = [
    { id: 1, name: 'electricity', code: 'electricity' },
    { id: 2, name: 'Airtime', code: 'airtime' },
    { id: 3, name: 'Internet Data Subscription', code: 'internet_data_subscription' },
    { id: 4, name: 'Cable TV', code: 'cable_tv' },
    { id: 5, name: 'Educations', code: 'educations' },
  ];
  const providers = {
    1: [{ code: 'ekedc', name: 'Eko Electricity Distribution Company', logoUrl: 'https://res.cloudinary.com/remita/eko.png' }, { code: 'ikedc', name: 'Ikeja Electricity Distribution Company', logoUrl: '' }],
    2: [{ code: 'mtn', name: 'MTN' }, { code: 'mtn_gh', name: 'MTN Ghana' }],
    3: [{ code: 'mtn', name: 'MTN' }, { code: 'smile', name: 'Smile' }],
    4: [{ code: 'dstv', name: 'DStv' }, { code: 'gotv', name: 'GoTV' }],
  };
  const accounts = { 12345678910: 'Adene Jonah', 2022075342: 'TEST DSTV CUSTOMER', 1402000001: 'SMILE CUSTOMER' };
  const state = { reply: 'ok', vends: {}, sent: [] };
  const ok = data => ({ body: { message: 'Approved or completed successfully', status: '00', data } });
  const vend = (body, status) => ({
    amount: body.amount,
    productCode: body.productCode,
    categoryCode: electricity.has(body.productCode) ? 'electricity' : 'other',
    token: electricity.has(body.productCode) ? '1123-4567-8567-8597-6545' : null,
    extraTokens: null,
    unit: electricity.has(body.productCode) ? '333.300' : null,
    clientReference: body.clientReference,
    paymentIdentifier: '1729988839525188',
    status,
  });
  const service = await fakeService(({ method, url, headers, body }) => {
    const [path, search = ''] = url.split('?');
    const query = new URLSearchParams(search);
    if (headers.secretkey !== 'remita-secret') return { status: 401, body: { status: '04', message: 'Authentication error' } };
    const route = path.replace(/^\/api\/v1\/vending/, '');
    if (method === 'GET' && route === '/categories') return ok({ totalPage: 1, totalContent: categories.length, items: categories });
    const byCategory = /^\/providers\/category\/(\d+)$/.exec(route);
    if (method === 'GET' && byCategory) return ok(providers[byCategory[1]] ?? []);
    if (method === 'GET' && route === '/products') {
      const found = products.filter(item => item.countryCode === query.get('countryCode') && item.categoryCode === query.get('categoryCode') && (!query.get('provider') || item.provider === query.get('provider')));
      const page = Number(query.get('page') ?? 0);
      return ok({ totalPage: Math.max(1, Math.ceil(found.length / 2)), totalContent: found.length, items: found.slice(page * 2, page * 2 + 2) });
    }
    if (method === 'POST' && route === '/validate') {
      const name = accounts[body.accountNumber];
      if (!name) return { body: { status: '02', message: 'Customer info could not be retrieved' } };
      return ok({ name, accountNumber: body.accountNumber, productCode: body.productCode, minAmount: 500, maxAmount: null, outstandingBalance: null, address: '34 Tokai, Abuja' });
    }
    if (method === 'POST' && route === '/transactions') {
      state.sent.push(body);
      if (state.vends[body.clientReference]) return { body: { status: '94', message: 'Duplicate Transaction' } };
      if (state.reply === 'refuse') return { status: 400, body: { status: '11', message: 'Insufficient balance' } };
      if (state.reply === 'pending') {
        state.vends[body.clientReference] = vend(body, 'pending');
        return { body: { status: '03', message: 'Transaction pending', data: { clientReference: body.clientReference } } };
      }
      state.vends[body.clientReference] = vend(body, 'completed');
      if (state.reply === 'lost') return { status: 504, body: '<html>Gateway timeout</html>', headers: { 'content-type': 'text/html' } };
      return ok(state.vends[body.clientReference]);
    }
    const requery = /^\/query-transaction\/(.+)$/.exec(route);
    if (method === 'GET' && requery) {
      const found = state.vends[decodeURIComponent(requery[1])];
      if (!found) return { body: { status: '22', message: 'Unknown payment reference' } };
      if (found.status === 'pending') return { body: { status: '03', message: 'Transaction pending' } };
      if (found.status === 'failed') return { body: { status: '01', message: 'Transaction failed' } };
      return ok(found);
    }
    return { status: 404, body: { status: '02', message: `Fake Remita has no ${path}` } };
  });
  return { ...service, state, env: { REMITA_SECRET_KEY: 'remita-secret', REMITA_API_URL: service.url, REMITA_CONTACT_PHONE: '08011111111' } };
}

/**
 * Anthropic's Messages API, OpenAI's and DeepSeek's Chat Completions, and their model lists, on one address. Keys that
 * start with `good` are accepted. `state.next` is the next reply's text, or `state.tool` a tool call to make once.
 */
export async function fakeAi() {
  const state = { next: 'Hello from the assistant.', tool: null, calls: [] };
  const service = await fakeService(({ method, url, headers, body }) => {
    const path = url.split('?')[0];
    const anthropic = path.startsWith('/v1/messages') || (path === '/v1/models' && headers['x-api-key']);
    const key = anthropic ? headers['x-api-key'] : String(headers.authorization ?? '').replace(/^Bearer /, '');
    if (!String(key).startsWith('good')) return { status: 401, body: { error: anthropic ? { type: 'authentication_error', message: 'invalid x-api-key' } : { message: 'Incorrect API key provided' } } };
    if (method === 'GET' && (path === '/v1/models' || path === '/models')) {
      return { body: { data: anthropic ? [{ id: 'claude-haiku-5-5' }, { id: 'claude-sonnet-5-5' }] : path === '/models' ? [{ id: 'deepseek-chat' }] : [{ id: 'gpt-5-mini' }] } };
    }
    state.calls.push({ path, headers, body });
    const tool = state.tool;
    state.tool = null;
    if (method === 'POST' && path === '/v1/messages') {
      return {
        body: {
          content: tool ? [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'toolu_1', name: tool.name, input: tool.arguments }] : [{ type: 'text', text: state.next }],
          stop_reason: tool ? 'tool_use' : 'end_turn',
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 },
        },
      };
    }
    if (method === 'POST' && (path === '/v1/chat/completions' || path === '/chat/completions')) {
      return {
        body: {
          choices: [{ message: { content: tool ? null : state.next, ...(tool ? { tool_calls: [{ id: 'call_1', type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }],
          usage: path === '/chat/completions' ? { prompt_tokens: 1000, completion_tokens: 30, prompt_cache_hit_tokens: 800 } : { prompt_tokens: 1000, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 700 } },
        },
      };
    }
    return { status: 404, body: { error: { message: `Fake AI has no ${path}` } } };
  });
  return { ...service, state, env: { ANTHROPIC_API_URL: service.url, OPENAI_API_URL: service.url, DEEPSEEK_API_URL: service.url } };
}
