import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { p2wpkh, Transaction } from '@scure/btc-signer';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EvmDriver, erc20Transfer, rlp, signedPayload, unsignedPayload } from '../dist/chains/evm.js';
import { encodeRaw, pbBytes, pbInt, refFields, transferContract, TronDriver } from '../dist/chains/tron.js';
import { UtxoDriver } from '../dist/chains/utxo.js';
import { addressOf, keyPath, tronBytes } from '../dist/keys.js';
import { LocalVault } from '../dist/vault/local.js';
import { normalise } from '../dist/vault/vault.js';

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const vault = new LocalVault(mnemonic);

describe('keys and addresses', () => {
  test('the published vectors for the abandon…about phrase', async () => {
    assert.equal(addressOf('BITCOIN', 'mainnet', await vault.publicKey("m/84'/0'/0'/0/0")), 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    assert.equal(addressOf('ETHEREUM', 'mainnet', await vault.publicKey("m/44'/60'/0'/0/0")), '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    assert.equal(addressOf('BASE', 'mainnet', await vault.publicKey("m/44'/60'/0'/0/0")), '0x9858EfFD232B4033E47d90003D41EC34EcaEda94');
    assert.equal(addressOf('TRON', 'mainnet', await vault.publicKey("m/44'/195'/0'/0/0")), 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
    assert.equal(addressOf('LITECOIN', 'mainnet', await vault.publicKey("m/84'/2'/0'/0/0")), 'ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh');
  });

  test('customers are 0/i, the hot wallet 1/0', () => {
    assert.equal(keyPath("m/44'/60'/0'", { kind: 'customer', index: 7 }), "m/44'/60'/0'/0/7");
    assert.equal(keyPath("m/44'/60'/0'", { kind: 'hot' }), "m/44'/60'/0'/1/0");
    assert.throws(() => keyPath("m/44'/60'/0'", { kind: 'customer', index: -1 }));
  });

  test('signatures are low-S and carry the right recovery bit', async () => {
    const path = "m/44'/60'/0'/0/3";
    const digest = keccak_256(new TextEncoder().encode('bitocard'));
    const sig = await vault.sign(path, digest);
    assert.ok(sig.s <= secp256k1.Point.CURVE().n / 2n);
    const recovered = new secp256k1.Signature(sig.r, sig.s).addRecoveryBit(sig.recovery).recoverPublicKey(digest);
    assert.ok(recovered.equals(secp256k1.Point.fromBytes(await vault.publicKey(path))));
    // A high-S version of the same signature is normalised, with the bit flipped.
    const n = secp256k1.Point.CURVE().n;
    const fixed = normalise(digest, await vault.publicKey(path), sig.r, n - sig.s, sig.recovery ^ 1);
    assert.deepEqual(fixed, sig);
    // A signature from another key is never accepted.
    const other = await vault.publicKey("m/44'/60'/0'/0/4");
    assert.throws(() => normalise(digest, other, sig.r, sig.s, sig.recovery), /does not match/);
  });
});

describe('EVM', () => {
  test('RLP', () => {
    assert.equal(bytesToHex(rlp(new TextEncoder().encode('dog'))), '83646f67');
    assert.equal(bytesToHex(rlp([new TextEncoder().encode('cat'), new TextEncoder().encode('dog')])), 'c88363617483646f67');
    assert.equal(bytesToHex(rlp(new Uint8Array())), '80');
    assert.equal(bytesToHex(rlp(Uint8Array.of(0x0f))), '0f');
  });

  test('the EIP-155 example transaction, byte for byte', () => {
    const tx = { nonce: 9n, gasPrice: 20_000_000_000n, gas: 21_000n, to: '0x3535353535353535353535353535353535353535', value: 10n ** 18n, data: new Uint8Array(), chainId: 1 };
    const digest = keccak_256(unsignedPayload(tx));
    assert.equal(bytesToHex(digest), 'daf5a779ae972f972197303d7b574746c7ef83eadac0f2791ad23db92e4c8e53');
    const key = hexToBytes('46'.repeat(32));
    const sig = secp256k1.Signature.fromBytes(secp256k1.sign(digest, key, { prehash: false, format: 'recovered' }), 'recovered');
    assert.equal(
      bytesToHex(signedPayload(tx, sig.r, sig.s, sig.recovery)),
      'f86c098504a817c800825208943535353535353535353535353535353535353535880de0b6b3a76400008025a028ef61340bd939bc2195fe537567866003e1a15d3c71ff63e1590620aa636276a067cbe9d8997f761aecb703304b3800ccf555c9f3dc64214b297fb1966a3b6d83',
    );
  });

  test('ERC-20 transfer data', () => {
    assert.equal(
      bytesToHex(erc20Transfer('0x52908400098527886E0F7030069857D2E4169EE7', 1_000_000n)),
      'a9059cbb00000000000000000000000052908400098527886e0f7030069857d2e4169ee700000000000000000000000000000000000000000000000000000000000f4240',
    );
  });

  function fakeNode(state) {
    const calls = [];
    const server = async (url, init) => {
      const { method, params, id } = JSON.parse(init.body);
      calls.push({ method, params });
      const answers = {
        eth_chainId: '0x1',
        eth_gasPrice: '0x3b9aca00',
        eth_getTransactionCount: state.nonce ?? '0x5',
        eth_getBalance: state.balance ?? '0xde0b6b3a7640000',
        eth_estimateGas: '0xc350',
        eth_call: state.token ?? '0x' + (10n ** 9n).toString(16).padStart(64, '0'),
        eth_sendRawTransaction: '0x',
        eth_getTransactionReceipt: state.receipt ?? null,
        eth_getTransactionByHash: state.byHash ?? null,
        eth_blockNumber: '0x64',
      };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: answers[method] }));
    };
    return { calls, server };
  }

  async function withFetch(server, work) {
    const original = globalThis.fetch;
    globalThis.fetch = server;
    try {
      return await work();
    } finally {
      globalThis.fetch = original;
    }
  }

  const paths = { path: intent => keyPath("m/44'/60'/0'", intent.from) };

  test('a USDT withdrawal from the hot wallet: signed by the hot key, our nonce, the token call', async () => {
    const node = fakeNode({});
    const driver = new EvmDriver('ETHEREUM', 'mainnet', 'https://rpc.example', vault, paths, 12);
    const signed = await withFetch(node.server, () =>
      driver.sign(
        { chain: 'ETHEREUM', network: 'mainnet', contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', to: '0x52908400098527886E0F7030069857D2E4169EE7', amount: 50_000_000n, from: { kind: 'hot' } },
        { nonce: async (_address, chainNonce) => chainNonce + 2n },
      ),
    );
    const hot = addressOf('ETHEREUM', 'mainnet', await vault.publicKey("m/44'/60'/0'/1/0"));
    assert.equal(signed.meta.from, hot);
    assert.equal(signed.meta.nonce, '7');
    assert.equal(signed.txHash, `0x${bytesToHex(keccak_256(hexToBytes(signed.raw.slice(2))))}`);
    assert.ok(signed.raw.includes('a9059cbb'));
  });

  test('refuses before signing when the hot wallet is short, or the node is another chain', async () => {
    const driver = new EvmDriver('ETHEREUM', 'mainnet', 'https://rpc.example', vault, paths, 12);
    const intent = { chain: 'ETHEREUM', network: 'mainnet', contract: null, to: '0x52908400098527886E0F7030069857D2E4169EE7', amount: 10n ** 20n, from: { kind: 'hot' } };
    await assert.rejects(withFetch(fakeNode({}).server, () => driver.sign(intent, {})), { name: 'Refusal' });
    const base = new EvmDriver('BASE', 'mainnet', 'https://rpc.example', vault, paths, 12);
    await assert.rejects(withFetch(fakeNode({}).server, () => base.sign({ ...intent, chain: 'BASE', amount: 1n }, {})), /expected 8453/);
  });

  test('a sweep sends the whole balance less gas', async () => {
    const driver = new EvmDriver('ETHEREUM', 'mainnet', 'https://rpc.example', vault, paths, 12);
    const signed = await withFetch(fakeNode({ balance: '0x' + (10n ** 16n).toString(16) }).server, () =>
      driver.sign({ chain: 'ETHEREUM', network: 'mainnet', contract: null, to: '0x52908400098527886E0F7030069857D2E4169EE7', amount: 1n, from: { kind: 'customer', index: 2 }, sweepAll: true }, {}),
    );
    // 0.01 ETH less 21,000 gas at 1.2 gwei.
    const value = (10n ** 16n - 21_000n * 1_200_000_000n).toString(16);
    assert.ok(signed.raw.includes(value), 'the value is the balance less the fee');
  });

  test('status: mined with confirmations, reverted, unknown', async () => {
    const driver = new EvmDriver('ETHEREUM', 'mainnet', 'https://rpc.example', vault, paths, 12);
    const signed = { txHash: '0xab', raw: '0x00', meta: {} };
    assert.deepEqual(await withFetch(fakeNode({ receipt: { status: '0x1', blockNumber: '0x60' } }).server, () => driver.status(signed)), { state: 'mined', confirmations: 5 });
    assert.equal((await withFetch(fakeNode({ receipt: { status: '0x0', blockNumber: '0x60' } }).server, () => driver.status(signed))).state, 'reverted');
    assert.equal((await withFetch(fakeNode({}).server, () => driver.status(signed))).state, 'unknown');
    assert.equal((await withFetch(fakeNode({ byHash: { hash: '0xab' } }).server, () => driver.status(signed))).state, 'pending');
  });

  test('addresses: checksums are enforced on mixed case, the zero address refused', () => {
    const driver = new EvmDriver('ETHEREUM', 'mainnet', 'https://rpc.example', vault, paths, 12);
    assert.equal(driver.address('0x52908400098527886e0f7030069857d2e4169ee7'), '0x52908400098527886E0F7030069857D2E4169EE7');
    assert.equal(driver.address('0x52908400098527886E0F7030069857D2E4169Ee7'), null);
    assert.equal(driver.address('0x0000000000000000000000000000000000000000'), null);
  });
});

describe('TRON', () => {
  test('protobuf pieces', () => {
    assert.equal(bytesToHex(pbInt(3, 300n)), '18ac02');
    assert.equal(bytesToHex(pbBytes(1, Uint8Array.of(1, 2))), '0a020102');
    const ref = refFields(0x1234567890n, '0000000001234567' + 'aabbccddeeff0011' + '00'.repeat(16));
    assert.equal(bytesToHex(ref.refBlockBytes), '7890');
    assert.equal(bytesToHex(ref.refBlockHash), 'aabbccddeeff0011');
  });

  test('a TRX transfer is built locally and signed over sha256 of the raw data', async () => {
    const owner = tronBytes(addressOf('TRON', 'mainnet', await vault.publicKey("m/44'/195'/0'/1/0")));
    const to = tronBytes('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
    const contract = transferContract(owner, to, 1_000_000n);
    // owner (field 1), to (field 2), amount (field 3) in the TransferContract.
    assert.equal(bytesToHex(contract.value), `0a15${bytesToHex(owner)}1215${bytesToHex(to)}18c0843d`);
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === '/wallet/getaccount') return new Response(JSON.stringify({ balance: 5_000_000 }));
      if (path === '/wallet/getnowblock') return new Response(JSON.stringify({ blockID: '0000000004c4b3f1' + '11'.repeat(8) + '22'.repeat(16), block_header: { raw_data: { number: 80000001, timestamp: 1_700_000_000_000 } } }));
      throw new Error(`unexpected ${path} ${init?.body}`);
    };
    try {
      const driver = new TronDriver('https://api.trongrid.io', null, 'mainnet', vault, { path: intent => keyPath("m/44'/195'/0'", intent.from) }, 19);
      const signed = await driver.sign({ chain: 'TRON', network: 'mainnet', contract: null, to: 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH', amount: 1_000_000n, from: { kind: 'hot' } });
      const tx = hexToBytes(signed.raw);
      // Transaction { raw_data (1), signature (2) }: the ID is sha256 of raw_data, and the signature recovers the owner.
      const rawLength = tx[1] | ((tx[2] & 0x7f) << 7);
      const rawStart = tx[1] & 0x80 ? 3 : 2;
      const raw = tx.slice(rawStart, rawStart + (tx[1] & 0x80 ? rawLength : tx[1]));
      assert.equal(signed.txHash, bytesToHex(sha256(raw)));
      const sig = tx.slice(-65);
      const recovered = secp256k1.Signature.fromBytes(sig.slice(0, 64), 'compact').addRecoveryBit(sig[64]).recoverPublicKey(sha256(raw));
      assert.ok(recovered.equals(secp256k1.Point.fromBytes(await vault.publicKey("m/44'/195'/0'/1/0"))));
      assert.ok(bytesToHex(raw).includes(bytesToHex(contract.value)), 'the raw data carries exactly this transfer');
      // ref_block_bytes: bytes 6–8 of the block number (80000001 = 0x04c4b401); ref_block_hash: bytes 8–16 of its ID.
      assert.ok(bytesToHex(raw).startsWith(`0a02b401220811${'11'.repeat(7)}`));
      assert.equal(bytesToHex(encodeRaw({ ...refFields(80000001n, '0000000004c4b3f1' + '11'.repeat(8)), expiration: 1n, timestamp: 1n, feeLimit: 0n, contract })), bytesToHex(encodeRaw({ ...refFields(80000001n, '0000000004c4b3f1' + '11'.repeat(8)), expiration: 1n, timestamp: 1n, feeLimit: 0n, contract })));
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('Bitcoin, Litecoin and Dogecoin', () => {
  class FakeSource {
    constructor(utxos, raw = {}) {
      this.list = utxos;
      this.raw = raw;
      this.sent = [];
    }
    async utxos() {
      return this.list;
    }
    async feeRate() {
      return 10n;
    }
    async rawTx(txid) {
      return this.raw[txid];
    }
    async broadcast(hex) {
      this.sent.push(hex);
    }
    async tx() {
      return null;
    }
  }

  test('a Bitcoin withdrawal signs exactly as btc-signer would with the key', async () => {
    const source = new FakeSource([
      { txid: 'aa'.repeat(32), vout: 0, value: 50_000n, confirmed: true },
      { txid: 'bb'.repeat(32), vout: 1, value: 100_000n, confirmed: true },
    ]);
    const driver = new UtxoDriver('BITCOIN', 'mainnet', source, vault, { path: intent => keyPath("m/84'/0'/0'", intent.from) }, 2);
    const signed = await driver.sign({ chain: 'BITCOIN', network: 'mainnet', contract: null, to: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', amount: 60_000n, from: { kind: 'hot' } }, { reserved: new Set() });
    assert.deepEqual(signed.meta.inputs, [`${'bb'.repeat(32)}:1`], 'the largest confirmed output is enough on its own');
    // The same transaction signed by btc-signer itself with the private key is byte-identical.
    const key = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/84'/0'/0'/1/0");
    const own = Transaction.fromRaw(hexToBytes(signed.raw));
    assert.equal(own.inputsLength, 1);
    assert.equal(own.outputsLength, 2);
    assert.equal(own.getOutput(0).amount, 60_000n);
    const change = own.getOutput(1).amount;
    const reference = new Transaction();
    reference.addInput({ txid: 'bb'.repeat(32), index: 1, witnessUtxo: { script: p2wpkh(key.publicKey).script, amount: 100_000n } });
    reference.addOutputAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 60_000n);
    reference.addOutput({ script: p2wpkh(key.publicKey).script, amount: change });
    reference.signIdx(key.privateKey, 0);
    reference.finalize();
    assert.equal(signed.raw, reference.hex);
    assert.equal(signed.txHash, reference.id);
    const fee = 100_000n - 60_000n - change;
    assert.equal(fee.toString(), signed.meta.fee);
    assert.ok(fee > 0n && fee < 5_000n);
  });

  test('reserved outputs are never spent twice, and a short wallet is refused before signing', async () => {
    const source = new FakeSource([{ txid: 'aa'.repeat(32), vout: 0, value: 50_000n, confirmed: true }]);
    const driver = new UtxoDriver('LITECOIN', 'mainnet', source, vault, { path: intent => keyPath("m/84'/2'/0'", intent.from) }, 6);
    const intent = { chain: 'LITECOIN', network: 'mainnet', contract: null, to: 'ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh', amount: 10_000n, from: { kind: 'hot' } };
    await assert.rejects(driver.sign(intent, { reserved: new Set([`${'aa'.repeat(32)}:0`]) }), { name: 'Refusal' });
    const signed = await driver.sign(intent, { reserved: new Set() });
    assert.equal(Transaction.fromRaw(hexToBytes(signed.raw)).getOutput(0).amount, 10_000n);
    assert.equal(driver.address('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'), null, 'a Bitcoin address is not a Litecoin one');
  });

  test('a Litecoin sweep spends everything to one output', async () => {
    const source = new FakeSource([
      { txid: 'aa'.repeat(32), vout: 0, value: 50_000n, confirmed: true },
      { txid: 'cc'.repeat(32), vout: 2, value: 30_000n, confirmed: true },
      { txid: 'dd'.repeat(32), vout: 0, value: 99_000n, confirmed: false },
    ]);
    const driver = new UtxoDriver('LITECOIN', 'mainnet', source, vault, { path: intent => keyPath("m/84'/2'/0'", intent.from) }, 6);
    const hot = addressOf('LITECOIN', 'mainnet', await vault.publicKey("m/84'/2'/0'/1/0"));
    const signed = await driver.sign({ chain: 'LITECOIN', network: 'mainnet', contract: null, to: hot, amount: 1n, from: { kind: 'customer', index: 4 }, sweepAll: true }, { reserved: new Set() });
    const tx = Transaction.fromRaw(hexToBytes(signed.raw));
    assert.equal(tx.inputsLength, 2, 'unconfirmed money is left for the next sweep');
    assert.equal(tx.outputsLength, 1);
    assert.equal(tx.getOutput(0).amount + BigInt(signed.meta.fee), 80_000n);
  });

  test('a Dogecoin withdrawal spends legacy outputs proved by their whole previous transaction', async () => {
    const hotKey = await vault.publicKey("m/44'/3'/0'/1/0");
    const hot = addressOf('DOGECOIN', 'mainnet', hotKey);
    // A previous transaction paying 5 DOGE to the hot wallet.
    const previous = new Transaction();
    previous.addOutputAddress(hot, 500_000_000n, { bech32: '', pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e });
    previous.addInput({ txid: 'ee'.repeat(32), index: 0, finalScriptSig: Uint8Array.of(0) });
    const prevHex = bytesToHex(previous.toBytes(true, false));
    const prevId = previous.id;
    const source = new FakeSource([{ txid: prevId, vout: 0, value: 500_000_000n, confirmed: true }], { [prevId]: prevHex });
    const driver = new UtxoDriver('DOGECOIN', 'mainnet', source, vault, { path: intent => keyPath("m/44'/3'/0'", intent.from) }, 40);
    const signed = await driver.sign({ chain: 'DOGECOIN', network: 'mainnet', contract: null, to: hot, amount: 200_000_000n, from: { kind: 'hot' } }, { reserved: new Set() });
    const tx = Transaction.fromRaw(hexToBytes(signed.raw), { allowUnknownInputs: true });
    assert.equal(tx.getOutput(0).amount, 200_000_000n);
    assert.ok(BigInt(signed.meta.fee) >= 1_000n * 200n, 'at least Dogecoin’s minimum relay fee');
    assert.equal(driver.address('DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC'), 'DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC');
    assert.equal(driver.address('ltc1qjmxnz78nmc8nq77wuxh25n2es7rzm5c2rkk4wh'), null);
  });
});
