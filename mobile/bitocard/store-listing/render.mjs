// Google Play listing images for the BitoCard app, drawn as HTML in the app's own colours, Inter and icons, and
// photographed by Chrome at Play's sizes: phone screenshots (1080 x 1920), 7- and 10-inch tablet screenshots
// (1920 x 1080, 2560 x 1440), Chromebook screenshots (3840 x 2160), feature graphics (1024 x 500) and the 512 px icon.
//
// The phone screens follow the app's real screens (src/app) with made-up data: no real person, number, balance or
// code, and no other company's logo (networks are named in plain text, gift cards are generic designs).
//
//   node store-listing/render.mjs        (from mobile/bitocard; Chrome or Edge must be installed)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const out = join(here, 'out');
const work = join(here, '.work');
// The repository's own React and lucide (the app's React Native copy is another version).
const rootRequire = createRequire(join(app, '..', '..', 'package.json'));
const { createElement } = rootRequire('react');
const { renderToStaticMarkup } = rootRequire('react-dom/server');
const lucide = rootRequire('lucide-react');

const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!chrome) throw new Error('Chrome or Edge is needed to render the images.');

const C = {
  navy: '#070f4c', navy2: '#101a66', pink: '#ff2382', pinkText: '#d10f5f', pinkSoft: '#ffe4ef', bg: '#f6f7fb', card: '#ffffff',
  text: '#070f4c', muted: '#4b5374', line: '#e4e7f0', field: '#cdd2e3', onNavy2: '#c9cde4', good: '#047857', goodSoft: '#dcf5e8',
};
const tints = { pink: ['#ffe4ef', '#d10f5f'], blue: ['#e5ecff', '#1d4ed8'], amber: ['#fff1dc', '#b45309'], violet: ['#ede7ff', '#6d28d9'], green: ['#dcf5e8', '#047857'], sky: ['#e0f2fe', '#0369a1'] };

const icon = (name, size = 22, color = 'currentColor', strokeWidth = 2) => renderToStaticMarkup(createElement(lucide[name], { size, color, strokeWidth, 'aria-hidden': true }));
const file = path => pathToFileURL(path).href;
const font = weight => file(join(app, `node_modules/@expo-google-fonts/inter/${weight}/Inter_${weight}.ttf`));
const mark = file(join(app, 'assets/images/mark.png'));
const markLight = file(join(app, 'assets/images/mark-light.png'));

const baseCss = `
@font-face { font-family: Inter; font-weight: 400; src: url(${font('400Regular')}); }
@font-face { font-family: Inter; font-weight: 600; src: url(${font('600SemiBold')}); }
@font-face { font-family: Inter; font-weight: 700; src: url(${font('700Bold')}); }
@font-face { font-family: Inter; font-weight: 800; src: url(${font('800ExtraBold')}); }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: Inter, sans-serif; color: ${C.text}; -webkit-font-smoothing: antialiased; overflow: hidden; }
svg { display: block; flex: none; }
`;

// ---- The app's screens, 390 x 844 points --------------------------------------------------------------------

const statusBar = (dark = false) => `
<div class="status" style="color:${dark ? '#fff' : C.text}">
  <span>9:41</span><span class="status-icons">${icon('Signal', 16, 'currentColor', 2.4)}${icon('Wifi', 16, 'currentColor', 2.4)}${icon('BatteryFull', 20, 'currentColor', 2)}</span>
</div>`;

const tabs = active => `
<nav class="tabs">${[['House', 'Home'], ['Smartphone', 'Mobile'], ['Gift', 'Gift cards'], ['Wallet', 'Wallet'], ['ReceiptText', 'Orders']]
  .map(([i, label]) => `<div class="tab ${label === active ? 'on' : ''}">${icon(i, 24)}<span>${label}</span></div>`)
  .join('')}</nav>`;

const topBar = title => `
<div class="topbar">${icon('ChevronLeft', 26, C.text)}<span>${title}</span><span style="width:26px"></span></div>`;

const screenCss = `
.screen { width: 390px; height: 844px; background: ${C.bg}; position: relative; overflow: hidden; display: flex; flex-direction: column; }
.status { height: 47px; padding: 14px 26px 0 34px; display: flex; justify-content: space-between; font-weight: 600; font-size: 16px; flex: none; }
.status-icons { display: flex; gap: 6px; align-items: center; }
.body { flex: 1; padding: 10px 18px 18px; display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
.tabs { flex: none; height: 84px; background: #fff; border-top: 1px solid ${C.line}; display: flex; padding: 8px 4px 24px; }
.tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; color: ${C.muted}; }
.tab.on { color: ${C.pinkText}; }
.topbar { height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; font-weight: 700; font-size: 17px; flex: none; }
.row { display: flex; align-items: center; gap: 10px; }
.title { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; line-height: 34px; }
.heading { font-size: 19px; font-weight: 700; line-height: 24px; }
.label { font-size: 15px; font-weight: 600; }
.small { font-size: 13px; }
.muted { color: ${C.muted}; }
.card { background: #fff; border: 1px solid ${C.line}; border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.field { background: #fff; border: 1.5px solid ${C.field}; border-radius: 14px; min-height: 52px; padding: 0 14px; display: flex; align-items: center; gap: 10px; font-size: 16px; }
.field.on { border-color: ${C.pink}; box-shadow: 0 0 0 3px ${C.pinkSoft}; }
.fieldlabel { font-size: 14px; font-weight: 600; margin-bottom: -8px; }
.btn { min-height: 52px; border-radius: 14px; background: ${C.pink}; color: #fff; font-weight: 700; font-size: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn.alt { background: #fff; color: ${C.text}; border: 1.5px solid ${C.field}; }
.seg { display: flex; background: #e9ebf3; border-radius: 13px; padding: 4px; }
.seg div { flex: 1; text-align: center; padding: 10px 0; font-weight: 600; font-size: 14px; border-radius: 10px; color: ${C.muted}; }
.seg .on { background: #fff; color: ${C.text}; box-shadow: 0 1px 3px rgba(7,15,76,.12); }
.chip { border: 1.5px solid ${C.field}; background: #fff; border-radius: 12px; padding: 11px 14px; font-weight: 600; font-size: 15px; }
.chip.on { border-color: ${C.pink}; background: ${C.pinkSoft}; color: ${C.pinkText}; }
.chips { display: flex; flex-wrap: wrap; gap: 9px; }
.pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 11px; font-size: 13px; font-weight: 600; }
.good { background: ${C.goodSoft}; color: ${C.good}; }
.way { background: #fff1dc; color: #b45309; }
.kv { display: flex; justify-content: space-between; font-size: 15px; padding: 9px 0; border-bottom: 1px solid ${C.line}; }
.kv:last-child { border-bottom: 0; }
.kv span:first-child { color: ${C.muted}; }
.kv span:last-child { font-weight: 600; text-align: right; }
.wallet { background: ${C.navy}; color: #fff; border-radius: 22px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.amount { font-size: 34px; font-weight: 800; letter-spacing: -0.8px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.tile { background: #fff; border: 1px solid ${C.line}; border-radius: 18px; min-height: 104px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 10px; font-size: 13px; font-weight: 600; text-align: center; line-height: 16px; }
.tileicon { width: 42px; height: 42px; border-radius: 13px; display: flex; align-items: center; justify-content: center; }
.gc { border-radius: 14px; aspect-ratio: 1.6; position: relative; overflow: hidden; color: #fff; padding: 12px; display: flex; flex-direction: column; justify-content: space-between; }
.gc b { font-size: 15px; }
.gc small { font-size: 12px; opacity: .9; font-weight: 600; }
.code { font-family: Consolas, monospace; letter-spacing: 3px; font-size: 18px; font-weight: 700; }
`;

const tile = (label, i, t) => `<div class="tile"><div class="tileicon" style="background:${tints[t][0]}">${icon(i, 22, tints[t][1])}</div>${label}</div>`;

const giftArt = [
  ['linear-gradient(135deg,#ff2382,#7c1fd1)', 'Online shopping', 'ShoppingBag'],
  ['linear-gradient(135deg,#0ea5e9,#1d4ed8)', 'Games store', 'Gamepad2'],
  ['linear-gradient(135deg,#10b981,#047857)', 'Music streaming', 'Music'],
  ['linear-gradient(135deg,#f59e0b,#d9480f)', 'Food delivery', 'UtensilsCrossed'],
  ['linear-gradient(135deg,#111827,#374151)', 'App store', 'AppWindow'],
  ['linear-gradient(135deg,#ec4899,#be185d)', 'Movies and TV', 'Clapperboard'],
];
const giftCard = ([bg, name, i], value) => `<div class="gc" style="background:${bg}"><div class="row" style="justify-content:space-between">${icon(i, 26, '#fff')}<small>${value}</small></div><b>${name}</b></div>`;

const scenes = {
  home: () => `
${statusBar()}
<div class="body">
  <div class="row"><img src="${mark}" style="width:30px;height:30px"><span style="flex:1;font-weight:800;font-size:22px">Bito<span style="color:${C.pinkText}">card</span></span>
    <div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center">${icon('Bell', 24)}<span style="position:absolute;top:4px;right:2px;background:${C.pink};color:#fff;font-size:11px;font-weight:700;border-radius:9px;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center">2</span></div>
    <div style="width:44px;height:44px;border-radius:22px;background:${C.navy};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600">AO</div></div>
  <div class="field" style="border-width:1px;border-color:${C.line};min-height:48px;color:${C.muted}">${icon('Search', 20, C.muted)}Search gift cards, airtime and more</div>
  <div><div class="muted">Hello,</div><div class="title">Ada</div></div>
  <div class="wallet"><div class="row"><span class="label" style="flex:1;color:${C.onNavy2}">NGN wallet</span><span class="label">$24.50</span></div>
    <div class="amount">₦128,450.00</div><div class="btn">Add funds</div></div>
  <div class="heading">I want to</div>
  <div class="grid">${tile('Buy airtime', 'Smartphone', 'pink')}${tile('Buy data', 'Wifi', 'blue')}${tile('Sell airtime', 'ArrowUpRight', 'amber')}${tile('Buy gift cards', 'Gift', 'violet')}${tile('Sell gift cards', 'Wallet', 'green')}${tile('Pay bills and TV', 'Zap', 'amber')}</div>
</div>${tabs('Home')}`,

  mobile: () => `
${statusBar()}
<div class="body">
  <div class="title">Mobile</div>
  <div class="seg"><div class="on">Airtime</div><div>Data</div></div>
  <div class="fieldlabel">Mobile number</div>
  <div class="field on">0803 555 0142</div>
  <div class="row" style="gap:8px"><span class="pill good">${icon('CircleCheck', 15, C.good)}MTN found from the number</span></div>
  <div class="label">Network</div>
  <div class="chips"><div class="chip on">MTN</div><div class="chip">Airtel</div><div class="chip">Glo</div><div class="chip">9mobile</div></div>
  <div class="label">Amount</div>
  <div class="chips"><div class="chip">₦200</div><div class="chip">₦500</div><div class="chip on">₦1,000</div><div class="chip">₦2,000</div><div class="chip">₦5,000</div></div>
  <div class="fieldlabel">Or type an amount (NGN)</div>
  <div class="field" style="color:${C.muted}">1,000</div>
  <div style="flex:1"></div>
  <div class="btn">Continue</div>
</div>${tabs('Mobile')}`,

  giftcards: () => `
${statusBar()}
<div class="body">
  <div class="title">Gift cards</div>
  <div class="seg"><div class="on">Buy</div><div>Sell</div></div>
  <div class="field" style="color:${C.muted}">${icon('Search', 20, C.muted)}Find a gift card</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    ${giftArt.map((g, n) => `<div style="display:flex;flex-direction:column;gap:6px">${giftCard(g, ['$10–$200', '$5–$100', '$10–$50', '$15–$100', '$10–$100', '$25–$100'][n])}<div class="small" style="font-weight:600">${g[1]}</div><div class="small muted">₦1,724 per $1</div></div>`).join('')}
  </div>
</div>${tabs('Gift cards')}`,

  pay: () => `
${statusBar()}${topBar('Confirm payment')}
<div class="body" style="padding-top:0">
  <div class="card"><div class="label muted" style="font-weight:600">Your order</div>
    <div class="kv"><span>For</span><span>Online shopping $50</span></div>
    <div class="kv"><span>Codes sent to</span><span>ada@example.com</span></div>
    <div class="kv"><span>Rate</span><span>₦1,724.32 per $1</span></div></div>
  <div class="label">Pay from</div>
  <div class="card" style="border:2px solid ${C.pink};flex-direction:row;align-items:center"><div class="tileicon" style="background:${C.pinkSoft}">${icon('Wallet', 22, C.pinkText)}</div><div style="flex:1"><div class="label">NGN wallet</div><div class="small muted">₦128,450.00 available</div></div>${icon('CircleCheck', 24, C.pink)}</div>
  <div class="card" style="flex-direction:row;align-items:center"><div class="tileicon" style="background:#e5ecff">${icon('DollarSign', 22, '#1d4ed8')}</div><div style="flex:1"><div class="label">USD wallet</div><div class="small muted">$24.50 available</div></div>${icon('Circle', 24, C.field)}</div>
  <div style="flex:1"></div>
  <div style="background:rgba(7,15,76,.92);border-radius:24px;padding:26px 20px;color:#fff;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center">
    ${icon('Fingerprint', 54, C.pink, 1.6)}<div class="heading">Confirm with your fingerprint</div><div class="small" style="color:${C.onNavy2}">To pay ₦86,216.00 from your NGN wallet</div></div>
  <div class="btn">${icon('Lock', 18, '#fff')}Pay ₦86,216.00</div>
</div>`,

  codes: () => `
${statusBar()}${topBar('Your order')}
<div class="body" style="padding-top:0">
  <div class="row"><div class="gc" style="background:${giftArt[1][0]};width:112px;padding:10px">${icon('Gamepad2', 24, '#fff')}<b style="font-size:13px">$25</b></div>
    <div><div class="heading">Games store $25</div><span class="pill good" style="margin-top:6px">${icon('CircleCheck', 14, C.good)}Delivered</span></div></div>
  <div class="card"><div class="label">Your code</div>
    <div class="row" style="justify-content:space-between;background:${C.bg};border-radius:12px;padding:14px"><span class="code">•••• •••• •••• 7Q4K</span>${icon('EyeOff', 22, C.muted)}</div>
    <div class="row small muted" style="gap:6px">${icon('ShieldCheck', 16, C.good)}Hidden until you reveal it. Screenshots are blocked.</div>
    <div class="btn">${icon('ScanFace', 20, '#fff')}Reveal with Face ID</div></div>
  <div class="card">
    <div class="kv"><span>Value</span><span>$25.00</span></div>
    <div class="kv"><span>Paid</span><span>₦43,108.00</span></div>
    <div class="kv"><span>Paid with</span><span>NGN wallet</span></div>
    <div class="kv"><span>Receipt</span><span>BC-104582</span></div></div>
  <div class="btn alt">${icon('MessageCircle', 18)}Ask us about this order</div>
</div>`,

  wallet: () => `
${statusBar()}
<div class="body">
  <div class="title">Wallet</div>
  <div class="seg"><div class="on">NGN</div><div>USD</div></div>
  <div class="wallet"><span class="label" style="color:${C.onNavy2}">NGN wallet</span><div class="amount">₦128,450.00</div>
    <div class="row"><div class="btn" style="flex:1">${icon('Plus', 18, '#fff')}Add funds</div><div class="btn" style="flex:1;background:${C.navy2}">${icon('ArrowLeftRight', 18, '#fff')}Move money</div></div></div>
  <div class="card" style="flex-direction:row;align-items:center"><div class="tileicon" style="background:${C.goodSoft}">${icon('Landmark', 22, C.good)}</div><div style="flex:1"><div class="label">Your account number</div><div class="small muted">Transfer from any bank app</div></div><span class="code" style="font-size:15px;letter-spacing:1px">80•• ••5521</span></div>
  <div class="heading">Transactions</div>
  <div class="card" style="gap:0;padding:4px 16px">
    ${[['ArrowDownLeft', 'Added by bank transfer', 'Today, 10:24', '+₦50,000.00', C.good], ['Smartphone', 'MTN airtime', 'Today, 09:02', '−₦1,000.00', C.text], ['Gift', 'Games store $25', 'Yesterday', '−₦43,108.00', C.text], ['ArrowDownLeft', 'Added by card', 'Mon 17 Nov', '+₦100,000.00', C.good]]
      .map(([i, t, d, a, col]) => `<div class="row" style="padding:12px 0;border-bottom:1px solid ${C.line}"><div class="tileicon" style="width:38px;height:38px;background:${C.bg}">${icon(i, 19, C.muted)}</div><div style="flex:1"><div class="label">${t}</div><div class="small muted">${d}</div></div><span class="label" style="color:${col}">${a}</span></div>`).join('')}
  </div>
</div>${tabs('Wallet')}`,

  bills: () => `
${statusBar()}${topBar('Prepaid electricity')}
<div class="body" style="padding-top:0">
  <div class="row"><div class="tileicon" style="width:52px;height:52px;background:${tints.amber[0]}">${icon('Zap', 28, tints.amber[1])}</div><div><div class="heading">Electricity, prepaid</div><div class="small muted">Token sent in the app</div></div></div>
  <div class="fieldlabel">Meter number</div>
  <div class="field">4501 2345 678</div>
  <div class="fieldlabel">Amount (NGN)</div>
  <div class="field">5,000</div>
  <div class="card" style="background:${C.goodSoft};border-color:#b8ead0"><div class="row label" style="color:${C.good};gap:8px">${icon('BadgeCheck', 20, C.good)}Meter found</div>
    <div class="kv" style="border-color:#b8ead0"><span>Name on the account</span><span>ADA OBI</span></div>
    <div class="kv"><span>Address</span><span>12 Allen Avenue</span></div></div>
  <div class="small muted">Check the name before you pay. Your token arrives on the order and in a notification.</div>
  <div style="flex:1"></div>
  <div class="btn">Pay ₦5,000.00</div>
</div>`,

  orders: () => `
${statusBar()}
<div class="body">
  <div class="title">Orders</div>
  <div class="seg"><div class="on">All</div><div>On the way</div><div>Delivered</div></div>
  ${[['Smartphone', 'MTN airtime ₦1,000', 'On the way', 'way', 'Just now', tints.pink], ['Gift', 'Games store $25', 'Delivered', 'good', 'Yesterday', tints.violet], ['Zap', 'Electricity ₦5,000', 'Delivered', 'good', 'Tue 18 Nov', tints.amber], ['Wifi', 'Data 10 GB, 30 days', 'Delivered', 'good', 'Mon 17 Nov', tints.blue], ['Tv', 'Pay-TV renewal', 'Delivered', 'good', 'Sat 15 Nov', tints.sky]]
    .map(([i, t, s, k, d, tint]) => `<div class="card" style="flex-direction:row;align-items:center"><div class="tileicon" style="background:${tint[0]}">${icon(i, 22, tint[1])}</div><div style="flex:1"><div class="label">${t}</div><div class="small muted">${d}</div></div><span class="pill ${k}">${s}</span></div>`).join('')}
  <div style="position:absolute;left:14px;right:14px;top:56px;background:#fff;border-radius:18px;box-shadow:0 14px 40px rgba(7,15,76,.22);padding:14px;display:flex;gap:12px;align-items:center">
    <img src="${mark}" style="width:34px;height:34px"><div style="flex:1"><div class="small" style="font-weight:700">BitoCard · now</div><div class="small">Your MTN airtime ₦1,000 was delivered.</div></div></div>
</div>${tabs('Orders')}`,
};

// ---- Layouts ---------------------------------------------------------------------------------------------------

const phone = (scene, width) => {
  const scale = width / 390;
  return `<div class="phone" style="width:${width + 28}px;height:${844 * scale + 28}px;padding:14px;border-radius:${62 * scale}px">
    <div style="width:${width}px;height:${844 * scale}px;border-radius:${48 * scale}px;overflow:hidden;position:relative">
      <div style="transform:scale(${scale});transform-origin:0 0;width:390px;height:844px"><div class="screen">${scenes[scene]()}</div></div>
      <div style="position:absolute;top:${11 * scale}px;left:50%;transform:translateX(-50%);width:${118 * scale}px;height:${34 * scale}px;background:#000;border-radius:${20 * scale}px"></div>
    </div></div>`;
};

const themes = {
  navy: { bg: `radial-gradient(1100px 700px at 85% 0%, rgba(255,35,130,.35), transparent 60%), radial-gradient(900px 800px at 0% 100%, rgba(80,110,255,.25), transparent 60%), ${C.navy}`, ink: '#fff', sub: C.onNavy2, accent: '#ff6fab' },
  light: { bg: `radial-gradient(1000px 700px at 100% 0%, ${C.pinkSoft}, transparent 65%), linear-gradient(180deg,#ffffff,#eef0f8)`, ink: C.navy, sub: C.muted, accent: C.pinkText },
  pink: { bg: `radial-gradient(1000px 800px at 0% 0%, #ff5aa0, transparent 60%), linear-gradient(160deg,#ff2382,#b5136a)`, ink: '#fff', sub: '#ffe4ef', accent: '#fff' },
};

const page = (body, w, h, extraCss = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}${screenCss}
html,body{width:${w}px;height:${h}px}
.phone{background:#0b0f2a;box-shadow:0 40px 90px rgba(5,10,51,.45), inset 0 0 0 2px #2a3166}
${extraCss}</style></head><body>${body}</body></html>`;

const headline = (t, head, sub, size) => `<div style="font-size:${size}px;font-weight:800;line-height:1.08;letter-spacing:-${size / 40}px;color:${t.ink}">${head}</div>
  <div style="margin-top:${size * 0.32}px;font-size:${size * 0.44}px;line-height:1.35;color:${t.sub};font-weight:600">${sub}</div>`;

const shot = (w, h, theme, scene, head, sub) => {
  const t = themes[theme];
  if (w < h) {
    return page(`<div style="width:${w}px;height:${h}px;background:${t.bg};position:relative;overflow:hidden">
      <div style="position:absolute;left:84px;right:84px;top:118px;text-align:center">${headline(t, head, sub, 74)}</div>
      <div style="position:absolute;left:50%;top:470px;transform:translateX(-50%)">${phone(scene, 640)}</div></div>`, w, h);
  }
  const pw = Math.round(h * 0.62);
  return page(`<div style="width:${w}px;height:${h}px;background:${t.bg};position:relative;overflow:hidden">
    <div style="position:absolute;left:${w * 0.08}px;width:${w * 0.44}px;top:50%;transform:translateY(-50%)">
      <div class="row" style="gap:${h * 0.016}px;margin-bottom:${h * 0.05}px"><img src="${theme === 'light' ? mark : markLight}" style="width:${h * 0.06}px;height:${h * 0.06}px"><span style="font-size:${h * 0.042}px;font-weight:800;color:${t.ink}">Bito<span style="color:${t.accent}">card</span></span></div>
      ${headline(t, head, sub, Math.round(h * 0.085))}</div>
    <div style="position:absolute;right:${w * 0.1}px;top:${h * 0.1}px">${phone(scene, pw)}</div></div>`, w, h);
};

const shots = [
  ['light', 'home', 'Airtime, data and gift cards in one app', 'One wallet for everything you top up and buy'],
  ['navy', 'mobile', 'Top up any network in seconds', 'Type the number. We find the network for you.'],
  ['light', 'giftcards', 'Gift cards at the day’s rate', 'See exactly what you pay before you buy'],
  ['pink', 'pay', 'Every payment needs your fingerprint', 'Face ID, fingerprint or your phone’s PIN'],
  ['navy', 'codes', 'Your codes stay hidden until you reveal them', 'Revealed only with Face ID, never in a screenshot'],
  ['light', 'wallet', 'Add money your way', 'Card, bank transfer, mobile money or your own account number'],
  ['navy', 'bills', 'Pay electricity and TV bills', 'See the name on the meter before you pay'],
  ['light', 'orders', 'Follow every order', 'Get notified the moment it’s delivered'],
];

// ---- Feature graphics, 1024 x 500 -------------------------------------------------------------------------------

const featureCss = `.fg{width:1024px;height:500px;position:relative;overflow:hidden}`;
const wordmark = (size, dark, accent = dark ? '#ff6fab' : C.pinkText) => `<div class="row" style="gap:${size * 0.4}px"><img src="${dark ? markLight : mark}" style="width:${size * 1.4}px;height:${size * 1.4}px"><span style="font-size:${size}px;font-weight:800;color:${dark ? '#fff' : C.navy}">Bito<span style="color:${accent}">card</span></span></div>`;
const features = [
  ['feature-graphic-1', `<div class="fg" style="background:${themes.navy.bg}">
    <div style="position:absolute;left:64px;top:96px;width:470px">${wordmark(44, true)}
      <div style="margin-top:30px;font-size:46px;font-weight:800;line-height:1.08;color:#fff;letter-spacing:-1px">Airtime, data and gift cards</div>
      <div style="margin-top:16px;font-size:22px;color:${C.onNavy2};font-weight:600">One wallet. Every network. Delivered in seconds.</div></div>
    <div style="position:absolute;right:70px;top:46px;transform:rotate(-6deg)">${phone('home', 300)}</div></div>`],
  ['feature-graphic-2', `<div class="fg" style="background:${themes.light.bg}">
    <div style="position:absolute;left:0;right:0;top:64px;display:flex;justify-content:center">${wordmark(40, false)}</div>
    <div style="position:absolute;left:0;right:0;top:150px;text-align:center;font-size:44px;font-weight:800;letter-spacing:-1px;color:${C.navy}">Top up, pay and buy in one app</div>
    <div style="position:absolute;left:80px;right:80px;top:262px;display:flex;justify-content:space-between">
      ${[['Smartphone', 'Airtime', 'pink'], ['Wifi', 'Data', 'blue'], ['Gift', 'Gift cards', 'violet'], ['Zap', 'Bills', 'amber'], ['Tv', 'Pay-TV', 'sky'], ['Wallet', 'Wallet', 'green']]
        .map(([i, l, t]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><div style="width:104px;height:104px;border-radius:30px;background:#fff;border:1px solid ${C.line};box-shadow:0 10px 26px rgba(7,15,76,.08);display:flex;align-items:center;justify-content:center"><div class="tileicon" style="width:62px;height:62px;border-radius:19px;background:${tints[t][0]}">${icon(i, 34, tints[t][1])}</div></div><span style="font-weight:700;font-size:19px">${l}</span></div>`).join('')}
    </div></div>`],
  ['feature-graphic-3', `<div class="fg" style="background:${themes.pink.bg}">
    <div style="position:absolute;left:64px;top:120px;width:440px">${wordmark(40, true, C.navy)}
      <div style="margin-top:28px;font-size:48px;font-weight:800;line-height:1.06;color:#fff;letter-spacing:-1px">Gift cards at the day’s rate</div>
      <div style="margin-top:16px;font-size:22px;color:#ffe4ef;font-weight:600">Codes hidden until you reveal them</div></div>
    <div style="position:absolute;right:56px;top:70px;width:440px;height:360px">
      ${giftArt.slice(0, 4).map((g, n) => `<div style="position:absolute;width:250px;left:${[0, 180, 30, 190][n]}px;top:${[10, 40, 190, 210][n]}px;transform:rotate(${[-9, 7, 5, -6][n]}deg);box-shadow:0 18px 40px rgba(60,0,30,.35);border-radius:16px">${giftCard(g, ['$50', '$25', '$100', '$20'][n])}</div>`).join('')}
    </div></div>`],
];

// ---- Render --------------------------------------------------------------------------------------------------

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
for (const dir of ['phone', 'tablet-7in', 'tablet-10in', 'chromebook', 'feature-graphic']) mkdirSync(join(out, dir), { recursive: true });

const shoot = (html, w, h, target) => {
  const source = join(work, `${target.replace(/[\\/]/g, '_')}.html`);
  writeFileSync(source, html);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000', `--window-size=${w},${h}`, `--screenshot=${join(out, target)}`, '--virtual-time-budget=4000', file(source)], { stdio: 'ignore' });
  if (!existsSync(join(out, target))) throw new Error(`Chrome did not write ${target}`);
  console.log(`${target}  ${w}x${h}`);
};

shots.forEach(([theme, scene, head, sub], n) => {
  const name = `${String(n + 1).padStart(2, '0')}-${scene}.png`;
  shoot(shot(1080, 1920, theme, scene, head, sub), 1080, 1920, `phone/${name}`);
  shoot(shot(1920, 1080, theme, scene, head, sub), 1920, 1080, `tablet-7in/${name}`);
  shoot(shot(2560, 1440, theme, scene, head, sub), 2560, 1440, `tablet-10in/${name}`);
  // Chromebooks: each side 1,080 to 7,680 px.
  shoot(shot(3840, 2160, theme, scene, head, sub), 3840, 2160, `chromebook/${name}`);
});
for (const [name, body] of features) shoot(page(body, 1024, 500, featureCss), 1024, 500, `feature-graphic/${name}.png`);
// Play's icon: 512 x 512, the "b" from the master artwork (assets/logo.png) at two thirds of the height, centred on
// white, so it sits inside Play's rounded mask with room around it (Python's Pillow, as scripts/brand-assets.py uses).
const playIcon = [
  'import sys',
  'from PIL import Image',
  'mark = Image.open(sys.argv[1]).convert("RGBA")',
  'mark = mark.crop(mark.getchannel("A").point(lambda a: 255 if a > 40 else 0).getbbox())',
  'height = 340',
  'mark = mark.resize((round(mark.width * height / mark.height), height), Image.LANCZOS)',
  'icon = Image.new("RGBA", (2048, 2048), "white")',
  'big = mark.resize((mark.width * 4, mark.height * 4), Image.LANCZOS)',
  'icon.alpha_composite(big, ((2048 - big.width) // 2, (2048 - big.height) // 2))',
  'icon.convert("RGB").resize((512, 512), Image.LANCZOS).save(sys.argv[2])',
].join('\n');
execFileSync('python', ['-c', playIcon, join(app, '..', '..', 'assets/logo.png'), join(out, 'icon-512.png')]);
console.log('icon-512.png  512x512');
// Every image without transparency (Chrome sometimes keeps an alpha channel; Play's feature graphic refuses one).
const flatten = ['import glob, sys', 'from PIL import Image', 'for f in glob.glob(sys.argv[1] + "/**/*.png", recursive=True):', '    im = Image.open(f)', '    if im.mode != "RGB": im.convert("RGB").save(f)'].join('\n');
execFileSync('python', ['-c', flatten, out]);
rmSync(work, { recursive: true, force: true });
console.log(`Done: ${out}`);
