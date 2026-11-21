// Google Play listing images for the Udozo app, drawn as HTML in the app's own colours, Inter and icons, and
// photographed by Chrome at Play's sizes: phone screenshots (1080 x 1920), 7- and 10-inch tablet screenshots
// (1920 x 1080, 2560 x 1440), Chromebook screenshots (3840 x 2160), foldable screenshots (2160 x 2160, 2160 x 1620,
// 1200 x 1920), Android XR screenshots (3840 x 2160), feature graphics (1024 x 500) and the 512 px icon.
//
// The phone screens follow the app's real screens (src/app) with made-up data: no real person, number, listing, price
// or code, and no other company's logo (items are drawn as icons on colour, never photos of real products).
//
//   node store-listing/render.mjs [phone]   (from mobile/udozo; Chrome or Edge, and Python with Pillow, must be installed)
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

// src/lib/palette.ts's light palette, with the deeper blue of the logo's disc for dark backgrounds.
const C = {
  blue: '#185174', deep: '#0f3550', accent: '#0e7cc0', accentSoft: '#e3f1fb', bg: '#f3f5f6', card: '#ffffff',
  text: '#10212e', muted: '#5b6b78', line: '#e1e6ea', field: '#cfd8de', onBlue: '#cfe0eb', good: '#1f7a4d', goodSoft: '#dcf2e6',
};
const tints = { blue: ['#e3f1fb', '#0e7cc0'], amber: ['#fff1dc', '#b45309'], violet: ['#ede7ff', '#6d28d9'], green: ['#dcf2e6', '#1f7a4d'], rose: ['#ffe4ea', '#be123c'], slate: ['#e8edf1', '#334155'] };

const icon = (name, size = 22, color = 'currentColor', strokeWidth = 2) => {
  if (!lucide[name]) throw new Error(`No lucide icon named ${name}`);
  return renderToStaticMarkup(createElement(lucide[name], { size, color, strokeWidth, 'aria-hidden': true }));
};
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
<nav class="tabs">${[['House', 'Home'], ['Search', 'Search'], ['CirclePlus', 'Sell'], ['MessageCircle', 'Chats'], ['CircleUser', 'Me']]
  .map(([i, label]) => `<div class="tab ${label === active ? 'on' : ''}">${icon(i, 24)}<span>${label}</span></div>`)
  .join('')}</nav>`;

const topBar = title => `
<div class="topbar">${icon('ChevronLeft', 26, C.text)}<span>${title}</span><span style="width:26px"></span></div>`;

const screenCss = `
.screen { width: 390px; height: 844px; background: ${C.bg}; position: relative; overflow: hidden; display: flex; flex-direction: column; }
.status { height: 47px; padding: 14px 26px 0 34px; display: flex; justify-content: space-between; font-weight: 600; font-size: 16px; flex: none; }
.status-icons { display: flex; gap: 6px; align-items: center; }
.body { flex: 1; padding: 10px 18px 18px; display: flex; flex-direction: column; gap: 14px; overflow: hidden; }
.tabs { flex: none; height: 84px; background: #fff; border-top: 1px solid ${C.line}; display: flex; padding: 8px 4px 24px; }
.tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; color: ${C.muted}; }
.tab.on { color: ${C.blue}; }
.topbar { height: 52px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; font-weight: 700; font-size: 17px; flex: none; }
.row { display: flex; align-items: center; gap: 10px; }
.title { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; line-height: 34px; }
.heading { font-size: 19px; font-weight: 700; line-height: 24px; }
.label { font-size: 15px; font-weight: 600; }
.small { font-size: 13px; }
.muted { color: ${C.muted}; }
.card { background: #fff; border: 1px solid ${C.line}; border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.field { background: #fff; border: 1.5px solid ${C.field}; border-radius: 14px; min-height: 52px; padding: 0 14px; display: flex; align-items: center; gap: 10px; font-size: 16px; }
.field.on { border-color: ${C.accent}; box-shadow: 0 0 0 3px ${C.accentSoft}; }
.fieldlabel { font-size: 14px; font-weight: 600; margin-bottom: -8px; }
.btn { min-height: 52px; border-radius: 14px; background: ${C.blue}; color: #fff; font-weight: 700; font-size: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn.alt { background: #fff; color: ${C.text}; border: 1.5px solid ${C.field}; }
.pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 11px; font-size: 13px; font-weight: 600; }
.good { background: ${C.goodSoft}; color: ${C.good}; }
.kv { display: flex; justify-content: space-between; font-size: 15px; padding: 9px 0; border-bottom: 1px solid ${C.line}; }
.kv:last-child { border-bottom: 0; }
.kv span:first-child { color: ${C.muted}; }
.kv span:last-child { font-weight: 600; text-align: right; }
.wallet { background: ${C.blue}; color: #fff; border-radius: 22px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.amount { font-size: 34px; font-weight: 800; letter-spacing: -0.8px; }
.tileicon { width: 42px; height: 42px; border-radius: 13px; display: flex; align-items: center; justify-content: center; flex: none; }
.photo { border-radius: 14px; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
.code { font-family: Consolas, monospace; letter-spacing: 4px; font-size: 22px; font-weight: 700; }
.avatar { border-radius: 999px; background: ${C.blue}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex: none; }
`;

// Made-up listings, each drawn as its category's icon on a colour (never a photo of a real product).
const items = [
  { title: 'Smartphone, 128 GB, like new', price: '₦285,000', place: 'Ikeja, Lagos', icon: 'Smartphone', bg: 'linear-gradient(135deg,#1e3a5f,#0e7cc0)' },
  { title: 'Three-seater fabric sofa', price: '₦160,000', place: 'Lekki, Lagos', icon: 'Sofa', bg: 'linear-gradient(135deg,#b45309,#f59e0b)' },
  { title: 'Saloon car, 2016, automatic', price: '₦6,800,000', place: 'Wuse, Abuja', icon: 'CarFront', bg: 'linear-gradient(135deg,#334155,#64748b)' },
  { title: 'Solar generator, 2 kW', price: '₦540,000', place: 'GRA, Port Harcourt', icon: 'Sun', bg: 'linear-gradient(135deg,#15803d,#4ade80)' },
  { title: 'Laptop, 16 GB RAM', price: '₦410,000', place: 'Yaba, Lagos', icon: 'Laptop', bg: 'linear-gradient(135deg,#6d28d9,#a78bfa)' },
  { title: 'Ankara fabric, 6 yards', price: '₦18,500', place: 'Aba, Abia', icon: 'Shirt', bg: 'linear-gradient(135deg,#be123c,#fb7185)' },
];
const photo = (item, h, size = 44, radius = 14) => `<div class="photo" style="height:${h}px;border-radius:${radius}px;background:${item.bg}">${icon(item.icon, size, 'rgba(255,255,255,.92)', 1.6)}</div>`;
const listingCard = item => `<div style="background:#fff;border:1px solid ${C.line};border-radius:16px;overflow:hidden">${photo(item, 112, 44, 0)}
  <div style="padding:9px 10px 11px"><div class="label" style="font-size:15px;font-weight:800">${item.price}</div><div class="small" style="line-height:17px;margin-top:2px">${item.title}</div>
  <div class="small muted row" style="gap:4px;margin-top:4px">${icon('MapPin', 13, C.muted)}${item.place}</div></div></div>`;
const thumb = (item, size) => `<div style="width:${size}px;flex:none">${photo(item, size, Math.round(size * 0.46), 10)}</div>`;
const bubble = (text, mine) => `<div style="align-self:${mine ? 'flex-end' : 'flex-start'};max-width:78%;${mine ? `background:${C.blue};color:#fff;border-radius:16px 16px 4px 16px` : `background:#fff;border:1px solid ${C.line};border-radius:16px 16px 16px 4px`};padding:10px 13px;font-size:15px;line-height:20px">${text}</div>`;

const scenes = {
  home: () => `
${statusBar()}
<div class="body">
  <div class="row"><img src="${mark}" style="width:32px;height:32px"><span style="flex:1;font-weight:800;font-size:22px;color:${C.blue}">Udozo</span>
    <div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center">${icon('Bell', 24)}<span style="position:absolute;top:4px;right:2px;background:${C.accent};color:#fff;font-size:11px;font-weight:700;border-radius:9px;min-width:18px;height:18px;display:flex;align-items:center;justify-content:center">3</span></div></div>
  <div class="field" style="border-width:1px;border-color:${C.line};min-height:48px;color:${C.muted}">${icon('Search', 20, C.muted)}<span style="flex:1">What are you looking for?</span>${icon('MapPin', 18, C.accent)}</div>
  <div class="row" style="gap:12px;overflow:hidden">${[['Smartphone', 'Phones', 'blue'], ['CarFront', 'Vehicles', 'slate'], ['House', 'Property', 'green'], ['Sofa', 'Home', 'amber'], ['Shirt', 'Fashion', 'rose']]
    .map(([i, l, t]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:62px;flex:none"><div style="width:58px;height:58px;border-radius:29px;background:${tints[t][0]};display:flex;align-items:center;justify-content:center">${icon(i, 26, tints[t][1])}</div><span class="small" style="font-weight:600">${l}</span></div>`).join('')}</div>
  <div class="row"><span class="heading" style="flex:1">Fresh in Lagos</span><span class="small" style="color:${C.accent};font-weight:700">See all</span></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${items.slice(0, 4).map(listingCard).join('')}</div>
</div>${tabs('Home')}`,

  listing: () => `
<div style="position:relative;flex:none;height:347px;background:${items[0].bg}">${statusBar(true)}
  <div style="position:absolute;inset:47px 0 0;display:flex;align-items:center;justify-content:center">${icon('Smartphone', 120, 'rgba(255,255,255,.92)', 1.4)}</div>
  <div style="position:absolute;top:57px;left:12px;right:12px;display:flex;justify-content:space-between">${['ChevronLeft', 'Share2'].map(i => `<div style="width:40px;height:40px;border-radius:20px;background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center">${icon(i, 22, '#fff')}</div>`).join('')}</div>
  <div style="position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,.4);color:#fff;font-size:12px;font-weight:600;padding:4px 10px;border-radius:99px">1 / 6</div></div>
<div class="body">
  <div><div class="title" style="font-size:26px">₦285,000</div><div class="label" style="margin-top:4px">Smartphone, 128 GB, like new</div>
    <div class="small muted row" style="gap:5px;margin-top:6px">${icon('MapPin', 14, C.muted)}Ikeja, Lagos · Posted today</div></div>
  <div class="row" style="gap:8px;flex-wrap:wrap"><span class="pill good">${icon('ShieldCheck', 15, C.good)}UdozoPay</span><span class="pill" style="background:${C.accentSoft};color:${C.blue}">${icon('Package', 15, C.blue)}Ships to a Connect Centre</span></div>
  <div class="card" style="flex-direction:row;align-items:center"><div class="avatar" style="width:44px;height:44px">CE</div><div style="flex:1"><div class="label">Chinedu E.</div><div class="small muted">Replies within an hour · 42 sold</div></div><span class="pill good" style="padding:4px 9px">Online</span></div>
  <div style="flex:1"></div>
  <div class="row"><div class="btn alt" style="flex:1">${icon('MessageCircle', 18)}Chat</div><div class="btn alt" style="flex:1">${icon('Phone', 18)}Call</div></div>
  <div class="btn">${icon('ShieldCheck', 18, '#fff')}Buy with UdozoPay</div>
</div>`,

  chat: () => `
${statusBar()}
<div class="topbar" style="justify-content:flex-start;gap:10px">${icon('ChevronLeft', 26, C.text)}<div class="avatar" style="width:36px;height:36px;font-size:13px">CE</div><div style="flex:1"><div class="label">Chinedu E.</div><div class="small" style="color:${C.good}">Online</div></div>${icon('Phone', 22, C.blue)}</div>
<div style="flex:none;margin:0 14px;background:#fff;border:1px solid ${C.line};border-radius:14px;padding:8px;display:flex;gap:10px;align-items:center">${thumb(items[0], 44)}<div style="flex:1"><div class="small" style="font-weight:600">Smartphone, 128 GB, like new</div><div class="small muted">₦285,000</div></div></div>
<div class="body" style="gap:10px;padding-top:14px">
  ${bubble('Hello! Yes, it’s still available. The battery is at 96%.', false)}
  ${bubble('Great. Can you send it to the Connect Centre in Ikeja?', true)}
  ${bubble('Yes, I can drop it off tomorrow.', false)}
  <div class="card" style="align-self:flex-end;width:78%;border:2px solid ${C.accent}"><div class="small muted" style="font-weight:600">Your offer</div><div class="heading">₦270,000</div><div class="row small" style="gap:6px;color:${C.good};font-weight:600">${icon('CircleCheck', 16, C.good)}Accepted by Chinedu</div><div class="btn" style="min-height:44px;font-size:15px">Buy at ₦270,000</div></div>
  <div style="flex:1"></div>
  <div class="small muted row" style="gap:6px;justify-content:center">${icon('ShieldCheck', 15, C.muted)}Pay through UdozoPay, never outside Udozo.</div>
  <div class="field" style="color:${C.muted}">${icon('Camera', 20, C.muted)}<span style="flex:1">Write a message</span>${icon('Send', 20, C.blue)}</div>
</div>`,

  sell: () => `
${statusBar()}${topBar('Post an ad')}
<div class="body" style="padding-top:0">
  <div class="row" style="gap:6px">${[1, 2, 3, 4, 5, 6].map(n => `<div style="flex:1;height:5px;border-radius:3px;background:${n <= 2 ? C.blue : C.line}"></div>`).join('')}</div>
  <div class="heading">Photos and video</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
    ${['linear-gradient(135deg,#15803d,#4ade80)', 'linear-gradient(135deg,#166534,#22c55e)', 'linear-gradient(135deg,#14532d,#16a34a)'].map((bg, n) => `<div style="position:relative">${photo({ ...items[3], bg }, 104, 34)}${n === 0 ? `<span style="position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.5);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px">Cover</span>` : ''}</div>`).join('')}
    ${[['Camera', 'Add photo'], ['Video', 'Add video']].map(([i, l]) => `<div class="photo" style="height:104px;border:2px dashed ${C.field};background:#fff;flex-direction:column;gap:4px;color:${C.blue};font-size:12px;font-weight:700">${icon(i, 26, C.blue)}${l}</div>`).join('')}</div>
  <div class="card" style="background:${C.accentSoft};border-color:#c3e1f5;flex-direction:row;align-items:center"><div class="tileicon" style="background:#fff">${icon('Sparkles', 22, C.accent)}</div><div style="flex:1"><div class="label">Fill from photos</div><div class="small muted">Anjio suggests a title, category and details</div></div></div>
  <div class="fieldlabel">Title</div>
  <div class="field on">Solar generator, 2 kW</div>
  <div class="fieldlabel">Price (NGN)</div>
  <div class="field">540,000</div>
  <div class="small muted row" style="gap:6px">${icon('ChartColumn', 15, C.muted)}Similar ads are priced ₦480,000 to ₦590,000</div>
  <div style="flex:1"></div>
  <div class="btn">Next</div>
</div>`,

  checkout: () => `
${statusBar()}${topBar('Buy with UdozoPay')}
<div class="body" style="padding-top:0">
  <div class="card" style="flex-direction:row;align-items:center">${thumb(items[0], 56)}<div style="flex:1"><div class="label">Smartphone, 128 GB</div><div class="small muted">From Chinedu E.</div></div></div>
  <div class="label">How you get it</div>
  <div class="card" style="border:2px solid ${C.accent};flex-direction:row;align-items:center"><div class="tileicon" style="background:${C.accentSoft}">${icon('Store', 22, C.blue)}</div><div style="flex:1"><div class="label">Collect at a Connect Centre</div><div class="small muted">Ikeja Connect Centre · Allen Avenue</div></div>${icon('CircleCheck', 24, C.accent)}</div>
  <div class="card" style="gap:0;padding:6px 16px">
    <div class="kv"><span>Price</span><span>₦270,000.00</span></div>
    <div class="kv"><span>Shipping</span><span>₦3,500.00</span></div>
    <div class="kv"><span>Connect fee</span><span>₦700.00</span></div>
    <div class="kv"><span>UdozoPay fee</span><span>₦1,350.00</span></div>
    <div class="kv" style="font-size:16px"><span style="color:${C.text};font-weight:700">Total</span><span style="font-weight:800">₦275,550.00</span></div></div>
  <div class="small muted row" style="gap:6px">${icon('ShieldCheck', 15, C.good)}The seller is paid only after you collect it.</div>
  <div style="flex:1"></div>
  <div style="background:rgba(16,33,46,.94);border-radius:24px;padding:24px 20px;color:#fff;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center">
    ${icon('Fingerprint', 52, '#7cc2ee', 1.6)}<div class="heading">Confirm with your fingerprint</div><div class="small" style="color:${C.onBlue}">To pay ₦275,550.00 from your wallet</div></div>
</div>`,

  order: () => `
${statusBar()}${topBar('Order SP-004182')}
<div class="body" style="padding-top:0">
  <div class="card" style="flex-direction:row;align-items:center">${thumb(items[0], 56)}<div style="flex:1"><div class="label">Smartphone, 128 GB</div><span class="pill good" style="margin-top:4px">${icon('PackageCheck', 14, C.good)}Ready to collect</span></div></div>
  <div class="card"><div class="label">Your release code</div>
    <div class="row" style="justify-content:space-between;background:${C.bg};border-radius:12px;padding:14px"><span class="code">•• •• ••</span>${icon('EyeOff', 22, C.muted)}</div>
    <div class="row small muted" style="gap:6px">${icon('ShieldCheck', 16, C.good)}Give it only once you’ve checked the item.</div>
    <div class="btn">${icon('ScanFace', 20, '#fff')}Show with Face ID</div></div>
  <div class="card" style="flex-direction:row;align-items:center"><div class="tileicon" style="background:${C.accentSoft}">${icon('Store', 22, C.blue)}</div><div style="flex:1"><div class="label">Ikeja Connect Centre</div><div class="small muted">Open today 8 am to 7 pm · free until Friday</div></div></div>
  <div class="card" style="gap:0;padding:8px 16px">
    ${[['Paid', true], ['Sent by the seller', true], ['At the Connect Centre', true], ['Collected', false]].map(([t, done]) => `<div class="row" style="padding:8px 0">${icon(done ? 'CircleCheck' : 'Circle', 20, done ? C.good : C.field)}<span class="label" style="${done ? '' : `color:${C.muted}`}">${t}</span></div>`).join('')}</div>
</div>`,

  call: () => `
<div style="position:absolute;inset:0;background:linear-gradient(180deg,${C.deep},${C.blue} 60%,#1e6a96)"></div>
<div style="position:relative;display:flex;flex-direction:column;height:100%">${statusBar(true)}
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;padding-top:70px;gap:14px;color:#fff;text-align:center">
    <div class="small" style="color:${C.onBlue};font-weight:700;letter-spacing:1px">UDOZO CALL</div>
    <div class="avatar" style="width:120px;height:120px;font-size:42px;background:rgba(255,255,255,.16);border:3px solid rgba(255,255,255,.35)">AO</div>
    <div class="title" style="color:#fff">Amaka O.</div>
    <div class="label" style="color:${C.onBlue}">About: Three-seater fabric sofa</div>
    <div class="pill" style="background:rgba(255,255,255,.14);color:#fff;margin-top:6px">${icon('Lock', 14, '#fff')}Your number stays private</div>
  </div>
  <div style="display:flex;justify-content:space-around;padding:0 40px 90px;color:#fff;text-align:center">
    ${[['PhoneOff', 'Decline', '#dc2626'], ['Phone', 'Answer', '#16a34a']].map(([i, l, bg]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:10px"><div style="width:76px;height:76px;border-radius:38px;background:${bg};display:flex;align-items:center;justify-content:center">${icon(i, 32, '#fff')}</div><span class="label">${l}</span></div>`).join('')}
  </div></div>`,

  wallet: () => `
${statusBar()}${topBar('Wallet')}
<div class="body" style="padding-top:0">
  <div class="wallet"><span class="label" style="color:${C.onBlue}">Your wallet</span><div class="amount">₦184,300.00</div>
    <div class="row"><div class="btn" style="flex:1;background:#fff;color:${C.blue}">${icon('Plus', 18, C.blue)}Add funds</div><div class="btn" style="flex:1;background:${C.deep}">${icon('Landmark', 18, '#fff')}Pay to my bank</div></div></div>
  <div class="card" style="flex-direction:row;align-items:center"><div class="tileicon" style="background:${C.goodSoft}">${icon('BadgeCheck', 22, C.good)}</div><div style="flex:1"><div class="label">Sales ready to pay out</div><div class="small muted">₦96,000.00 · ₦42,000.00 still held</div></div></div>
  <div class="heading">Transactions</div>
  <div class="card" style="gap:0;padding:4px 16px">
    ${[['ArrowDownLeft', 'Sale: Ankara fabric, 6 yards', 'Today, 11:40', '+₦18,500.00', C.good], ['ArrowDownLeft', 'Added by bank transfer', 'Today, 09:12', '+₦50,000.00', C.good], ['ShoppingBag', 'UdozoPay: Laptop, 16 GB RAM', 'Yesterday', '−₦414,300.00', C.text], ['Landmark', 'Paid to your bank', 'Mon 17 Nov', '−₦120,000.00', C.text]]
      .map(([i, t, d, a, col]) => `<div class="row" style="padding:12px 0;border-bottom:1px solid ${C.line}"><div class="tileicon" style="width:38px;height:38px;background:${C.bg}">${icon(i, 19, C.muted)}</div><div style="flex:1"><div class="label" style="font-size:14px">${t}</div><div class="small muted">${d}</div></div><span class="label" style="color:${col};font-size:14px">${a}</span></div>`).join('')}
  </div>
</div>`,
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
  blue: { bg: `radial-gradient(1100px 700px at 85% 0%, rgba(14,124,192,.55), transparent 60%), radial-gradient(900px 800px at 0% 100%, rgba(31,122,77,.28), transparent 60%), ${C.deep}`, ink: '#fff', sub: C.onBlue },
  light: { bg: `radial-gradient(1000px 700px at 100% 0%, ${C.accentSoft}, transparent 65%), linear-gradient(180deg,#ffffff,#edf1f4)`, ink: C.text, sub: C.muted },
  sky: { bg: `radial-gradient(1000px 800px at 0% 0%, #38a3e6, transparent 60%), linear-gradient(160deg,#0e7cc0,#185174)`, ink: '#fff', sub: '#e3f1fb' },
};

const page = (body, w, h, extraCss = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}${screenCss}
html,body{width:${w}px;height:${h}px}
.phone{background:#0a1620;box-shadow:0 40px 90px rgba(6,22,34,.45), inset 0 0 0 2px #24384a}
${extraCss}</style></head><body>${body}</body></html>`;

const headline = (t, head, sub, size) => `<div style="font-size:${size}px;font-weight:800;line-height:1.08;letter-spacing:-${size / 40}px;color:${t.ink}">${head}</div>
  <div style="margin-top:${size * 0.32}px;font-size:${size * 0.44}px;line-height:1.35;color:${t.sub};font-weight:600">${sub}</div>`;

// Udozo's mark beside its name: the blue disc on light backgrounds, the white one on dark.
const lockup = (size, dark) => `<div class="row" style="gap:${size * 0.38}px"><img src="${dark ? markLight : mark}" style="width:${size * 1.4}px;height:${size * 1.4}px"><span style="font-size:${size}px;font-weight:800;color:${dark ? '#fff' : C.blue}">Udozo</span></div>`;

const shot = (w, h, theme, scene, head, sub) => {
  const t = themes[theme];
  if (w < h) {
    return page(`<div style="width:${w}px;height:${h}px;background:${t.bg};position:relative;overflow:hidden">
      <div style="position:absolute;left:84px;right:84px;top:118px;text-align:center">${headline(t, head, sub, 74)}</div>
      <div style="position:absolute;left:50%;top:470px;transform:translateX(-50%)">${phone(scene, 640)}</div></div>`, w, h);
  }
  // Wide screens keep the phone at 62% of the height; squarer ones (foldables) cap it by the width so it clears the
  // words, and size the words by the same base.
  const pw = Math.round(Math.min(h * 0.62, w * 0.36));
  const base = Math.min(h, w * 0.5625);
  return page(`<div style="width:${w}px;height:${h}px;background:${t.bg};position:relative;overflow:hidden">
    <div style="position:absolute;left:${w * 0.08}px;width:${w * 0.44}px;top:50%;transform:translateY(-50%)">
      <div style="margin-bottom:${base * 0.05}px">${lockup(base * 0.042, theme !== 'light')}</div>
      ${headline(t, head, sub, Math.round(base * 0.085))}</div>
    <div style="position:absolute;right:${w * 0.1}px;top:${h * 0.1}px">${phone(scene, pw)}</div></div>`, w, h);
};

// Android XR (16:9): the app as a floating panel in a room, tilted a little towards the viewer, with the panel's own
// move bar beneath it, as Android XR draws one.
const xrRoom = `radial-gradient(1400px 900px at 70% 35%, rgba(255,255,255,.18), transparent 60%), radial-gradient(1600px 900px at 15% 110%, rgba(14,124,192,.3), transparent 60%), linear-gradient(180deg,#0f2433 0%,#18384d 55%,#24414f 100%)`;
const xrShot = (w, h, scene, head, sub) => {
  const panelW = Math.round(h * 0.36), scale = panelW / 390, panelH = Math.round(844 * scale);
  return page(`<div style="width:${w}px;height:${h}px;background:${xrRoom};position:relative;overflow:hidden">
    <div style="position:absolute;left:0;right:0;bottom:0;height:${h * 0.26}px;background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.07))"></div>
    <div style="position:absolute;left:${w * 0.07}px;width:${w * 0.42}px;top:50%;transform:translateY(-50%)">
      <div style="margin-bottom:${h * 0.045}px">${lockup(h * 0.036, true)}</div>
      ${headline(themes.blue, head, sub, Math.round(h * 0.07))}</div>
    <div style="position:absolute;right:${w * 0.12}px;top:${(h - panelH) / 2 - h * 0.03}px;perspective:${h * 2}px">
      <div style="transform:rotateY(-12deg);transform-origin:left center">
        <div style="width:${panelW}px;height:${panelH}px;border-radius:${28 * scale}px;overflow:hidden;box-shadow:0 ${h * 0.04}px ${h * 0.09}px rgba(0,0,0,.45), 0 0 0 ${2 * scale}px rgba(255,255,255,.25)">
          <div style="transform:scale(${scale});transform-origin:0 0;width:390px;height:844px"><div class="screen">${scenes[scene]()}</div></div></div>
        <div style="margin:${h * 0.018}px auto 0;width:${panelW * 0.18}px;height:${h * 0.008}px;border-radius:99px;background:rgba(255,255,255,.55)"></div>
      </div></div></div>`, w, h);
};

const shots = [
  ['light', 'home', 'Buy and sell near you', 'Phones, cars, homes, fashion and more'],
  ['blue', 'listing', 'Pay safely with UdozoPay', 'The seller is paid only after you have the item'],
  ['light', 'chat', 'Chat and make offers', 'Agree a price, then buy at it in one tap'],
  ['sky', 'sell', 'Post an ad in minutes', 'Take photos and let Anjio fill in the details'],
  ['light', 'checkout', 'Collect at a Connect Centre', 'Check the item at the counter before you accept it'],
  ['blue', 'order', 'Your release code stays private', 'Shown only with Face ID, never in a screenshot'],
  ['sky', 'call', 'Call sellers without sharing your number', 'Calls ring even when the app is closed'],
  ['light', 'wallet', 'Get paid to your bank', 'Add funds, follow sales and pay out from one wallet'],
];

// ---- Feature graphics, 1024 x 500 -------------------------------------------------------------------------------

const featureCss = `.fg{width:1024px;height:500px;position:relative;overflow:hidden}`;
const features = [
  ['feature-graphic-1', `<div class="fg" style="background:${themes.blue.bg}">
    <div style="position:absolute;left:64px;top:110px;width:470px">${lockup(44, true)}
      <div style="margin-top:30px;font-size:48px;font-weight:800;line-height:1.08;color:#fff;letter-spacing:-1px">Buy and sell near you</div>
      <div style="margin-top:16px;font-size:22px;color:${C.onBlue};font-weight:600">Chat, call and pay safely with UdozoPay.</div></div>
    <div style="position:absolute;right:70px;top:46px;transform:rotate(-6deg)">${phone('home', 300)}</div></div>`],
  ['feature-graphic-2', `<div class="fg" style="background:${themes.light.bg}">
    <div style="position:absolute;left:0;right:0;top:64px;display:flex;justify-content:center">${lockup(40, false)}</div>
    <div style="position:absolute;left:0;right:0;top:150px;text-align:center;font-size:42px;font-weight:800;letter-spacing:-1px;color:${C.text}">Everything you need, from people near you</div>
    <div style="position:absolute;left:80px;right:80px;top:262px;display:flex;justify-content:space-between">
      ${[['Smartphone', 'Phones', 'blue'], ['CarFront', 'Vehicles', 'slate'], ['House', 'Property', 'green'], ['Sofa', 'Home', 'amber'], ['Shirt', 'Fashion', 'rose'], ['Wrench', 'Services', 'violet']]
        .map(([i, l, t]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:12px"><div style="width:104px;height:104px;border-radius:30px;background:#fff;border:1px solid ${C.line};box-shadow:0 10px 26px rgba(16,33,46,.08);display:flex;align-items:center;justify-content:center"><div class="tileicon" style="width:62px;height:62px;border-radius:19px;background:${tints[t][0]}">${icon(i, 34, tints[t][1])}</div></div><span style="font-weight:700;font-size:19px">${l}</span></div>`).join('')}
    </div></div>`],
  ['feature-graphic-3', `<div class="fg" style="background:${themes.sky.bg}">
    <div style="position:absolute;left:64px;top:120px;width:440px">${lockup(40, true)}
      <div style="margin-top:28px;font-size:46px;font-weight:800;line-height:1.06;color:#fff;letter-spacing:-1px">Sell what you don’t use</div>
      <div style="margin-top:16px;font-size:22px;color:#e3f1fb;font-weight:600">Post an ad in minutes. Get paid to your bank.</div></div>
    <div style="position:absolute;right:40px;top:22px;width:470px;height:460px">
      ${items.slice(0, 4).map((it, n) => `<div style="position:absolute;width:190px;left:${[0, 250, 20, 262][n]}px;top:${[0, 14, 228, 240][n]}px;transform:rotate(${[-6, 5, 4, -5][n]}deg);box-shadow:0 18px 40px rgba(6,22,34,.35);border-radius:16px">${listingCard(it)}</div>`).join('')}
    </div></div>`],
];

const foldable = [[2160, 2160], [2160, 1620], [1200, 1920]];

// ---- Render --------------------------------------------------------------------------------------------------

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
for (const dir of ['phone', 'tablet-7in', 'tablet-10in', 'chromebook', 'foldable', 'xr', 'feature-graphic']) mkdirSync(join(out, dir), { recursive: true });

const shoot = (html, w, h, target) => {
  const source = join(work, `${target.replace(/[\\/]/g, '_')}.html`);
  writeFileSync(source, html);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--default-background-color=00000000', `--window-size=${w},${h}`, `--screenshot=${join(out, target)}`, '--virtual-time-budget=4000', file(source)], { stdio: 'ignore' });
  if (!existsSync(join(out, target))) throw new Error(`Chrome did not write ${target}`);
  console.log(`${target}  ${w}x${h}`);
};

// `node store-listing/render.mjs phone` draws only the phone screenshots and feature graphics, to check them quickly.
const phoneOnly = process.argv[2] === 'phone';
shots.forEach(([theme, scene, head, sub], n) => {
  const name = `${String(n + 1).padStart(2, '0')}-${scene}.png`;
  shoot(shot(1080, 1920, theme, scene, head, sub), 1080, 1920, `phone/${name}`);
  if (phoneOnly) return;
  shoot(shot(1920, 1080, theme, scene, head, sub), 1920, 1080, `tablet-7in/${name}`);
  shoot(shot(2560, 1440, theme, scene, head, sub), 2560, 1440, `tablet-10in/${name}`);
  // Chromebooks: each side 1,080 to 7,680 px.
  shoot(shot(3840, 2160, theme, scene, head, sub), 3840, 2160, `chromebook/${name}`);
  // Foldables: each side 960 to 3,840 px; Play wants an unfolded 1:1, an unfolded 4:3 and the outer screen at 10:16.
  const [fw, fh] = foldable[n % foldable.length];
  shoot(shot(fw, fh, theme, scene, head, sub), fw, fh, `foldable/${name}`);
  // Android XR: 16:9, each side 720 to 7,680 px.
  shoot(xrShot(3840, 2160, scene, head, sub), 3840, 2160, `xr/${name}`);
});
for (const [name, body] of features) shoot(page(body, 1024, 500, featureCss), 1024, 500, `feature-graphic/${name}.png`);
// Play's icon: 512 x 512, the blue disc from the master artwork (assets/udozo/logo.png) at two thirds of the height,
// centred on white, so it sits inside Play's rounded mask with room around it (Pillow, as scripts/brand-assets.py uses).
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
execFileSync('python', ['-c', playIcon, join(app, '..', '..', 'assets/udozo/logo.png'), join(out, 'icon-512.png')]);
console.log('icon-512.png  512x512');
// Every image without transparency (Chrome sometimes keeps an alpha channel; Play's feature graphic refuses one).
const flatten = ['import glob, sys', 'from PIL import Image', 'for f in glob.glob(sys.argv[1] + "/**/*.png", recursive=True):', '    im = Image.open(f)', '    if im.mode != "RGB": im.convert("RGB").save(f)'].join('\n');
execFileSync('python', ['-c', flatten, out]);
rmSync(work, { recursive: true, force: true });
console.log(`Done: ${out}`);
