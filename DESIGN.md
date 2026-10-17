# BitoCard design

How BitoCard looks and feels, for anyone (person or AI) designing or building a screen. It covers every surface: the bitocard.com store and customer account app (`apps/storefront`), the consoles (admin, SHQ and Verify, built on `packages/admin-ui`) and the docs and legals sites. The Kombai canvas at `.kombai/canvas/bitocard-storefront.canvas` contains desktop and phone references for the storefront home. A `bitocard.ds` file is not checked into this repository yet. The code's source of truth is `packages/ui/src/styles/tokens.css` (mirrored for JavaScript in `packages/ui/src/tokens.ts`).

## The feel

Confident, digital and quick. Deep navy carries the weight (text, rails, the hero), one hot pink does every job that asks the user to act, and everything else is white space, white cards and soft shadows. Headings are heavy and tight; body copy is small, calm and plain UK English. It should read like a well-run marketplace, never a crypto casino or a bank form. The only place the design gets loud is Spin and win, and that is deliberate.

## Tokens

Use the Tailwind utilities (`bg-brand-500`, `text-navy-900`) or `var(--color-…)` in plain CSS. **Never write a hex class (`bg-[#ff2382]`) in the apps**: tests fail on it.

### Colour

| Role | Token | Notes |
|---|---|---|
| Action (CTA, active, toggles on, check bullets) | `--color-brand-500` `#ff2382` | The only action colour |
| Action hover, link text | `--color-brand-600` `#e3106b` | |
| Focus outline (store), legal eyebrows | `--color-brand-700` `#c00b58` | |
| Pink tints (selected nav, arrow chips, icon circles) | `--color-brand-50`, `--color-brand-100` | Tailwind `pink-50`/`pink-100` in store chips |
| Text (store), dark buttons | `--color-navy-900` `#070f4c` | Hover `--color-navy-800` |
| Hero, dark rooms | `--color-navy-950` `#040935` | |
| Dark promos, rails | `--color-navy-900` → `--color-navy-700` | |
| Plain-CSS body copy / quiet text / borders / soft panels | `--color-navy-600` / `-500` / `-200` / `-50` | /resellers, legals |
| Console text / secondary / placeholder | `--color-ink` / `--color-muted` / `--color-subtle` | |
| Console border, console page | `--color-line`, `--color-canvas` | |
| Store page | `--color-page` `#fcfdff` | Cards are white |
| Secondary accent | `--color-azure-500` `#2477ff` | Hero badges, mobile tint |
| Positive money | `--color-mint-500` (`-700` text, `-50` tint) | |
| Rewards only | `--color-gold-200/400/500/700` | Spin and win |
| Spin room, spotlight | `--color-plum-800`, `--color-plum-900` | |

Store neutrals are Tailwind slate: borders `slate-100`/`slate-200`, secondary text `slate-500`, placeholders `slate-400`, soft panels `slate-50`.

**Status** (one colour per word, everywhere, via `statusTones` in `packages/admin-ui/src/ui/status.tsx`): green (`emerald-50` / `emerald-700`) for completed, paid, active; amber (`amber-50` / `amber-700`) for pending and in review; blue (`blue-50` / `blue-700`) for processing; red (`red-50` / `red-700`) for failed and declined; grey slate for draft and expired; pink (`brand-50` / `brand-700`) for refunded. Badges are pills with a 6px dot. Sandbox mode is always amber.

**Category identity** (`components/store/theme.tsx`): gift cards pink, airtime blue, data emerald, bills amber, pay-TV violet, eSIM fuchsia, software orange, virtual numbers indigo, virtual cards sky, mobile money lime. Each shows as a `-50` tile with a `-600` icon, and as a `from-500 to-600/700` gradient behind a brand without card art. These colours label categories; they never mark an action.

### Type

Inter everywhere (`font-sans` and `font-display`, loaded once with next/font on `<html>`); JetBrains Mono for code in the docs; the legals site still uses Arial.

| Style | Size / weight | Where |
|---|---|---|
| Hero display | 40 → 60 (sm) → 72px (xl), 800, line-height 1.02, tracking tight | Store hero; second line in `--color-brand-500` |
| Section heading | 22 → 30px, 800, tight | "Trending now", "Shop by category" |
| Page title (console) | 24 → 30px, 800, tight | `PageHeader` |
| Card heading (console) | 18px, 700 | `CardHeader` |
| Product title | 15 → 18px, 700, 2 lines max | Product cards |
| Price | 16 → 18px, 800, navy | "From $10", "US$1.20" |
| Body | 14px, 400 | Most copy; subtitles `slate-500` |
| Button | 15px (store) / 14px (console), 600 | |
| Label | 12px, 500, uppercase, wide tracking, `--color-subtle` | Key-value labels |
| Code | 13px mono, line-height 1.65, on `#0d1117` | Docs panels |

### Shape, depth and motion

- **Radius:** 8px (`rounded-lg`) inputs and console buttons; 12px (`rounded-xl`) store buttons, card art, menu items; 16px (`rounded-2xl`) cards, dialogs, the search bar; 24px (`rounded-3xl`) promos, stat cards, the trust bar, an inset hero; full pills for chips, badges, toggles and arrow chips.
- **Depth:** flat page → white card with a 1px `slate-100` border and `shadow-sm` (console: `--color-line` and `shadow-card`) → `shadow-md` on hover → `shadow-lg` search bar → `shadow-xl` menus → `shadow-2xl` dialogs over a navy scrim at 45–50%.
- **Motion:** Tailwind's 150ms standard ease for colour and lift. Cards rise 2px and deepen their shadow on hover; busy buttons swap their icon for a spinning `LoaderCircle`; skeletons pulse. No scroll-driven, parallax or WebGL motion anywhere.
- **Focus:** buttons and links get a 3px outline (store `--color-brand-700`, offset 5px; consoles `--color-brand-500`, offset 2px). Text fields never get it: they show focus with a `--color-brand-500` border and a 2px `--color-brand-100` ring, and the store search bar greys its field.

## Surfaces

### The store (bitocard.com)

- **Header:** sticky, white at 95% with blur and a `slate-100` bottom border, 64px (72px from sm), content at most 1400px wide. Bitocard lockup, then from xl the **Catalog** mega-menu and quick links, the country and currency buttons, an outlined **Sign in** (`rounded-xl`, `slate-200` border) and the pink **Start Reselling** with a store icon.
- **Hero:** full-bleed `--color-navy-950` with the lit globe (`/hero/globe.webp`, kept to the right) under a left-to-right navy overlay so the text stays readable. Headline in two lines, the second pink; a `slate-200` subtitle; one white search bar (`rounded-2xl`, 6px padding, `shadow-lg`) holding the field, a country picker with flags and a square pink search button; then a single row of category links, icon on a `white/10` tile and label, scrolling sideways on phones with a fade at the right. On the right, featured brand cards float rotated ±6° with a heavy shadow (`0 20px 45px rgba(0,0,0,.45)`) and a `white/25` ring, plus small pink and azure category badges rotated ±12°.
- **Home grid:** a dense 12/6/1-column grid (gaps 28/24/32px) of sections the admins lay out: product rails, a category grid, a brand grid, promos and a trust bar. A section is 3, 4, 6, 8, 9 or 12 columns wide and may be two rows tall beside stacked short ones.
- **Section heading:** a heavy navy title with a small `slate-500` line beneath, and **View all →** in `--color-brand-600` aligned to the right. Filter chips (40px pills, white with `slate-200` border; the active one with a `--color-brand-500` border and pink text) sit below.
- **Product card:** white, 16px radius, 12px padding, `slate-100` border. 16:9 art with 12px radius, a two-line bold title, a two-line `slate-500` description, small sky-tinted feature icons for numbers, then the price bottom left and a round 40px `pink-50` arrow chip bottom right, which fills pink with a white arrow on hover. Below lg, rails become snap carousels with the next card peeking (~72% wide); from lg they are 3 or 4-up grids.
- **Card art:** the brand's own gift card art; else the brand colour (or the category gradient) with its logo on a white rounded tile; else heavy initials. Virtual numbers show the country flag over an indigo-to-blue plate with a white "LOCAL NUMBER" pill.
- **Promos:** 24px radius, 28px padding. Themes: pink (`pink-50 → pink-100 → fuchsia-100`), sky (`sky-100 → blue-50 → indigo-100`), sunset (`amber-100 → orange-100 → pink-100`), navy (`navy-900 → navy-700`, white text) and plain white. Bullets carry round pink check marks; the button is pink, or white with a ring on light themes. Art is drawn in code: a rotated pink gradient tile with a white icon, or a striped pink-and-white awning shop with the b mark.
- **Trust bar:** a 24px-radius `slate-50` panel, four items, each a round `pink-100` icon circle in `--color-brand-600` beside a bold title and a `slate-500` line.
- **Footer:** white with a `slate-100` top border; the lockup and a one-line description, then Shop, Business and Legal lists; "A Golojan Ltd venture" at the bottom.
- **Dialogs:** native `<dialog>`, 16px radius, `shadow-2xl`, navy scrim. The first visit opens "Where are you shopping from?" with a filter field and flags.

### The customer account app (/account)

App-style and mobile first. A bottom bar of six tabs (Home, Catalog, Orders, Wallet, Crypto, Account) on phones and tablets, active in pink with a 2px underline. From lg: a 240px left rail (active `pink-50` with pink text) and a sticky sub rail for the tab's own places (current item white with a pink bar). On smaller screens those places become pills, chips or tabs under the title. Home opens with stat cards in a snap slider (24px radius, tinted pink, blue, emerald or indigo, 28px heavy values), then tinted entry cards per menu group, popular products and recent orders.

**Spin and win** is the one loud moment: a full-screen dialog of a dark navy room under a plum spotlight, a gold-rimmed wheel of navy and pink wedges (top prize gold) with 24 bulbs that blink, chase and flash, a gold pointer with a pink jewel and a glossy pink hub. The wheel spins for 5 seconds with a long ease-out, then coins burst, confetti falls and a gold plaque counts the win up. Reduced motion cuts this to a single 0.6-second turn. Keep gold and plum inside this feature.

### The consoles (admin, SHQ, Verify)

The same palette, but quieter and denser. The page is `--color-canvas`, the text `--color-ink`. A 96px `--color-navy-900` rail (icon above a 12px label, selected `--color-brand-500` with a pink glow), a 240px white section nav (selected `--color-brand-50` with `--color-brand-600` text), and a sticky header with breadcrumbs, the Live/Sandbox switch (amber in sandbox), the notification bell and the account menu. Main content is at most 1400px wide with 24px between blocks.

Page pattern: page header → tabs or search → stat cards (2-up, 4-up at xl; 48px rounded icon chips in pink, blue, violet, green or amber) → a card holding a data table (header row on canvas; rows stack into cards on phones). Detail pages are two-thirds content and a one-third side card. Buttons are 44px high with 8px radius: primary pink, secondary pink outline, ghost, and red for danger. Audited actions open a dialog asking for a reason. Verify is a centred wizard at most 576px wide in a 24px-radius card, with a navy-100 progress bar that fills pink.

### Docs and legals

**Docs:** white, `slate-800` body copy at line-height 1.75, navy headings (h1 36px 800), pink links (`--color-brand-600`, semibold), blockquotes with a 3px pink left border on `--color-brand-50`, and code in dark panels with shiki's github-dark highlighting.

**Legals:** plain CSS. Each page opens with a full-width banner gradient (navy-900 → `#151a68` → `#7a1160` → brand-700) with pink and blue glows; cards have a 20px radius and a `--color-navy-200` border; body copy is `--color-navy-600`.

## Layout and responsiveness

- Content is at most 1400px wide, with 16/24/32px side padding.
- Breakpoints: **sm 640** (taller header, single-row search, header buttons appear), **md 768** (6-column home grid), **lg 1024** (12 columns, grids instead of carousels, the app's side rails), **xl 1280** (Catalog mega-menu; the console section nav stops being a drawer).
- Tap targets are at least 44px. No page ever scrolls sideways; rows that must scroll do so inside themselves, without a scroll bar and with a fade or a peeking card.

## Imagery and icons

- **Icons:** lucide-react everywhere (`lucide-static` on canvas): 2px stroke, `currentColor`, 16px inline, 20px in buttons, 24px in nav. They sit in tinted round circles or rounded-xl tiles. Uploaded category icons go on white tiles.
- **Flags:** from the store itself (`/flags/<code>.svg`), never an outside host.
- **Logo:** the lowercase "b" mark (navy with a pink cap and arrow) to the left of "Bito" in navy and "card" in pink. On navy, use the light mark and white "Bito". The mark alone stands in where space is short. Never use it as a letter of the name.
- **Photography:** essentially none. Brand art and code-drawn illustrations do the work. Label illustrations as illustrations.

## Copy

- Plain UK English, short sentences, sentence case ("Start selling", "View all", "Products appear here soon.").
- Prices are face values: "From $10". The customer's price comes at checkout.
- The only tagline is **Digital store in 5 minutes**. It is about store setup, never funding, verification or a first sale. No other slogans and no income claims.
- Never name suppliers, costs or routing. Never promise countries, products, payment methods or dates that aren't confirmed.

## Do

- Use one pink filled button per area; everything else is outline, ghost or a pink link.
- Put navy text on white or near-white; pink is for action, not for long text.
- Keep cards white, rounded and softly shadowed; let the page breathe.
- Use the status map for every status word, so a word always has the same colour.
- Check every screen at phone width.

## Don't

- Don't use hex classes or invent colours outside the tokens and Tailwind's slate and status scales.
- Don't draw the focus outline inside text fields.
- Don't bring gold, plum or casino effects outside Spin and win.
- Don't add scroll-jacking, parallax or autoplaying video.
- Don't use the category colours for buttons or links.
