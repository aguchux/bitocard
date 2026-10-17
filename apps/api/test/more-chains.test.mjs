// More coins and networks: Polygon, Arbitrum, Base and Optimism share the customer's EVM address; Litecoin and Dogecoin
// have address families of their own (with their own key prefixes); TRX deposits on TRON are read from the chain.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { HDKey } from '@scure/bip32';
import { base58check, bech32 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { fakeService } from './helpers.mjs';

let derive;
let withdrawals;
let client;
let providers;

before(async () => {
  derive = await import('../dist/crypto/derive.js');
  withdrawals = await import('../dist/crypto/withdrawals.service.js');
  client = await import('../dist/crypto/chains/client.js');
  providers = await import('../dist/crypto/chains/providers.js');
});

const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
/** An account key at a path, exported with the given version bytes (xpub by default). */
const account = (path, versions) => HDKey.fromMasterSeed(seed, versions).derive(path).publicExtendedKey;
const legacy = base58check(sha256);
const keyHash = (xpub, index) => {
  const program = bech32.fromWords(bech32.decode(derive.bitcoinAddress(derive.childPublicKey(xpub, index).publicKey, false)).words.slice(1));
  return Buffer.from(program).toString('hex');
};

describe('Litecoin and Dogecoin addresses', () => {
  test('Litecoin is native SegWit (ltc1…, testnet tltc1…) of the same key hash as Bitcoin would use', () => {
    const xpub = account("m/84'/2'/0'");
    const address = derive.deriveAddress('litecoin', xpub, 3);
    assert.match(address, /^ltc1q[02-9ac-hj-np-z]{38}$/);
    const decoded = bech32.decode(address);
    assert.equal(Buffer.from(bech32.fromWords(decoded.words.slice(1))).toString('hex'), keyHash(xpub, 3));
    assert.equal(derive.validAddress('litecoin', address), true);
    assert.equal(derive.validAddress('litecoin', derive.deriveAddress('bitcoin', xpub, 3)), false, 'a Bitcoin address is not a Litecoin one');
    const test = account("m/84'/1'/0'", { private: 0x04358394, public: 0x0436f6e1 });
    assert.ok(test.startsWith('ttub'));
    assert.match(derive.deriveAddress('litecoin', test, 0), /^tltc1q/);
  });

  test('Dogecoin is legacy pay-to-key-hash (D…, version 0x1e; testnet n…, 0x71)', () => {
    const xpub = account("m/44'/3'/0'");
    const address = derive.deriveAddress('dogecoin', xpub, 5);
    assert.match(address, /^D[1-9A-HJ-NP-Za-km-z]{33}$/);
    const bytes = legacy.decode(address);
    assert.deepEqual([bytes.length, bytes[0], Buffer.from(bytes.slice(1)).toString('hex')], [21, 0x1e, keyHash(xpub, 5)]);
    assert.equal(derive.validAddress('dogecoin', address), true);
    const test = account("m/44'/1'/0'", { private: 0x04358394, public: 0x0432a9a8 });
    assert.ok(test.startsWith('tgub'));
    assert.match(derive.deriveAddress('dogecoin', test, 0), /^n/);
  });

  test('the coins’ own key prefixes are accepted, private keys never', () => {
    const ltub = account("m/84'/2'/0'", { private: 0x019d9cfe, public: 0x019da462 });
    const mtub = account("m/84'/2'/0'", { private: 0x01b26792, public: 0x01b26ef6 });
    const dgub = account("m/44'/3'/0'", { private: 0x02fac398, public: 0x02facafd });
    assert.deepEqual([ltub.slice(0, 4), mtub.slice(0, 4), dgub.slice(0, 4)], ['Ltub', 'Mtub', 'dgub']);
    // The same key, whatever its prefix, gives the same addresses.
    assert.equal(derive.deriveAddress('litecoin', ltub, 0), derive.deriveAddress('litecoin', account("m/84'/2'/0'"), 0));
    assert.equal(derive.deriveAddress('litecoin', mtub, 0), derive.deriveAddress('litecoin', account("m/84'/2'/0'"), 0));
    assert.equal(derive.deriveAddress('dogecoin', dgub, 0), derive.deriveAddress('dogecoin', account("m/44'/3'/0'"), 0));
    assert.equal(derive.parseXpub(ltub).testnet, false);
    const xprv = HDKey.fromMasterSeed(seed).derive("m/84'/2'/0'").privateExtendedKey;
    assert.throws(() => derive.parseXpub(xprv));
  });
});

describe('withdrawal addresses on the new chains', () => {
  test('every EVM network takes the checksummed 0x address', () => {
    const evm = derive.deriveAddress('evm', account("m/44'/60'/0'"), 0);
    for (const chain of ['POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM']) {
      assert.equal(withdrawals.withdrawalAddress(chain, evm.toLowerCase(), false), evm, chain);
      assert.equal(withdrawals.withdrawalAddress(chain, `0x${'0'.repeat(40)}`, false), null);
    }
    assert.deepEqual(withdrawals.withdrawalChains.filter(chain => ['POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM', 'LITECOIN', 'DOGECOIN'].includes(chain)).length, 6);
  });

  test('Litecoin takes ltc1 and its legacy L… and M… addresses, never Bitcoin’s', () => {
    const xpub = account("m/84'/2'/0'");
    const segwit = derive.deriveAddress('litecoin', xpub, 0);
    assert.equal(withdrawals.withdrawalAddress('LITECOIN', segwit.toUpperCase(), false), segwit, 'upper case is the same address');
    const hash = derive.childPublicKey(xpub, 0).publicKey;
    const l = legacy.encode(Uint8Array.from([0x30, ...Buffer.from(keyHash(xpub, 0), 'hex')]));
    const m = legacy.encode(Uint8Array.from([0x32, ...Buffer.from(keyHash(xpub, 0), 'hex')]));
    assert.ok(hash && l.startsWith('L') && m.startsWith('M'));
    assert.equal(withdrawals.withdrawalAddress('LITECOIN', l, false), l);
    assert.equal(withdrawals.withdrawalAddress('LITECOIN', m, false), m);
    assert.equal(withdrawals.withdrawalAddress('LITECOIN', derive.deriveAddress('bitcoin', xpub, 0), false), null, 'bc1 is Bitcoin');
    assert.equal(withdrawals.withdrawalAddress('LITECOIN', segwit, true), null, 'a mainnet address in the sandbox');
    assert.equal(withdrawals.withdrawalAddress('BITCOIN', segwit, false), null, 'ltc1 is not Bitcoin');
  });

  test('Dogecoin takes D… addresses on mainnet and n… on testnet, nothing else', () => {
    const d = derive.deriveAddress('dogecoin', account("m/44'/3'/0'"), 0);
    assert.equal(withdrawals.withdrawalAddress('DOGECOIN', d, false), d);
    assert.equal(withdrawals.withdrawalAddress('DOGECOIN', d, true), null);
    assert.equal(withdrawals.withdrawalAddress('DOGECOIN', `${d.slice(0, -1)}${d.at(-1) === 'a' ? 'b' : 'a'}`, false), null, 'a wrong checksum');
    assert.equal(withdrawals.withdrawalAddress('DOGECOIN', derive.deriveAddress('litecoin', account("m/84'/2'/0'"), 0), false), null);
  });
});

describe('TRX on TRON', () => {
  let tron;
  let to;
  let toHex;
  const hash = 'ab'.repeat(32);

  before(async () => {
    to = derive.deriveAddress('tron', account("m/44'/195'/0'"), 0);
    toHex = `41${derive.tronToHex(to).slice(2)}`;
    tron = await fakeService(call => {
      const path = call.url.split('?')[0];
      if (path === '/wallet/gettransactioninfobyid') return { body: { id: hash, blockNumber: 1200 } };
      if (path === '/wallet/gettransactionbyid') {
        return { body: { txID: hash, ret: [{ contractRet: 'SUCCESS' }], raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { amount: 12_500_000, owner_address: '41'.padEnd(42, '1'), to_address: toHex } } }] } } };
      }
      if (path === `/v1/accounts/${to}/transactions`) {
        return { body: { data: [{ txID: hash, ret: [{ contractRet: 'SUCCESS' }], raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { amount: 12_500_000, to_address: toHex } } }] } }, { txID: 'cd'.repeat(32), raw_data: { contract: [{ type: 'TriggerSmartContract', parameter: { value: {} } }] } }] } };
      }
      return { status: 404, body: {} };
    });
  });
  after(() => tron?.close());

  test('a plain TRX transfer is the transaction’s coin transfer, found by re-reading it', async () => {
    const reader = new client.TronClient({ url: tron.url });
    const seen = await reader.inspect(hash);
    assert.deepEqual(seen.transfers.map(item => [item.index, item.to, item.contract, item.raw]), [[0, to, null, 12_500_000n]]);
    assert.equal(seen.ok, true);
    assert.equal(reader.nativeScan, false, 'only TronGrid lists TRX transfers');
  });

  test('TronGrid lists an address’s TRX deposits (contract calls left out)', async () => {
    const grid = new client.TronClient({ url: tron.url, flavor: 'trongrid' });
    assert.equal(grid.nativeScan, true);
    const found = await grid.scan({ addresses: [to], contracts: [], native: true });
    assert.deepEqual(found.map(item => [item.hash, item.index, item.contract, item.raw]), [[hash, 0, null, 12_500_000n]]);
  });
});

describe('providers for the new chains', () => {
  test('Alchemy, Infura and Ankr reach every new EVM network on the right host, live and sandbox', () => {
    const urls = (id, values, environment) => {
      const endpoints = providers.chainProvider(id).endpoints(values, environment);
      return Object.fromEntries(['POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM'].map(chain => [chain, endpoints[chain] ? 'set' : null]));
    };
    for (const [id, values] of [['alchemy', { ALCHEMY_API_KEY: 'k' }], ['infura', { INFURA_API_KEY: 'k' }], ['ankr', { ANKR_API_KEY: 'k' }]]) {
      assert.deepEqual(urls(id, values, 'live'), { POLYGON: 'set', ARBITRUM: 'set', BASE: 'set', OPTIMISM: 'set' }, id);
      assert.deepEqual(urls(id, values, 'sandbox'), { POLYGON: 'set', ARBITRUM: 'set', BASE: 'set', OPTIMISM: 'set' }, id);
    }
    assert.ok(providers.providerChains(providers.chainProvider('alchemy')).includes('POLYGON'));
  });

  test('Litecoin and Dogecoin through BlockCypher (main networks only), GetBlock and litecoinspace.org', () => {
    const cypher = providers.chainProvider('blockcypher');
    const live = cypher.endpoints({ BLOCKCYPHER_TOKEN: 't' }, 'live');
    assert.ok(live.LITECOIN && live.DOGECOIN && live.BITCOIN);
    const sandbox = cypher.endpoints({ BLOCKCYPHER_TOKEN: 't' }, 'sandbox');
    assert.deepEqual([Boolean(sandbox.BITCOIN), sandbox.LITECOIN, sandbox.DOGECOIN], [true, null, null], 'BlockCypher has no Litecoin or Dogecoin test network');
    const getblock = providers.chainProvider('getblock');
    assert.ok(getblock.fields.some(field => field.key === 'GETBLOCK_LITECOIN_URL') && getblock.fields.some(field => field.key === 'GETBLOCK_DOGECOIN_URL'));
    assert.ok(getblock.endpoints({ GETBLOCK_DOGECOIN_URL: 'https://doge.example' }, 'live').DOGECOIN instanceof client.BitcoinRpcClient);
    assert.ok(getblock.endpoints({ GETBLOCK_POLYGON_URL: 'https://polygon.example' }, 'live').POLYGON instanceof client.EvmClient);
    assert.ok(providers.chainProvider('litecoinspace').endpoints({ LITECOINSPACE_ENABLED: 'on' }, 'live').LITECOIN instanceof client.EsploraClient);
    assert.equal(providers.chainProvider('litecoinspace').endpoints({}, 'live').LITECOIN, null, 'off until an admin switches it on');
    assert.ok(providers.walletKeyFields.some(field => field.key === 'CRYPTO_XPUB_LITECOIN') && providers.walletKeyFields.some(field => field.key === 'CRYPTO_TEST_XPUB_DOGECOIN'));
  });

  test('each new chain has a name, a family, and its main network known', () => {
    for (const chain of ['POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM']) {
      assert.equal(client.chainFamily[chain], 'evm');
      assert.equal(client.isEvm(chain), true);
      assert.equal(client.tokenStandard(chain), 'ERC-20');
      assert.equal(client.normaliseAddress(chain, '0xABCdef0000000000000000000000000000000001'), '0xabcdef0000000000000000000000000000000001');
    }
    assert.deepEqual([client.chainFamily.LITECOIN, client.chainFamily.DOGECOIN, client.isEvm('TRON')], ['litecoin', 'dogecoin', false]);
    assert.equal(client.chainNames.ARBITRUM, 'Arbitrum One');
  });

  test('a provider on another EVM network is refused for live (chain IDs are checked)', async () => {
    const fake = { key: 'k', network: async () => '1', latestBlock: async () => 1n, inspect: async () => null, nativeScan: false, tokenScan: true };
    client.forgetNetworks();
    await assert.rejects(client.checkNetwork('POLYGON', fake, 'live'), /test network \(1\)/, 'an Ethereum endpoint pasted for Polygon');
    client.forgetNetworks();
    await assert.doesNotReject(client.checkNetwork('POLYGON', { ...fake, key: 'p', network: async () => '137' }, 'live'));
  });
});
