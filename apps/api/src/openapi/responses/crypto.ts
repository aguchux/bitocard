import { array, bool, constant, int, list, mode, nullableInt, nullableStr, nullableTime, objectSchema, oneOf, ref, shape, str, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

/** A reseller's own coins on chain (`/v1/crypto`): the coin wallet, deposits and withdrawals. */
const coin = str('Coin amount, as a decimal string in the coin’s units.');
const chain = str('Network code, for example `ETHEREUM`, `TRON` or `BITCOIN`.');
const withdrawalStatus = oneOf(
  '`awaiting_code` (the emailed code is needed), `review` (BitoCard approves it first), `queued`, `submitting`, `broadcast` (sent, waiting for confirmations), `completed`, `failed`, `rejected` or `cancelled`. Failed, rejected and cancelled ones return the coins.',
  ['awaiting_code', 'review', 'queued', 'submitting', 'broadcast', 'completed', 'failed', 'rejected', 'cancelled'],
);

const wallet = objectSchema('ResellerCoins', {
  object: constant('reseller_coins'),
  mode,
  onchain: bool('Whether your plan lets you deposit coins on chain (Premium). Withdrawing what you hold is always open.'),
  withdrawal_chains: array(shape({ chain, name: str('Network name.') }), 'The networks a withdrawal address can be saved on.'),
  assets: array(shape({
    asset: str('Coin code.'),
    name: str('Coin name.'),
    decimals: int('Decimal places of the coin.'),
    enabled: bool('Whether BitoCard offers the coin now (one switched off is listed while you hold some).'),
    available: coin,
    withdrawing: str('On its way out on chain (asked, confirmed or being sent), in the coin’s units.'),
  })),
});
const network = objectSchema('CryptoDepositNetwork', {
  object: constant('crypto_network'),
  asset: str('Coin code.'),
  chain,
  name: str('Network name.'),
  token: nullableStr('The token standard (`ERC-20`, `BEP-20`, `TRC-20`), or null for the network’s own coin.'),
  confirmations: int('Confirmations before a deposit is credited.'),
});
const address = objectSchema('CryptoDepositAddress', {
  object: constant('crypto_deposit_address'),
  mode,
  asset: str('Coin code.'),
  chain,
  network: str('Network name.'),
  address: str('Your deposit address on that network.'),
  contract: nullableStr('The token contract to check before sending, or null for the network’s own coin.'),
  confirmations: int('Confirmations before a deposit is credited.'),
  watch_until: time('Watched closely for deposits until then (renewed each time it is shown); later deposits are still found.'),
});
const deposit = objectSchema('CryptoDeposit', {
  object: constant('crypto_deposit'),
  id: uuid('Deposit ID.'),
  mode,
  asset: str('Coin code.'),
  chain,
  network: str('Network name.'),
  tx_hash: str('The transaction on chain.'),
  amount: coin,
  status: oneOf('`pending`, `credited`, `ignored` (too small or too large to credit) or `failed` (no longer on chain).', ['pending', 'credited', 'ignored', 'failed']),
  confirmations: int('Confirmations so far.'),
  confirmations_needed: nullableInt('Confirmations needed before it is credited.'),
  created_at: time('When it was first seen.'),
  credited_at: nullableTime('When it reached your coin wallet.'),
});
const savedAddress = objectSchema('CryptoWithdrawalAddress', {
  object: constant('crypto_withdrawal_address'),
  id: uuid('Address ID.'),
  mode,
  chain,
  network: str('Network name.'),
  address: str('The address, in its standard form.'),
  label: str('Your name for it.'),
  usable_from: time('Withdrawals to it can start from then (24 hours after it was added).'),
  ready: bool('Whether it can be used now.'),
  created_at: time('When it was added.'),
});
const withdrawalNetworks = objectSchema('CryptoWithdrawalNetworks', {
  object: constant('crypto_withdrawal_networks'),
  asset: str('Coin code.'),
  daily_limit: coin,
  remaining_today: str('What can still be withdrawn in the next 24 hours, in the coin’s units.'),
  data: array(shape({ object: constant('crypto_network'), chain, name: str('Network name.'), fee: str('BitoCard’s network fee, taken on top.'), minimum: str('The smallest withdrawal.'), confirmations: int('Confirmations before it is settled.') })),
});
const withdrawal = objectSchema('CryptoWithdrawal', {
  object: constant('crypto_withdrawal'),
  id: uuid('Withdrawal ID.'),
  number: str('Shown as `CW-000123`.'),
  mode,
  asset: str('Coin code.'),
  chain,
  network: str('Network name.'),
  address: str('Where it is sent.'),
  amount: coin,
  fee: str('BitoCard’s network fee.'),
  total: str('Amount plus fee: what left the coin wallet.'),
  status: withdrawalStatus,
  review_reason: nullableStr('While it waits for review: `amount`, `unscreened` or `recent_card_top_up`.'),
  code_sent_at: nullableTime('While it waits for its code: when the latest one was emailed (another can be asked for a minute later).'),
  tx_hash: nullableStr('The transaction, once broadcast.'),
  confirmations: int('Confirmations so far.'),
  created_at: time('When it was asked for.'),
  completed_at: nullableTime('When it was settled.'),
});
const preview = objectSchema('CryptoWithdrawalPreview', {
  object: constant('crypto_withdrawal_preview'),
  mode,
  asset: str('Coin code.'),
  chain,
  network: str('Network name.'),
  address: str('Where it would be sent.'),
  amount: coin,
  fee: str('BitoCard’s network fee.'),
  total: str('What would leave the coin wallet.'),
  needs_approval: bool('Whether BitoCard approves it before it is sent.'),
});

const walletExample = {
  object: 'reseller_coins',
  mode: 'test',
  onchain: true,
  withdrawal_chains: [{ chain: 'ETHEREUM', name: 'Ethereum' }, { chain: 'TRON', name: 'TRON' }],
  assets: [{ asset: 'USDT', name: 'Tether USD', decimals: 6, enabled: true, available: '78.500000', withdrawing: '0.000000' }],
};
const networkExample = { object: 'crypto_network', asset: 'USDT', chain: 'ETHEREUM', name: 'Ethereum', token: 'ERC-20', confirmations: 12 };
const addressExample = { object: 'crypto_deposit_address', mode: 'test', asset: 'USDT', chain: 'ETHEREUM', network: 'Ethereum', address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  contract: '0x7169d38820dfd117c3fa1f22a697dba58d90ba06', confirmations: 12, watch_until: '2026-10-25T09:00:00.000Z' };
const depositExample = { object: 'crypto_deposit', id: '3b0f1d0e-8a1c-4b55-9a52-0f2f4d9d1a11', mode: 'test', asset: 'USDT', chain: 'ETHEREUM', network: 'Ethereum',
  tx_hash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060', amount: '100.000000', status: 'credited', confirmations: 21, confirmations_needed: 12,
  created_at: '2026-10-18T09:00:00.000Z', credited_at: '2026-10-18T09:03:00.000Z' };
const savedExample = { object: 'crypto_withdrawal_address', id: 'c2a3b4d5-1e2f-4a3b-8c9d-0e1f2a3b4c5d', mode: 'test', chain: 'ETHEREUM', network: 'Ethereum',
  address: '0x52908400098527886E0F7030069857D2E4169EE7', label: 'Treasury', usable_from: '2026-10-19T09:00:00.000Z', ready: false, created_at: '2026-10-18T09:00:00.000Z' };
const withdrawalExample = { object: 'crypto_withdrawal', id: '7d1e2f3a-4b5c-4d6e-8f70-81920a1b2c3d', number: 'CW-000124', mode: 'test', asset: 'USDT', chain: 'ETHEREUM', network: 'Ethereum',
  address: '0x52908400098527886E0F7030069857D2E4169EE7', amount: '20.000000', fee: '1.500000', total: '21.500000', status: 'awaiting_code', review_reason: null,
  code_sent_at: '2026-10-18T10:00:00.000Z', tx_hash: null, confirmations: 0, created_at: '2026-10-18T10:00:00.000Z', completed_at: null };
const sentExample = { ...withdrawalExample, status: 'completed', code_sent_at: null, tx_hash: '0x7f1c9d2a3b4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd', confirmations: 12, completed_at: '2026-10-18T10:05:00.000Z' };

export const cryptoDocs: DocsArea = {
  schemas: {
    ResellerCoins: wallet,
    CryptoDepositNetwork: network,
    CryptoDepositAddress: address,
    CryptoDeposit: deposit,
    CryptoWithdrawalAddress: savedAddress,
    CryptoWithdrawalNetworks: withdrawalNetworks,
    CryptoWithdrawal: withdrawal,
    CryptoWithdrawalPreview: preview,
  },
  responses: {
    'GET /v1/crypto': { status: 200, description: 'Your coin wallet.', schema: 'ResellerCoins', example: walletExample },
    'GET /v1/crypto/deposit-networks': { status: 200, description: 'Networks open for deposits of the coin.', schema: list(ref('CryptoDepositNetwork'), {}, false), example: { object: 'list', data: [networkExample] } },
    'POST /v1/crypto/deposit-addresses': { status: 200, description: 'Your deposit address.', schema: 'CryptoDepositAddress', example: addressExample },
    'GET /v1/crypto/deposits': { status: 200, description: 'Your latest 25 deposits.', schema: list(ref('CryptoDeposit'), {}, false), example: { object: 'list', data: [depositExample] } },
    'GET /v1/crypto/withdrawal-addresses': { status: 200, description: 'Your saved addresses.', schema: list(ref('CryptoWithdrawalAddress'), {}, false), example: { object: 'list', data: [savedExample] } },
    'POST /v1/crypto/withdrawal-addresses': { status: 201, description: 'The saved address.', schema: 'CryptoWithdrawalAddress', example: savedExample },
    'DELETE /v1/crypto/withdrawal-addresses/{id}': {
      status: 200,
      description: 'The address was removed.',
      schema: objectSchema('DeletedWithdrawalAddress', { object: constant('crypto_withdrawal_address'), id: uuid('Address ID.'), deleted: { type: 'boolean', const: true, description: 'Always `true`.' } }),
      example: { object: 'crypto_withdrawal_address', id: savedExample.id, deleted: true },
    },
    'GET /v1/crypto/withdrawal-networks': {
      status: 200,
      description: 'Networks open for withdrawals of the coin.',
      schema: 'CryptoWithdrawalNetworks',
      example: { object: 'crypto_withdrawal_networks', asset: 'USDT', daily_limit: '500.000000', remaining_today: '480.000000', data: [{ object: 'crypto_network', chain: 'ETHEREUM', name: 'Ethereum', fee: '1.500000', minimum: '5.000000', confirmations: 12 }] },
    },
    'POST /v1/crypto/withdrawals': {
      status: 201,
      description: 'The withdrawal waiting for its emailed code, or with `preview: true` what it would cost.',
      schema: { anyOf: [ref('CryptoWithdrawal'), ref('CryptoWithdrawalPreview')] },
      example: withdrawalExample,
    },
    'GET /v1/crypto/withdrawals': { status: 200, description: 'Your latest 25 withdrawals.', schema: list(ref('CryptoWithdrawal'), {}, false), example: { object: 'list', data: [sentExample] } },
    'GET /v1/crypto/withdrawals/{id}': { status: 200, description: 'The withdrawal.', schema: 'CryptoWithdrawal', example: sentExample },
    'POST /v1/crypto/withdrawals/{id}/confirm': { status: 200, description: 'The confirmed withdrawal, queued for the signer or waiting for review.', schema: 'CryptoWithdrawal', example: { ...withdrawalExample, status: 'queued', code_sent_at: null } },
    'POST /v1/crypto/withdrawals/{id}/resend-code': { status: 200, description: 'The withdrawal with its new code’s time.', schema: 'CryptoWithdrawal', example: withdrawalExample },
    'POST /v1/crypto/withdrawals/{id}/cancel': { status: 200, description: 'The cancelled withdrawal; the coins are back in your coin wallet.', schema: 'CryptoWithdrawal', example: { ...withdrawalExample, status: 'cancelled', code_sent_at: null } },
  },
};
