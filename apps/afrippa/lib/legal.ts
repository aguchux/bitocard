/**
 * Afrippa's legal documents (docs/CRYPTO_SPINOFF_PLAN.md, step 5 item 2): drafts for lawyers' review in each market,
 * describing what Afrippa actually does. `legalVersion` is the date of the terms traders accept before trading (the
 * API's `cryptoDeclarationVersion`): change both together when people must accept again.
 */

export const legalVersion = "2026-10-28";
export const legalContact = "support@afrippa.com";

/** Who the drafts name as the operator, until the owner confirms which company operates Afrippa. */
export const operator = {
  name: "De-Golojan Technologies Ltd",
  number: "RC 1606658",
  address: "3 Agu Street, Upper Housing Estate Extension, Abakpa Nike, Enugu, Nigeria",
  law: "the laws of the Federal Republic of Nigeria",
};

export type LegalBlock = string | { list: string[] } | { table: { head: string[]; rows: string[][] } };
export type LegalSection = { id: string; heading: string; body: LegalBlock[] };
export type LegalDocument = { slug: string; title: string; summary: string; sections: LegalSection[] };

const draftOperator = `Afrippa is a venture of Golojan Ltd. Until the company that will operate Afrippa is confirmed, these drafts name ${operator.name} (${operator.number}), ${operator.address}, as its operator ("Afrippa", "we", "us").`;

const terms: LegalDocument = {
  slug: "terms",
  title: "Terms of use",
  summary: "Who may use Afrippa, your account and wallets, what is not allowed, and what we may do.",
  sections: [
    {
      id: "about",
      heading: "1. About Afrippa",
      body: [
        draftOperator,
        "Afrippa is a peer-to-peer market where people buy and sell crypto with each other. Buyers pay sellers directly, outside Afrippa, through the seller's own bank account, mobile money wallet or payment service. Afrippa holds the coins: in your Afrippa wallet, and in escrow while an order is open, so a seller's coins go to the buyer only when the seller releases them or Afrippa's team decides an appeal.",
        "Afrippa is never a party to a trade. We do not buy or sell crypto ourselves, set prices for you, or receive or hold the money traders pay each other.",
        "These terms, the P2P trading rules, the fees page and the risk warnings form one agreement between you and us. The privacy notice says how we use your personal data.",
      ],
    },
    {
      id: "who",
      heading: "2. Who may use Afrippa",
      body: [
        {
          list: [
            "You are 18 or over.",
            "You live in a country Afrippa serves, shown when you sign up. Your country is fixed when you open your account.",
            "You are not a citizen or a resident of the United States or the United Kingdom.",
            "You have one Afrippa account, opened for yourself and used only by you.",
            "Before trading you accept the current version of these terms, the P2P trading rules and the risk warnings. When they change, we ask you to accept them again.",
          ],
        },
        "Live trading needs an identity check, from a document issued by a country Afrippa serves. We may refuse or close an account that does not meet these conditions, including after an identity check.",
      ],
    },
    {
      id: "account",
      heading: "3. Your account and its security",
      body: [
        "Give true details and keep them up to date. Two-step sign-in is required: an authenticator app, codes we email you or codes we text to your confirmed mobile number, with recovery codes for when you lose it.",
        "Releasing coins and adding a payment method each need a fresh code from your two-step method, so that someone who gets into your session cannot move your coins or add an account to be paid into.",
        "Keep your password, codes and recovery codes secret. Afrippa will never ask you for them. Tell us at once through Help if you think someone else has used your account. When we reset your two-step sign-in, withdrawals wait 24 hours.",
      ],
    },
    {
      id: "wallets",
      heading: "4. Your crypto wallets",
      body: [
        "Your wallet shows the coins we hold for you. We keep them in Afrippa's own wallets for all traders together, and record each trader's share in our books.",
        {
          list: [
            "Deposits: send only the coin, on the network, shown with your deposit address. Coins sent on another network, or another coin, may be lost for good. A deposit is credited once the network has confirmed it the number of times shown.",
            "Withdrawals: a new withdrawal address can be used 24 hours after you add it. We show the network fee before you confirm, and email you a code to confirm each withdrawal. Daily limits apply.",
            "We check withdrawal addresses against sanctions lists. We may review, hold or refuse a withdrawal, for example a large one, one to an address we cannot check, or one we believe is fraudulent or unlawful.",
            "A transaction sent on a blockchain cannot be reversed. Check the address and network before you confirm.",
          ],
        },
      ],
    },
    {
      id: "trading",
      heading: "5. Trading",
      body: ["How ads, orders, payments, release, appeals and standing work is set out in the P2P trading rules, which form part of these terms. The fees are on the fees page and are shown before you confirm."],
    },
    {
      id: "not-allowed",
      heading: "6. What is not allowed",
      body: [
        {
          list: [
            "Paying, or asking to be paid, from or to an account that is not in the trader's own name.",
            "Moving a trade off Afrippa, or sharing contact details, links or other ways to trade outside an order.",
            "Fake payment proofs, reversing a payment after coins were released, or any other fraud.",
            "Using several accounts, someone else's account or someone else's identity.",
            "Money laundering, financing terrorism, evading sanctions, or trading the proceeds of crime.",
            "Abusing, threatening or harassing other traders or Afrippa's team.",
            "Trying to break, overload or get around Afrippa's systems or limits.",
          ],
        },
      ],
    },
    {
      id: "our-actions",
      heading: "7. Freezes, pauses and closing",
      body: [
        "We may freeze an amount in your wallet or your whole account, pause your trading, refuse a withdrawal, close your ads or close your account, where these terms are broken, to protect other traders, or where the law requires it. We tell you why unless the law prevents it.",
        "Where the law allows, you can withdraw the coins you hold when your account is closed. Frozen coins may be kept, or handed over to authorities, where the law requires it.",
        "You can close your account through Help once you have no open orders.",
      ],
    },
    {
      id: "help",
      heading: "8. Help and the AI assistant",
      body: [
        "You can ask Afrippa's team through Help, by chat or by question. Chat may first be answered by Afrippa's AI assistant. It is an AI: it can be wrong, it never acts on your coins or orders, and you can ask for a person at any time. Never send it your passwords, codes or recovery codes.",
      ],
    },
    {
      id: "no-advice",
      heading: "9. No advice",
      body: ["Nothing on Afrippa is financial, investment, legal or tax advice. Read the risk warnings. You are responsible for the tax on your trades."],
    },
    {
      id: "liability",
      heading: "10. Our responsibility to you",
      body: [
        "We run Afrippa with reasonable care and skill. We are not responsible for what other traders do, for payments made between traders outside Afrippa, for blockchain networks, or for losses you could have avoided by following these terms and the P2P trading rules.",
        "Nothing in these terms limits a responsibility that the law does not allow us to limit. The rest of our responsibility will be set out after lawyers' review in each market.",
      ],
    },
    {
      id: "changes",
      heading: "11. Changes",
      body: ["We may change these documents. We tell you before a change affects you, and ask you to accept the new version before you trade again. Orders already open finish under the version they were opened under."],
    },
    {
      id: "law",
      heading: "12. Law and disputes",
      body: [`This draft is governed by ${operator.law}; the governing law for each market will be confirmed after lawyers' review. Tell us first through Help: most problems are put right there. You keep any rights you have under the law where you live.`],
    },
  ],
};

const p2pRules: LegalDocument = {
  slug: "p2p-rules",
  title: "P2P trading rules",
  summary: "How ads, orders, escrow, payment, release, appeals and standing work.",
  sections: [
    {
      id: "ads",
      heading: "1. Ads",
      body: [
        {
          list: [
            "An ad offers to sell or to buy a coin at a fixed price, in one market and currency, with the least and most per order.",
            "A sell ad locks the coins it offers, and the seller's fee on them, in your wallet until they are taken or you close the ad. A buy ad locks nothing.",
            "Every ad names one to five of your own payment methods in its currency, each usable 24 hours after you added it, and a payment window: 15, 30 or 60 minutes.",
            "An ad's terms may not carry contact details, links or anything that moves a trade off Afrippa.",
          ],
        },
      ],
    },
    {
      id: "orders",
      heading: "2. Orders and escrow",
      body: [
        "Taking an ad opens an order at the price you saw. The seller's coins, and the seller's fee, move into escrow at once, and the payment window starts.",
        {
          list: [
            "The buyer pays the full amount, within the window, to the account shown in the order, and only from an account in their own name: the name their identity check verified.",
            "The buyer then marks the order paid, naming the account they paid from.",
            "The seller checks their own banking or mobile money app (a screenshot or a message is not proof) that the full amount arrived from an account in the buyer's name, then releases the coins with a fresh two-step code.",
            "Released coins go to the buyer, less the buyer's fee. A release is final: it cannot be taken back.",
          ],
        },
        "Never release coins before the money is in your account, and never pay or be paid outside the order's accounts. Afrippa's team will never ask you to.",
      ],
    },
    {
      id: "cancelling",
      heading: "3. Cancelling and expiry",
      body: [
        "The buyer can cancel an order before paying. An order not marked paid by the end of its window expires. Either way the coins go back to the seller (to the ad, if it is still open), and nobody pays a fee.",
        "Never cancel an order you have paid: appeal instead. A buyer who cancels or lets expire three orders within a day cannot open orders as a buyer until a day after the first.",
      ],
    },
    {
      id: "reversible",
      heading: "4. Payments that can be taken back",
      body: ["Some payment services let the payer take a payment back after it was made (for example PayPal). Ads and orders using them are marked. Release only once you are sure such a payment has settled; if it is taken back after you release, Afrippa cannot return the coins."],
    },
    {
      id: "appeals",
      heading: "5. Appeals",
      body: [
        "Once an order is marked paid, either side can appeal, saying what went wrong. The coins stay in escrow until Afrippa's team decides. Add your evidence (statements, receipts) in the order room, and answer the team's questions there.",
        "The team releases the coins to the buyer or returns them to the seller, and records whose fault it was, if anyone's. The decision is final on Afrippa; you keep any rights you have under the law.",
      ],
    },
    {
      id: "standing",
      heading: "6. Standing and strikes",
      body: [
        {
          list: [
            "An appeal decided against you, or a report about you that Afrippa's team upholds, is a strike, and starts a 24-hour cool-off.",
            "Three strikes in 90 days pause your trading until Afrippa's team clears them.",
            "While paused or cooling off, you cannot post ads or open orders, and your ads leave the market.",
          ],
        },
      ],
    },
    {
      id: "room",
      heading: "7. The order room",
      body: ["Each order has a room for its two traders. Messages are kept with the order; photos (JPEG, PNG) and PDFs of up to 4 MB, at most 20 per order, can be sent. Afrippa's team can read the room and write in it, and does so during appeals. Once the order closes, the room is kept, read-only."],
    },
    {
      id: "limits",
      heading: "8. Limits and checks",
      body: [
        {
          list: [
            "Each market has limits per order and per day. Traders with fewer than five completed orders have lower ones.",
            "A buyer can open at most 10 orders an hour, and have at most 5 waiting for payment.",
            "The same person on both sides of an order is refused, whoever's account it is.",
            "Afrippa may hold, review or refuse a trade, or pause a trader, to stop fraud.",
          ],
        },
      ],
    },
    {
      id: "trust",
      heading: "9. Feedback, blocks and reports",
      body: [
        "After a released order, each side can leave feedback once, within 30 days: positive or negative, with an optional comment of up to 300 characters without contact details. Your completion rate, how fast you pay and release, and your feedback are shown to other traders by your nickname.",
        "You can block a trader: neither of you then sees the other's ads. You can report a trader for fraud, fake payments, payments from someone else, moving trades off Afrippa, abuse or anything else; Afrippa's team decides each report and tells you the outcome.",
      ],
    },
  ],
};

const fees: LegalDocument = {
  slug: "fees",
  title: "Fees",
  summary: "What Afrippa charges, when, and where you see it before you confirm.",
  sections: [
    {
      id: "trading",
      heading: "1. Trading fee",
      body: [
        "Both sides of a released order pay a fee, in the coin traded; the seller's rate is usually higher than the buyer's. The rates are set for each coin and market and shown on the market and in every order preview before you confirm.",
        {
          list: [
            "The buyer's fee comes out of the coins they receive.",
            "The seller's fee is held in escrow with the order (or kept beside the coins a sell ad offers).",
            "Fees are charged only when the coins are released. A cancelled, expired or returned order costs nobody anything.",
          ],
        },
      ],
    },
    {
      id: "withdrawals",
      heading: "2. Withdrawals and deposits",
      body: ["Each withdrawal pays a network fee, set per network and shown before you confirm. Afrippa charges nothing to receive a deposit; the sender pays the network's own fee."],
    },
    {
      id: "free",
      heading: "3. Free",
      body: ["Opening an account, identity checks, posting and closing ads, saving payment methods, and help cost nothing."],
    },
    {
      id: "others",
      heading: "4. Other people's charges",
      body: ["Banks, mobile money networks and payment services may charge you for the payments traders make to each other. Those charges are between you and them."],
    },
    {
      id: "changes",
      heading: "5. Changes",
      body: ["When rates change, the new ones show on the market and in previews at once. An order already open keeps the fees it was opened with."],
    },
  ],
};

const risks: LegalDocument = {
  slug: "risks",
  title: "Risk warnings",
  summary: "What can go wrong when you hold and trade crypto, and how to protect yourself.",
  sections: [
    {
      id: "value",
      heading: "1. You can lose all of it",
      body: ["Crypto prices rise and fall fast and without warning. A coin can lose most or all of its value. Only trade what you can afford to lose."],
    },
    {
      id: "protection",
      heading: "2. No protection scheme",
      body: [
        "Coins held on Afrippa are not bank deposits. They are not covered by deposit insurance, investor compensation or similar schemes.",
        "Afrippa holds traders' coins together in its own wallets and records each trader's share in its books. If Afrippa failed, getting your coins back could be delayed, and is not guaranteed. How traders' coins would be protected in that case is still being confirmed with lawyers.",
      ],
    },
    {
      id: "fraud",
      heading: "3. Payment fraud",
      body: [
        {
          list: [
            "Fake payment proofs: screenshots, texts and emails can be forged. Check your own banking app.",
            "Payments from someone else: money from an account not in the buyer's name may be stolen and taken back later.",
            "Payments taken back: some services let the payer reverse a payment after you released the coins.",
            "Anyone asking you to trade outside an order, or to release first, is probably a fraudster.",
          ],
        },
      ],
    },
    {
      id: "final",
      heading: "4. Blockchain transactions are final",
      body: ["Coins sent to a wrong address or on a wrong network usually cannot be recovered. Networks can be slow, congested or interrupted."],
    },
    {
      id: "account",
      heading: "5. Your account",
      body: ["If someone gets your password and codes, they may be able to take your coins. Use a strong password and two-step sign-in, beware of fake Afrippa sites and messages, and never share your codes."],
    },
    {
      id: "rules",
      heading: "6. Rules change",
      body: ["Laws on crypto differ by country and change. Afrippa may have to limit or stop service in a country, and you may owe tax on your trades. Find out what applies where you live."],
    },
    {
      id: "advice",
      heading: "7. No advice",
      body: ["Afrippa does not give financial, investment, legal or tax advice, and does not tell you whether to buy or sell. Ask an independent adviser if you are unsure."],
    },
  ],
};

const privacy: LegalDocument = {
  slug: "privacy",
  title: "Privacy notice",
  summary: "What personal data Afrippa keeps, why, who sees it, where, for how long, and your rights.",
  sections: [
    {
      id: "who",
      heading: "1. Who we are",
      body: [draftOperator, `We decide how your personal data is used (we are its controller). Write to us at ${legalContact} or through Help.`],
    },
    {
      id: "what",
      heading: "2. What we keep",
      body: [
        {
          list: [
            "Your account: name, email address, country, password (only as a secure hash), mobile number if you add one, your Google account's ID if you sign in with Google, your two-step method (secrets encrypted, recovery codes only as hashes) and your nickname.",
            "Trading: your ads, orders, the coins and amounts, the order room's messages and files, feedback, blocks, reports, strikes and decisions on appeals.",
            "Payment methods: your bank account, mobile money wallet or payment service details, encrypted, with the name they are held in.",
            "Wallets: your deposit addresses, deposits, withdrawal addresses and withdrawals, and their blockchain transactions.",
            "Identity checks (below).",
            "Devices: a random ID afrippa.com keeps in its cookie on each browser you use; we keep only a keyed hash of it, with when it was first and last seen.",
            "Help: your chats and questions, with the AI assistant's answers. If you chat without signing in, the name and email address you give.",
            "Notices we send you, and records of security events such as sign-ins from a new device.",
            "Technical data: your IP address, used for rate limits and security, and the requests your browser makes, kept in our server logs.",
          ],
        },
      ],
    },
    {
      id: "identity-checks",
      heading: "3. Identity checks",
      body: [
        "Before you trade live, Afrippa Verify (verify.afrippa.com) checks your identity: your ID document's details and photos, a selfie, and short liveness photos taken by your camera. Comparing your face with your ID uses biometric data, so we ask for your explicit consent first; without it we cannot check you, and you cannot trade live.",
        "Photos are stripped of hidden data (such as location), encrypted, and stored privately. A person on Afrippa's team reviews them. ID numbers are encrypted, and a keyed fingerprint of them shows our reviewers when the same ID is used on another account. We keep the outcome, your verified name and your document's country.",
      ],
    },
    {
      id: "why",
      heading: "4. Why we use it",
      body: [
        {
          table: {
            head: ["What for", "Our reason"],
            rows: [
              ["Running your account, wallets and trades, and helping you", "Our contract with you"],
              ["Identity checks with biometric data", "Your explicit consent, and the law on knowing our customers"],
              ["Preventing fraud: limits, device checks, same-person checks, standing and refused text", "Our legitimate interest in a safe market, and the law"],
              ["Screening withdrawal addresses against sanctions lists, and keeping records", "The law"],
              ["Security notices and emails about your account", "Our contract with you, and our legitimate interest in your account's safety"],
            ],
          },
        },
        "Some decisions are made automatically: limits, the number of strikes or cancellations, refusing ad terms or feedback that carry contact details, and refusing withdrawals to sanctioned addresses. A person on Afrippa's team reviews them if you ask through Help.",
      ],
    },
    {
      id: "who-sees",
      heading: "5. Who sees it",
      body: [
        {
          list: [
            "Other traders see your nickname, your ads, your trading figures and feedback, never your name or contact details.",
            "The other side of an open order sees the name payments must come from and, for the seller's account, its details; the seller sees the account the buyer paid from. They are shown only while the order is open.",
            "Afrippa's team, as their work needs.",
            "Service providers working for us: database hosting (Neon, United States), servers and file storage (DigitalOcean, United States), the site's hosting (Vercel), email and text message services, Google (sign-in with Google), the AI providers behind the assistant (Anthropic and OpenAI; your messages are sent with secrets and long numbers masked), blockchain data providers, the key-management service behind our crypto signer (Turnkey, which sees no personal data), and sanctions screening services (Chainalysis, TRM Labs; withdrawal addresses only).",
            "Authorities, where the law requires it.",
          ],
        },
        "We do not sell your personal data, and we do not use it for advertising.",
      ],
    },
    {
      id: "where",
      heading: "6. Where it is stored",
      body: ["Your data is stored in the United States. Where it leaves your country, we use the safeguards your country's law requires; these are being confirmed with lawyers in each market."],
    },
    {
      id: "retention",
      heading: "7. How long we keep it",
      body: [
        {
          table: {
            head: ["What", "How long"],
            rows: [
              ["Identity documents and photos", "Deleted 90 days after a check is declined, and a week after an unfinished one is left. For an approved check, five years (to be confirmed with lawyers)."],
              ["Orders, trades, wallets and their records", "As long as the law requires financial records to be kept (to be confirmed for each market)."],
              ["Chats with Help", "12 months after they end."],
              ["Questions to Help", "Two years after they are resolved."],
              ["Notices in your account", "90 days."],
              ["Your account, payment methods and device records", "While your account is open; removed payment methods are kept with the orders that used them."],
            ],
          },
        },
      ],
    },
    {
      id: "rights",
      heading: "8. Your rights",
      body: [
        "Depending on where you live, you can ask for a copy of your data, to correct it, to delete it, to restrict or object to its use, to move it, and to withdraw consent (for identity checks, before the check is decided). Ask us through Help or by email; we answer within a month. Some data must be kept by law even if you ask us to delete it.",
        "You can complain to your country's data protection authority, for example Nigeria's Data Protection Commission, Ghana's Data Protection Commission or Kenya's Office of the Data Protection Commissioner.",
      ],
    },
    {
      id: "children",
      heading: "9. Children",
      body: ["Afrippa is for adults only. We do not knowingly keep data about anyone under 18; we close such accounts when we find them."],
    },
    {
      id: "changes",
      heading: "10. Changes",
      body: ["We update this notice when what we do changes, and tell you of important changes before they apply."],
    },
  ],
};

const cookies: LegalDocument = {
  slug: "cookies",
  title: "Cookie notice",
  summary: "The few cookies and browser storage Afrippa uses, all needed for the site to work.",
  sections: [
    {
      id: "cookies",
      heading: "1. Cookies",
      body: [
        "Afrippa uses only cookies that are strictly necessary, so it asks for no consent. It uses no analytics, advertising or tracking cookies.",
        {
          table: {
            head: ["Name", "Site", "What for", "Kept"],
            rows: [
              ["afr_session", "afrippa.com", "Keeps you signed in", "30 days"],
              ["afr_google", "afrippa.com", "Finishes signing in with Google safely", "10 minutes"],
              ["afr_chat", "afrippa.com", "Keeps your chat with Help when you are not signed in", "30 days"],
              ["afr_device", "afrippa.com", "A random ID for this browser, to tell you of sign-ins from new devices and to stop fraud", "One year"],
              ["afr_kyc", "verify.afrippa.com", "Keeps your identity check open while you do it", "Two hours"],
            ],
          },
        },
      ],
    },
    {
      id: "storage",
      heading: "2. Browser storage",
      body: [
        "If you are offered Afrippa as an app on your device, we remember on the device when you were last asked (bc_install, in local storage, and bc_install_visit, for one visit). Its offline page is kept by the site's service worker.",
        "You can clear these at any time in your browser's settings; signing out removes afr_session.",
      ],
    },
  ],
};

export const legalDocuments: LegalDocument[] = [terms, p2pRules, fees, risks, privacy, cookies];
export const legalDocument = (slug: string) => legalDocuments.find(doc => doc.slug === slug) ?? null;
