import { array, bool, constant, int, list, mode, nullableInt, nullableStr, objectSchema, oneOf, ref, shape, str, time, uuid } from '../schema.js';
import type { DocsArea } from './index.js';

const side = oneOf('Buy coins with money, or sell coins for money.', ['buy', 'sell']);
const coin = str('Coin amount, as a decimal string in the asset’s units.');
const currency = str('Three-letter fiat currency.');
const reserveCoin = shape({ asset: str('Coin code.'), name: str('Coin name.'), enabled: bool('Whether the coin is enabled.'), balance: coin });
const reserveWallet = shape({ currency, balance: int('Fiat reserve in minor units.') });
const markup = objectSchema('ExchangeMarkup', {
  object: constant('exchange_markup'), asset: str('Coin code.'), currency, enabled: bool('Whether customers may trade this pair.'),
  buy_markup_bps: int('Markup when the customer buys, in basis points.'), sell_markup_bps: int('Markup when the customer sells, in basis points.'),
  min_fiat: int('Minimum trade in fiat minor units.'), max_fiat: nullableInt('Maximum trade in fiat minor units, or null.'),
  market_usd: nullableStr('Current market USD price of a whole coin.'), market_price: nullableInt('Market price in this currency, in minor units.'),
  buy_price: nullableInt('Customer buy price in minor units per whole coin.'), sell_price: nullableInt('Customer sell price in minor units per whole coin.'),
  updated_at: nullableStr('Last markup update, ISO timestamp.'),
});
const overviewAssetOpen = shape({ asset: str('Coin code.'), name: str('Coin name.'), decimals: int('Asset decimal places.'),
  market_usd: str('Live market price in US dollars.'), buy_price: int('BitoCard buy price in fiat minor units per whole coin.'),
  sell_price: int('BitoCard sell price in fiat minor units per whole coin.'), available_to_buy: coin,
  available_to_sell_for: int('BitoCard’s available fiat reserve in minor units.'), your_coins: coin,
  your_wallet: int('Your available fiat wallet balance in minor units.'),
});
const overviewAssetClosed = shape({ asset: str('Coin code.'), name: str('Coin name.'), decimals: int('Asset decimal places.'), closed: str('Reason the pair is unavailable.'), your_coins: coin });
const quote = objectSchema('ResellerExchangeQuote', {
  object: constant('reseller_exchange_quote'), id: uuid('Quote ID.'), mode, side, asset: str('Coin code.'), currency,
  amount: coin, fiat: int('Fiat in minor units.'), price: int('Locked fiat price per whole coin, in minor units.'),
  markup_bps: int('BitoCard markup in basis points.'), expires_at: time('Quote expiry, 30 seconds after creation.'), created_at: time('Quote creation.'),
});
const trade = objectSchema('ResellerExchangeTrade', {
  object: constant('reseller_exchange_trade'), id: uuid('Trade ID.'), number: str('Receipt number.'), mode, side,
  asset: str('Coin code.'), currency, amount: coin, fiat: int('Fiat in minor units.'),
  price: int('Locked fiat price per whole coin, in minor units.'), markup: int('BitoCard’s markup earned, in fiat minor units.'), created_at: time('Trade creation.'),
});

const deskTrade = objectSchema('DeskTrade', {
  object: constant('desk_trade'), id: uuid('Trade ID.'), number: str('Receipt number shown to the customer.'), mode, side,
  asset: str('Coin code.'), currency, amount: coin, fiat: int('Fiat in minor units.'), price: int('Fiat price per whole coin, in minor units.'),
  markup: int('Your markup earned, in fiat minor units.'), customer: shape({ id: uuid('Customer ID.'), name: str('Customer name.'), email: str('Customer email.') }),
  created_at: time('Trade time.'),
});
const deskTradeExample = { object: 'desk_trade', id: '2c9a4c1e-4b1f-4f1c-9a43-1b2d1c0f7a11', number: 'EX-000124', mode: 'test', side: 'buy', asset: 'BTC', currency: 'NGN',
  amount: '0.01000000', fiat: 91350000, price: 9135000000, markup: 900000, customer: { id: '0b6f3a52-6a0b-4b7e-9b52-3b6f6c1d2e33', name: 'Ada Trader', email: 'ada@example.com' },
  created_at: '2026-10-17T11:31:00.000Z' };

const deskExample = { object: 'exchange_desk', enabled: true, fallback_to_bitocard: true, markup_cap_bps: 500 };
const reserveExample = { object: 'exchange_reserves', mode: 'test', desk: { id: '9ea9e75d-c29a-4b0b-85d4-0679a952a272', name: 'Ada Digital' },
  coins: [{ asset: 'BTC', name: 'Bitcoin', enabled: true, balance: '0.01000000' }], wallets: [{ currency: 'NGN', balance: 250000 }, { currency: 'USD', balance: 0 }] };
const markupExample = { object: 'exchange_markup', asset: 'BTC', currency: 'NGN', enabled: true, buy_markup_bps: 150, sell_markup_bps: 150,
  min_fiat: 10000, max_fiat: null, market_usd: '60000', market_price: 9000000000, buy_price: 9135000000, sell_price: 8865000000, updated_at: '2026-10-17T11:30:00.000Z' };
const overviewExample = { object: 'reseller_exchange', mode: 'test', currency: 'NGN', desk: { id: 'bitocard', name: 'BitoCard' }, quote_seconds: 30,
  assets: [{ asset: 'BTC', name: 'Bitcoin', decimals: 8, market_usd: '60000', buy_price: 9135000000, sell_price: 8865000000,
    available_to_buy: '0.50000000', available_to_sell_for: 200000000, your_coins: '0.01000000', your_wallet: 1000000 }] };
const quoteExample = { object: 'reseller_exchange_quote', id: '895154de-683a-4f78-9717-a7de659df87f', mode: 'test', side: 'buy', asset: 'BTC', currency: 'NGN',
  amount: '0.01000000', fiat: 91350000, price: 9135000000, markup_bps: 150, expires_at: '2026-10-17T11:30:30.000Z', created_at: '2026-10-17T11:30:00.000Z' };
const tradeExample = { object: 'reseller_exchange_trade', id: 'eaed234d-f741-4c8c-bd83-e95433224885', number: 'RE-000123', mode: 'test', side: 'buy', asset: 'BTC',
  currency: 'NGN', amount: '0.01000000', fiat: 91350000, price: 9135000000, markup: 1350000, created_at: '2026-10-17T11:30:10.000Z' };

export const exchangeDocs: DocsArea = {
  schemas: {
    ExchangeDesk: objectSchema('ExchangeDesk', { object: constant('exchange_desk'), enabled: bool('Whether the reseller desk is enabled by BitoCard.'), fallback_to_bitocard: bool('Whether customers may use BitoCard when the reseller does not offer the pair.'), markup_cap_bps: int('The most markup your market allows on each side, in basis points.') }),
    ExchangeReserves: objectSchema('ExchangeReserves', { object: constant('exchange_reserves'), mode, desk: shape({ id: str('Reseller ID.'), name: str('Store name.') }), coins: array(reserveCoin), wallets: array(reserveWallet) }),
    ExchangeMarkup: markup,
    ResellerExchangeOverview: objectSchema('ResellerExchangeOverview', { object: constant('reseller_exchange'), mode, currency,
      desk: shape({ id: str('BitoCard desk ID.'), name: str('BitoCard desk name.') }), quote_seconds: int('Seconds a quote remains valid.'),
      assets: array({ anyOf: [overviewAssetOpen, overviewAssetClosed] }) }),
    ResellerExchangeQuote: quote, ResellerExchangeTrade: trade, DeskTrade: deskTrade,
    ResellerCoinBalance: objectSchema('ResellerCoinBalance', { object: constant('reseller_coin_balance'), mode, asset: str('Coin code.'), wallet: coin, reserve: coin }),
  },
  responses: {
    'GET /v1/exchange': { status: 200, description: 'BitoCard’s live exchange pairs and reserves.', schema: 'ResellerExchangeOverview', example: overviewExample },
    'GET /v1/exchange/desk': { status: 200, description: 'Your customer desk settings.', schema: 'ExchangeDesk', example: deskExample },
    'PUT /v1/exchange/desk': { status: 200, description: 'Updated desk settings.', schema: 'ExchangeDesk', example: deskExample },
    'GET /v1/exchange/reserves': { status: 200, description: 'Your customer desk reserves.', schema: 'ExchangeReserves', example: reserveExample },
    'POST /v1/exchange/reserves/transfers': { status: 201, description: 'Updated fiat reserves.', schema: 'ExchangeReserves', example: reserveExample },
    'POST /v1/exchange/reserves/coins/transfers': { status: 201, description: 'Updated coin wallet and reserve.', schema: 'ResellerCoinBalance',
      example: { object: 'reseller_coin_balance', mode: 'test', asset: 'BTC', wallet: '0.00400000', reserve: '0.00600000' } },
    'GET /v1/exchange/desk/trades': { status: 200, description: 'Your customers’ trades at your desk.', schema: list(ref('DeskTrade')),
      example: { object: 'list', data: [deskTradeExample], has_more: false } },
    'GET /v1/exchange/markups': { status: 200, description: 'Your customer exchange prices.', schema: list(ref('ExchangeMarkup'), { mode }, false), example: { object: 'list', mode: 'test', data: [markupExample] } },
    'PUT /v1/exchange/markups': { status: 200, description: 'Updated customer price.', schema: 'ExchangeMarkup', example: markupExample },
    'POST /v1/exchange/quotes': { status: 201, description: 'Price held for 30 seconds.', schema: 'ResellerExchangeQuote', example: quoteExample },
    'POST /v1/exchange/trades': { status: 201, description: 'Completed reseller trade.', schema: 'ResellerExchangeTrade', example: tradeExample },
    'GET /v1/exchange/trades': { status: 200, description: 'Completed reseller trades.', schema: list(ref('ResellerExchangeTrade')),
      example: { object: 'list', data: [tradeExample], has_more: false } },
  },
};
