/**
 * Udozo's legal documents (docs/UDOZO_SPINOFF_PLAN.md, step 5 item 3), describing what Udozo actually does now that it
 * is live and takes real payments. `legalVersion` is the date of the terms people accept before they post a listing
 * or use Safe pay (the API's `shopTermsVersion`): change both together when people must accept again.
 */

export const legalVersion = "2026-11-05";
/** Privacy and legal requests. */
export const legalContact = "legal@udozo.com";
/** Help with an account, a listing or an order. */
export const supportContact = "support@udozo.com";

/** The company that owns and operates Udozo (the owner's decision, 30 October 2026). */
export const operator = {
  name: "De-Golojan Technologies Ltd",
  number: "RC 1606658",
  law: "the laws of the Federal Republic of Nigeria",
};

export type LegalBlock = string | { list: string[] } | { table: { head: string[]; rows: string[][] } };
export type LegalSection = { id: string; heading: string; body: LegalBlock[] };
export type LegalDocument = { slug: string; title: string; summary: string; sections: LegalSection[] };

const whoWeAre = `Udozo is owned and operated by ${operator.name} (${operator.number}) ("Udozo", "we", "us").`;

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
        "How listings are shown. Search results come in the order you choose (best match, newest or price), nearest to you first. On the home pages:",
        {
          list: [
            "Sponsored listings are placed by Udozo's team, sometimes because a seller paid Udozo, and are always labelled Sponsored. Nothing else moves a listing up for payment.",
            "Trending ranks recent listings by how many people contacted, saved and viewed them.",
            "Some rows show listings or stores Udozo's team picked by hand to show what is on Udozo. Nobody pays for these; a store or listing is only picked while it is live.",
            "Trending deals are listings whose price came down, shown beside the lowest price they had in the 30 days before.",
            "Top selling ranks listings by Safe pay sales completed in the last 30 days. Until enough have sold, the most contacted listings show instead, titled Popular, never as sales.",
            "For you, Recently viewed, Because you searched and Price dropped are chosen for you from your own activity on Udozo: the listings you looked at, saved and contacted, and what you searched for. Without that activity, or if you turn personalisation off, For you shows what is popular. People also viewed shows listings that others who looked at a listing looked at too.",
            "Personalisation only changes the order of listings that are already on Udozo for you to see. Sponsored listings stay labelled, and nothing moves up because anyone paid. You can turn personalisation off, and clear what Udozo remembers, under Account, Privacy.",
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
            "You must be 18 or over. You need a confirmed email address, and a mobile number from your country. You confirm the number later, with a code we text it, from your profile (where we can text numbers in your country).",
            "One Udozo account works on udozo.com and on every reseller's store, with one wallet and one history of purchases. One person, one account: do not open accounts to get round a limit, a block or a suspension.",
            "Your country is fixed when you open your account. You buy and sell in your own country's market, in its currency. A reseller's store sells only to shoppers from its own country; others may look, but cannot buy there.",
            "Sharing your phone number with a buyer who asks for it needs it confirmed with a code. Selling with Safe pay needs a passed identity check and a payout bank account in your verified name.",
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
            "What is public. Live listings are public, on Udozo and in search engines: the title, description, features, photos, video, price, condition, the area you chose, and your first name and initial with your badges (for example a confirmed phone or a passed identity check). If you add a profile photo (a picture of you, or a logo or icon), it is public too, beside your name on your listings and seller page, and so is a cover you put across the top of your seller page; each is stored with our file storage provider in the United States, deleted when you replace or remove it, and Udozo's team may remove one that breaks the rules. Your seller page gathers the same: your first name and initial, your photo and cover, your badges, when you joined, your live listings with their categories and states, how many you have sold, your Safe pay sales and how often you answer chats; never your full name, phone, email or where you live. Never put anyone's personal details in a listing.",
            "Usernames. Once you have posted enough ads, you may choose a username, and your seller page's address becomes it. It is public, on your seller page's address and beside your listings. It may not pretend to be another person, business or Udozo, mislead buyers, or carry a phone number, email address, link, social media handle or words we do not allow. You can change it once every 30 days; your old one then leads to your new page for 90 days, and nobody else can take it meanwhile. We may remove a username that breaks these rules, and your page goes back to its first address.",
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
            "used or opened single-use medical items (syringes, needles, catheters, test strips), and medical supplies past their expiry date;",
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
        "Medical equipment and supplies are regulated. If you sell them, you must hold any licence or registration your country requires (for example from NAFDAC in Nigeria, the FDA in Ghana or the Pharmacy and Poisons Board in Kenya), list only products registered for sale there, give their registration number when asked, and sell sterile items only sealed and in date.",
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
      heading: "8. Chats, offers, calls and contact details",
      body: [
        {
          list: [
            "Keep the conversation on Udozo. Chats protect both of you: we can see them if you report a problem. Be polite, honest and lawful. Do not send spam, links, threats or other people's personal details.",
            "Either side can offer a price in a chat. An offer lasts 48 hours unless it is accepted, declined, withdrawn or replaced first. An accepted offer is the price for Safe pay for 7 days. Accepting an offer says you will buy or sell at that price; it does not move any money.",
            "Nobody's phone number or email is on a listing. Where a seller takes calls, a signed-in buyer can ask for the seller's contact details. If the seller shares them, that buyer sees the seller's confirmed phone number and email on every listing of the seller's, until the seller stops sharing. A seller who declines can be asked again after 7 days. We limit how many sellers a buyer can ask each hour.",
            "A buyer can ask a seller to call them back. The seller is then given the buyer's name, confirmed mobile number and email with the listing, until the seller marks it done. We limit how many call backs a buyer can ask for each hour.",
            "While a seller has Udozo open, a signed-in buyer can call them in the browser about a listing. The call is relayed by our provider, so neither of you sees the other's phone number or internet address, and we do not record it. We keep who called whom, about which listing, when and how it ended, and tell a seller about a call they missed.",
            "Use anyone's details, or a call, only for the listing. Never ask for codes or payment in a call.",
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
      id: "buy-orders",
      heading: "9a. Buy orders",
      body: [
        "Where buy orders are open, a buyer can ask to buy a listing at a price with Buy this. A buy order is an agreement between the buyer and the seller: Udozo is not the seller or the buyer, does not hold the money, and cannot recover money paid outside Safe pay. Section 9 applies to every buy order.",
        {
          list: [
            "The seller has the hours shown to accept, offer another price or decline. Without an answer the buy order ends. A price the seller offers is answered by the buyer in the same time.",
            "Once accepted, the item is held for the buyer: it cannot be accepted for someone else, or bought with Safe pay, while the buy order is open. Meet within the days shown; the seller can give more time once. Either side can cancel, or say the sale did not happen, before it is marked sold.",
            "The seller marks the buy order sold only once the buyer has paid and has the item. The buyer can say they bought it; if the seller does not answer within 3 days, it is recorded as sold.",
            "A buyer can say they did not buy it within 7 days of the seller marking it sold. Marking a sale that did not happen, or denying one that did, breaks these terms. When buyers say they did not buy from a seller three times in 90 days, we pause that seller's buy orders for 30 days, and we may suspend accounts that misuse buy orders.",
            "Completed buy orders are the record of who bought what on Udozo, which we use to let buyers review sellers when reviews open.",
            "We limit how many buy orders a buyer can have open and send each day, and we may refuse them between accounts that look like one person.",
          ],
        },
      ],
    },
    {
      id: "reviews",
      heading: "9b. Reviews and ratings",
      body: [
        "Where reviews are open, a buyer who completed a purchase (a Safe pay order released to the seller, or a buy order the seller marked sold) can review the seller once for it, within the time shown (30 days unless the market says otherwise): positive or negative, and neutral where the market offers it. A negative review says what went wrong.",
        {
          list: [
            "Reviews are public on the seller's page and their listings, with the reviewer's first name and initial, their photo if they have one, the item and the month. A seller's positive share counts the last 12 months, each buyer once (their latest review), and leaves neutral reviews out.",
            "Each review is a conversation: the seller can reply, the reviewer can add to it, and other buyers who bought the same item (the same brand and model, else the same listing) from the same seller in the last 12 months can say whether they agree. Each person may write a few times, and a conversation closes after 12 months.",
            "A review can be changed three times within 30 days, or withdrawn. Earlier versions are kept for Udozo's moderators, and a review changed after the seller replied says so.",
            "Not allowed: reviews of purchases that did not happen, reviewing yourself or someone you work with, reviews paid for or given in exchange for anything; sellers offering refunds, discounts or gifts to change or remove a review, or pressuring a buyer; buyers asking for anything in exchange for a good review or for removing a bad one; contact details, links, other people's personal details, threats or abuse. Contact details and links are hidden automatically.",
            "Anyone can report a review or a reply. Udozo's moderators read reported reviews, and may hold a review before it shows (for example from a new account), remove it or a reply, close a conversation, or stop someone writing reviews (for 180 days for faking or extortion). We tell the reviewer when their review is removed and why; ask us to look again through Contact us.",
            "Reviews are people's opinions, not Udozo's. They do not change how listings are ranked, and Udozo does not edit them, except to hide contact details and links.",
          ],
        },
        "Private ratings: where they are open, after a chat, call, call back or contact request about a listing, the buyer can privately rate how the seller dealt with them (replies, helpfulness and courtesy, with optional tags and a note for Udozo's team). They are never public. The seller sees only a summary once five buyers have rated them, counted up to the previous day, never who rated them, which listing or any note. Each buyer rates a seller about a listing once, and a seller at most once in 30 days. Udozo's team reads them, may leave a rating out of a summary, and looks into any rating saying the seller asked for payment outside Udozo or before the item was seen.",
        "Seller scores: where they are shown, Udozo's assistant, Anjio, works out each seller's scores every night from what happens on Udozo (how fast they reply, how often they answer buyers, whether prices stay as listed, how prices compare with similar listings, completed sales and reviews), each from a minimum number of them. Buyers see only words (such as \"Usually replies within an hour\"), a band from Good up, and the strongest points; sellers see their numbers and tips. Anjio may write one or two sentences about a seller from those figures only; it is checked before it shows, can be imperfect, and sellers can report it. Scores never change how listings are ranked, and nobody can pay for one. How it works is explained on udozo.com/help/how-anjio-rates-sellers.",
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
        "Nothing in these terms limits a responsibility the law does not allow us to limit.",
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
        `These terms are governed by ${operator.law}. Tell us first: most problems are put right there. You keep any rights you have under the law where you live.`,
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
        "Safe pay takes real payments. Udozo collects, holds and refunds Safe pay money through licensed payment partners.",
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
            "You must be a business, or a person acting in the course of business, 18 or over, and based in a country where we accept sellers. Your country is fixed when you sign up, and you trade in its currency. You give the owner's mobile number from that country, and confirm it later with a code we text it (where we can text numbers there).",
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
        "We run Seller HQ with reasonable care and skill. We are not responsible for what suppliers or buyers do, or for registrars and payment partners failing, beyond putting right what we can. Nothing in these terms limits a responsibility the law does not allow us to limit.",
        "We tell you in Seller HQ or by email at least 30 days before a change that is not in your favour takes effect, unless the law requires it sooner. If you do not agree, you may close your account before it does.",
        `These terms are governed by ${operator.law}. Questions: ${supportContact}; legal and privacy requests: ${legalContact}.`,
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
            "Your account: name, email address, country, password (only as a one-way hash), your mobile number (confirmed later with a code we text it, where we can text numbers in your country), when you signed in, failed sign-ins, and the codes we email or text you (only as hashes).",
            "About you, from your profile: the area you live in and, if you give them, your date of birth and your sex (or that you would rather not say). Only you and Udozo's team see them, never buyers, sellers or stores, and you can change them at any time.",
            "Your listings: title, description, features, price and its changes, condition, category, the area you chose, photos and video, how you deliver, and how many people contacted you. Live listings are public, with your first name and the first letter of your last name and your badges. If you choose a username, it is public too: it is your seller page's address and shows with your listings. We remove the hidden details phones add to photos and videos, and keep a one-way fingerprint of each photo to spot photos copied from another listing.",
            "Chats: messages, photos (encrypted, in private storage, seen only by the two of you), offers, when each side read them, blocks, and how fast sellers reply. A moderator reads a chat only when one of you reports it, or when it matters to a Safe pay dispute, and each reading is recorded.",
            "Interest in listings: the listings you save, and that you started a chat, asked for a seller's contact details or a call back, or called a seller.",
            "Contact requests and call backs: who asked whom, about which listing, the note written (numbers and links hidden) and the answer. When a seller shares their contact, the buyers they shared it with.",
            "Purchases and reviews: each completed purchase (what was bought, from whom and when) as the right to review it; your reviews, the parts you marked, their earlier versions, your replies in reviews' conversations (contact details and links hidden), the reports you make about reviews and what moderators decided. Reviews and replies are public with your first name and initial and your photo if you have one.",
            "Private ratings of sellers: the scores, tags and note you give a seller after being in touch about a listing, with how you were in touch (a chat, call, call back or contact request). The seller sees only an anonymous summary of five or more ratings; only Udozo's team sees who rated whom and the notes.",
            "Seller scores: figures worked out each night from your activity as a seller (replies, answers to buyers, prices, completed sales, reviews and private ratings), kept with monthly snapshots for 24 months. A short summary may be written from them by our AI assistant through our AI provider, which is sent only those figures: never your name, messages, reviews' words or prices.",
            "Buy orders: who asked to buy which listing, the price asked and any price the seller offered back, how many, the notes and meeting place written (numbers and links hidden), each step and when it was taken (accepted, cancelled, marked sold, said bought, said not bought, and why), and when deadlines were reminded. Each step also shows in your chat with the other person.",
            "Calls: who called whom, about which listing, when it rang, was answered and ended, and how. The connection details the two browsers swap are deleted when the call ends. Calls are not recorded. While you have udozo.com open signed in, when you last had it open, so buyers can see you are there.",
            "Reports and safety: reports you make or that are made about you, our checks and reviews of listings, strikes and any suspension, with its reason.",
            "Your wallet and payments: top-ups, purchases, refunds and payouts. You pay on our payment partner's page; we never receive your full card number, card security code or mobile money PIN.",
            "Safe pay orders: the item, price, both fees, the hand-over, the delivery address (encrypted, shown only to the seller once the buyer has paid), the release code (encrypted, shown only to the buyer), the seller's dispatch photos (encrypted, in private storage), the courier and tracking, the deadlines, and who ended the order and why.",
            "Orders on a reseller's store: what is kept for a Safe pay order, plus the store, the price figures each side is paid, your confirmed phone number when you bought (encrypted), the listing and the store's note as you saw them, the order's chat with the store, and the supplier and reseller's own thread about it. We record each time your details are opened.",
            "Disputes: the reason, everyone's messages and photos (encrypted, in private storage), our decision and, on a store's order, whose fault an upheld dispute was.",
            "Reports of a reseller's store: who reported it, the store, the reason, what was written, the order, and our decision. Only Udozo sees who made a report.",
            "Payout accounts: the bank (account name, and the number kept encrypted) or mobile money number, when it was added, and each payout's amount, status and reference.",
            "Shop assistants: your questions, the answers, the listings it showed and what it looked up, your ratings and reports of answers. To limit questions from one place each day, a one-way code of your IP address that changes every day.",
            "Help: your chats and questions with our team, and, if you chat without signing in, the name and email address you give. Messages sent with our Contact us form: what it is about, your name, email address, the phone number if you give one, your message, the country you were browsing and, if you were signed in, your account; our replies (emailed to you) and our team's notes on it.",
            "Sellers we invite: the business contact details you have made public (your or your store's name, phone number, area and what you sell), or the email address you or someone else gave us, so our team can invite you to sell on Udozo. We keep our messages to you, your replies and feedback, whether you opened your invite link and, if you sign up with it or with that phone number or email, which account it led to.",
            "Sellers on Seller HQ: your business's details and checks, your team, your stores, what you publish on them, your wallets, invoices and payouts, your API keys (only as hashes) and webhooks, and for domains you buy, the registrant details you give.",
            "Notifications: what we told you in your account (about your listings, chats, requests, orders, reviews, payouts and account), when, and whether you have read it.",
            "Devices: on udozo.com, Seller HQ and for our team, the browsers where you turned on notifications (the browser's push address and keys, encrypted, and a label such as \"Chrome on Android\"), and which notifications you chose to have sent to them.",
            "Signing up: each step you take to create an account on udozo.com or Seller HQ (entering your email, the emailed and texted codes, your mobile number, your password, signing in with Google), when you took it, whether it went through or why not (for example a wrong or expired code), the country you chose, and the kind of device and browser (such as \"Chrome on Android\"), never your codes or password. Our team uses it to see where people get stuck signing up, and may contact you to help. We also count how many times the sign-up pages are opened each day, without anything about who opened them.",
            "Posting an ad: each step you take from pressing Sell to your ad going live (where you pressed Sell, which step of Post an ad you reached, what a step still needed, whether posting went through or why not), how a moderator's review ended and why, and when your ad first got a view, a chat, a call or a lead, and sold, with the kind of device and browser, never anything you typed or uploaded. Our team uses it to see where sellers get stuck posting, and may contact you to help. If you leave an ad unfinished, or finished but not posted, we may remind you in your account and by email (once for an unfinished ad, up to three times for one ready to post); deleting the draft stops them. We also count how many times Post an ad is opened each day, by where Sell was pressed, without anything about who opened it.",
            "Technical data: your IP address, used for rate limits and security, and the requests your browser makes, in our server logs.",
            "Listing views: how many times each listing's page was opened, each day, shown to its seller and used to rank Trending. Nothing about who viewed it is kept: so one visitor counts once, a one-way code of their IP address, browser and the listing is held in memory for half an hour, then forgotten.",
            "What you look at, to personalise what you see (section 5): signed in, or if you are not signed in and chose Accept all on our cookie banner, the listings you open, how long you read them, how many photos you open and how far down you read; what you search for (the words, with phone numbers, emails, long numbers and codes taken out) and the filters you use; which listings you click, share or mark Not interested, and where on the page they were; and, from your account, the listings you save, contact, call, make offers on or buy. Each visit has a random ID kept only in the page while it is open. If you are not signed in, a random ID in the optional udz_vid cookie links your visits; we keep only a one-way code of it. From this we keep a short profile of your interests (categories, brands, models, areas, price ranges and condition, which fade over time), your last searches and the listings you viewed.",
          ],
        },
        'We do not collect your precise location: "Use my location" on udozo.com finds the nearest area in your browser, and your position is never sent to us. We use no analytics, advertising or tracking cookies. Our one optional cookie, udz_vid, is set only if you choose Accept all, and only to personalise what you see.',
        "Personalisation never uses your date of birth (except to leave out anyone under 18, who gets no profile), your sex, what you write in messages or chats, or your phone number. It is never used for advertising, never sold and never shown to sellers: they see only how many people viewed and contacted their listings. One person in ten, chosen at random, sees the usual popular order in For you instead, so we can measure whether personalising helps.",
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
              ["Seeing where people get stuck signing up, and helping them finish", "Our legitimate interest in a sign-up that works for everyone"],
              ["Seeing where sellers get stuck posting ads, and helping them", "Our legitimate interest in posting that works for everyone"],
              ["Personalising what you see (For you, Recently viewed, your searches, People also viewed) and improving search", "Signed in: our contract with you (the terms) and our legitimate interest in showing you what you are looking for; you can object by turning personalisation off. Not signed in: your consent, given by choosing Accept all"],
              ["Inviting sellers whose business details are public, and following up", "Our legitimate interest in growing Udozo's marketplace. Tell us at any time and we stop: we keep only your number or email, marked so we never contact you again"],
              ["Accounting and tax records", "The law"],
            ],
          },
        },
        "Some decisions are made automatically: refusing a listing that uses a word for an item that may never be sold, refusing store pages that claim to own the items, refusing a Safe pay order whose buyer and seller our checks show are the same person, limits, and pausing a seller or store at the strike limit. A person on Udozo's team reviews them if you ask.",
        "Personalisation is automated too: it chooses the order of listings in For you and the other rows made for you. It decides nothing about you beyond that order: it never stops you seeing, buying or selling anything, and search with words still shows the best matches first. Turn it off, remove single items or clear your history at any time under Account, Privacy (signed in), or with Necessary only in Cookie settings (not signed in).",
      ],
    },
    {
      id: "who-sees",
      heading: "6. Who sees it",
      body: [
        {
          list: [
            "The public: live listings and each seller's page (first name and initial, username if they chose one, profile photo and cover, badges, when they joined, their live listings and figures), including in search engines and in previews when a link is shared.",
            "The other person in a chat: your first name and initial, your messages and offers. The other person in a buy order: your first name and initial, the price, notes and meeting place written, and each step. A seller sees a Safe pay buyer's delivery address once they have paid. A seller sees a buyer's name, confirmed mobile number and email when the buyer asks for a call back, and a buyer sees a seller's confirmed phone number and email once the seller shares them. Neither sees the other's number in a call. On a reseller's store, the supplier and the reseller see the buyer's name, phone number, email and address once the supplier accepts, and the courier the seller chooses receives the delivery address.",
            "Udozo's team, as their work needs.",
            "Service providers working for us: Neon (database, United States), DigitalOcean (servers and file storage, United States), Upstash (cache and rate limits), Vercel (hosting our sites, and the registrar for domains sellers buy, which receives the registrant's details), Cloudflare (our domain's DNS, the network in front of our API, and relaying calls between buyers and sellers: the call passes through it, encrypted, and is not recorded), Resend and MailerSend (email), Termii and Africa's Talking (text messages), our payment partners Paystack, Flutterwave, pawaPay and Stripe (payments, refunds and payouts, depending on your country and method), Anthropic, OpenAI and DeepSeek (shop assistants, as section 4 says; DeepSeek processes what it is sent in China), Google (signing up and in with Google on udozo.com and Seller HQ: Google tells us your name, email and that it confirmed it; we keep your Google account's ID to recognise it, never your Google password), and browser push services (Google, Mozilla, Apple, Microsoft) for notifications on udozo.com and Seller HQ: they carry each notification to your device encrypted, so they cannot read it.",
            "Authorities, where the law requires it.",
          ],
        },
        "We do not sell your personal data, and we do not use it for advertising.",
      ],
    },
    {
      id: "where",
      heading: "7. Where it is stored",
      body: ["Your data is stored in the United States. What a shop assistant run by DeepSeek is sent (section 4) is processed in China. Where it leaves your country, we use the safeguards your country's law requires."],
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
              ["Contact requests and call backs", "12 months after they are answered or cancelled. A shared contact stays shared until the seller stops sharing it or closes their account."],
              ["Buy orders", "Two years after they end, as the record of who bought what (reviews of sellers rely on it)."],
              ["Reviews and their replies", "While both accounts are open. A withdrawn review's words are deleted after 30 days; reviews and replies Udozo removed, and decided reports, after two years. A purchase never reviewed: 13 months."],
              ["Private ratings of sellers", "Two years after they are given; when you were asked to rate one, 90 days."],
              ["Seller scores", "While you sell on Udozo, recalculated every night; monthly snapshots for 24 months."],
              ["Calls", "Who called whom and when: 90 days. The connection details: deleted when the call ends. When you last had udozo.com open: replaced each time."],
              ["Buyers' details on store orders", "Shown to the supplier and reseller until 30 days after the order ends."],
              ["Identity documents and photos", "Deleted 90 days after a check is declined, and a week after an unfinished one is left. For an approved check, five years."],
              ["Chats and questions with our team", "Chats 12 months after they end; questions two years after they are resolved."],
              ["Contact us messages", "Two years after the last reply or change; messages we mark as spam, after 30 days."],
              ["What you looked at and searched for (to personalise)", "90 days. Your interest profile: deleted after 180 days without a visit, and at once when you turn personalisation off, clear your history, choose Necessary only (not signed in) or close your account. When you sign in, what was kept under your udz_vid cookie becomes your account's."],
              ["Searches counted per day", "Each search's words (cleaned as section 2 says) and how often they were searched each day, with nothing about who searched: 13 months, to suggest popular searches and improve search."],
              ["Your sign-up steps", "Deleted 7 days after your account is ready to use, or 30 days after your last step if you never finish. Only daily counts with nothing about you are kept, for a year."],
              ["Notifications", "90 days. A browser you turned notifications on in: until you turn them off, remove it, or sign out of it."],
              ["Your posting steps", "Deleted 30 days after your last step if your ad never goes live; otherwise 90 days after it went live, or 30 days after it sold if sooner. Only daily counts with nothing about you are kept, for a year."],
              ["Sellers we invite who do not sign up", "Deleted 12 months after our last contact (or after we added you, if we never reached you). If you ask us to stop, only your number or email, marked not to contact."],
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
      body: ["Udozo is for adults only. We do not knowingly keep data about anyone under 18; we close such accounts when we find them. Nobody under 18, by the date of birth on their profile, gets a personalisation profile."],
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
  summary: "The few cookies and browser storage Udozo's sites use, all needed for them to work, and your choice about optional cookies.",
  sections: [
    {
      id: "cookies",
      heading: "1. Cookies",
      body: [
        "Udozo uses cookies that are strictly necessary for its sites to work, and one optional cookie, udz_vid, set only if you choose Accept all (section 3). It uses no analytics, advertising or tracking cookies.",
        {
          table: {
            head: ["Name", "Site", "What for", "Kept"],
            rows: [
              ["udz_customer", "udozo.com, and each reseller's store on its own address", "Keeps you signed in. Each site keeps its own.", "30 days"],
              ["udz_assistant", "udozo.com", "Keeps your conversation with the shop assistant when you are not signed in", "30 days"],
              ["udz_market", "udozo.com", "Remembers the country you chose in the header (or All countries), so udozo.com opens it next time. Set only when you choose", "12 months"],
              ["udz_google", "udozo.com", "Checks that a \"Continue with Google\" sign-in is the one this browser started", "10 minutes"],
              ["udz_session", "Seller HQ (shq.udozo.com), shared across udozo.com addresses", "Keeps sellers and their team signed in", "30 days"],
              ["udz_admin_session", "Udozo's admin", "Keeps Udozo's team signed in", "12 hours"],
              ["udz_kyc", "verify.udozo.com", "Keeps your identity check open while you do it", "Two hours"],
              ["udz_cookie_consent", "udozo.com, and each reseller's store on its own address", "Remembers your cookie choice (Necessary only or Accept all) and when you made it", "12 months"],
              ["udz_vid", "udozo.com", "Optional, only after Accept all: a random ID that links your visits when you are not signed in, so udozo.com can remember what you look at and show you listings you are likely to want (For you, Recently viewed, your searches). Never used for advertising. Removed, with what was kept under it, when you choose Necessary only", "12 months"],
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
              ["udz_microphone_prompt", "udozo.com", "Whether you allowed your microphone for calls, or when you chose Not now, so we do not ask again too soon", "Until you clear it"],
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
    {
      id: "choices",
      heading: "3. Your cookie choices",
      body: [
        "On your first visit each of Udozo's sites asks about cookies. Necessary only keeps to the strictly necessary cookies above; Accept all also allows Udozo's one optional cookie, udz_vid, on udozo.com. If Udozo adds other optional cookies, this notice will name them first, and you will be asked again.",
        "Your choice is kept for 12 months in udz_cookie_consent, then you are asked again. You can change it at any time with Cookie settings at the foot of every page. Each reseller's store on its own address asks separately.",
      ],
    },
  ],
};

export const legalDocuments: LegalDocument[] = [terms, safePay, sellers, privacy, cookies];
export const legalDocument = (slug: string) => legalDocuments.find(doc => doc.slug === slug) ?? null;
