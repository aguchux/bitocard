import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Prestmit } from '../dist/gift-card-sales/prestmit.js';
import { providerUrl } from '../dist/integrations/endpoints.js';

const env = process.env;
const [command = 'check', reference] = process.argv.slice(2);
const client = new Prestmit({
  apiKey: env.PRESTMIT_SANDBOX_API_KEY,
  apiSecret: env.PRESTMIT_SANDBOX_API_SECRET,
  accountPin: env.PRESTMIT_SANDBOX_ACCOUNT_PIN,
  baseUrl: providerUrl({}, 'prestmit', 'sandbox'),
});

function required(value, label) {
  if (!value) throw new Error(`Set ${label}.`);
  return value;
}

function amount() {
  const value = Number(env.PRESTMIT_SANDBOX_AMOUNT);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Set PRESTMIT_SANDBOX_AMOUNT to a positive whole number.');
  return value;
}

let stage;
async function run(label, action) {
  stage = label;
  const result = await action();
  stage = undefined;
  return result;
}

async function main() {
  if (!client.configured()) throw new Error('Set PRESTMIT_SANDBOX_API_KEY and PRESTMIT_SANDBOX_API_SECRET to your activated sandbox credentials.');

  switch (command) {
    case 'check': {
      const availability = await run('service availability', () => client.availability());
      console.log('Sandbox service availability', availability);
      const sellable = await run('sell catalogue', () => client.sellableCards());
      console.log('Sell catalogue entries:', sellable.length);
      const buyable = await run('buy catalogue (first page)', () => client.buyableCards(1));
      console.log('Buy catalogue entries on the first page:', buyable.length);
      const card = buyable.find(item => !item.preOrder && Math.ceil(item.minPrice) <= Math.floor(item.maxPrice));
      if (!card) throw new Error('No whole-value buy card on the first page to test payment calculation.');
      const price = Math.ceil(card.minPrice);
      const quote = await run('buy payment calculation', () => client.buyCost(card.sku, price));
      if (quote.naira === null) throw new Error('Prestmit returned no NGN payment amount for the sample card.');
      console.log('Buy quote', { sku: card.sku, price, currency: card.currency, ...quote });
      break;
    }
    case 'buy': {
      const sku = required(env.PRESTMIT_SANDBOX_BUY_SKU, 'PRESTMIT_SANDBOX_BUY_SKU');
      const price = amount();
      const quote = await run('buy payment calculation', () => client.buyCost(sku, price));
      if (!quote.available || quote.naira === null) throw new Error('The selected sandbox card cannot be purchased in NGN.');
      const uniqueIdentifier = randomUUID();
      console.log('Sandbox buy identifier:', uniqueIdentifier);
      const trade = await run('buy creation', () => client.buy({ sku, price, quantity: 1, uniqueIdentifier }));
      if (!trade.reference) throw new Error('Prestmit returned no buy reference. Look up the identifier before retrying.');
      console.log('Sandbox buy', { reference: trade.reference, status: trade.status });
      break;
    }
    case 'sell': {
      const cardId = required(env.PRESTMIT_SANDBOX_SELL_CARD_ID, 'PRESTMIT_SANDBOX_SELL_CARD_ID');
      const value = amount();
      const code = env.PRESTMIT_SANDBOX_SELL_CODE;
      const photo = env.PRESTMIT_SANDBOX_SELL_PHOTO;
      if (Boolean(code) === Boolean(photo)) throw new Error('Set exactly one of PRESTMIT_SANDBOX_SELL_CODE or PRESTMIT_SANDBOX_SELL_PHOTO using sandbox fixtures.');
      const photos = [];
      if (photo) {
        const type = /\.png$/i.test(photo) ? 'image/png' : /\.jpe?g$/i.test(photo) ? 'image/jpeg' : null;
        if (!type) throw new Error('Use a PNG or JPEG sandbox fixture.');
        const data = await readFile(photo).catch(() => null);
        if (!data || !data.length || data.length > 4 * 1024 * 1024) throw new Error('Use a readable fixture between 1 byte and 4 MB.');
        photos.push({ name: basename(photo), type, data });
      }
      const uniqueIdentifier = randomUUID();
      console.log('Sandbox sell identifier:', uniqueIdentifier);
      const trade = await run('sell creation', () => client.createTrade({ cardId, amount: value, uniqueIdentifier, code, photos }));
      if (!trade.reference) throw new Error('Prestmit returned no sell reference. Look up the identifier before retrying.');
      console.log('Sandbox sell', { reference: trade.reference, status: trade.status });
      break;
    }
    case 'buy-status': {
      const uniqueIdentifier = required(reference, 'the buy identifier argument');
      const trade = await run('buy history', () => client.findBuy({ uniqueIdentifier }));
      if (!trade) throw new Error('Trade not yet visible in sandbox buy history.');
      console.log('Sandbox buy status', { reference: trade.reference, status: trade.status });
      if (trade.status === 'COMPLETED' || trade.status === 'APPROVED') {
        const codes = await run('buy code retrieval', () => client.buyCodes(trade.reference));
        if (!codes.length) throw new Error('The buy is complete and its codes are not available yet.');
        console.log('Delivered sandbox codes:', codes.length);
      }
      break;
    }
    case 'sell-status': {
      const uniqueIdentifier = required(reference, 'the sell identifier argument');
      const trade = await run('sell history', () => client.findTrade(uniqueIdentifier));
      if (!trade) throw new Error('Trade not yet visible in sandbox sell history.');
      console.log('Sandbox sell status', { reference: trade.reference, status: trade.status });
      break;
    }
    default:
      throw new Error('Use check, buy, sell, buy-status <identifier>, or sell-status <identifier>.');
  }
}

try {
  await main();
} catch (error) {
  // Provider error bodies may echo credentials or the gift card details.
  console.error(stage ? `Prestmit sandbox ${stage} failed${error.status ? ` (HTTP ${error.status})` : ''}.` : error.message);
  process.exitCode = 1;
}
