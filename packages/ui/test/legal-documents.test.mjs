// Every legal document listed in legal.ts (and so in every site's footer) is a page of the legals app, with its card on
// the documents hub and its banner image: a document added to the list but not built, or built but not listed, fails.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const legal = readFileSync(new URL('../src/legal.ts', import.meta.url), 'utf8');
const legals = new URL('../../../apps/legals/', import.meta.url);
const content = readFileSync(new URL('components/content.ts', legals), 'utf8');
const og = readFileSync(new URL('components/og.tsx', legals), 'utf8');

const listed = [...legal.matchAll(/\{ href: "(\/documents\/[a-z-]+)", label: "([^"]+)"/g)].map(([, href, label]) => ({ href, label }));

describe('legal documents', () => {
  test('the list names the documents', () => {
    assert.ok(listed.length >= 5);
    assert.ok(listed.some(doc => doc.href === '/documents/reseller-terms'));
  });

  for (const { href, label } of listed) {
    test(`${label} has its page, card and banner image`, () => {
      const page = new URL(`app/(site)${href}/page.tsx`, legals);
      assert.ok(existsSync(page), `${href} has a page`);
      const source = readFileSync(page, 'utf8');
      assert.match(source, new RegExp(`path: "${href}"`), `${href} passes its own path to pageMetadata`);
      assert.match(source, /pageMetadata\(seo\)/);
      assert.ok(content.includes(`"${href}":`), `${href} has a card on the documents hub`);
      assert.ok(og.includes(`"${href}":`), `${href} has a banner image`);
    });
  }

  test('every document page is listed', () => {
    const pages = readdirSync(new URL('app/(site)/documents/', legals), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `/documents/${entry.name}`);
    assert.deepEqual(pages.sort(), listed.map(doc => doc.href).sort());
  });

  test('the reseller terms are marked as a draft and cover stores, content and domains', () => {
    const terms = readFileSync(new URL('app/(site)/documents/reseller-terms/page.tsx', legals), 'utf8');
    assert.match(terms, /This is a draft/);
    for (const id of ['stores', 'content', 'domains', 'customers', 'disputes', 'wallet']) assert.match(terms, new RegExp(`<Section id="${id}"`), `section ${id}`);
  });

  test("every cookie BitoCard's sites set is in the cookie notice", () => {
    const cookies = readFileSync(new URL('app/(site)/documents/cookies/page.tsx', legals), 'utf8');
    for (const name of ['bc_market', 'bc_customer', 'bc_signed_in', 'bc_public_spin', 'bc_access', 'bc_chat', 'bc_kyc', 'bc_session', 'bc_admin_session', 'bc_install', 'bc_install_visit']) assert.match(cookies, new RegExp(`<strong>${name}</strong>`), name);
  });

  test("BitoCard Shop and B2B reselling have left BitoCard's documents (Udozo publishes its own)", () => {
    assert.doesNotMatch(legal, /shop-terms/);
    for (const doc of ['privacy', 'cookies', 'terms', 'reseller-terms']) {
      const page = readFileSync(new URL(`app/(site)/documents/${doc}/page.tsx`, legals), 'utf8');
      assert.doesNotMatch(page, /BitoCard Shop|shop\.bitocard\.com|Safe pay|Resale shop|shop-terms|bc_assistant|Anjio/, doc);
    }
    const config = readFileSync(new URL('next.config.ts', legals), 'utf8');
    assert.match(config, /source: "\/documents\/shop-terms", destination: "\/documents", permanent: true/, 'the old address goes to the documents hub');
  });

  test('VPN access has its terms of sale and its privacy entry, and is never sold on renewal', () => {
    const terms = readFileSync(new URL('app/(site)/documents/terms/page.tsx', legals), 'utf8');
    const privacy = readFileSync(new URL('app/(site)/documents/privacy/page.tsx', legals), 'utf8');
    assert.match(terms, /<Section id="vpn" title="5\. VPN access">/);
    for (const id of ['vpn-what', 'vpn-term', 'vpn-refunds', 'vpn-limits', 'vpn-use']) assert.match(terms, new RegExp(`id="${id}"`), id);
    assert.match(terms, /never renews automatically/);
    const numbers = [...terms.matchAll(/<Section id="[a-z-]+" title="(\d+)\./g)].map(([, n]) => Number(n));
    assert.deepEqual(numbers, numbers.map((_, index) => index + 1), 'sections are numbered in order');
    assert.match(privacy, /When you buy VPN access/);
    // No unproven claims, and the supplier is never named.
    for (const page of [terms, privacy]) assert.doesNotMatch(page, /no[- ]logs?\b|anonymous VPN|VPNresellers/i);
  });
});
