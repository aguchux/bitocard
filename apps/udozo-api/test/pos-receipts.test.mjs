// Udozo POS receipts (docs/UDOZO_POS_PLAN.md, milestone 6): every sale as an 80 mm or 58 mm receipt (a gift receipt
// without prices) or an A4 invoice numbered once per shop; the customer gets the PDF on WhatsApp by sending the words
// its QR code fills in, from a number the cashier typed (the template's Get receipt button outside the 24-hour window),
// or by email with the PDF attached. Meta is a local fake; email is captured in the outbox.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { adminClient, confirmMobile, fakeService, lastEmailCode, startApp, testMobile } from './helpers.mjs';

let server;
let prisma;
let admin;
let graph;
let notices;
let outbox;
let email;
const appSecret = 'meta-app-secret';
let outCounter = 0;

before(async () => {
  graph = await fakeService(call => {
    const path = new URL(call.url, 'http://x').pathname;
    if (call.headers.authorization !== 'Bearer meta-token') return { status: 401, body: { error: { message: 'Invalid OAuth access token', code: 190 } } };
    if (call.method === 'POST' && path === '/PNID/messages') return call.body?.status === 'read' ? { body: { success: true } } : { body: { messages: [{ id: `wamid.out.${(outCounter += 1)}` }] } };
    if (call.method === 'POST' && path === '/PNID/media') return { body: { id: `media-up-${(outCounter += 1)}` } };
    return { status: 404, body: { error: { message: 'unknown', code: 100 } } };
  });
  server = await startApp({
    env: {
      APP_PRODUCT: 'udozo',
      WHATSAPP_PHONE_NUMBER_ID: 'PNID', WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA', WHATSAPP_NUMBER: '+2348000000000', WHATSAPP_ACCESS_TOKEN: 'meta-token',
      WHATSAPP_APP_SECRET: appSecret, WHATSAPP_VERIFY_TOKEN: 'verify-me-please', WHATSAPP_API_URL: graph.url,
    },
  });
  prisma = server.app.get((await import('../dist/database/prisma.service.js')).PrismaService);
  notices = server.app.get((await import('../dist/whatsapp/notices.service.js')).WhatsappNotices);
  outbox = server.app.get((await import('../dist/whatsapp/outbox.service.js')).WhatsappOutbox);
  email = server.app.get((await import('../dist/notifications/email.service.js')).EmailService);
  admin = await adminClient(server);
  for (const key of ['classifieds', 'pos', 'whatsapp_channel']) assert.equal((await admin.put(`/v1/admin/switches/${key}`, { country_code: 'NG', enabled: true })).status, 200, key);
  await prisma.classifiedMarketSettings.update({ where: { country: 'NG' }, data: { firstListingsReviewed: 0 } });
});

after(async () => {
  await server?.close();
  await graph?.close();
});

function client() {
  let token = null;
  const request = async (method, path, body) => {
    const res = await fetch(`${server.base}${path}`, {
      method,
      headers: {
        ...(token ? { 'bitocard-customer-session': token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method === 'POST' ? { 'idempotency-key': `receipts-${randomUUID()}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const type = res.headers.get('content-type') ?? '';
    if (type.startsWith('application/pdf')) return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (json?.session?.token) token = json.session.token;
    return { status: res.status, json };
  };
  return { get: path => request('GET', path), post: (path, body = {}) => request('POST', path, body), patch: (path, body) => request('PATCH', path, body) };
}

let counter = 0;
async function owner(shop = "Ada's Gadget Hub") {
  const who = client();
  const address = `receipts${(counter += 1)}-${Date.now()}@example.com`;
  const signup = await who.post('/v1/store/account/signup', { name: 'Ada Okafor', email: address, password: 'correct horse battery', country: 'NG', phone: testMobile('NG') });
  assert.equal(signup.status, 201, JSON.stringify(signup.json));
  await confirmMobile(server.app, who);
  assert.equal((await who.post('/v1/store/account/email/verify', { code: await lastEmailCode(server.app, address) })).status, 200);
  await who.post('/v1/classifieds/terms/accept', { version: (await who.get('/v1/classifieds/terms')).json.version });
  assert.equal((await who.post('/v1/pos/owner/signup', { plan: 'free', shop: { name: shop, vat_bps: 750, address: '12 Allen Avenue, Ikeja', phone: '0803 000 1111', tin: '12345678-0001' } })).status, 201);
  const me = await who.get('/v1/pos/owner');
  who.shop = me.json.account.shops[0];
  who.till = who.shop.tills[0];
  return who;
}

async function sale(who, extra = {}) {
  const category = await prisma.classifiedCategory.findUniqueOrThrow({ where: { slug: 'tvs' } });
  const made = await who.post('/v1/classifieds/listings', { title: `Wireless Earbuds Pro ${randomUUID().slice(0, 4)}`, price: 1_850_000, category_id: category.id, stock: 50, pos_enabled: true, on_shop: false });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const listing = (await who.post(`/v1/classifieds/listings/${made.json.id}/submit`)).json;
  const total = 1_850_000 + Math.round((1_850_000 * 750) / 10_000);
  const sold = await who.post('/v1/pos/owner/sales', { till_id: who.till.id, client_sale_id: randomUUID(), lines: [{ listing_id: listing.id, quantity: 1 }], payments: [{ method: 'transfer', amount: total, reference: 'GTB 0042' }], expected_total: total, ...extra });
  assert.equal(sold.status, 201, JSON.stringify(sold.json));
  return sold.json;
}

let inCounter = 0;
async function whatsappSays(from, message) {
  inCounter += 1;
  const body = { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PNID' }, contacts: [{ wa_id: from, profile: { name: 'Shopper' } }], messages: [{ from, id: `wamid.in.${inCounter}.${Math.random()}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }] };
  const start = graph.calls.length;
  const raw = JSON.stringify(body);
  const res = await fetch(`${server.base}/v1/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}` }, body: raw });
  assert.equal(res.status, 200);
  await notices.idle();
  await outbox.idle();
  return graph.calls.slice(start);
}
const sentTo = (calls, waId) => calls.filter(call => call.url.endsWith('/PNID/messages') && call.body?.to === waId && !call.body.status).map(call => call.body);
const text = body => ({ type: 'text', text: { body } });
const tap = id => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
const pageWidth = bytes => Number(/\/MediaBox \[0 0 ([\d.]+) /.exec(bytes.toString('latin1'))?.[1]);

describe('receipt PDFs', () => {
  test('80 mm and 58 mm receipts, a gift receipt and an A4 invoice numbered once per shop', async () => {
    const ada = await owner();
    const first = await sale(ada);
    const receipt = await ada.get(`/v1/pos/owner/sales/${first.id}/receipt.pdf`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.headers.get('cache-control'), 'no-store, private');
    assert.match(receipt.headers.get('content-disposition'), new RegExp(`Receipt-${first.number}\\.pdf`));
    assert.equal(receipt.bytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(Math.abs(pageWidth(receipt.bytes) - 226.77) < 0.1, '80 mm paper by default');
    assert.ok(Math.abs(pageWidth((await ada.get(`/v1/pos/owner/sales/${first.id}/receipt.pdf?width=58&gift=true`)).bytes) - 164.41) < 0.1, '58 mm paper');

    const invoice = await ada.get(`/v1/pos/owner/sales/${first.id}/receipt.pdf?kind=invoice`);
    assert.equal(invoice.status, 200);
    const year = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric' }).format(new Date());
    assert.match(invoice.headers.get('content-disposition'), new RegExp(`Invoice-INV-${year}-0001\\.pdf`));
    assert.ok(Math.abs(pageWidth(invoice.bytes) - 595.28) < 0.1, 'A4');
    await ada.get(`/v1/pos/owner/sales/${first.id}/receipt.pdf?kind=invoice`);
    const second = await sale(ada);
    assert.match((await ada.get(`/v1/pos/owner/sales/${second.id}/receipt.pdf?kind=invoice`)).headers.get('content-disposition'), new RegExp(`INV-${year}-0002`), 'the next number, the first kept');
    assert.equal((await ada.get(`/v1/pos/owner/sales/${first.id}/receipts`)).json.invoice_number, `INV-${year}-0001`);

    // Another shop's sale is never theirs.
    const other = await owner('Kemi Phones');
    assert.equal((await other.get(`/v1/pos/owner/sales/${first.id}/receipt.pdf`)).status, 404);
    assert.equal((await other.get(`/v1/pos/owner/sales/${first.id}/receipts`)).status, 404);
  });

  test('the shop keeps its email, bank account and whether receipts print the QR code', async () => {
    const ada = await owner();
    const saved = await ada.patch(`/v1/pos/owner/shops/${ada.shop.id}`, { email: 'Sales@AdaGadgets.ng', bank_name: 'GTBank', bank_account_name: "Ada's Gadget Hub", bank_account_number: '0123 456 789', receipt_qr: false });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const shop = (await ada.get('/v1/pos/owner')).json.account.shops[0];
    assert.deepEqual([shop.email, shop.bank, shop.receipt_qr], ['sales@adagadgets.ng', { name: 'GTBank', account_name: "Ada's Gadget Hub", account_number: '0123456789' }, false]);
    assert.equal((await ada.patch(`/v1/pos/owner/shops/${ada.shop.id}`, { email: 'not an email' })).json.error.param, 'email');

    const sold = await sale(ada);
    const overview = (await ada.get(`/v1/pos/owner/sales/${sold.id}/receipts`)).json;
    assert.equal(overview.print.qr, null, 'no QR code when the shop prints none');
    assert.equal(overview.shop.email, 'sales@adagadgets.ng');
  });
});

describe('receipts on WhatsApp', () => {
  test("the receipt's QR code: the customer sends its words and gets the PDF, then the invoice; the till sees it delivered", async () => {
    const ada = await owner();
    const sold = await sale(ada);
    const overview = (await ada.get(`/v1/pos/owner/sales/${sold.id}/receipts`)).json;
    assert.equal(overview.whatsapp.available, true);
    assert.match(overview.print.qr.text, new RegExp(`^RECEIPT ${sold.number}-[A-Z2-9]{8}$`));
    assert.equal(overview.print.qr.whatsapp_url, `https://wa.me/2348000000000?text=${encodeURIComponent(overview.print.qr.text)}`);
    assert.equal((await ada.get(`/v1/pos/owner/sales/${sold.id}/receipts`)).json.print.qr.text, overview.print.qr.text, 'the printed code is the same every time');

    const shown = await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt-codes`, { kind: 'receipt' });
    assert.equal(shown.status, 201, JSON.stringify(shown.json));
    assert.equal(shown.json.used_at, null);
    assert.ok(new Date(shown.json.expires_at).getTime() - Date.now() <= 10 * 60_000 + 5_000, 'ten minutes');

    const waId = '2348031114417';
    const calls = await whatsappSays(waId, text(shown.json.text.toLowerCase()));
    assert.ok(calls.some(call => call.url.endsWith('/PNID/media')), 'uploaded to Meta, never a public link');
    const [document, offer] = sentTo(calls, waId);
    assert.equal(document.type, 'document');
    assert.equal(document.document.filename, `Receipt-${sold.number}.pdf`);
    assert.match(document.document.id, /^media-up-/);
    assert.match(document.document.caption, /Ada's Gadget Hub/);
    const code = shown.json.text.split('-').pop();
    assert.deepEqual(offer.interactive.action.buttons.map(button => button.reply.id), [`rinv:${code}`]);

    const status = (await ada.get(`/v1/pos/owner/sales/${sold.id}/receipt-codes/${shown.json.id}`)).json;
    assert.ok(status.used_at);
    assert.equal(status.delivered_to, '+234 803 ••• 4417');

    const invoice = sentTo(await whatsappSays(waId, tap(`rinv:${code}`)), waId)[0];
    assert.match(invoice.document.filename, /^Invoice-INV-\d{4}-0001\.pdf$/);

    const sends = (await ada.get(`/v1/pos/owner/sales/${sold.id}/receipts`)).json.sends;
    assert.deepEqual(sends.map(send => [send.via, send.kind, send.to, send.status]), [
      ['qr', 'invoice', '+234 803 ••• 4417', 'sent'],
      ['qr', 'receipt', '+234 803 ••• 4417', 'sent'],
    ]);
  });

  test('wrong, expired and closed codes are answered in words; nothing is sent', async () => {
    const ada = await owner();
    const sold = await sale(ada);
    const shown = (await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt-codes`, {})).json;
    const waId = '2348031119999';
    const code = shown.text.split('-').pop();
    const wrongNumber = sentTo(await whatsappSays(waId, text(`RECEIPT POS-999999-${code}`)), waId);
    assert.match(wrongNumber[0].text.body, /could not find that receipt/);
    await prisma.posReceiptCode.update({ where: { id: shown.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.match(sentTo(await whatsappSays(waId, text(shown.text)), waId)[0].text.body, /expired. Ask Ada's Gadget Hub/);
    assert.equal(await prisma.posReceiptSend.count({ where: { saleId: sold.id } }), 0);
  });

  test("to a number the cashier typed: the template's Get receipt button outside the window, the PDF at once inside it", async () => {
    const ada = await owner();
    const customer = (await ada.post('/v1/pos/owner/customers', { name: 'Chief Okoro' })).json;
    const sold = await sale(ada, { customer_id: customer.id });

    const fresh = '08035550199';
    const start = graph.calls.length;
    const sent = await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt/whatsapp`, { phone: fresh, save_to_customer: true });
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    assert.equal(sent.json.to, '+234 803 ••• 0199');
    await outbox.idle();
    const [template] = sentTo(graph.calls.slice(start), '2348035550199');
    assert.equal(template.type, 'template');
    assert.equal(template.template.name, 'udozo_pos_receipt');
    assert.deepEqual(template.template.components[0].parameters.map(p => p.text), ["Ada's Gadget Hub", sold.number, 'NGN 19,887.50']);
    const payload = template.template.components[1].parameters[0].payload;
    assert.match(payload, /^rcpt:[A-Z2-9]{8}$/);
    assert.equal((await prisma.posCustomer.findUniqueOrThrow({ where: { id: customer.id } })).phone, '+2348035550199', 'kept on the customer who had none');

    const sends = (await ada.get(`/v1/pos/owner/sales/${sold.id}/receipts`)).json.sends;
    assert.deepEqual([sends[0].via, sends[0].status, sends[0].template], ['whatsapp', 'sent', true]);

    // Tapping Get receipt opens the window and brings the PDF.
    const document = sentTo(await whatsappSays('2348035550199', tap(payload)), '2348035550199')[0];
    assert.equal(document.document.filename, `Receipt-${sold.number}.pdf`);

    // Now inside the window, the next one goes as the PDF itself.
    const again = graph.calls.length;
    assert.equal((await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt/whatsapp`, { phone: '+2348035550199', kind: 'invoice' })).status, 201);
    await outbox.idle();
    assert.match(sentTo(graph.calls.slice(again), '2348035550199')[0].document.filename, /^Invoice-INV-/);
  });

  test('refused: another country’s number, a number that said STOP, and a country where WhatsApp is closed', async () => {
    const ada = await owner();
    const sold = await sale(ada);
    assert.equal((await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt/whatsapp`, { phone: '+233241234567' })).json.error.code, 'phone_wrong_country');
    await prisma.whatsappContact.upsert({ where: { waId: '2348035550777' }, create: { waId: '2348035550777', country: 'NG', optedOutAt: new Date() }, update: { optedOutAt: new Date() } });
    assert.equal((await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt/whatsapp`, { phone: '08035550777' })).json.error.code, 'whatsapp_opted_out');

    assert.equal((await admin.put('/v1/admin/switches/whatsapp_channel', { country_code: 'NG', enabled: false })).status, 200);
    try {
      const overview = (await ada.get(`/v1/pos/owner/sales/${sold.id}/receipts`)).json;
      assert.deepEqual([overview.whatsapp.available, overview.print.qr], [false, null]);
      assert.equal((await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt-codes`, {})).json.error.code, 'whatsapp_unavailable');
      assert.equal((await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt/whatsapp`, { phone: '08035550123' })).json.error.code, 'whatsapp_unavailable');
    } finally {
      await admin.put('/v1/admin/switches/whatsapp_channel', { country_code: 'NG', enabled: true });
    }
  });
});

describe('receipts by email', () => {
  test('the receipt and invoice attached as PDFs; masked on the record; at most ten sends a day per sale', async () => {
    const ada = await owner();
    const customer = (await ada.post('/v1/pos/owner/customers', { name: 'Mama Nkechi' })).json;
    const sold = await sale(ada, { customer_id: customer.id });
    const before = email.outbox.length;
    const sent = await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt/email`, { email: 'Nkechi@Example.com', attach: 'both', save_to_customer: true });
    assert.equal(sent.status, 201, JSON.stringify(sent.json));
    assert.deepEqual([sent.json.via, sent.json.kind, sent.json.to, sent.json.status], ['email', 'both', 'n***@example.com', 'sent']);
    const message = email.outbox.slice(before).find(item => item.to === 'nkechi@example.com');
    assert.equal(message.subject, `Your receipt from Ada's Gadget Hub · NGN 19,887.50`);
    assert.deepEqual(message.attachments.map(file => [file.filename.replace(/INV-\d{4}-\d{4}/, 'INV'), file.contentType, file.content.subarray(0, 5).toString()]), [
      [`Receipt-${sold.number}.pdf`, 'application/pdf', '%PDF-'],
      ['Invoice-INV.pdf', 'application/pdf', '%PDF-'],
    ]);
    assert.equal((await prisma.posCustomer.findUniqueOrThrow({ where: { id: customer.id } })).email, 'nkechi@example.com');

    for (let index = 1; index < 10; index += 1) assert.equal((await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt/email`, { email: 'nkechi@example.com' })).status, 201);
    const refused = await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt/email`, { email: 'nkechi@example.com' });
    assert.deepEqual([refused.status, refused.json.error.code], [429, 'receipt_send_limit']);
    assert.equal((await ada.post(`/v1/pos/owner/sales/${sold.id}/receipt/email`, { email: 'nope' })).status, 400);
  });
});

describe('receipt helpers', () => {
  test('words a QR code fills in, cashiers as first name and initial, and where an invoice stands', async () => {
    const { receiptCodeIn } = await import('../dist/whatsapp/receipts.js');
    const { shortName } = await import('../dist/pos/receipts.service.js');
    const { invoiceStatus } = await import('../dist/pos/receipt-pdf.js');
    assert.deepEqual(receiptCodeIn(' receipt pos-000123-k7m2q9xa '), { number: 'POS-000123', code: 'K7M2Q9XA' });
    assert.deepEqual(receiptCodeIn('RECEIPT POS-000123 K7M2Q9XA'), { number: 'POS-000123', code: 'K7M2Q9XA' });
    assert.equal(receiptCodeIn('receipt please'), null);
    assert.equal(receiptCodeIn('RECEIPT POS-000123-K7M2Q9X1'), null, 'never a 1, 0, O or I');
    assert.deepEqual([shortName('Blessing  Musa Adeyemi'), shortName('Kemi')], ['Blessing A.', 'Kemi']);
    const paid = { refunded: null, total: 1000, payments: [{ method: 'cash', amount: 1000 }] };
    assert.equal(invoiceStatus(paid), 'PAID');
    assert.equal(invoiceStatus({ ...paid, payments: [{ method: 'cash', amount: 400 }, { method: 'credit', amount: 600 }] }), 'PART PAID');
    assert.equal(invoiceStatus({ ...paid, payments: [{ method: 'credit', amount: 1000 }] }), 'UNPAID');
    assert.equal(invoiceStatus({ ...paid, refunded: { when: 'today', reason: null } }), 'REFUNDED');
  });
});
