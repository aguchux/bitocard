/**
 * Udozo's legal documents (docs/UDOZO_SPINOFF_PLAN.md, step 5 item 3): drafts for lawyers' review in each market,
 * describing what Udozo actually does. `legalVersion` is the date of the terms people accept before they post a listing
 * or use Safe pay (the API's `shopTermsVersion`): change both together when people must accept again.
 */

export const legalVersion = "2026-10-30";
/** Privacy and legal requests (to be set up). */
export const legalContact = "legal@udozo.com";
/** Help with an account, a listing or an order (to be set up). */
export const supportContact = "support@udozo.com";

/** The company that owns and operates Udozo (the owner's decision, 30 October 2026). */
export const operator = {
  name: "De-Golojan Technologies Ltd",
  number: "RC 1606658",
  address: "3 Agu Street, Upper Housing Estate Extension, Abakpa Nike, Enugu, Nigeria",
  law: "the laws of the Federal Republic of Nigeria",
};

export type LegalBlock = string | { list: string[] } | { table: { head: string[]; rows: string[][] } };
export type LegalSection = { id: string; heading: string; body: LegalBlock[] };
export type LegalDocument = { slug: string; title: string; summary: string; sections: LegalSection[] };

const whoWeAre = `Udozo is owned and operated by ${operator.name} (${operator.number}), ${operator.address} ("Udozo", "we", "us").`;

const terms: LegalDocument = {
  slug: "terms",
  title: "Terms of use",
  summary: "Your Udozo account, what Udozo does and does not do, listings, what may not be sold, chats, offers and the shop assistants.",
  sections: [
    {
      id: "about",
      heading: "1. About Udozo",
      body: [
        whoWeAre,
        "Udozo is a marketplace for buying and selling near you, at udozo.com. Sellers post listings and buyers contact them. Some sellers also let resellers sell their listings on the resellers' own stores, which Udozo hosts.",
        "These terms, the Safe pay rules and the privacy notice form one agreement between you and us. Sellers who run stores in Seller HQ also accept the seller terms. Where a document says more about one subject, that document applies to it.",
        "Udozo opens country by country. In a country where it is not open, nothing in these documents is an offer.",
      ],
    },
    {
      id: "role",
      heading: "2. What Udozo does, and does not do",
      body: [
        {
          list: [
            "We host listings and chats. We check listings, keep the marketplace safe and offer Safe pay.",
            "We are not the seller or the buyer. A sale is between the buyer and the seller. We do not own, inspect, store, value or deliver the items. We do not promise that an item is as described, that a seller will sell or that a buyer will pay.",
            "Safe pay is the one exception. When a buyer pays with Safe pay, we hold the money and pay it to the seller, or back to the buyer, as the Safe pay rules say. We still do not become the seller or inspect the item.",
            "A reseller's store is not the seller of the item either. The item is sold by the seller named on its page, and Udozo holds the money as for Safe pay.",
            "Paying directly is at your own risk. If you pay or are paid outside Safe pay, in cash, by transfer or any other way, we take no part in that payment and cannot get the money back.",
          ],
        },
      ],
    },
    {
      id: "account",
      heading: "3. Your account",
      body: [
        {
          list: [
            "You must be 18 or over. You need a confirmed email address, and a mobile number from your country, confirmed with a code we text you when you sign up (where we can text numbers in your country).",
            "One Udozo account works on udozo.com and on every reseller's store, with one wallet and one history of purchases. One person, one account: do not open accounts to get round a limit, a block or a suspension.",
            "Your country is fixed when you open your account. You buy and sell in your own country's market, in its currency. A reseller's store sells only to shoppers from its own country; others may look, but cannot buy there.",
            "Showing your phone number to buyers needs it confirmed with a code. Selling with Safe pay needs a passed identity check and a payout bank account in your verified name.",
            "Keep your password and codes secret. Udozo never asks for them in a chat, a call or a message.",
          ],
        },
      ],
    },
    {
      id: "wallet",
      heading: "4. Your wallet",
      body: [
        "Your Udozo wallet pays for Safe pay orders and purchases on resellers' stores. You top it up through our payment partners; we credit a top-up only once the partner confirms it. Money you top up can be spent on Udozo and its stores, but cannot be withdrawn or transferred. Refunds of orders paid from the wallet go back to it.",
        "Money from your own Safe pay sales is kept apart, and can be paid out to your bank account as the Safe pay rules say.",
      ],
    },
    {
      id: "listings",
      heading: "5. Posting a listing",
      body: [
        "As a seller you promise that:",
        {
          list: [
            "you own the item, or have the right to sell it, and it is yours to hand over;",
            "the listing is true and complete: the title, description, features, condition and photos describe the actual item, faults included, and the photos are of the item itself;",
            "the price is the price you will sell at, and a former price or discount is one you really offered;",
            "you list each item once, in the right category and area, and follow the law that applies to you and to the item, including consumer law if you sell as a business.",
          ],
        },
        "The rules for listings:",
        {
          list: [
            "No contact details or links. Titles and descriptions cannot contain web addresses, links or phone numbers. Buyers contact you through Udozo, and you choose whether they can see your confirmed phone number.",
            "Photos and video. Each listing needs at least the number of photos shown when you post it, and may have one short video. We remove the hidden details phones add, such as where a photo was taken.",
            "How long and how many. A listing is live for 30 days unless you renew it. There is a limit on how many listings you post in each category every 30 days, shown when you post.",
            "What is public. Live listings are public, on Udozo and in search engines: the title, description, features, photos, video, price, condition, the area you chose, and your first name and initial with your badges (for example a confirmed phone or a passed identity check). Never put anyone's personal details in a listing.",
            "Sold listings stay visible, marked sold, for about 30 days, then leave the market.",
            "Your content. You keep the rights in your words, photos and video. You give us a free, worldwide licence to host, show, resize and share them, including in previews on other sites and apps, to run and promote Udozo while the listing is live and for a reasonable time after.",
            "Listing is free for now. If we add paid features, we publish their prices and terms first, and you choose whether to use them.",
          ],
        },
      ],
    },
    {
      id: "prohibited",
      heading: "6. What may not be sold",
      body: [
        "You must not list, offer or ask for:",
        {
          list: [
            "weapons, ammunition, explosives and their parts, and anything designed to injure;",
            "illegal drugs, prescription-only and restricted medicines, and anything to make or take them;",
            "counterfeit, replica or fake goods, and anything that infringes someone else's trademark, copyright or other rights;",
            "stolen goods, or goods you cannot show you are entitled to sell;",
            "fake or copied money, cards or documents, stolen card or account details, and anything for fraud;",
            "financial products, investments, loans, crypto offers, gift card codes and money transfer services;",
            "protected or restricted animals and wildlife products, and any animal whose sale the law limits;",
            "adult content and sexual services;",
            "people, personal data, accounts, and anything else whose sale is illegal where you or the buyer are.",
          ],
        },
        "Some categories, such as vehicles, property and pets, have their own rules, shown when you post in them. If you are not sure, ask us before you post.",
      ],
    },
    {
      id: "moderation",
      heading: "7. Checks, removal and suspension",
      body: [
        {
          list: [
            "We check listings when they are posted or changed. Some checks are automatic: a listing using a word for an item that may never be sold is refused, and listings that look doubtful (for example a price far below similar listings, a photo another seller uses, many listings posted at once, or a new seller's first listings) wait for a person to review them.",
            "We may ask you to change a listing, refuse it, or remove a live one, if we think it breaks these terms or the law, or is unsafe for buyers. We tell you why.",
            "Anyone can report a listing, and buyers and sellers can report each other from a chat. We review reports. A moderator reads a chat only when it has been reported, or when it matters to a Safe pay dispute.",
            "If you break these terms, try to defraud anyone or put people at risk, we may suspend you or close your account, and your listings leave the market. Where the law requires it, we report it to the authorities.",
            `If you disagree with a decision, ask us through your account or email ${supportContact}, and a person will review it.`,
          ],
        },
      ],
    },
    {
      id: "chats",
      heading: "8. Chats, offers and phone numbers",
      body: [
        {
          list: [
            "Keep the conversation on Udozo. Chats protect both of you: we can see them if you report a problem. Be polite, honest and lawful. Do not send spam, links, threats or other people's personal details.",
            "Either side can offer a price in a chat. An offer lasts 48 hours unless it is accepted, declined, withdrawn or replaced first. An accepted offer is the price for Safe pay for 7 days. Accepting an offer says you will buy or sell at that price; it does not move any money.",
            "If a seller allows it, a signed-in buyer can ask to see the seller's confirmed phone number. We limit how many numbers a buyer can see each hour, and tell the seller how many people asked. Use a number only for the listing.",
            "You can block someone in a chat. They can then no longer write to you there.",
            "We keep chats for 12 months after their last message, longer while a report on them is open, then delete them with their photos.",
          ],
        },
      ],
    },
    {
      id: "safe-trade",
      heading: "9. Paying directly",
      body: [
        "Many people meet, look at the item and pay directly. We take no part in those payments and cannot recover money paid outside Safe pay. The Safe Trade Guide on udozo.com gives each category's checks. In short:",
        {
          list: [
            "meet in a busy public place in daylight, and bring someone if you can;",
            "inspect the item, and check it works, before you pay; check papers for vehicles and property;",
            'never pay a deposit, an "inspection fee" or a delivery charge in advance to someone you have not met;',
            "keep the chat on Udozo, and be wary of anyone who pushes you to another app, or to pay or be paid in a hurry;",
            "never share codes, passwords or card details: Udozo never asks for them;",
            "report anything suspicious from the listing or the chat.",
          ],
        },
        "The guide gives advice. It is not a promise that a trade will be safe, and following it does not make Udozo part of the sale.",
      ],
    },
    {
      id: "assistants",
      heading: "10. Shop assistants",
      body: [
        {
          list: [
            "An AI assistant, Anjio (or another named assistant in your country), answers questions about Udozo, finds and compares listings, and helps sellers write listings, price them and reply to buyers. It always says it is an AI assistant.",
            "It can be wrong. Check what it says against the listing and the seller. Price ranges come from similar listings on Udozo; they are not valuations, offers or guarantees.",
            "It never acts for you. It cannot buy, sell, pay, message anyone or change a listing. Its suggestions change nothing until you accept them, and you are responsible for what you post or send.",
            "Signed in, you can ask for a person at any time, and your conversation is passed to our support team.",
            "Do not tell it personal details it does not need. It hides numbers that look like phone numbers, card numbers or codes before they are sent. There is a daily limit on questions. The privacy notice says what is sent to the AI provider and how long we keep conversations.",
          ],
        },
      ],
    },
    {
      id: "rights",
      heading: "11. Consumer rights and our responsibility",
      body: [
        "If you buy from someone selling as a business, you have the rights consumer law gives you against them. Sellers who sell as a business must say so in their listings and follow consumer law. These terms do not take away any right the law gives you.",
        "We are responsible for running Safe pay as the Safe pay rules describe, and for holding and paying out its money correctly. We are not responsible for the items, for what buyers, sellers and resellers say or do, or for payments made outside Safe pay.",
        "Nothing in these terms limits a responsibility the law does not allow us to limit. The rest of our responsibility will be set out after lawyers' review in each market.",
      ],
    },
    {
      id: "changes",
      heading: "12. Changes",
      body: [
        "We may change these documents, for example when we open Udozo in a new country or add a feature. We tell you before a change that affects you takes effect, and ask you to accept the new version before you next post a listing or use Safe pay. An order already requested follows the terms and fees shown when it was asked for.",
      ],
    },
    {
      id: "law",
      heading: "13. Law and contact",
      body: [
        `This draft is governed by ${operator.law}; the governing law for each market will be confirmed after lawyers' review. Tell us first: most problems are put right there. You keep any rights you have under the law where you live.`,
        `Ask for help from your account, or email ${supportContact}. For privacy and legal requests, email ${legalContact}.`,
      ],
    },
  ],
};

const safePay: LegalDocument = {
  slug: "safe-pay",
  title: "Safe pay rules",
  summary: "How Safe pay holds the money: the steps and deadlines, fees, delivery, refunds, releases, payouts, disputes, and buying on a reseller's store.",
  sections: [
    {
      id: "about",
      heading: "1. What Safe pay is",
      body: [
        "Safe pay lets a buyer pay through Udozo, which holds the money until the buyer has the item. It is the buyer's choice on each purchase, offered where we have opened it in your country. Purchases on resellers' stores always use it.",
        "Safe pay is not taking real payments in any country yet. Udozo collects, holds and refunds Safe pay money through licensed payment partners. It opens in a country only once lawyers have confirmed what that country's law requires.",
        "The deadlines below are those set for Nigeria. Each country's own are shown before anyone commits.",
      ],
    },
    {
      id: "steps",
      heading: "2. How it works",
      body: [
        {
          list: [
            "The buyer asks to buy with Safe pay, at the listed price or a price the seller accepted in a chat in the last 7 days. They choose to meet in person, where the seller hands over in person, or delivery, where the seller delivers. They see the price, any delivery charge, their fee and the total first.",
            "The seller accepts or declines within 24 hours. To accept, a seller must have passed our identity check and added a payout bank account in their verified name.",
            "The buyer pays the total from their Udozo wallet within 24 hours. We hold it, and the listing shows as reserved.",
            "The hand-over, within 5 days. Meeting in person: the buyer gets a 6-digit release code. When they have the item and are happy with it, they give the code to the seller, who enters it to be paid. Buyers: never give the code before you have the item. Five wrong codes lock the release until we help.",
            "Delivery: see section 3.",
            "We release the money to the seller, and the listing is marked sold.",
          ],
        },
      ],
    },
    {
      id: "delivery",
      heading: "3. Delivery and shipping",
      body: [
        {
          list: [
            "A seller who delivers sets the delivery charge in the listing: within their state and elsewhere, or free. It goes to the seller in full once the buyer has the item, and is refunded with the order if the item never arrives.",
            "The seller sees the delivery address once the buyer has paid.",
            "Before sending, the seller photographs the item and the sealed parcel: at least two photos and at most eight, kept private to the order and to us.",
            "The seller sends it by courier, marks it sent with the courier and tracking number (and a tracking link where the courier gives one), then keeps the tracking up to date.",
            "Once it is delivered, the buyer confirms it arrived in good condition, or opens a dispute, within 3 days. If they do neither, the money is released to the seller.",
            "A parcel never reported delivered is released after the country's longest transit time (7 days in Nigeria) plus that confirmation time, unless the buyer opens a dispute.",
            "The item is the seller's responsibility until the buyer has it. Loss or damage on the way is the seller's to put right. The photos and tracking help us decide any dispute.",
          ],
        },
      ],
    },
    {
      id: "fees",
      heading: "4. Fees",
      body: [
        {
          list: [
            "Safe pay has a fee for the buyer and a fee for the seller. Each is a percentage of the price, up to a maximum amount, set for each country and shown before anyone commits. The fees fixed when the buyer asks are the ones for that order.",
            "The buyer pays their fee with the price. It is refunded with the price if the item does not change hands: a cancellation, a seller who does not hand over in time, or a dispute decided with a full refund.",
            "The seller's fee is taken only from money released to them: from the price, or from the part released after a dispute.",
          ],
        },
      ],
    },
    {
      id: "cancelling",
      heading: "5. Cancelling, deadlines and refunds",
      body: [
        {
          list: [
            "Before the buyer pays, either side can cancel, and nothing is charged. A request not answered, or an accepted order not paid, in time ends by itself.",
            "Once paid, either side can cancel until the hand-over, and the buyer is refunded in full, their fee included. A delivery that has been sent cannot be cancelled: the buyer confirms it or opens a dispute.",
            "If the seller does not hand over in time, the order is cancelled and the buyer refunded in full.",
            "Refunds go back to the buyer's Udozo wallet, which paid for the order.",
          ],
        },
      ],
    },
    {
      id: "release",
      heading: "6. Releases and payouts",
      body: [
        {
          list: [
            "Released money, the price less the seller's fee plus any delivery charge, goes to the seller's sales money in their account.",
            "It can be paid out to the seller's bank account, in the name their identity check verified, once the payout hold for their country has passed, above the minimum for their country. The hold lets a payment that is later reversed still be put right. A new bank account can be used 24 hours after it is added, and you can have at most three.",
            "When a buyer paid with money topped up by card or mobile money in the last 60 days, payments that can be reversed, we may check the payment before the seller can withdraw it. We tell the seller when it is ready.",
            "A release is final. Once the code is entered, the delivery is confirmed or the confirmation time has passed, the money is the seller's, and we cannot take it back for the buyer, except where a payment is reversed or the law requires it.",
          ],
        },
      ],
    },
    {
      id: "disputes",
      heading: "7. Disputes",
      body: [
        "Before the money is released, the buyer can open a dispute: the item did not arrive, is not as described or is damaged. The money stays held. Both sides add their side, with photos, in the dispute.",
        "Udozo decides, from what both sides give us, the listing and the chat: a full refund to the buyer, a part refund with the rest released to the seller, or release to the seller. We do not inspect items. Our decision settles where the Safe pay money goes. It does not stop either of you using your legal rights against the other.",
      ],
    },
    {
      id: "protection",
      heading: "8. Protecting Safe pay",
      body: [
        {
          list: [
            "The same person cannot be the buyer and the seller. We compare identity checks and payout accounts to stop it, and refuse those orders.",
            "A seller new to Safe pay can sell up to a limit for their first five sales.",
            "Cancelling after accepting, not handing over in time, and disputes decided against the seller each count as a strike. A seller with 3 strikes in 90 days cannot take Safe pay orders until we review it.",
            "We may refuse, hold or reverse a Safe pay order, and report it, where we suspect fraud, money laundering or a breach of these rules.",
          ],
        },
      ],
    },
    {
      id: "stores",
      heading: "9. Buying on a reseller's store",
      body: [
        "Sellers can let resellers sell their listings on the resellers' own stores. The seller who wrote the listing (the supplier) is the seller of the item and is named on its page. The reseller's store is where it was bought.",
        {
          list: [
            "The buyer pays from their Udozo wallet. The money is locked in the wallet until the supplier accepts the order, within 24 hours. If the supplier declines or does not answer in time, the money is unlocked; not answering counts as the supplier's strike. A supplier may choose to accept orders automatically.",
            "Once accepted, the money is held by Udozo as for any Safe pay order, and the steps, deadlines, delivery rules and disputes above apply.",
            "On release, the money is split three ways: the supplier receives their price less the reseller's discount, less their Safe pay fee, plus any delivery charge; the reseller receives the rest of the price, less our fee on it; and Udozo keeps its fees. After a part refund, what remains is shared between the supplier and the reseller in proportion to what each would have received.",
            "The supplier and the reseller both answer the buyer in the order's chat. The buyer sees every message as from the store. The supplier and the reseller also have a thread of their own about the order, which the buyer never sees.",
            "Once the supplier accepts, the supplier and the reseller see the buyer's name, confirmed phone number, email and delivery address, to hand over or deliver the item, until 30 days after the order ends. We record each time they are opened.",
            "The reseller can cancel an order before it is handed over or shipped; the buyer gets all their money back.",
            "In a dispute, the supplier and the reseller both take part. When we uphold a dispute, we decide whose fault it was: the supplier's (the item or its delivery was not as the listing said) or the reseller's (their note, store or messages misled the buyer). It counts as that person's strike.",
            "A buyer can report the store from their order, for example for claiming to own or make the items, asking for payment outside Udozo or misusing their details. We review each report and tell the buyer what we decided.",
          ],
        },
      ],
    },
    {
      id: "changes",
      heading: "10. Changes",
      body: ["Changes never apply to an order already requested: it follows the rules and fees shown when the buyer asked."],
    },
  ],
};

const sellers: LegalDocument = {
  slug: "sellers",
  title: "Seller terms",
  summary: "Seller HQ: every feature with no setup fee or monthly plan, your wallet and invoices, your stores and domains, reselling suppliers' listings, strikes, payouts and closing.",
  sections: [
    {
      id: "about",
      heading: "1. About these terms",
      body: [
        whoWeAre,
        "These terms apply when you open a seller account on Seller HQ (shq.udozo.com) and sell suppliers' listings on your own stores. They sit alongside the terms of use, the Safe pay rules and the privacy notice.",
        `"You" means the business that holds the account, and includes the people you add to your team. "Suppliers" are Udozo sellers who open their listings to resellers. Some features are open only in some countries or on some plans; a section describes one only once we switch it on for you.`,
      ],
    },
    {
      id: "account",
      heading: "2. Your account and checks",
      body: [
        {
          list: [
            "You must be a business, or a person acting in the course of business, 18 or over, and based in a country where we accept sellers. Your country is fixed when you sign up, and you trade in its currency. You give the owner's mobile number from that country, confirmed with a code we text it when you sign up (where we can text numbers there).",
            "Before your stores can take live orders, your business passes our business check on Udozo Verify (verify.udozo.com). If your business is unregistered, the owner's own identity check is the business check. If it is registered, you give us its registration certificate, proof of its address and a document naming its directors or owners. We may ask for more, refuse an account, or keep it in test mode.",
            "Everything you give us must be true, complete and yours to give. A false or borrowed document, or someone else's identity, ends your account, and we may report it.",
            "You may invite staff and give them roles. You are responsible for everything done in your account, by you, your team or anyone using your sign-in details or API keys. Keep them secret, and tell us at once if you think one has been misused.",
            "Test mode lets you try Seller HQ with test money and test orders. Nothing in test mode is real.",
          ],
        },
      ],
    },
    {
      id: "model",
      heading: "3. How reselling works",
      body: [
        {
          list: [
            "The supplier owns and sells the item. The supplier is the seller of the item and gets it to your buyer. Your store is where it was bought. You never own or hold the item, and never hold your buyer's money: Udozo holds it until the buyer has the item.",
            "Your catalogue lists suppliers' listings from your own country. Your stores sell only to shoppers from your country.",
            "You earn the difference between your price and what the supplier receives, less our fee on it, as the Safe pay rules describe. It is added to your earnings when the order is released.",
          ],
        },
      ],
    },
    {
      id: "setup-fee",
      heading: "4. No setup fee",
      body: ["Opening a seller account and taking your stores live is free: there is no setup fee."],
    },
    {
      id: "plans",
      heading: "5. Every feature, no monthly charge",
      body: [
        {
          list: [
            "Every store has every Seller HQ feature: your own domains, your brand alone on your store's pages, store traffic, your team and chat with us. There is no plan to choose and no monthly charge.",
            "If we introduce a setup fee or paid plans, we will tell you in Seller HQ and by email at least 30 days before anything is charged, with the prices and what would change. You can close your account before then.",
          ],
        },
      ],
    },
    {
      id: "charges",
      heading: "6. What you pay for",
      body: [
        {
          list: [
            "You pay for what you buy in Seller HQ, such as domains (section 9), and our fee on your resale earnings (section 3).",
            "We show every price before you confirm.",
          ],
        },
      ],
    },
    {
      id: "wallet",
      heading: "7. Your wallet, invoices and what you owe",
      body: [
        {
          list: [
            "You have a wallet in your country's currency and one in US dollars, and can move money between them at the rate we show before you confirm. Your country's wallet pays for domains and anything else you buy from us; when it is short, we may use dollars you topped up to cover the difference.",
            "Money you top up can only be spent on what you buy from Udozo and what you owe. It cannot be withdrawn or paid out.",
            "Each store has a monthly invoice, and your account one for what is not tied to a store, listing every charge. Each charge is taken from your wallet when it happens.",
            "When your wallet cannot cover a usage charge, the rest is owed to us, up to your credit limit. It starts at US$10. Once you have paid a full month's invoice in full and owe nothing, you can raise it a step at a time in Seller HQ, up to US$100. An invoice unpaid after its due date lowers it a step. At the limit, usage we would charge for, such as buying or renewing domains, stops until you pay. Your next top-ups pay what you owe first.",
            "If we credit your wallet by mistake, or a payment we credited is reversed, we may correct your balance. Your balance is not a bank account and earns no interest.",
          ],
        },
      ],
    },
    {
      id: "payouts",
      heading: "8. Your earnings and payouts",
      body: [
        {
          list: [
            "Your earnings from released orders become withdrawable once the payout hold for your country has passed, so that a reversed payment can still be put right.",
            "You can withdraw them to a bank account in your business's or verified owner's name, or, where we offer it, to a mobile money wallet on one of the owner's own confirmed phone numbers, above the minimum for your country. A new payout account can be used 24 hours after it is added. Only the account's owner adds one.",
            "The mobile money provider's fee comes out of the amount you withdraw; Seller HQ shows what will arrive before you confirm. Money sent to the wallet you chose cannot be recalled by us.",
          ],
        },
      ],
    },
    {
      id: "stores",
      heading: "9. Your stores and domains",
      body: [
        {
          list: [
            "You can run any number of stores, each with its own name, address and design. These terms apply to all of them.",
            "Each store starts as a test store on its own address on udozo.com (for example yourstore.udozo.com). That address is for testing only: orders there are practice, and no real money moves. You do not own it, and it ends when the store is closed. We may refuse or change a name that is misleading, offensive, infringes someone's rights or is reserved.",
            "A store goes live only on its own domain, once your business check has passed. Once live, its udozo.com address sends visitors to the domain. If the store loses its last working domain (expired, suspended or disconnected), it goes back to test mode and we tell you.",
            "You can connect a domain you already own. You must own or control it, and you remain responsible for it.",
            "You can buy a domain through Seller HQ. We buy it from our registrar partner in your name and contact details: you are its registrant and own it, under the registrar's terms and the rules of its ending. Give true contact details; the registrar may email you to confirm them, and may suspend the domain if you do not.",
            "We show the first year's price and the renewal price together before you buy. A domain is not refundable once registered.",
            "We remind you before a domain expires. With automatic renewal on, we renew it for a year from your wallet about 14 days before it expires. If your wallet cannot pay, we tell you and try again. An expired domain stops serving your store, and after the registrar's grace period it can be lost for good.",
            "You can ask for a domain's transfer code in Seller HQ, subject to the registrar's rules, and move it to another registrar.",
            "We may suspend a domain, or ask the registrar to, if it is used for fraud, phishing, spam, malware or anything unlawful.",
          ],
        },
      ],
    },
    {
      id: "reselling",
      heading: "10. Reselling suppliers' listings",
      body: [
        {
          list: [
            "Never present yourself as the owner or maker. Your store shows each listing exactly as its supplier wrote it, with the supplier's name and a link to their page, and you cannot change it. Do not claim, anywhere on your store or to buyers, to own, make or stock the items, or say anything about them the supplier did not say. Breaking this is a strike, and repeated, we suspend your reselling or your account.",
            "Your one note per listing shows only once the supplier approves its exact words, and they can take that approval back. It must be plain words, with no links, phone numbers, email addresses or handles.",
            "You sell from the supplier's price, or a lower floor they agree in a deal, up to their markup limit, and never above our markup cap for your country. A price set as a markup follows the supplier's price. A fixed price that falls outside the limits after a change stops selling until you reprice it.",
            "A deal a supplier offers applies once you accept it, to new orders only, and either of you can end it.",
            "A supplier can pause a listing, end its resale or stop you reselling their listings at any time. Their listings then leave your stores at once; orders already paid continue.",
            "Your chat with a supplier stays on Udozo, and you see each other's confirmed phone numbers. Use them only for your work together. Never ask a supplier, or let a buyer, pay outside Udozo for an item sold through your store.",
          ],
        },
      ],
    },
    {
      id: "orders",
      heading: "11. Orders and your buyers",
      body: [
        {
          list: [
            "Your buyers pay only from their Udozo wallet, as the Safe pay rules describe. Nothing is yours before the order is released.",
            "You and the supplier both write to the buyer in the order's chat, and the buyer sees every message as from your store. No links, bank details or requests to pay outside Udozo.",
            "Once the supplier accepts, you see the buyer's name, phone number, email and delivery address. Use them only for that order, never for anything else, and only until 30 days after it ends. We record every time they are opened.",
            "You can cancel an order before it is handed over or shipped; the buyer gets all their money back. Each cancellation counts as a strike.",
            "If a buyer disputes an order, you take part with the supplier. Tell us honestly what your store and its note said. We decide, and our decision is final on Udozo, without affecting anyone's legal rights.",
          ],
        },
      ],
    },
    {
      id: "strikes",
      heading: "12. Strikes and reports of your store",
      body: [
        {
          list: [
            "Buyers and suppliers can report your store, for example for claiming to own or make the items, saying what the supplier did not, asking for payment outside Udozo or misusing a buyer's details. We review each report and tell you if we uphold it.",
            "Cancellations, disputes lost because of your store, and upheld reports each count as a strike. They count together over 90 days. At the limit for your country (3 today), your stores cannot take orders until we review it; orders already paid continue.",
            "Repeated or serious breaches can end your reselling or your account.",
          ],
        },
      ],
    },
    {
      id: "content",
      heading: "13. What you publish on your stores",
      body: [
        "You can write your stores' words, upload logos and images and arrange their pages. You are responsible for all of it. Everything you publish must:",
        {
          list: [
            "be yours to use: you own, or have permission to use, every logo, image, name and text;",
            "be honest: no misleading claims about items, prices, delivery or availability, and no claim that Udozo or a brand endorses you;",
            "contain no one's personal data, and never ID documents or card details;",
            "be lawful and decent: nothing illegal, hateful, violent, sexual, defamatory, threatening or harmful to children, no malicious code, and no attempt to collect sign-in or payment details;",
            "keep buyers on Udozo's checkout: never ask them to pay or contact you outside the store for an order placed through it.",
          ],
        },
        "Some words claiming ownership of items are refused when you save or publish a page. You give us a worldwide, royalty-free licence to host, copy, resize, display and deliver what you publish, only to run your stores. You keep ownership, and the licence ends when you remove it or close the store, apart from copies the law or short-lived backups keep.",
        "We may review what you publish at any time. If it breaks these terms or the law, or someone credibly complains, we may remove it, unpublish a page or suspend the store, and tell you why unless the law prevents us. If a claim is made against us because of what you published, you must cover our reasonable costs of dealing with it.",
      ],
    },
    {
      id: "api",
      heading: "14. Using our API",
      body: [
        {
          list: [
            "Each API key and webhook endpoint belongs to one of your stores. Keep keys and webhook secrets secret, use only the permissions you need, and replace a key you think has leaked.",
            "Verify our webhooks' signatures, and treat our API, not a webhook, as the record of an order. Buyers' details are never sent in webhooks.",
            "Stay within our rate limits, and do not test our security, scrape the catalogue for others or resell API access.",
          ],
        },
      ],
    },
    {
      id: "not-allowed",
      heading: "15. Things you must not do",
      body: [
        {
          list: [
            "Break the law, including consumer, tax, sanctions, anti-money laundering, data protection and advertising laws.",
            "Use stolen payments or identities, or create orders or accounts to abuse a promotion or a free domain.",
            "Help anyone get around our checks or limits, or interfere with Udozo, suppliers, other sellers or buyers.",
          ],
        },
        "We may refuse an order, hold money we reasonably believe is linked to fraud or a breach of these terms while we investigate, and report suspicious activity where the law requires it.",
      ],
    },
    {
      id: "closing",
      heading: "16. Suspension and closing",
      body: [
        {
          list: [
            "You can close your account once your orders and disputes are settled.",
            "We may suspend your account or a store at once if you break these terms, if the law or a regulator requires it, or to protect buyers, suppliers or Udozo. We tell you why unless the law prevents us, and lift it when the reason has gone.",
            "We may end these terms with 30 days' notice, or at once for a serious breach.",
            "When your account closes, your stores go offline. We pay out your withdrawable earnings after the payout hold, less what you owe us. Money you topped up is spent only on what you owe. Domains you bought stay yours to transfer.",
          ],
        },
      ],
    },
    {
      id: "law",
      heading: "17. Responsibility, changes and law",
      body: [
        "We run Seller HQ with reasonable care and skill. We are not responsible for what suppliers or buyers do, or for registrars and payment partners failing, beyond putting right what we can. Nothing in these terms limits a responsibility the law does not allow us to limit; the rest will be set out after lawyers' review in each market.",
        "We tell you in Seller HQ or by email at least 30 days before a change that is not in your favour takes effect, unless the law requires it sooner. If you do not agree, you may close your account before it does.",
        `This draft is governed by ${operator.law}; the governing law for each market will be confirmed after lawyers' review. Questions: ${supportContact}; legal and privacy requests: ${legalContact}.`,
      ],
    },
  ],
};

const privacy: LegalDocument = {
  slug: "privacy",
  title: "Privacy notice",
  summary: "What personal data Udozo keeps, why, who sees it, where, for how long, and your rights.",
  sections: [
    {
      id: "who",
      heading: "1. Who we are",
      body: [
        whoWeAre,
        `This notice covers udozo.com, resellers' stores hosted by Udozo (on udozo.com addresses and their own domains), Seller HQ (shq.udozo.com) and Udozo Verify (verify.udozo.com). We decide how your personal data is used: we are its controller. Write to us at ${legalContact}.`,
      ],
    },
    {
      id: "what",
      heading: "2. What we keep",
      body: [
        {
          list: [
            "Your account: name, email address, country, password (only as a one-way hash), your mobile number (confirmed with a code we text you when you sign up, where we can text numbers in your country), when you signed in, failed sign-ins, and the codes we email or text you (only as hashes).",
            "Your listings: title, description, features, price and its changes, condition, category, the area you chose, photos and video, how you deliver, and how many people contacted you. Live listings are public, with your first name and the first letter of your last name and your badges. We remove the hidden details phones add to photos and videos, and keep a one-way fingerprint of each photo to spot photos copied from another listing.",
            "Chats: messages, photos (encrypted, in private storage, seen only by the two of you), offers, when each side read them, blocks, and how fast sellers reply. A moderator reads a chat only when one of you reports it, or when it matters to a Safe pay dispute, and each reading is recorded.",
            "Interest in listings: the listings you save, and that you asked to see a seller's phone number or started a chat.",
            "Reports and safety: reports you make or that are made about you, our checks and reviews of listings, strikes and any suspension, with its reason.",
            "Your wallet and payments: top-ups, purchases, refunds and payouts. You pay on our payment partner's page; we never receive your full card number, card security code or mobile money PIN.",
            "Safe pay orders: the item, price, both fees, the hand-over, the delivery address (encrypted, shown only to the seller once the buyer has paid), the release code (encrypted, shown only to the buyer), the seller's dispatch photos (encrypted, in private storage), the courier and tracking, the deadlines, and who ended the order and why.",
            "Orders on a reseller's store: what is kept for a Safe pay order, plus the store, the price figures each side is paid, your confirmed phone number when you bought (encrypted), the listing and the store's note as you saw them, the order's chat with the store, and the supplier and reseller's own thread about it. We record each time your details are opened.",
            "Disputes: the reason, everyone's messages and photos (encrypted, in private storage), our decision and, on a store's order, whose fault an upheld dispute was.",
            "Reports of a reseller's store: who reported it, the store, the reason, what was written, the order, and our decision. Only Udozo sees who made a report.",
            "Payout accounts: the bank (account name, and the number kept encrypted) or mobile money number, when it was added, and each payout's amount, status and reference.",
            "Shop assistants: your questions, the answers, the listings it showed and what it looked up, your ratings and reports of answers. To limit questions from one place each day, a one-way code of your IP address that changes every day.",
            "Help: your chats and questions with our team, and, if you chat without signing in, the name and email address you give.",
            "Sellers on Seller HQ: your business's details and checks, your team, your stores, what you publish on them, your wallets, invoices and payouts, your API keys (only as hashes) and webhooks, and for domains you buy, the registrant details you give.",
            "Devices: for Seller HQ and our team, the browsers where you turned on notifications (the browser's push address and keys, encrypted).",
            "Technical data: your IP address, used for rate limits and security, and the requests your browser makes, in our server logs.",
          ],
        },
        'We do not collect your precise location: "Use my location" on udozo.com finds the nearest area in your browser, and your position is never sent to us. We use no analytics, advertising or tracking cookies.',
      ],
    },
    {
      id: "identity-checks",
      heading: "3. Identity checks",
      body: [
        "Before you sell with Safe pay, are paid out, or run stores, Udozo Verify (verify.udozo.com) checks your identity: your name, date of birth, your ID document's type, number and photos, a selfie, and short photos taken by your camera while you follow on-screen steps. A registered business also gives its registration documents.",
        "Comparing your face with your ID uses biometric data, so we ask for your explicit consent first. Without it we cannot check you, and you cannot use what needs the check.",
        "Photos are stripped of hidden data, such as location, encrypted, and stored privately in the United States. A person on Udozo's team reviews them. ID numbers are encrypted, and a keyed fingerprint of them shows our reviewers when the same ID is used on another account. We keep the outcome, your verified name and your document's country.",
      ],
    },
    {
      id: "ai",
      heading: "4. AI providers",
      body: [
        "A shop assistant's answers are written by Anthropic, OpenAI or DeepSeek, whichever runs that assistant. We send it your question and the conversation so far, Udozo's own information for your country, and the public details of the listings it looks up. Signed in, it can also look up your own listings, your Safe pay orders (never codes) and which of your chats are waiting for a reply (never their messages).",
        "We send more only when you ask: a seller's own listing and its photos when they ask it to fill in a listing from its photos (only to Anthropic or OpenAI: DeepSeek is never sent photos), and the latest messages of a chat when a seller asks it to suggest a reply. Before anything is sent, numbers that look like phone, card or account numbers, codes and passwords are hidden, and we never send your email address, phone number, delivery address or payment details.",
      ],
    },
    {
      id: "why",
      heading: "5. Why we use it",
      body: [
        {
          table: {
            head: ["What for", "Our reason"],
            rows: [
              ["Running your account, listings, chats, offers, wallet and orders, and helping you", "Our contract with you"],
              ["Safe pay: holding money, releasing or refunding it, deciding disputes", "Our contract with you"],
              ["Identity checks with biometric data", "Your explicit consent, and the law on knowing who we pay"],
              ["Keeping Udozo safe: checking listings, reports, strikes, same-person checks and limits", "Our legitimate interest in a safe marketplace and in preventing fraud, and the law where we must report"],
              ["Shop assistants, and reviewing their answers to improve them", "Our legitimate interest in helping people use Udozo, and our contract with you"],
              ["Running Seller HQ, stores, domains, invoices and payouts", "Our contract with sellers"],
              ["Accounting and tax records", "The law"],
            ],
          },
        },
        "Some decisions are made automatically: refusing a listing that uses a word for an item that may never be sold, refusing store pages that claim to own the items, refusing a Safe pay order whose buyer and seller our checks show are the same person, limits, and pausing a seller or store at the strike limit. A person on Udozo's team reviews them if you ask.",
      ],
    },
    {
      id: "who-sees",
      heading: "6. Who sees it",
      body: [
        {
          list: [
            "The public: live listings, including in search engines and in previews when a link is shared.",
            "The other person in a chat: your first name and initial, your messages and offers. A seller sees a Safe pay buyer's delivery address once they have paid. On a reseller's store, the supplier and the reseller see the buyer's name, phone number, email and address once the supplier accepts, and the courier the seller chooses receives the delivery address.",
            "Udozo's team, as their work needs.",
            "Service providers working for us: Neon (database, United States), DigitalOcean (servers and file storage, United States), Upstash (cache and rate limits), Vercel (hosting our sites, and the registrar for domains sellers buy, which receives the registrant's details), Cloudflare (our domain's DNS and the network in front of our API), Resend and MailerSend (email), Termii and Africa's Talking (text messages), our payment partners Paystack, Flutterwave, pawaPay and Stripe (payments, refunds and payouts, depending on your country and method), Anthropic, OpenAI and DeepSeek (shop assistants, as section 4 says; DeepSeek processes what it is sent in China), Google (signing in to Seller HQ with Google), and browser push services (Google, Mozilla, Apple, Microsoft) for Seller HQ's notifications.",
            "Authorities, where the law requires it.",
          ],
        },
        "We do not sell your personal data, and we do not use it for advertising.",
      ],
    },
    {
      id: "where",
      heading: "7. Where it is stored",
      body: ["Your data is stored in the United States. What a shop assistant run by DeepSeek is sent (section 4) is processed in China. Where it leaves your country, we use the safeguards your country's law requires; these are being confirmed with lawyers in each market."],
    },
    {
      id: "retention",
      heading: "8. How long we keep it",
      body: [
        {
          table: {
            head: ["What", "How long"],
            rows: [
              ["Listings", "Public while live (sold ones for about 30 days after), then kept, not public, while your account is open and with the records of any order or report about them. A draft is deleted when you delete it."],
              ["Chats with buyers and sellers", "12 months after their last message, with their photos, unless a report on them is still open."],
              ["Shop assistant conversations", "30 days after their last message, with the daily codes kept with them."],
              ["Safe pay and store orders, disputes, store reports and payouts", "As long as accounting and tax laws require, usually six years after the order."],
              ["Order chats on a reseller's store", "12 months after the order ends."],
              ["Buyers' details on store orders", "Shown to the supplier and reseller until 30 days after the order ends."],
              ["Identity documents and photos", "Deleted 90 days after a check is declined, and a week after an unfinished one is left. For an approved check, five years (to be confirmed with lawyers)."],
              ["Chats and questions with our team", "Chats 12 months after they end; questions two years after they are resolved."],
              ["Your account", "While it is open. Ask us to close it; we then delete your account details within 30 days, apart from the records above."],
              ["Server and security logs", "A short time, usually no longer than 30 days."],
            ],
          },
        },
      ],
    },
    {
      id: "rights",
      heading: "9. Your rights",
      body: [
        `Depending on where you live, you can ask for a copy of your data, to correct it, to delete it, to restrict or object to its use, to move it, and to withdraw consent (for identity checks, before the check is decided). Email ${legalContact}; we answer within a month. Some data must be kept by law even if you ask us to delete it.`,
        "You can complain to your country's data protection authority, for example Nigeria's Data Protection Commission (NDPC), Ghana's Data Protection Commission (DPC) or Kenya's Office of the Data Protection Commissioner (ODPC).",
      ],
    },
    {
      id: "children",
      heading: "10. Children",
      body: ["Udozo is for adults only. We do not knowingly keep data about anyone under 18; we close such accounts when we find them."],
    },
    {
      id: "changes",
      heading: "11. Changes",
      body: ["We update this notice when what we do changes, and tell you of important changes before they apply."],
    },
  ],
};

const cookies: LegalDocument = {
  slug: "cookies",
  title: "Cookie notice",
  summary: "The few cookies and browser storage Udozo's sites use, all needed for them to work.",
  sections: [
    {
      id: "cookies",
      heading: "1. Cookies",
      body: [
        "Udozo uses only cookies that are strictly necessary, so it asks for no consent. It uses no analytics, advertising or tracking cookies.",
        {
          table: {
            head: ["Name", "Site", "What for", "Kept"],
            rows: [
              ["udz_customer", "udozo.com, and each reseller's store on its own address", "Keeps you signed in. Each site keeps its own.", "30 days"],
              ["udz_assistant", "udozo.com", "Keeps your conversation with the shop assistant when you are not signed in", "30 days"],
              ["udz_session", "Seller HQ (shq.udozo.com), shared across udozo.com addresses", "Keeps sellers and their team signed in", "30 days"],
              ["udz_admin_session", "Udozo's admin", "Keeps Udozo's team signed in", "12 hours"],
              ["udz_kyc", "verify.udozo.com", "Keeps your identity check open while you do it", "Two hours"],
            ],
          },
        },
      ],
    },
    {
      id: "storage",
      heading: "2. Browser storage",
      body: [
        "Some choices are remembered in your browser itself, never sent to us:",
        {
          table: {
            head: ["Name", "Site", "What for", "Kept"],
            rows: [
              ["udz_assistant_language", "udozo.com", "The language you chose for the shop assistant", "Until you clear it"],
              ["assistant:draft:<listing>", "udozo.com", "Carries a message the shop assistant drafted into the listing's chat", "Until it is used, or the tab closes"],
              ["bc_install, bc_install_visit", "udozo.com, Seller HQ", "When you were last offered the site as an app, and that you were asked on this visit", "Until you clear it; for one visit"],
              ["udozo-shq-reseller, udozo-shq-mode", "Seller HQ", "Which seller account you work in, and live or test mode", "Until you clear it"],
              ["udozo-shq.checklist.dismissed.<account>", "Seller HQ", "That you hid the getting-started checklist", "Until you clear it"],
              ["bc_push:<who>", "Seller HQ, Udozo's admin", "That you turned notifications on in this browser", "Until you turn them off"],
              ["bitocard-admin-mode", "Udozo's admin", "Live or test figures, for Udozo's team", "Until you clear it"],
            ],
          },
        },
        "The sites' service workers keep a page to show when you have no connection. You can clear all of this at any time in your browser's settings; signing out removes your session cookie.",
      ],
    },
  ],
};

export const legalDocuments: LegalDocument[] = [terms, safePay, sellers, privacy, cookies];
export const legalDocument = (slug: string) => legalDocuments.find(doc => doc.slug === slug) ?? null;
