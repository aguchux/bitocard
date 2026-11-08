# Udozo on WhatsApp: post, find, chat and ask, through Udozo's own number

**Status:** planned and built on 7 November 2026 at the owner's request (phases 1 to 5 below). It goes live once the owner's steps are done: Meta's business verification, the number, the token, the webhook, the templates submitted and approved from the admin, then `whatsapp_channel` switched on market by market (`classifieds_wanted` too, for wanted requests).

**How it was built (where it differs from the plan below):**

- The code is `apps/udozo-api/src/whatsapp/` (`cloud-api.ts`, `notices.service.ts`, `contacts.service.ts`, `outbox.service.ts`, `templates.ts`, `messages.ts`, `bot.service.ts`, `relay.service.ts`, `flows/sell.flow.ts`, `flows/wanted.flow.ts`, `admin.service.ts`, `jobs.service.ts`) and `apps/udozo-api/src/classifieds/wanted/`; migration `20270301000000_whatsapp_and_wanted`.
- Templates are five: `udozo_new_message`, `udozo_wanted_match`, `udozo_wanted_response`, `udozo_account_update` (every other notice: buy orders, contact requests answered, call backs, missed calls) and `udozo_link_confirmed`.
- The relay hooks are registered, not imported: `ConversationsService.onMessage` and `InboxService.useChannel`, so the classifieds code does not depend on WhatsApp. A template is claimed under an advisory lock per contact, chat and template, so two messages at once send one.
- Plain text with no menu going on is read as a search.
- A seller's answer to a wanted request is a text message in the listing's chat ("About your request ..."), not a card.
- udozo.com learns whether WhatsApp and requests are open from the public `GET /v1/classifieds/channels?country=` (a minute in caches).
- Legal: terms section 10a and privacy section 4a, version `2026-11-07`.
- **Codes on WhatsApp** (added the same day at the owner's request): codes that confirm a mobile number can go on WhatsApp with Meta's verification template (`udozo_verification_code`, authentication category), by choice, where the country cannot text, or when the text fails (`SmsService.sendCode`, `whatsapp/codes.service.ts`).
- **Anjio answers on WhatsApp** (added the same day at the owner's request, beyond the plan's "no AI"): questions and the menu's Ask Anjio go to the market's shop assistant (`whatsapp/anjio.service.ts`, switch `whatsapp_assistant`, off by default), never inside a chat between people; when it cannot answer, the question is searched.
- **Contact seller** (added the same day at the owner's request, an exception to "neither side sees the other's number" that the seller chooses): a listing's buttons are Chat with seller (the relay), **Contact seller** and More (Call me back, Save it, New search). A seller who chose **Let buyers WhatsApp me directly** (Profile > WhatsApp on udozo.com, off by default, asked first; `whatsapp_contacts.direct_at`, cleared when the number is let go or tied to another account) is shown to a signed-in buyer with their first name and initial and their connected WhatsApp number, in one message whose **Chat on WhatsApp** button (Meta's `cta_url`) opens `wa.me/<seller>` with "Hi, I saw your listing … on Udozo: <link>" filled in. A seller who shared their details with that buyer before (an accepted contact request) is shown the same way with their confirmed phone and email; anyone else is sent the usual contact request. Never a buyer the seller blocked, a suspended seller or a number opted out; each buyer and listing is recorded once (`whatsapp_direct_contacts`, migration `20270304000000_whatsapp_direct`, kept 12 months): a phone lead, at most 20 a day per buyer (`direct_contact_limit`), and the seller told once per buyer (`customer.classifieds.whatsapp_shared`). `whatsapp/direct.service.ts`; terms 10a and privacy 4a say so.

## Context

The owner wants buyers and sellers to use Udozo through a WhatsApp Business number. Sellers post ads there, buyers find items there, and both talk to each other and make requests there. Udozo has no WhatsApp code today: "whatsapp" appears only in two bot-detection regexes. It also has no buyer-request ("wanted") feature.

What the owner chose:
- **Provider:** Meta's WhatsApp Cloud API directly, on Udozo's own Meta app and WhatsApp Business account.
- **Messages:** relayed through Udozo's number. Neither side sees the other's number, as with calls. WhatsApp messages become messages in the existing listing chat, and either side can answer from WhatsApp or from udozo.com.
- **Requests:** a new **wanted requests** feature. A buyer says what they need; Udozo shows matching listings and tells sellers in that category and area, who answer with one of their listings.
- **Posting:** a step-by-step menu of WhatsApp lists and buttons. No AI.

## Rules the design follows

- **Meta's 24-hour window.** Udozo may send free-form messages only within 24 hours of the person's last message to it. Outside that window it may send only templates that Meta has approved, such as "Chinedu sent you a message about iPhone 13, tap Reply". Tapping a template's button opens the window again, and Udozo then sends what is waiting.
- **Opt-in.** Udozo messages a person first only if they opted in: by connecting WhatsApp on udozo.com, or by messaging Udozo. Sending STOP opts them out, and START opts them back in.
- **Who someone is.** A WhatsApp number (`wa_id`) is tied to one Udozo customer. Every account needs a confirmed email (`sellerCountry` in `listings.service.ts`), and there is no sign-in by phone, so a number never creates an account. An unknown number can only browse. To post, chat or make requests, the person signs up or connects on udozo.com. *(Changed 8 November 2026: a number can now make its own account on WhatsApp, with the email confirmed by an emailed code typed there, and sign in to udozo.com from WhatsApp. See AGENTS.md, Sign up and in with WhatsApp.)*
- **Linking** happens in two ways:
  1. **Automatically**, when the number is an account's **confirmed** mobile (`phoneVerifiedAt`, already proved by a texted code).
  2. **From Profile > WhatsApp on udozo.com.** The site opens `wa.me/<number>?text=LINK <code>` (a one-time code, valid 10 minutes, stored only as its hash). Receiving that code from the number proves the person holds both the account and the number. If it is not yet the account's mobile, they are asked to confirm, and it becomes the account's confirmed mobile.
- **Every action goes through the existing services.** No WhatsApp shortcut skips a rule. The bot calls the same services as udozo.com: `ListingsService` create, update and submit (terms, `requireComplete`, photo minimum, moderation, limits), `ListingMediaService.addPhoto` (it takes a buffer), `ConversationsService.start` and `send` (blocking, pacing, `cleanMessage`), `ContactRequestsService`, and `ListingSearchService.search`.
- **Switches,** both Udozo-only, global or per country, and off by default: `whatsapp_channel` and `classifieds_wanted`. Wanted requests work on the web without WhatsApp.

## Data (one migration in `apps/udozo-api/prisma/migrations/`)

- **`whatsapp_contacts`**: one row per number.
  - Who: `wa_id` (E.164, unique), `customer_id` (unique, nullable), `country`.
  - Consent and window: `linked_at`, `opted_in_at`, `opted_out_at`, `last_inbound_at` (the window).
  - Menu state: `flow`, `flow_state` jsonb, `flow_updated_at`, `active_conversation_id` (which chat a plain reply goes to).
- **`whatsapp_link_codes`**: customer, code hash, expiry, `used_at`.
- **`whatsapp_notices`**: each inbound webhook body, stored encrypted and unique by body hash, with status, attempts and `next_attempt_at`. It mirrors `SupplierWebhook`.
- **`whatsapp_messages`**: messages in and out.
  - Identity and kind: `wamid` (unique), contact, direction, kind (text, interactive, image or template), template name.
  - Links to the chat: `conversation_id`, `classified_message_id`.
  - Delivery: status (`queued`, `sent`, `delivered`, `read` or `failed`), error, attempts, `next_attempt_at`, and the encrypted payload while queued.
  - Kept 90 days.
- **`classified_messages.channel`**: `web` (the default) or `whatsapp`, shown as "via WhatsApp".
- **`notification_preferences.whatsapp`**: nullable boolean, beside `push`.
- **`classified_wanted_requests`**: numbered `WR-000123`.
  - Who and where: customer, country, `category_id`, state or area.
  - What: `words` (80 characters), `details` (300 characters, through `cleanNote`), budget minimum and maximum in minor units, conditions.
  - Status: `open`, `fulfilled`, `closed`, `expired` or `removed`. `expires_at` is 14 days. Also `source` (`web` or `whatsapp`) and `sellers_told`.
- **`classified_wanted_matches`**: request and seller (unique), `notified_at`. This makes sure each seller is told once.
- **`classified_wanted_responses`**: request, seller, listing, conversation, note. Unique per request and seller.
- **Market settings** (`classified_market_settings`): `wanted_open_per_buyer` (3), `wanted_per_day` (5), `wanted_sellers_per_request` (30) and `wanted_notices_per_seller_day` (20).

## API (`apps/udozo-api/src/whatsapp/`, `@ProductOnly('udozo')`)

1. **Integration group `whatsapp`**, Udozo's only, following the existing recipe:
   - add the keys to `integrationKeyList` and the zod config, add a `platformGroups` entry, add it to `ownTests` with a `testWhatsapp()`, and add links in `links.ts`;
   - fields: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_NUMBER` (shown and used in `wa.me` links), and the secrets `WHATSAPP_ACCESS_TOKEN` (a system-user token), `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`;
   - an optional `WHATSAPP_API_URL`, defaulting to the Graph API with a pinned version;
   - Test connection reads the phone number's verified name, display number and quality rating.
2. **`cloud-api.ts`**, a plain `fetch` client:
   - sending: text, image with caption, interactive buttons (at most 3) and lists (at most 10 rows), templates, and marking a message read;
   - media: download inbound media (media id, then a URL that expires in minutes, then the bytes);
   - templates: list and create them on the WhatsApp Business account;
   - errors split into definite refusals and unclear failures, as `ProviderError` does.
3. **Webhook** (`webhook.controller.ts`, `notices.service.ts`), following `SupplierWebhooksService`:
   - `GET /v1/webhooks/whatsapp` answers Meta's verify challenge (`hub.verify_token`, compared in constant time);
   - `POST /v1/webhooks/whatsapp` checks `X-Hub-Signature-256`, an HMAC-SHA256 of `req.rawBody` with the app secret (raw body is already on in `bootstrap.ts`);
   - the body is stored encrypted, the reply is 200, then it is processed through `waitUntil`;
   - inbound messages are deduplicated by `wamid`, since Meta retries;
   - status callbacks update `whatsapp_messages`.
4. **`contacts.service.ts`**: finding or creating a contact, linking (both ways above), opt-in and opt-out, the window, and `POST|GET|DELETE /v1/store/account/whatsapp` for udozo.com (code, status, preferences, disconnect).
5. **`outbox.service.ts`**:
   - each message is queued as a row and sent after the reply;
   - inside the window it sends free text, outside it the matching template, at most one template per chat an hour;
   - retries come from the `whatsapp` job (1, 5 and 30 minutes);
   - a definite refusal is marked `failed`, and a number that is not on WhatsApp stops further sends.
6. **`templates.ts`**: the registry of template names, categories (utility), languages, bodies and buttons.
   - The templates: `udozo_new_message`, `udozo_wanted_match`, `udozo_wanted_response`, `udozo_account_update` and `udozo_link_confirmed` (built: one generic update template in place of `udozo_buy_order_update` and `udozo_contact_answered`).
   - The admin page submits missing ones to Meta and shows each one's approval status.
7. **Flows** (`flows/`): one state machine per flow. Each flow keeps its step in `flow_state`, an idle flow resets after 24 hours, and all wording is in `messages.ts`, in plain UK English.
   - **Main menu** (on hi, MENU, or an unknown message), as a list: Find something, Post a request, Sell something, My chats, Help. HELP, CANCEL, STOP and START work at any step.
   - **Deep links** (pre-filled text): `L 12345` opens that listing, `LINK <code>` connects, and `SELL` and `WANT` start those flows.
   - **Find:**
     1. The person types words.
     2. The state defaults to the customer's own; they can choose another.
     3. `ListingSearchService.search` returns up to 10 results as a list, with a "More results" row.
     4. A chosen listing comes as its photo with a caption (title, price, area, condition, address), and the buttons Chat with seller, Call back and More. More offers Request contact, Save and "Buy on udozo.com". (Built as Chat with seller, Contact seller and More: see Contact seller above.)
     5. Unknown numbers get results and a link to sign up.
   - **Chat (the relay):**
     - Chat with seller asks for the first message, then calls `ConversationsService.start` and makes that chat active.
     - A plain reply goes to the chat Udozo's forwarded message belongs to: WhatsApp's reply context names it, through `whatsapp_messages.wamid`. Otherwise it goes to the active chat.
     - My chats lists the latest 10 so the person can choose one.
     - Photos go both ways: the bytes go through `sendPhoto` coming in, and a signed private link going out.
     - Offers and buy-order cards arrive as text with a link. Block and Report are in the chat's menu.
     - Messages are worded "**[Listing]** Chinedu: …". Only first names are used, and no number ever appears.
   - **Sell** (step by step, saved after each step as an ordinary draft, so it also shows in My listings on udozo.com):
     1. Before starting: the person is linked, the account's checks pass (`sellerCountry`) and the switch is on. An open draft is offered first ("Continue your draft …?").
     2. Title, typed.
     3. Category: the top categories as a list, in pages of 9 plus More, then the subcategories in the same way. Or the person types words, matched with `matchCategories` from the api-client.
     4. Condition, as a list.
     5. Price: typed (`450k` and `₦450,000` are both read), or Ask for price.
     6. Area: "Use <your area>", or type a place and choose among the matches.
     7. Photos: send the market's minimum to 12. Each goes through `addPhoto`, and refusals (too small, a repeat) are said in words. Done appears once enough photos are in.
     8. Description, or Skip.
     9. Brand, if the category asks for one: the top brands, or type one.
     10. Summary, with Post, Change (a list of the steps) and Keep as draft.
     11. Terms: if not accepted, a link to them and an "I accept" button, which records the version.
     12. Post calls `submit` and answers "Live" or "In review", with the listing's link.
     - The posting journey records source `whatsapp` and each step: add `whatsapp` to `sellSources` in both copies and to the admin's labels, and record it explicitly for drafts made through WhatsApp.
   - **Wanted:**
     1. What they need, typed.
     2. The category: the best match to confirm, or a list.
     3. Area (defaults to theirs), budget (or Skip), condition (Any, New or Used).
     4. Summary, then Post request.
     5. The bot replies with up to 5 matching listings now and "We told N sellers". Responses arrive with the seller's listing and a Chat button.
8. **Relay hooks:**
   - `ConversationsService.write` calls `relay.forward(message)` after commit (through `waitUntil`) when the recipient is linked, opted in and has "Chats on WhatsApp" on (on once linked).
   - `InboxService.create` calls `whatsapp.enqueue(created)` beside `push.enqueue`, only for the types in a `whatsappTypes` set (buy-order steps, a contact answered, a call back, a missed call, wanted match and response). It never sends `customer.classifieds.message`, because the relay already sends the chat message itself.
9. **Wanted requests** (`src/classifieds/wanted/`):
   - **Buyer routes:** `POST /v1/classifieds/wanted` (needs a confirmed email; open and daily limits; refused words give `request_prohibited`), `GET /v1/classifieds/me/wanted`, and `POST …/:id/close`.
   - **Matching:** sellers with live listings in the category or its children in the country, area first, then state. Never the buyer, a blocked pair or a suspended seller. Capped by both the per-request and per-seller-day settings. Each seller is told once, with the notice `customer.classifieds.wanted_match` (inbox, push and WhatsApp).
   - **Seller routes:** `GET /v1/classifieds/me/wanted-for-you` and `POST /v1/classifieds/wanted/:id/respond { listing_id, note? }`. The listing must be the seller's own, live and in the category. Responding opens or joins that listing's chat with a `wanted_response` card and tells the buyer (`…wanted_response`).
   - **Admin routes:** `/v1/admin/classifieds/wanted` (list, view, remove with a reason, audited).
   - The `classifieds` job expires requests.
10. **Cron and limits:**
    - a `whatsapp` job every 5 minutes, added to `jobOwners` as Udozo's and to `vercel.json`: retries notices and the outbox, resets stale flows, and deletes old rows (notices 30 days, messages 90 days, link codes);
    - inbound messages are limited per number (30 a minute), as a guard against floods.

## Apps

- **udozo.com:**
  - Profile > **WhatsApp** (`/account/profile/whatsapp`): Connect (opens `wa.me` with the code), status, "Chats on WhatsApp" and "Request alerts on WhatsApp", Disconnect.
  - A "Chat with us on WhatsApp" link in the footer and on Help.
  - On a listing page, "Ask on WhatsApp" (`wa.me/…?text=L <ref>`), shown only while the switch is on.
  - Wanted: Account > **Requests I made** and **Requests for you** (`/account/wanted`), and a form at `/<cc>/wanted/new`, also linked from searches with no results ("Can't find it? Post a request").
  - A chat message sent from WhatsApp shows "via WhatsApp".
- **Udozo admin:**
  - Settings > Integrations > WhatsApp.
  - Site > **WhatsApp** (`/whatsapp`): the number's quality rating, templates with their approval status and Submit to Meta, messages in and out over 7 days, failed sends, and looking a contact up by number to opt them out.
  - Marketplace > **Wanted requests**.
  - The four wanted limits on Limits and words.

## Phases (one commit each, each tested)

1. **Foundation:** the integration, webhook, notices, contacts and linking, opt-in and STOP, the outbox, the template registry and submission, the main menu and Help, Profile > WhatsApp, and admin Site > WhatsApp.
2. **Find and chat:** search, listing cards, the relay both ways, call back and contact requests, My chats.
3. **Sell:** the step-by-step posting flow, and posting journeys with `whatsapp`.
4. **Wanted requests:** the API, udozo.com, the WhatsApp flow and admin.
5. **Notices on WhatsApp**, plus legal and docs:
   - the terms get a WhatsApp section, and the privacy notice names Meta/WhatsApp as a processor, with numbers, relayed messages, storage and retention;
   - bump `legalVersion`;
   - update AGENTS.md.

## Owner steps (outside code)

1. Verify Udozo's business with Meta.
2. Create the Meta app and add WhatsApp.
3. Register a number that is not on the WhatsApp app, with "Udozo" as its approved display name.
4. Make a system-user token with `whatsapp_business_messaging` and `whatsapp_business_management`.
5. Set the webhook to `https://api.udozo.com/v1/webhooks/whatsapp` with the verify token, and subscribe to `messages`.
6. Add a payment method in WhatsApp Manager. Meta charges per template sent; replies within the window are free.
7. Submit the templates (from the admin) and wait for Meta's approval.
8. Switch `whatsapp_channel` on, starting with Nigeria.

## Verification

- **Tests in `apps/udozo-api`:** a fake Graph API through `fakeService` in `test/helpers.mjs`, then:
  - `whatsapp-webhook` (the signature, the verify challenge, deduplication, retries);
  - `whatsapp-linking` (automatic, by code, STOP and START);
  - `whatsapp-relay` (both directions, the window falling back to a template, reply context, blocked chats);
  - `whatsapp-find`;
  - `whatsapp-sell` (the whole flow through to submit, with photo and terms refusals);
  - `wanted-requests` (limits, matching, responses, moderation, the switch);
  - plus `vercel-crons` and `udozo-scope`, updated.
- **Tests in udozo.com:** `whatsapp-connect.test.ts`, `wanted.test.ts`.
- **Tests in the admin:** `whatsapp.test.tsx`, `wanted.test.tsx`.
- Run each phase's targeted tests only, and build `@udozo/api` before its tests.
- **Live,** after the owner's steps: Test connection reads the number; a message to the number gets the menu; then the full test run: post a test ad, find it from another phone, chat both ways, and post and answer a wanted request.
