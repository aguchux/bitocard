import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { detectNetworkByPrefix, hasPrefixTable } from '../dist/catalogue/network-prefixes.js';

describe('network prefix guesses (fallback when a supplier cannot tell)', () => {
  test('matches a national or international Nigerian number to its network', () => {
    assert.equal(detectNetworkByPrefix('08031234567', 'NG'), 'mtn');
    assert.equal(detectNetworkByPrefix('+2348031234567', 'NG'), 'mtn');
    assert.equal(detectNetworkByPrefix('08021234567', 'NG'), 'airtel');
    assert.equal(detectNetworkByPrefix('08051234567', 'NG'), 'glo');
    assert.equal(detectNetworkByPrefix('08091234567', 'NG'), '9mobile');
  });

  test('matches Ghanaian and Kenyan numbers', () => {
    assert.equal(detectNetworkByPrefix('0241234567', 'GH'), 'mtn');
    assert.equal(detectNetworkByPrefix('0701234567', 'KE'), 'safaricom');
    assert.equal(detectNetworkByPrefix('0730123456', 'KE'), 'airtel');
  });

  test('an unrecognised prefix or country returns null, never a guess', () => {
    assert.equal(detectNetworkByPrefix('0999999999', 'NG'), null);
    assert.equal(detectNetworkByPrefix('+19175550123', 'US'), null);
    assert.equal(hasPrefixTable('NG'), true);
    assert.equal(hasPrefixTable('US'), false);
  });
});
