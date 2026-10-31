// Udozo is the marketplace and B2B reselling, nothing of BitoCard's digital-products business
// (docs/BITOCARD_CLASSIFIEDS_PLAN.md, docs/BITOCARD_B2B_RESELLING_PLAN.md). Its admin and Seller HQ list only Udozo's
// switches, plan features and limits, notifications and integrations; BitoCard's own (the startup allowance, the welcome
// bonus, reserved accounts, resellers' own suppliers and gateways, spin and win, the digital-product store templates,
// suppliers, chargeback protection) never appear, and what is shown speaks in Udozo's name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { switchKeysFor } from '../dist/settings/settings.service.js';
import { planFeatureDetail, planFeaturesFor, planLimitsFor } from '../dist/plans/features.js';
import { notificationTypesFor } from '../dist/notifications/inbox.js';
import { groupsForProduct } from '../dist/integrations/definitions.js';

test("Udozo's feature switches are the marketplace's, resale's and the shared ones it uses", () => {
  assert.deepEqual(
    [...switchKeysFor('udozo')].sort(),
    ['classifieds', 'classifieds_assistant', 'classifieds_install_prompt', 'classifieds_resale', 'classifieds_safe_pay', 'custom_domains', 'customer_wallets', 'manual_reseller_approval', 'reseller_resale', 'reseller_two_step', 'shq_install_prompt'],
  );
  for (const key of ['startup_allowance', 'welcome_bonus', 'reserved_accounts', 'own_integrations', 'own_payment_gateways', 'spin_rewards', 'store_template_topups']) {
    assert.ok(switchKeysFor('bitocard').includes(key), `${key} stays BitoCard's`);
  }
});

test("Udozo's plans have no BitoCard features or limits, and say Udozo", () => {
  assert.deepEqual(planFeaturesFor('udozo'), ['custom_domains', 'white_label', 'store_traffic', 'priority_support', 'team_members']);
  assert.deepEqual(planLimitsFor('udozo'), ['domains_per_store', 'team_members', 'free_domains', 'webhook_endpoints']);
  assert.ok(planFeaturesFor('bitocard').includes('own_integrations') && planLimitsFor('bitocard').includes('stores') && !planLimitsFor('bitocard').includes('free_domains'));
  for (const feature of planFeaturesFor('udozo')) assert.doesNotMatch(JSON.stringify(planFeatureDetail(feature, 'udozo')), /BitoCard/, feature);
  assert.match(planFeatureDetail('priority_support', 'bitocard').description, /BitoCard/, "BitoCard's own words unchanged");
});

test('Udozo sends and lists none of BitoCard’s own notices', () => {
  const udozo = notificationTypesFor('udozo');
  for (const type of ['startup_allowance.granted', 'connection.approved', 'number.expiring', 'chargeback.opened', 'fee.refunded', 'admin.order.needs_review', 'admin.vpn.attention', 'admin.crypto.withdrawal_review', 'customer.esim.low_data', 'customer.p2p.order_opened']) {
    assert.ok(!udozo.includes(type), type);
    assert.ok(notificationTypesFor('bitocard').includes(type), `${type} stays BitoCard's`);
  }
  for (const type of ['resale.order_new', 'customer.classifieds.order_paid', 'admin.classifieds.dispute_opened', 'domain.purchased', 'payout.paid', 'security.password_changed']) assert.ok(udozo.includes(type), type);
});

test("Udozo's integrations are the platform services and pawaPay, never BitoCard's suppliers or Afrippa's addresses", () => {
  const groups = groupsForProduct('bitocard', 'udozo');
  const ids = groups.map(group => group.id);
  for (const id of ['reloadly', 'vtpass', 'didww', 'zendit', 'remita', 'esim_access', 'africas_talking', 'vpnresellers', 'telnyx', 'deepseek', 'support_ai']) assert.ok(!ids.includes(id), id);
  for (const id of ['email', 'flutterwave', 'paystack', 'stripe', 'pawapay', 'file_storage', 'domains', 'store_hosts', 'anthropic', 'openai']) assert.ok(ids.includes(id), id);
  assert.ok(groups.every(group => group.section === 'platform'), 'pawaPay sits with the platform services');
  assert.ok(!groups.flatMap(group => group.fields.map(field => field.key)).some(key => key.startsWith('AFRIPPA_')));
  assert.ok(groupsForProduct('bitocard', 'bitocard').some(group => group.id === 'reloadly'), "BitoCard's own list unchanged");
});
