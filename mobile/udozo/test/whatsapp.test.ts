// Connecting WhatsApp: wa.me links with the code filled in, and the API's refusals in words.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linkHref, whatsappErrorText, whatsappHref } from '../src/lib/whatsapp.ts';

test('wa.me links carry only the digits and the message', () => {
  assert.equal(whatsappHref('+234 800 000 0000', 'LINK AB12'), 'https://wa.me/2348000000000?text=LINK%20AB12');
  assert.equal(whatsappHref('+234 800 000 0000'), 'https://wa.me/2348000000000');
  assert.equal(whatsappHref('123'), null);
  assert.equal(whatsappHref(null), null);
});

test("Connect uses the API's link, else makes one from Udozo's number", () => {
  const link = { object: 'whatsapp_link' as const, code: 'AB12', link: null, expires_at: '2026-11-13T10:10:00Z' };
  assert.equal(linkHref(link, '+2348000000000'), 'https://wa.me/2348000000000?text=LINK%20AB12');
  assert.equal(linkHref({ ...link, link: 'https://wa.me/1?text=x' }, '+2348000000000'), 'https://wa.me/1?text=x');
});

test('refusals are put in words', () => {
  assert.equal(whatsappErrorText('whatsapp_unavailable', 'x'), 'Udozo is not on WhatsApp in your country yet.');
  assert.match(whatsappErrorText('link_code_limit', 'x'), /several codes/);
  assert.equal(whatsappErrorText('other', 'As it was.'), 'As it was.');
});
