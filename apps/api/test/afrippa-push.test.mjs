// Device push for Afrippa's admins (docs/CRYPTO_SPINOFF_PLAN.md, step 4 part 3): their browsers on admin.afrippa.com
// subscribe to Afrippa's own push key (its Browser push integration, never BitoCard's), choose among Afrippa's admin
// notices only, and get Afrippa's notices signed with Afrippa's key; BitoCard's admins never get them, nor the reverse.
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import webpush from 'web-push';
import { adminClient, adminCode, afrippaAdminClient, fakeService, startApp } from './helpers.mjs';

const bitocardVapid = webpush.generateVAPIDKeys();
const afrippaVapid = webpush.generateVAPIDKeys();
let server;
let pushService;
let inbox;

before(async () => {
  pushService = await fakeService(() => ({ status: 201, body: '' }));
  // BitoCard's push keys come from the environment, as on the droplet; Afrippa's never do.
  server = await startApp({
    env: { WEBHOOK_ALLOW_PRIVATE_URLS: 'on', WEB_PUSH_PUBLIC_KEY: bitocardVapid.publicKey, WEB_PUSH_PRIVATE_KEY: bitocardVapid.privateKey, WEB_PUSH_SUBJECT: 'mailto:ops@bitocard.com' },
  });
  inbox = server.app.get((await import('../dist/notifications/inbox.service.js')).InboxService);
});

after(async () => {
  await server?.close();
  await pushService?.close();
});

let count = 0;
const subscription = () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const path = `/push/afrippa-${(count += 1)}-${Date.now()}`;
  return { path, json: { endpoint: `${pushService.url}${path}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } } };
};
const until = async (check, what) => {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};
/** The VAPID key and contact a push was signed with, from its Authorization header (`vapid t=<jwt>, k=<key>`). */
const signer = call => {
  const header = call.headers.authorization;
  const key = /k=([A-Za-z0-9_-]+)/.exec(header)[1];
  const jwt = /t=([^,\s]+)/.exec(header)[1];
  return { key, sub: JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')).sub };
};

describe("Afrippa's admins' devices", () => {
  test('push is off for Afrippa until Afrippa sets its own keys, whatever BitoCard has', async () => {
    const afrippa = await afrippaAdminClient(server);
    assert.deepEqual((await afrippa.get('/v1/afrippa/admin/devices/push-settings')).json, { object: 'push_settings', enabled: false, public_key: null });
    const refused = await afrippa.post('/v1/afrippa/admin/devices', subscription().json);
    assert.deepEqual([refused.status, refused.json.error.code], [409, 'push_not_configured']);
    // BitoCard's admins keep BitoCard's key.
    const bitocard = await adminClient(server);
    assert.equal((await bitocard.get('/v1/admin/devices/push-settings')).json.public_key, bitocardVapid.publicKey);
  });

  test("with Afrippa's keys: its own key, its own notices, pushes signed by Afrippa, and each product kept apart", async () => {
    const afrippa = await afrippaAdminClient(server);
    const saved = await afrippa.put('/v1/afrippa/admin/integrations/web_push', {
      values: { WEB_PUSH_PUBLIC_KEY: afrippaVapid.publicKey, WEB_PUSH_PRIVATE_KEY: afrippaVapid.privateKey },
      code: await adminCode(server, afrippa),
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual((await afrippa.get('/v1/afrippa/admin/devices/push-settings')).json, { object: 'push_settings', enabled: true, public_key: afrippaVapid.publicKey });

    const sub = subscription();
    const registered = await afrippa.post('/v1/afrippa/admin/devices', sub.json);
    assert.equal(registered.status, 201, JSON.stringify(registered.json));
    assert.equal(registered.json.current, true);
    assert.equal((await afrippa.get('/v1/afrippa/admin/devices')).json.data.length, 1);

    // Only Afrippa's admin notices to choose from, never BitoCard's.
    const types = (await afrippa.get('/v1/afrippa/admin/notification-preferences')).json.data.map(item => item.type);
    assert.ok(types.includes('admin.p2p.order_appealed'), types.join());
    assert.ok(types.includes('admin.afrippa.ticket_created'));
    assert.ok(!types.includes('admin.dispute.escalated'), 'never BitoCard admin notices');
    const bitocard = await adminClient(server);
    const bitocardTypes = (await bitocard.get('/v1/admin/notification-preferences')).json.data.map(item => item.type);
    assert.ok(!bitocardTypes.some(type => type.startsWith('admin.p2p.') || type.startsWith('admin.afrippa.')), bitocardTypes.join());
    const muted = await afrippa.put('/v1/afrippa/admin/notification-preferences/admin.dispute.escalated', { push: false });
    assert.deepEqual([muted.status, muted.json.error.code], [404, 'resource_missing']);

    // A BitoCard admin's browser registered on BitoCard's admin.
    const bitocardSub = subscription();
    assert.equal((await bitocard.post('/v1/admin/devices', bitocardSub.json)).status, 201);

    // An Afrippa notice reaches the Afrippa admin's browser, signed with Afrippa's key and contact; never BitoCard's admin.
    await inbox.afrippaAdmins('admin.p2p.order_appealed', { subject: `appeal-${Date.now()}`, title: 'An order was appealed', body: 'ORD-000001 needs a decision.', link: '/orders/x' });
    await until(() => pushService.calls.some(call => call.url === sub.path), 'the Afrippa push');
    const pushed = pushService.calls.filter(call => call.url === sub.path);
    assert.equal(pushed.length, 1);
    assert.deepEqual(signer(pushed[0]), { key: afrippaVapid.publicKey, sub: 'mailto:support@afrippa.com' });
    assert.equal(pushService.calls.filter(call => call.url === bitocardSub.path).length, 0, "BitoCard's admins never get Afrippa's notices");

    // A BitoCard notice is signed with BitoCard's key and never reaches Afrippa's admin.
    await inbox.admins('admin.dispute.escalated', { subject: `dispute-${Date.now()}`, title: 'A dispute was escalated', body: 'D-000001', link: '/orders/disputes' });
    await until(() => pushService.calls.some(call => call.url === bitocardSub.path), 'the BitoCard push');
    assert.equal(signer(pushService.calls.find(call => call.url === bitocardSub.path)).key, bitocardVapid.publicKey);
    assert.equal(pushService.calls.filter(call => call.url === sub.path).length, 1);

    // A test push uses Afrippa's key too.
    const tested = await afrippa.post(`/v1/afrippa/admin/devices/${registered.json.id}/test`);
    assert.deepEqual([tested.status, tested.json.sent], [200, true]);
    assert.equal(signer(pushService.calls.filter(call => call.url === sub.path).at(-1)).key, afrippaVapid.publicKey);
  });

  test("each realm's device routes are closed to the other", async () => {
    const afrippa = await afrippaAdminClient(server);
    const bitocard = await adminClient(server);
    assert.ok([401, 403].includes((await afrippa.get('/v1/admin/devices')).status));
    assert.ok([401, 403].includes((await bitocard.get('/v1/afrippa/admin/devices')).status));
  });
});
