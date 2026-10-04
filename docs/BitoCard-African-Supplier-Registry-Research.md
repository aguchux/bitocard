# BitoCard African Supplier Registry — Research Baseline

**Research date:** 4 October 2026  
**Purpose:** Seed the supplier registry and integration qualification backlog for reseller-owned supplier connections.  
**Source of product rules:** BitoCard `AGENTS.md` and `PLANS.md` supplied with this task.

## Executive finding

No single supplier covers every digital product in every English-speaking African market. Build a provider registry with country- and product-level eligibility, then refresh it from provider catalogues and available-number inventory. Treat this document as a research baseline, not a promise of current live inventory or permission for any reseller to connect an account. **API provisioning is a hard inclusion requirement:** a supplier remains in the active registry only when official API documentation or provider materials show programmatic product discovery and/or fulfilment for the relevant product. An API for checkout or collections alone does not qualify a company as a digital-product supplier. Partner approval may still be required for production access, and must be tracked separately from technical API readiness.

The existing BitoCard plan already names a strong starting set. The highest-value additions from this research are DT One for broad digital value services, Ghana’s expressPay as a bill/API candidate, and clearer separation of communications infrastructure from airtime/bill suppliers. The first qualification markets remain Nigeria, Ghana and Kenya. Expand after contract, account eligibility, live catalogue, settlement, and support checks.

## Scope and interpretation

This baseline covers 21 African countries where English is an official, co-official, or established government/business working language: Botswana (BW), Cameroon (CM), Eswatini (SZ), The Gambia (GM), Ghana (GH), Kenya (KE), Lesotho (LS), Liberia (LR), Malawi (MW), Mauritius (MU), Namibia (NA), Nigeria (NG), Rwanda (RW), Seychelles (SC), Sierra Leone (SL), South Africa (ZA), South Sudan (SS), Tanzania (TZ), Uganda (UG), Zambia (ZM), and Zimbabwe (ZW). Cameroon is bilingual; French-first markets are included only where English is also an official/working language. This is a product-market scope, not a claim that English is the most-used language in each country.

Use three separate geographic fields everywhere:

1. **Reseller account market** — country where a reseller can contract with and hold credentials for the supplier.
2. **Fulfilment market** — country where the buyer, recipient, or utility account is located.
3. **Product country of use** — country/region restriction on the digital item (especially gift cards, eSIM bundles, software licences, and numbers).

A supplier being available in a country does not prove that it offers every product there, that a local reseller can open an account, or that its contract permits downstream resale. Product and connection eligibility must be recorded independently.

## Registry status vocabulary

- **Documented API:** official API documentation or an official partner API is public.
- **Country evidence:** an official source explicitly describes country/service coverage, or exposes a live country/catalogue discovery API.
- **Qualification required:** BitoCard must confirm commercial access, reseller permission, live credentials, settlement currency, pricing, limits, support, and market-specific legal requirements.
- **Runtime catalogue required:** availability must be read from the authenticated provider account; public headline counts are not sufficient to enable a product.
- **Partner-gated API:** official product API provisioning is documented, but production credentials, market entitlement, reseller access, or fulfilment scope need qualification.

## Supplier master registry

Supplier names and terms are internal. Do not expose suppliers, costs, credentials, or routing decisions in the public storefront or reseller API.

| Code | Supplier / product | Scope and API evidence | Current assessment and next check |
|---|---|---|---|
| `reloadly` | Airtime, data, gift cards, utility bills | Official APIs include product-specific environments and discovery endpoints. Airtime coverage is described as 140+ countries; gift card products are country-filterable; utility billers have a catalogue API. | **Priority cross-market qualification.** Build per-product discovery; verify the reseller's account market, product-country availability, biller types, rates and reversals from live credentials. |
| `dtone` | Airtime, data, eSIM, utility/bill payments, gift cards, gaming PINs | Official DVS REST API advertises 160+ countries and 875+ operators/billers, with discovery, transaction and account services. | **Priority cross-market qualification.** Strongest broad alternative candidate; ask for African market price files, downstream resale rights, API keys/sandbox, funding terms and status/refund semantics. |
| `prestmit` | Gift cards: buy and sell | Official partner API documents gift-card buy/sell flows, webhooks, wallet and fiat payout flows. Public docs explicitly mention NGN and GHS payout currencies. | **API documented; partner access gated.** Confirm reseller business onboarding, countries/currencies supported, buy inventory versus sell acceptance, settlement and card types. |
| `cardtonic` | Gift cards: buy/sell, rewards | Official developer/API site and business API documentation exist; the developer landing page describes API access as a waitlist. | **API documented; production access gated.** Confirm company/reseller jurisdictions, products, buy/sell functions and production access before building a live adapter. |
| `vtpass` | Nigeria airtime/data, cable TV, electricity, education, insurance and other bills | Public REST API docs include sandbox/live account registration, service variations, status requery and callbacks. | **Nigeria qualification.** Confirm biller-level live availability, reseller terms, funding/minimums, and whether customer-facing downstream resale is approved. |
| `interswitch_quickteller` | Nigeria bill payments and digital services | Existing BitoCard plan identifies Interswitch/Quickteller as a second Nigerian supplier; public partner/API access must be qualified for BitoCard use case. | **Qualification lead.** Confirm exact B2B API/product catalogue, commercial access, reseller rights, per-biller coverage and webhook/reversal contract. |
| `korba_xchange` | Ghana airtime/data, ECG, Ghana Water, TV/utilities; payment collections/disbursements | Official REST API docs include airtime, bundles, ECG, GWCL, TV/utilities, transaction status and callbacks; a sandbox is documented. | **Priority Ghana qualification.** Confirm production credentials, provider commission, ECG prepaid/postpaid coverage, reversals and explicit reseller permission. |
| `techlink_gh` | Ghana airtime/data, ECG, water, TV, education results | Official business API page documents a REST API and wallet-funded orders for Ghana digital services. | **Ghana backup candidate.** Confirm partner onboarding, commercial terms, exact biller types, final statuses and refunds. |
| `king_flexy_gh` | Ghana airtime/data and utility/TV bills | Official developer docs expose catalogue and biller APIs, orders and transaction flows for Ghana utilities/TV. | **Ghana backup candidate.** Confirm live API credentials, downstream resale permissions, balance/funding and support SLAs. |
| `expresspay_gh` | Ghana bill payment, airtime, data and collections | Official developer site documents third-party integration and bill payments; also advertises airtime/data. | **New Ghana qualification lead.** Confirm that bill generation supports reseller-originated utility purchase and that API credentials include fulfilment, not only customer payment collection. |
| `ipay_africa` | Kenya bills, airtime, TV; collections and payouts | Official API universe includes a Billing API; documentation describes utility and airtime payments. | **Kenya qualification.** Verify current catalogue, billers, credentials, rates, production access and reseller resale terms; docs are older in places. |
| `elipa` | Bill/airtime APIs in multiple markets (at least Kenya; docs also expose country-specific Uganda/Malawi/Zambia paths) | Official API documentation has country-specific areas and billing endpoints. | **Regional qualification lead.** Build a country capability check and verify live billers in each market (e.g., KE/UG/MW/ZM); do not infer coverage from API pages alone. |
| `tupay` | Kenya bill/TV payments (BitoCard target); payment services | Existing plan identifies Kenya TV services; public bill API docs show services such as DStv. | **Kenya backup lead.** Validate exact country and TV billers, production API access, business type eligibility, and whether Tupay product name/API is the same entity and contract in scope. |
| `cellulant_tingg` | Pan-African payment acceptance and payout; potential bill services | Official Tingg docs show a country-code bill-query API and current payment-channel country matrix. | **Do not classify checkout coverage as product-supplier coverage.** Qualify separate service/biller APIs and markets before enabling bill fulfilment. Excellent candidate as a reseller-local payment gateway integration. |
| `africas_talking` | SMS, USSD, voice, airtime/mobile data, payments | Official service table lists products by country. Markets with airtime include KE, UG, TZ, NG, GH and ZA; other services have narrower coverage. | **Communications/airtime candidate.** Map each service separately by country. Do not infer phone-number inventory from voice API availability. Check sender-ID/short-code rules and local approvals. |
| `airalo_partners` | Travel eSIM | Official partner API supports package discovery, order, eSIM management, usage and notifications; official docs describe 200+ destinations. | **Destination-country coverage.** BitoCard can sell packages usable in African destinations; the reseller's home market and end-user eligibility are a separate commercial check. |
| `esim_go` | Travel eSIM | Official REST API supports catalogue discovery and country/network lookup; provider advertises 190+ countries. | **Destination-country coverage.** Existing plan flags a $1,000 minimum top-up; re-confirm minimum, wholesale terms, local downstream resale rights, roaming rules and expiry/refunds. |
| `esim_access` | Travel eSIM | Official reseller API documents wholesale eSIM provisioning, ordering, status, top-up, cancellation and suspension. | **Partner-gated API.** Confirm African destination coverage, production credentials, settlement/funding terms and reseller permission. |
| `esimerge` | Travel eSIM | Official provider site documents a live REST API, wallet, reseller provisioning and destination catalogue. | **Partner-gated API.** Verify API docs/sandbox, African destination coverage, commercial terms, and reseller onboarding. |
| `nexway_connect` | Software/game licences and digital delivery | Official Nexway documentation exposes REST API product catalogue/order/fulfilment functions; Nexway Monetize describes software and digital goods. | **Partner-gated.** Confirm African reseller territories, vendor/brand authorization, VAT/invoicing obligations, catalogue and API entitlement. Avoid unauthorised grey-market keys. |
| `ingram_micro` | Software and cloud subscriptions | Existing BitoCard plan lists distributor and Microsoft/software categories. APIs/marketplaces require partner onboarding and region-specific authorization. | **Partner-gated candidate.** Confirm African reseller programme, country catalogues, API access, distributor agreement, tax and end-customer licence assignment. |
| `td_synnex` | Software and cloud subscriptions | Existing BitoCard plan lists as alternative distributor; product access is marketplace/partner-led. | **Partner-gated candidate.** Confirm markets served, API programme, eligible legal entity and downstream reseller permissions. |
| `pax8` | Business software subscriptions | Existing plan lists for later expansion. | **Partner-gated candidate.** Confirm African reseller onboarding and territory coverage; do not assume the US/Europe marketplace extends to Africa. |
| `also_cloud` | Business software subscriptions | Existing plan lists as mainly Europe. | **Low priority for Africa until territory confirmed.** Confirm eligible countries, marketplace/catalogue and partner API access. |
| `didww` | Virtual numbers, SIP and messaging | Official REST API supports country and DID inventory discovery, requirements, ordering and service configuration. Public coverage includes selected African countries including Ghana, Kenya, Nigeria, South Africa, Uganda and Zimbabwe (availability varies). | **Strong telecom adapter candidate.** Query live country/DID inventory and documentation requirements; separate number type, voice/SMS capabilities, regulatory approvals and resale rights. |
| `telnyx` | Virtual numbers, voice, SMS | Official coverage/support pages document phone number and service coverage, with Nigeria and South Africa appearing in published country material. | **Telecom candidate; inventory/country restrictions apply.** Query official coverage tool/API and document country-specific registration, capabilities and ordering prerequisites. |
| `twilio` | Virtual numbers, voice, SMS | Official Phone Numbers API allows country/capability inventory lookup and purchase; number types and regulatory requirements vary by country. | **Telecom candidate.** Do not claim availability from general “100+ countries” language. Use country API/inventory, number type, SMS/voice capability and local regulatory checklist. |
| `vonage` | Virtual numbers, voice and SMS | Official Numbers API documents search, purchase, cancellation and management of virtual numbers. | **API documented; partner/country gates apply.** Validate African DID inventory, number type, SMS/voice capability and resale model per country. |
| `plivo` | Virtual numbers, voice and SMS | Official Phone Numbers API documents inventory search, purchase and number management. | **API documented; partner/country gates apply.** Validate African inventory, number type, requirements and downstream resale permission. |
| `flutterwave_cards` | Virtual payment cards (planned) | Existing plan lists Flutterwave cards for Nigeria pilot; this is a regulated financial product, not a standard gift-card supply API. | **Commercial/regulatory gate.** Confirm issuing/processor programme, business model, eligible reseller entity/countries, KYC/AML, cardholder terms, funding and API scopes before listing. |
| `maplerad` | Virtual payment cards (planned) | Existing plan lists Maplerad as Nigeria alternative. | **Commercial/regulatory gate.** Confirm product issuance and reseller/distribution access, operating countries, programme manager, KYC, FX/fees and scheme requirements. |
| `onafriq` | Virtual cards and cross-border financial services (planned) | Existing plan lists Onafriq as pan-African expansion candidate. | **Commercial/regulatory gate.** Confirm actual card programme/API access in each market; regional payment network presence does not prove virtual-card issuance/resale eligibility. |

### Platform vendors that are not automatically product suppliers

Keep supplier and payment-provider capabilities separate in the registry. Tingg, Korba, expressPay, iPay and eLipa expose APIs; classify each capability from product-specific endpoints. Only create a product offer when an authenticated service catalogue explicitly returns the relevant fulfilment product. A payment gateway's country footprint is not a bill-supplier footprint. Hubtel is omitted from the active product-supplier registry because the public API evidence reviewed documents merchant payments, but did not establish an API for supplying and fulfilling the bill products in scope.

## Country qualification matrix

This matrix is a **candidate map** for sales and due diligence. It is not a live availability promise. Broad-network suppliers must be checked through the authenticated account catalogue before enabling products. “Local candidates” below are leads supported by the documented target market, not confirmed contracts.

| Country | Broad digital value suppliers to query | Documented/local supplier leads | Initial registry action |
|---|---|---|---|
| Botswana (BW) | Reloadly, DT One | Tingg payments; local utility supplier search | Query airtime/data and gift-card country catalogues; source electricity/water/TV partner. |
| Cameroon (CM) | Reloadly, DT One | Tingg payments/mobile-money methods | Add bilingual operator; check product catalogue and French-language support. Source bill API. |
| Eswatini (SZ) | Reloadly, DT One | No bill supplier confirmed in this research | Query dynamic catalogues; source local utilities/TV partner. |
| The Gambia (GM) | Reloadly, DT One | No bill supplier confirmed in this research | Query dynamic catalogues; source telco/utility supplier. |
| Ghana (GH) | Reloadly, DT One, Africa's Talking | Korba Xchange, Techlink GH, KiNG FLEXY GH, expressPay; Tingg for payments | Qualify Korba first; preserve API-provisioned providers as backups. Confirm biller-level service codes. |
| Kenya (KE) | Reloadly, DT One, Africa's Talking | iPay Africa, eLipa, Tupay; Tingg payments | Query Reloadly KPLC/TV first; qualify iPay/eLipa for gaps and Tupay for TV. |
| Lesotho (LS) | Reloadly, DT One | No bill supplier confirmed in this research | Query dynamic products; source local bill and payment partner. |
| Liberia (LR) | Reloadly, DT One | No bill supplier confirmed in this research | Query dynamic products; source local bill supplier. |
| Malawi (MW) | Reloadly, DT One | eLipa APIs expose MW area; Africa's Talking SMS/USSD | Verify eLipa live billers and local accounts; query airtime catalogue. |
| Mauritius (MU) | Reloadly, DT One | No bill supplier confirmed in this research | Query dynamic products; source local utilities and payment partner. |
| Namibia (NA) | Reloadly, DT One | No bill supplier confirmed in this research | Query dynamic products; source local utilities, TV and payment partner. |
| Nigeria (NG) | Reloadly, DT One, Africa's Talking | VTpass; Interswitch/Quickteller; Prestmit/Cardtonic gift-card API; Tingg payments | Pilot market. Qualify VTpass, then Quickteller; verify Cardtonic/Prestmit production access. |
| Rwanda (RW) | Reloadly, DT One | Africa's Talking SMS/USSD; Tingg payment methods | Query airtime/data and bills; source local utility partner. |
| Seychelles (SC) | Reloadly, DT One | No bill supplier confirmed in this research | Query dynamic products; source local bill/payment partner. |
| Sierra Leone (SL) | Reloadly, DT One | No bill supplier confirmed in this research | Query dynamic products; source local telco and utility partner. |
| South Africa (ZA) | Reloadly, DT One, Africa's Talking | Tingg payments | Query networks and licensed bill aggregators; check product and payment compliance separately. |
| South Sudan (SS) | Reloadly, DT One | Tingg payment methods | Query dynamic products and country restrictions; source local bill partner. |
| Tanzania (TZ) | Reloadly, DT One, Africa's Talking | eLipa regional API lead; Tingg; Africa's Talking airtime | Query airtime/data; validate every utility API and service code. |
| Uganda (UG) | Reloadly, DT One, Africa's Talking | eLipa regional API lead; Tingg | Query airtime/data and eLipa billers; identify local utility gaps. |
| Zambia (ZM) | Reloadly, DT One | eLipa regional API lead; Africa's Talking SMS/USSD; Tingg | Query airtime/data; verify eLipa biller catalogue and local utilities. |
| Zimbabwe (ZW) | Reloadly, DT One | Tingg payments | Query dynamic catalogues; source utility/TV provider. |

**Broad supplier country leads are not certified per country.** The market check should use each account's current product/country catalogue, then store product-level evidence and its retrieval timestamp. For virtual numbers use country/DID inventory and legal requirements; for eSIMs use package destination coverage; for software use partner territory and licence terms.

## Product category shortlist

| Product category | Cross-market starting points | Local/regional coverage strategy | Special eligibility |
|---|---|---|---|
| Airtime and data | Reloadly; DT One; Africa's Talking where its country/service list supports it | Add national telecom aggregators where price, coverage or reliability is better | Recipient/destination country and operator; amount/bundle; local currency; reversal rules. |
| Electricity, water and TV | DT One and Reloadly biller catalogue (only where the live feed returns exact biller) | Country APIs: VTpass/Quickteller (NG); Korba/Techlink/KiNG FLEXY/expressPay (GH); iPay/eLipa/Tupay (KE); discover partners for other countries | Exact service code, prepaid/postpaid, meter/account validation, presentment, token/receipt, asynchronous status, reversals. |
| Gift cards | Reloadly; DT One for purchase inventory | Prestmit/Cardtonic as buy/sell trading candidates, after account and market qualification | Country of redemption, brand, denomination, currency, delivery type, purchase versus sell workflows. |
| Travel eSIM | Airalo Partners; eSIM Go; eSIM Access; eSimerge | Destination catalogue; no need to treat destination coverage as local bill coverage | Network, bundle, validity, FUP, activation policy, refund/cancellation, country restrictions. |
| Software/licences | Nexway; Ingram Micro; TD SYNNEX; Pax8; ALSO | Start with a distributor offering an African partner territory and approved digital catalogue | Reseller authorization, EULA territory, tax, key delivery, seat assignment, renewal/cancellation, transfer restrictions. |
| Virtual numbers / SIP / SMS | DIDWW; Telnyx; Twilio; Vonage; Plivo; Africa's Talking for comms APIs | Query number inventory in each country and number type; source local carriers if absent | Local address/KYC, proof documents, SMS/voice capability, number portability, legal use, renewal and release. |
| Virtual payment cards | Flutterwave, Maplerad, Onafriq (planned leads only) | Country-specific regulated programme onboarding | Issuer/program manager, KYC/AML, cardholder terms, scheme approvals, funding, customer support, licensing. Keep separate from gift cards. |

## Country coverage data sources and refresh rules

Prefer machine-readable source-of-truth checks over static claims:

- **Airtime/data:** list providers, operators and products per ISO country from the authenticated product API (e.g., Reloadly/DT One); save the raw response hash, product IDs, timestamp, account market and effective status.
- **Bills:** query biller catalogue and service variations per country and category; run a validation/presentment test where supported before activation. Never infer country service from the provider's payment acceptance list.
- **Gift cards:** query each product's usage countries, brands, denominations, fulfilment method and sell/buy function.
- **eSIM:** query destination, included networks, bundle, validity and FUP; refresh before quote and cache with a short TTL.
- **Phone numbers:** query country → number group/type → features → live stock → requirements/pricing; revalidate at checkout because stock changes.
- **Software:** import the partner product feed, but retain explicit territory, end-customer eligibility, channel authorization and licence terms per SKU.
- **Cards:** require a separate compliance and programme approval record before exposing any card product.

Recommended refresh cadence: nightly country/product sync for stable catalogues; hourly or on-quote checks for volatile rates/stock; immediate refresh after provider webhook/config change. Mark feed failures as **stale/unknown**, never as “no coverage”.

## Suggested normalized registry data model

Maintain distinct records rather than a provider list with a single country array:

- **Provider:** `code`, display/legal name, provider type, official docs, support contact, onboarding URL, country-of-contract limitations, API versions, status, owner.
- **Capability:** provider, capability code, transaction direction (`buy`, `sell`, `issue`, `pay_bill`, `collect`, `payout`), product category, API operation, sandbox/live support.
- **Market offer:** provider, reseller account country, recipient/service country, product-of-use country, currency, local operator/biller/brand, provider SKU, denominations, terms, live status, source timestamp, evidence URL/hash.
- **Connection policy:** available-to-resellers globally/countries, approval mode, permitted plans, allowed regions, test/live credentials, seller-of-record model, permitted downstream resale, connection status.
- **Commercial terms:** prefunding model, initial/minimum top-up, transaction fee/commission, FX spread, settlement currencies, tax responsibility, refund/reversal rules, chargeback allocation, invoice access.
- **Operational profile:** auth scheme, idempotency support, webhook signature and replay handling, status lookup, timeout semantics, retry/requery schedule, maintenance channel, SLA, support escalation.
- **Compliance profile:** required business documents, licences, KYC/AML, number/document rules, product restrictions, privacy/data location, end-customer checks, territory/EULA.
- **Evidence:** source type (`official_docs`, `provider_api`, `contract`, `sales_confirmation`, `test_order`), URL/document ID, retrieved by, retrieved at, expiry/review date, confidence, notes.

Eligibility for a reseller connection should be true only when (a) BitoCard has a working adapter, (b) the provider explicitly permits the relevant reseller/sub-reseller model, (c) the reseller's contracting country and product markets are approved, (d) credentials are checked, and (e) the provider-specific risk/compliance review passes.

## Adapter qualification checklist

For each provider and each product family:

1. Obtain partner written confirmation that a BitoCard reseller may connect its own account and sell the provider product to its own customers; identify seller of record and support owner.
2. Confirm account-creation countries, business-type restrictions, live credentials, API docs/version, test environment, IP allowlisting and per-reseller credential scopes.
3. Pull actual catalogues for all 21 target markets; compare products, country of use, currencies, price/discount, min/max, package/denomination and availability.
4. Establish prefunding/credit model, first deposit, minimum top-up, fees, FX, settlement, wallet segregation, taxes, refunds and chargeback responsibility.
5. Test complete flows: validate/present, quote, idempotent purchase, webhook, status requery, timeout/unknown, fail, refund/reversal, duplicate callback and reconciliation report.
6. Capture biller/product/customer inputs and outputs in the normalized mapping; keep provider product identifiers internal.
7. Test real low-value transactions only with approval and a written testing window; don't send live orders through a sandbox connection.
8. Record per-country go-live decision and renewal date; disable only the affected provider-market-product on stale feeds or incidents.

## Recommended integration sequence

1. **Complete pilot markets (NG, GH, KE):** Reloadly catalogue and biller discovery; VTpass (NG); Korba (GH), with Techlink/KiNG FLEXY/expressPay as API-provisioned alternatives; Kenya KPLC/TV catalogue gap check then iPay/eLipa/Tupay qualification.
2. **Add a pan-African digital value alternative:** qualify DT One with dynamic market feeds and comparable product mappings.
3. **Add regional network candidates:** eLipa and Africa's Talking per documented market/service; distinguish their API product types carefully.
4. **Fill remaining countries' bill gaps:** request local licensed aggregator introductions for the 18 non-pilot markets; verify utility/telecom biller relationships directly.
5. **Then extend non-utility verticals:** eSIM package suppliers; authorized software distributors; virtual-number inventory; regulated virtual-card issuing programmes.

## Official research sources

All links accessed on 4 October 2026. Country feeds, access requirements and inventory may change; recheck before qualification or implementation.

### Core multi-country suppliers
- [Reloadly developer documentation](https://developers.reloadly.com/) — [airtime country/operator guidance](https://support.reloadly.com/what-countries-and-mobile-operators-are-available-on-the-api), [gift-card API](https://docs.reloadly.com/gift-cards), [utility biller API](https://docs.reloadly.com/utility-payments/Utility-Billers/Get-Billers).
- [DT One API overview](https://developers.dtone.com/reference/overview) and [product discovery endpoints](https://developers.dtone.com/docs/endpoints-for-product-discovery).
- [Africa's Talking country/service table](https://help.africastalking.com/en/articles/2727792-which-countries-are-africa-s-talking-products-in).
- [Tingg API docs](https://docs.tingg.africa/) and [market/payment method list](https://cellulant-tingg.freshdesk.com/en/support/solutions/articles/72000662154-cellulant-market-coverage-and-payment-methods-available-).

### Country bill and utility candidates
- [VTpass API docs](https://vtpass.com/documentation/); [Interswitch / Quickteller API docs](https://docs.interswitchgroup.com/docs/value-added-services-overview).
- [Korba Xchange API overview](https://xchange.korba365.com/docs/).
- [Techlink GH API](https://business.techlinkgh.com/techlinkgh-api); [KiNG FLEXY developer API](https://kingflexygh.com/developers); [expressPay developer/bill-payment pages](https://expresspaygh.com/developers/docs/bill-payments/payment).
- [iPay Africa API universe](https://dev.ipayafrica.com/) and [billing API docs](https://dev.ipayafrica.com/billing.html); [eLipa API docs](https://elipa.global/dev/); [Tupay bill API docs](https://docs.tupay.app/bills/order/).

### eSIM, software and telecom
- [Airalo Partner API](https://developers.partners.airalo.com/); [eSIM Go API](https://docs.esim-go.com/); [eSIM Access reseller API](https://docs.esimaccess.com/); [eSimerge API and reseller platform](https://esimerge.com/).
- [Nexway API docs](https://apidoc.nexway.store/); [Ingram Micro Reseller API portal](https://developer.ingrammicro.com/); [TD SYNNEX API catalog](https://developer.tdsynnex.com/); [Pax8 API documentation](https://devx.pax8.com/docs/introduction); [ALSO Cloud Marketplace API](https://www.also.com/ec/cms5/en_6000/6000/also-cloud-marketplace/index.jsp). Partner territory, API production access and product catalogue still require confirmation.
- [DIDWW coverage API docs](https://doc.didww.com/api3/2026-04-16/coverage-resources/countries/index.html); [DIDWW coverage map](https://www.didww.com/coverage-and-prices/coverage).
- [Telnyx international number coverage](https://support.telnyx.com/en/articles/1424680-international-coverage); [Twilio phone-number API](https://www.twilio.com/docs/phone-numbers/api); [Vonage Numbers API](https://developer.vonage.com/en/api/numbers); [Plivo Phone Numbers API](https://www.plivo.com/docs/numbers/phone-numbers).

### Gift card and payment leads
- [Prestmit API documentation](https://documentation.prestmit.io/docs/getting-started); [Cardtonic Developer API](https://cardtonic.com/developer).
- [Flutterwave virtual-card API](https://developer.flutterwave.com/v2.0/reference/create-a-virtual-card); [Maplerad Issuing API](https://maplerad.dev/docs/issuing); [Onafriq Card Issuing API](https://developers.onafriq.com/docs/card-issuance/o4s4drespbv5l-overview). These APIs are documented; programme access, market eligibility and regulatory approval remain gates.

## Open actions for BitoCard

- Ask Reloadly and DT One for live catalogue exports and written per-country reseller/account eligibility for the 21-market scope.
- Confirm Prestmit and Cardtonic API production access, commercial coverage, sell-card verification/payout countries, and whether resellers may connect their own credentials.
- Request written downstream-resale approval and supplier funding terms from each local utility supplier before implementing a customer-facing connection.
- Add a scheduled country/catalogue discovery job and a review queue for provider changes; store evidence and last-checked timestamps per offer.
- Extend `PLANS.md` registry with accepted vendors only after due diligence; keep candidates and active integrations as distinct statuses.
