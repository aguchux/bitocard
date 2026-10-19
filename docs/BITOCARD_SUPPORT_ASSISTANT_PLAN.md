# BitoCard Support Assistant: implementation plan

**Status:** phase 1 (tickets without AI) built on 19 October 2026: statuses are `open`, `pending` and `resolved` with a `queue` (`reseller` or `bitocard`) for who answers, in place of the longer status list below. Phase 2 (live chat without AI) and phase 3 (AI providers, keys, allowance and usage) built the same day; own keys are the reseller's own `ai_keys` on any plan rather than an own-integration connection. Phase 4 (bots: wizard, knowledge, Generate from BitoCard, Update knowledge base, playground, activation) built the same day. Phase 5 (assistants answering chats and tickets, tools, redaction, hand-over, drafts) built the same day. Phases 6 and 7 to follow.

## What we are building

Live chat and support tickets on every store, answered by people and, where the store has one, by an AI **support bot**:

- **Bots** run on Anthropic, OpenAI or DeepSeek. The store pays through its own API key, or uses BitoCard's keys as part of the Premium plan. Each store has at most one bot.
- **Who makes bots:** a reseller makes one for each of their stores in SHQ. BitoCard makes one for bitocard.com, and one for its own support of resellers in SHQ.
- **Building a bot:** Role + AI agent → Profile (name, avatar) → Knowledge (upload a document, or have BitoCard generate one from the store) → Assign to a store → Test → Activate.
- **What a bot does:**
  - answers chats;
  - replies to tickets;
  - opens tickets from a chat, to the reseller or to BitoCard;
  - hands over to a person.
- **Escalation chain:**
  1. customer to the store's reseller;
  2. reseller to BitoCard;
  3. BitoCard to engineering, as a GitHub issue that is fixed or patched; closing it tells the person who asked.

## Decisions (recommended defaults, change before building)

| Question | Recommendation | Why |
|---|---|---|
| Knowledge format | **Markdown (.md) with a fixed outline and a short YAML header**, plus an optional **CSV of FAQs** (`question,answer,category`) | Models read Markdown natively and the headings keep facts in context. CSV suits only question-and-answer pairs. A template is downloadable from SHQ and the admin app (appendix A). |
| How knowledge reaches the model | The **whole document in the system prompt**, cached by the provider (at most 60,000 characters, about 15,000 tokens). No vector database in v1. | One store's knowledge fits easily. Prompt caching (Anthropic cache control; OpenAI and DeepSeek cache automatically) keeps it cheap. Add pgvector only if documents outgrow this. |
| Live facts (prices, orders, availability) | **Tools, never the document**: the bot calls BitoCard functions scoped to that customer and store | The document goes stale, and the API is the truth. |
| Ticket replies | A per-bot setting, **Reply automatically** or **Suggest a draft** for staff to send. Default: automatic for chats, draft for tickets in the first month of a bot | Tickets are often about money and identity. Owners turn on automatic replies once they trust the bot. |
| Who can chat | Signed-in store customers (a store's customers are its own), and reseller staff in SHQ. Signed-out shoppers get the bot only for general questions (no tools), at a low rate limit. | Order tools need a known customer. |
| BitoCard-funded AI | Premium (`ai_assistant` plan feature) with a **monthly allowance per store** (for example 2,000 bot replies) set by admins; past it, the bot hands over to people until the month resets or the store adds its own key | Caps BitoCard's cost. Own keys have no BitoCard cap. |
| Own keys | Allowed on every plan once verified, as an own integration of a new kind, `ai_provider` | They pay their provider. Reuses the encrypted connections, checks and reseller access switches. |
| Transport | Polling (every 2 seconds while a chat is open, otherwise every 30 seconds) on Vercel Functions; the bot's reply is produced after the customer's message commits (`waitUntil`, with the `support` cron as backstop) | No WebSockets on Vercel Functions. Streaming over SSE can come later. |
| Disputes | Kept separate. The bot sends money problems with an order to **Report a problem** (dispute), not to a ticket | Disputes already carry the money decisions, chargebacks and refunds. |

## Data model (Prisma, new migrations)

- **`support_bots`**
  - **Owner and placement:** `reseller_id` (house accounts for BitoCard), `store_id` (**unique**: one bot per store), and a `scope`: `store` (customers) or `platform` (BitoCard's bot for resellers in SHQ; only one).
  - **Role:** `roles` (`chat`, `tickets`), `ticket_reply_mode` (`auto` | `draft`).
  - **AI agent:** `provider` (`anthropic` | `openai` | `deepseek`), `model`, `funding` (`bitocard` | `own`), `connection_id` (own key).
  - **Profile:** `name`, `avatar_url` (media), `greeting`, `tone` (friendly | formal | brief), `instructions` (extra house rules, at most 2,000 characters), `languages`.
  - **Status:** `draft` | `active` | `paused` (by owner) | `suspended` (by BitoCard), with `knowledge_id` (the version in use) and timestamps.
- **`support_bot_knowledge`** (versioned): `bot_id`, `version`, `source` (`upload` | `generated` | `edited`), `format` (`md` | `csv`), `content` (text; CSV is turned into Markdown Q&A on upload), `chars`, `created_by`, `created_at`. A version is never edited in place, and the bot points at one.
- **`support_conversations`** (chats):
  - who: `store_id`, `reseller_id`, `customer_id` or `user_id` (reseller staff chatting with BitoCard), `mode`;
  - state: `status` (`bot` | `waiting` for a person | `with_staff` | `closed`), `assigned_to`, `last_message_at`, `ticket_id` (when it became a ticket).
- **`support_messages`**: `conversation_id`, `author` (`customer` | `staff` | `bot` | `system`), `author_id`, `author_name`, `body` (at most 4,000 characters), `tool_calls` (summarised, internal), `created_at`.
- **`support_tickets`** (`T-000123`):
  - **Ownership:** `reseller_id`, `store_id`, and `requester` (`customer` | `reseller`) with its id.
  - **Who answers:** `queue` (`reseller`: the store answers; `bitocard`: BitoCard answers).
  - **Content:** `subject`, `category` (order, payment, account, product, technical, other), `priority`, `order_id`/`checkout_id` (optional).
  - **State:** `status` (`open` | `waiting_customer` | `waiting_staff` | `escalated` | `engineering` | `resolved` | `closed`), `assignee`, `source` (`form` | `chat` | `bot` | `api` | `email` later).
  - **Engineering:** `github_issue` (number, url, state), timestamps.
- **`support_ticket_messages`**: like dispute messages (`visibility` `all` | `staff`), plus `draft` (a bot suggestion waiting for staff) and `bot_id`.
- **`ai_usage`**: `bot_id`, `store_id`, `funding`, `provider`, `model`, `input_tokens`, `cached_tokens`, `output_tokens`, `cost_micros` (from an admin price table per model), `kind` (`chat` | `ticket` | `generate`), `created_at`. Monthly totals drive the allowance.

## API (all built API-first)

- **Bots** (SHQ sessions only, owners and admins; admin equivalents under `/v1/admin/support/bots`):
  - `GET/POST /v1/support/bots`, `GET/PATCH/DELETE /v1/support/bots/:id`;
  - `POST …/:id/activate|pause`;
  - `PUT …/:id/knowledge` (an upload or text) and `GET …/:id/knowledge(/versions)`;
  - `POST …/:id/knowledge/generate`, which returns a draft document for the owner to read and edit before applying;
  - `GET /v1/support/knowledge-template?format=md|csv`;
  - `POST …/:id/test { message }`: a playground answer, nothing stored, counted as usage.
- **Chats, for customers** (`/v1/store/support`, customer sessions, left out of the public OpenAPI document): `POST /conversations`, `GET /conversations(/:id)`, `POST /conversations/:id/messages`, `GET …/messages?after=`, `POST …/:id/human` (ask for a person), `POST …/:id/close`.
- **Chats, for staff:** resellers on `/v1/support/conversations…` (SHQ) to see, take over, reply and close; BitoCard on `/v1/admin/support/conversations…`. Reseller staff chat with BitoCard through `/v1/support/bitocard/conversations…`.
- **Tickets:**
  - **Customers:** `/v1/store/support/tickets` (create, list, read, reply).
  - **Resellers** (`/v1/support/tickets`, **public API** with scopes `support:read`/`support:write`, so their own systems can open and answer tickets): their customers' tickets (reply, internal note, resolve, **escalate to BitoCard**), and their own tickets to BitoCard.
  - **BitoCard** (`/v1/admin/support/tickets`): reply, assign, resolve, and **escalate to engineering**.
  - **Webhook events:** `support_ticket.created`, `support_ticket.updated` and `support_ticket.message_received`, documented in `eventDocs`, carrying the ticket summary and never the messages.
- **Engineering:** `POST /v1/admin/support/tickets/:id/github-issue` (operations; audited) creates the issue. `POST /v1/webhooks/github` (signature `X-Hub-Signature-256`) closes the loop when the issue is closed or its pull request merges.

## AI providers (`src/support/ai/`)

- **The interface:** `AiProvider.reply({ system, cachedContext, messages, tools, model, maxTokens }) → { text, toolCalls, usage }`, with one adapter per provider.
  - **Anthropic:** the Messages API, `cache_control` on the knowledge block, tool use. Default model `claude-sonnet-5-5`, or `claude-haiku-5-5` for low cost.
  - **OpenAI:** the Responses API (or Chat Completions), function tools, automatic caching. The model is chosen by the admin from a list kept in settings.
  - **DeepSeek:** OpenAI-compatible Chat Completions at `https://api.deepseek.com`, function calling, automatic context caching. Default `deepseek-chat`.
- **Settings:** BitoCard's keys are integration settings (Settings > Integrations > **AI providers**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, the models offered, the price table per model). Each has Test connection, sign-up and key links, and an "adapter built" flag.
- **Own keys:** resellers add theirs as own integrations of kind `ai_provider` (`connectable.ts`), checked with a tiny request and stored encrypted, like suppliers. A bot with `funding: own` uses only that connection, and stops (handing chats to people) when the connection is no longer active.
- **Failures:** timeouts and provider errors never lose the customer's message. The chat shows "A person will reply shortly", moves to `waiting`, and staff are told.

## Bot behaviour and safety

- **System prompt, in this order:**
  1. BitoCard's fixed rules (below);
  2. the store's profile and tone;
  3. the knowledge document (cached);
  4. the conversation.

  Knowledge and customer text are untrusted data. They never override the fixed rules: a defence against prompt injection.
- **Fixed rules:**
  - Say it is an AI assistant (shown in the chat too).
  - Never reveal or ask for codes, PINs, passwords, card numbers or one-time codes.
  - Never name BitoCard's suppliers, costs or routing.
  - Never promise refunds, credits or delivery times.
  - Hand over to a person when unsure, when money must move, for identity or legal questions, for an angry customer, or when the customer asks.
  - Answer only about this store.
- **Tools** (server-side, scoped to the conversation's store and customer; the model only proposes):
  - `search_products(query)`: what the store lists, with face values and availability.
  - `order_status(order)`: the customer's own orders only. Status and what to do next, **never codes**; the bot points to the order page and its Reveal.
  - `store_policies(topic)`: refunds, delivery, verification and payment methods, from the market's settings.
  - `create_ticket(subject, summary, category, order?)`: opens a ticket for the customer, to the store's queue.
  - `handoff(reason)`: sends the chat to staff.
  - **BitoCard's platform bot also has:** `reseller_account_status` (verification, plan, wallet state, never balances to anyone not entitled), `docs_search` (the docs guides) and `create_ticket` to BitoCard.
- **Redaction:** delivered codes, licence keys, tokens, PINs and full card or account numbers are never put in a prompt. Anything that looks like one in a customer's message is masked before sending.
- **Limits:** a cap on messages per conversation per minute, on bot replies per store per day, and on token budgets. Past the monthly allowance, chats go to people.
- **Records:** transcripts are kept 12 months (to confirm). Usage is kept for billing. Every staff and bot action on a ticket is attributed.

## "Generate from BitoCard" (knowledge for a store)

`StoreKnowledgeService.generate(storeId)` builds the document from data we already hold, filling the template section by section without AI, so it is exact:

- **The store:** name, address and domains, country, currency, and its template and what it sells (categories and menu groups).
- **Products:** listed products, most popular first (at most 150), with brands, face values or ranges. It says prices are shown at checkout.
- **Delivery:** how each category is delivered (codes on the order page with Reveal, electricity tokens, eSIM install steps, VPN sign-in details, number renewals and their 15-day rule).
- **Policies and accounts:**
  - refunds per product type, from our terms;
  - payment methods and wallets in the market (spend only, top-ups, account numbers);
  - when identity checks are asked;
  - disputes ("Report a problem").
- **Contact:** support hours and contact, entered by the reseller (left as placeholders to fill).

An optional **Polish with AI** step rewrites the wording in the store's tone, without adding facts, before the owner reviews it. Nothing is applied until the owner presses **Apply**, which saves it as a new knowledge version.

### Update knowledge base (keeping the store's data current)

The store changes after the document is made: products listed and unlisted, a new template, payment methods, a domain, policies. **Update knowledge base** refreshes the document from the store's data as it is now, without losing what the owner wrote.

- **Managed and owner sections.**
  - Each part of a generated document is wrapped in markers, `<!-- bitocard:products -->` … `<!-- /bitocard:products -->`. The parts are the store, what it sells, products, delivery, buying and paying, refunds, accounts and verification.
  - Everything outside the markers is the owner's: About the store, FAQs, support hours and contact, extra rules, and anything they add.
  - An uploaded document gets markers only where it uses the template's headings. Anything else counts as the owner's.
- **What an update does** (`POST /v1/support/bots/:id/knowledge/update`, and the same for admins):
  1. Regenerates every managed section from current data.
  2. Leaves the owner's sections untouched.
  3. Returns a **draft with a section-by-section comparison**, for example "Products: 12 added, 3 removed" and "Payment methods: Mobile money added". Removed lines and added lines are shown side by side.
- **Applying:**
  - The owner applies it, or individual sections. Applying saves a **new knowledge version** (`source: refreshed`); earlier versions can be restored.
  - **Managed sections edited by hand:** the update says so and asks before replacing them (Keep mine, or Use BitoCard's).
- **When the data has moved on:**
  - Each knowledge version keeps a **fingerprint of the store data it was made from** (`data_hash`: listed products, categories, template, payment methods, policies, domains, contact).
  - The `support` cron (daily) compares it with the store now. When they differ, the Assistant page shows **"Your store has changed since the knowledge base was updated"**, the owner is told once (`support.knowledge_stale`), and the update shows exactly what changed.
- **Automatic updates** (optional, per bot, off by default): `auto_refresh` applies the managed sections by itself when the fingerprint changes (at most daily), never touching owner sections or hand-edited managed ones, and records the new version. Owners who check every change leave it off.
- **Prices and stock are never written into the document:** the bot reads them live through its tools. An update keeps the descriptions current (what is sold, how it is delivered, the policies).

`support_bot_knowledge` gains `data_hash`, `managed_sections` (the hash of each managed section as generated, to detect hand edits) and the source `refreshed`. `support_bots` gains `auto_refresh` and `knowledge_stale_at`.

## Screens

- **SHQ, Support (new section):**
  - **Chats:** inbox, conversation, take over, reply, close.
  - **Tickets:** list with filters, ticket thread with internal notes, the bot's drafts (Send, Edit, Discard), escalate to BitoCard.
  - **Assistant:** the wizard below.
  - **Help from BitoCard:** chat and tickets with BitoCard. The bot answers first; Premium means priority.
- **The Assistant wizard** (`/support/assistant/new`, then `/support/assistant/<id>`):
  1. **Role and AI agent:** chat, tickets or both. The provider and model, paid by BitoCard (Premium: allowance shown) or by their own key (pick or add the connection).
  2. **Profile:** name, avatar (upload with `ImageField`, purpose `reseller_bot_avatar`), greeting, tone, extra instructions.
  3. **Knowledge:** **Download template** (.md or .csv), **Upload**, or **Generate from BitoCard** (preview, edit, apply), with versions. Afterwards, **Update knowledge base** refreshes BitoCard's sections from the store's current data (comparison, apply all or per section), with the "store has changed" notice and the Automatic updates switch.
  4. **Assign to store:** stores without a bot. A store that already has one is shown with its bot.
  5. **Test:** a playground chat, then **Activate**.
- **Admin:**
  - **Support > Chats and Tickets:** bitocard.com's customers, resellers' chats with BitoCard, escalated tickets, and GitHub issues with their state.
  - **Support > Assistants:** BitoCard's bots made with the same wizard, every reseller's bot with usage, and suspend.
  - **Settings > Integrations > AI providers:** keys and models.
  - **Settings > Plans:** the `ai_assistant` feature and allowance.
- **Storefront:**
  - A chat button on store pages and in the account app: a sheet on phones, a panel on desktops. It shows the bot's name and avatar, "AI assistant", and Talk to a person.
  - **Account > Support:** tickets list, new ticket, thread.
  - On an order page, **Get help** opens a chat about that order.

## Notifications

- **Resellers:** `support.chat_waiting`, `support.ticket_created`, `support.ticket_replied`, `support.ticket_escalated`, `support.bot_paused` (key failed or allowance reached), and `support.knowledge_stale` (the store changed since the knowledge base was updated).
- **Admins:** `admin.support.ticket_escalated`, `admin.support.chat_waiting`, `admin.support.issue_closed`.
- **Customers:** `customer.support.ticket_replied`, `customer.support.ticket_resolved`.
- **Email:** customers are emailed ticket replies under the store's brand.

## GitHub escalation

- **Setup:** integration **Engineering (GitHub)**, a GitHub App (recommended) or a fine-grained token with Issues read/write on one repository: `GITHUB_REPO`, `GITHUB_APP_ID`/`GITHUB_PRIVATE_KEY` or `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`.
- **Creating the issue:** **Escalate to engineering** (BitoCard operations only) opens an issue drafted by the bot (steps, expected, actual, area, environment, the ticket link) and edited by the admin. It carries **no personal data** (no names, emails, phone numbers, codes or account numbers) and is labelled `support` plus `bug` or `feature`.
- **Ticket status:** the ticket moves to `engineering`, with the issue linked.
- **Closing the loop:** when the issue closes (or its fix merges), the GitHub webhook moves the ticket to `waiting_staff` with a note. Staff confirm the fix with the requester, and the reseller and customer are told.

## Billing and plans

- **Plan feature:** `ai_assistant` (Premium by migration), with an admin-set **monthly allowance** of bot replies per store, and models allowed on BitoCard funding (the cheaper ones by default).
- **Own keys:** no BitoCard charge in v1. A small platform fee (the existing fee rules, kind `ai_usage`) is possible later.
- **Usage view:** `ai_usage` totals per store and month, shown to the reseller (Assistant > Usage) and to admins, with an estimated cost.

## Legal and privacy (before switching on anywhere)

- **Privacy notice:** chat transcripts and tickets (what, who sees them, retention); AI providers as processors (Anthropic, OpenAI, DeepSeek, with where they process data; DeepSeek processes in China, so take advice and consider offering it only on own keys); that customers are told they are talking to an AI; GitHub receiving no personal data.
- **Reseller terms:** the reseller is responsible for what its bot says from their knowledge, for their own keys and the provider's terms, and for the AI disclosure. BitoCard may suspend a bot.
- **Customer terms:** the AI assistant can make mistakes and cannot make refunds or decisions. Ask for a person at any time.
- **Providers:** use their no-training or zero-retention options where offered.

## Delivery order (each phase ships with its tests: PGlite and Docker, Vitest for UI)

1. **Tickets without AI:** models, customer, reseller and BitoCard ticket APIs, escalation between queues, webhooks, notifications, and SHQ, admin and storefront screens.
2. **Chat without AI:** conversations, polling, staff inbox and takeover, the storefront widget, SHQ's chat with BitoCard.
3. **AI providers:** the three adapters, integration settings and Test connection, own-key connections (`ai_provider`), usage metering and allowance, prices.
4. **Bots:** model, wizard, knowledge (upload, template, versions), **Generate from BitoCard** and **Update knowledge base** (managed sections, comparison, data fingerprint, stale notice, automatic updates), the playground, assign and activate.
5. **Bot in chat and tickets:** the system prompt, tools with scoping and redaction, hand-off, ticket drafts and automatic replies, the safety tests (injection attempts, never codes or suppliers, money requests handed over).
6. **Engineering escalation:** the GitHub integration, issue drafting, webhook back to the ticket.
7. **Legal drafts**, AGENTS.md and PLANS.md, docs (support tickets guide, webhook events), then a pilot on bitocard.com and one reseller.

## Appendix A: knowledge template (Markdown)

```markdown
---
store: Example Store
country: NG
currency: NGN
languages: [en]
support_hours: Mon–Sat 08:00–20:00 WAT
contact: support@example.com
updated: 2026-10-18
---

# About the store
Who we are, what we sell and who we serve, in two or three sentences.

# What we sell
- Airtime and data for MTN, Airtel, Glo and 9mobile
- Electricity tokens for every distribution company
- Gift cards: Amazon, Apple, Steam, …

# Buying and paying
How prices are shown, payment methods, the store wallet and top-ups.

# Delivery
How each product arrives (codes on the order page, tokens, eSIM install), and typical times.

# Refunds and problems
What can be refunded and when, and how to report a problem with an order.

# Accounts and verification
Signing in, when an identity check is asked, and keeping codes safe.

# FAQs
## How long does airtime take?
Usually seconds. …

## Can I cancel an order?
…

# Things the assistant must not do
- Promise refunds or delivery times
- …
```

**CSV (FAQs only):** `question,answer,category`, one per row, UTF-8, with a header row. Turned into the FAQs section on upload.
