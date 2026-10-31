// VPN credentials exist before the supplier call, are encrypted at rest, and are stable when a worker retries.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';

const { VpnCredentialsService } = await import('../dist/vpn/vpn-credentials.service.js');

const config = { ENCRYPTION_KEY: randomBytes(32).toString('base64') };

function fixture() {
  const state = { delivery: null, subscription: null };
  const order = {
    id: '10000000-0000-4000-8000-000000000001',
    resellerId: '20000000-0000-4000-8000-000000000001',
    mode: 'live',
    productId: '30000000-0000-4000-8000-000000000001',
    supplierCode: 'vpnresellers',
    supplierReference: '40000000-0000-4000-8000-000000000001',
    status: 'processing',
  };
  const prisma = {
    order: { findUniqueOrThrow: async () => order },
    vpnSubscription: {
      findUnique: async () => (state.subscription ? { ...state.subscription, delivery: state.delivery } : null),
    },
    $transaction: async work =>
      work({
        orderDelivery: {
          create: async ({ data }) => {
            state.delivery = { id: '50000000-0000-4000-8000-000000000001', ...data };
            return state.delivery;
          },
        },
        vpnSubscription: {
          create: async ({ data }) => {
            state.subscription = { id: '60000000-0000-4000-8000-000000000001', credentialVersion: 1, ...data };
            return state.subscription;
          },
        },
      }),
  };
  return { state, order, service: new VpnCredentialsService(prisma, config) };
}

describe('VPN credential preparation', () => {
  test('stores one encrypted delivery before provisioning and returns it unchanged on retry', async () => {
    const { state, order, service } = fixture();
    const first = await service.prepare(order.id);
    assert.equal(first.username, `bc-${order.supplierReference}`);
    assert.equal(first.password.length, 32);
    assert.equal(first.expiresAt.getTime() > Date.now() + 29 * 24 * 60 * 60 * 1000, true);
    assert.equal(state.delivery.kind, 'vpn_account');
    assert.equal(state.delivery.serial, first.username);
    assert.notEqual(state.delivery.codeEncrypted, first.password);
    assert.match(state.delivery.codeEncrypted, /^v1:/);
    assert.equal(state.subscription.status, undefined, 'the database default owns provisioning status');

    const encrypted = state.delivery.codeEncrypted;
    const second = await service.prepare(order.id);
    assert.deepEqual(second, first);
    assert.equal(state.delivery.codeEncrypted, encrypted);
  });

  test('refuses orders outside the VPNresellers processing transition', async () => {
    const wrongStatus = fixture();
    wrongStatus.order.status = 'completed';
    await assert.rejects(wrongStatus.service.prepare(wrongStatus.order.id), /processing order/);

    const wrongSupplier = fixture();
    wrongSupplier.order.supplierCode = 'stock';
    await assert.rejects(wrongSupplier.service.prepare(wrongSupplier.order.id), /VPNresellers supplier/);
  });
});
