import Link from "next/link";
import { legalEntities } from "@bitocard/ui/legal";
import { ContactEmail, EntityTable, LegalPage, Section } from "@/components/legal";
import { pageMetadata } from "@/components/seo";

const seo = {
  title: "Reseller terms",
  description: "The terms for selling with BitoCard: your account and checks, your wallet and payouts, pricing, your stores and what you publish on them, domains, your customers, disputes and your own integrations.",
  path: "/documents/reseller-terms",
};

export const metadata = pageMetadata(seo);

export default function ResellerTerms() {
  return (
    <LegalPage
      seo={seo}
      intro={
        <>
          <p>These terms apply when you open a reseller account on BitoCard Seller Head Quarters (SHQ, shq.bitocard.com) and when you sell through BitoCard: on a store BitoCard hosts for you, or from your own website, app or systems through our API. They sit alongside our <Link href="/documents/terms">terms of use</Link> and <Link href="/documents/privacy">privacy notice</Link>.</p>
          <p><strong>This is a draft.</strong> It describes how BitoCard is built to work and is published so you can read it before you sign up. It is being reviewed by lawyers in each region and may change before reseller accounts take real money. We will ask you to accept the final version in SHQ before your account takes payments, and tell you about any later change in advance.</p>
        </>
      }
    >
      <Section id="who" title="1. Who we are and what these terms cover">
        <p>BitoCard is operated by companies in the Golojan group. Your agreement is with the company for the region your business is based in.</p>
        <EntityTable caption="Contracting entity by region" />
        <p>In these terms, “we”, “us” and “BitoCard” mean that company; “you” means the business that holds the reseller account, and includes the people you add to your team. “Your customers” are the people who buy from you, on your store or through your own systems.</p>
        <p>Some features are not live yet, or are offered only in some countries or on some plans. Where a section describes one, it applies only once we switch it on for you. Nothing in these terms promises a country, product, payment method or launch date.</p>
      </Section>

      <Section id="account" title="2. Your account and checks">
        <ul>
          <li><strong>Who can sign up.</strong> You must be a business or a person acting in the course of business, at least 18, and based in a country where we accept resellers (during our pilot: Nigeria, Ghana and Kenya). You trade in your country&apos;s currency; selling to other countries needs the Premium plan and our approval of the products and countries.</li>
          <li><strong>Checks before selling.</strong> Before your account can take live payments, the account&apos;s owner passes our identity check, and your business passes our business check (KYB). If your business is unregistered, the owner&apos;s own check is the business check. If it is registered, you give us its registration certificate, proof of its address and a document naming its directors or owners. We may ask for more, refuse an account, or keep it in test mode, as the law and our risk checks require.</li>
          <li><strong>Tell us the truth.</strong> Everything you give us in these checks must be true, complete and yours to give. A false or borrowed document, or someone else&apos;s identity, ends your account, and we may report it to the authorities.</li>
          <li><strong>Keep it up to date.</strong> Tell us when your business details, owners or directors change. Renaming your business after its check restarts the 24-hour wait on your payout bank accounts.</li>
          <li><strong>Your team.</strong> You may invite staff and give them roles. You are responsible for everything done in your account, by you, your team or anyone using your sign-in details or API keys. Keep passwords, codes and API keys secret, and tell us at once if you think one has been misused.</li>
          <li><strong>Test mode.</strong> Your sandbox lets you try BitoCard with test keys and simulated orders. Nothing in test mode is real: it never charges real money, buys from real suppliers or delivers real products.</li>
        </ul>
      </Section>

      <Section id="model" title="3. How selling with BitoCard works">
        <ul>
          <li><strong>We supply, you sell.</strong> We supply the products in our catalogue at our wholesale price and fulfil each order. You choose which products you offer, set your customers&apos; prices within the limits below, and serve your customers.</li>
          <li><strong>Who sells to your customer.</strong> For products we supply, BitoCard is the seller of record: we collect and pay the sales tax, VAT or GST due on the sale and issue the receipt, under your store&apos;s brand. For products fulfilled by your own supplier account (section 13), you are the seller of record.</li>
          <li><strong>Our suppliers stay ours.</strong> We choose where each order is fulfilled. You must not try to find out, contact or bypass our suppliers through BitoCard, or present our suppliers&apos; names or marks as yours.</li>
          <li><strong>Availability changes.</strong> Products, countries, prices and payment methods can change or be withdrawn at any time, for example when a supplier stops offering them or the law requires it. We tell you in SHQ and through the API.</li>
        </ul>
      </Section>

      <Section id="wallet" title="4. Your wallet, top-ups and payouts">
        <h3 id="wallet-funding">Paying for orders</h3>
        <ul>
          <li><strong>Pre-funding.</strong> Your wallet pays our wholesale price for every order before it is fulfilled. An order your wallet cannot cover is refused. Your store can be published before your wallet is funded, but it cannot take paid orders until it is funded and your checks are complete.</li>
          <li><strong>Two wallets.</strong> You have a wallet in your country&apos;s currency and one in US dollars. You can move money between them at the rate we show before you confirm. Your country&apos;s wallet pays your orders; when it is short, we may use dollars you topped up to cover the difference, at our disclosed rate.</li>
          <li><strong>Top-ups are not withdrawable.</strong> Money you top up (by card, bank transfer, mobile money or your own reserved bank account) can only be spent on orders, fees and your plan. It cannot be withdrawn or paid out. We credit a top-up only once the payment provider confirms it.</li>
          <li><strong>Holds.</strong> When an order is placed we hold its wholesale price. We take it when the order is delivered and give it back if the order fails.</li>
        </ul>
        <h3 id="wallet-earnings">Your profit and payouts</h3>
        <ul>
          <li><strong>Your profit is yours.</strong> On a sale we collect for you, the difference between your customer&apos;s price and our wholesale price (after tax) is your profit. It becomes withdrawable once the payout hold for your country has passed (15 days after the sale unless we tell you otherwise), so that refunds and chargebacks can still be put right.</li>
          <li><strong>Withdrawals.</strong> You can withdraw withdrawable profit to a bank account in your business&apos;s or verified owner&apos;s name, above the minimum we set for your country. A new bank account can be used 24 hours after it is added, and we may check the account name with the bank first. Only the account&apos;s owner can add a payout account.</li>
          <li><strong>Mistakes.</strong> If we credit your wallet by mistake, or a payment we credited is reversed, we may correct your balance. If it goes below what you owe us, you must pay the difference.</li>
          <li><strong>Your balance is not a bank account.</strong> We do not pay interest on it. It is a record of what you have paid in and earned with BitoCard.</li>
        </ul>
      </Section>

      <Section id="pricing" title="5. Prices and markups">
        <ul>
          <li><strong>Our price to you.</strong> SHQ and the API show our wholesale price for every product before you sell it. Quotes hold the price for the time shown on them.</li>
          <li><strong>Your price to your customer.</strong> You set your markup, discount or fixed price for each product, within our rules. Under our Markup Protection Scheme your price can be at most 100% above our wholesale price, or less where we set a lower cap for your country. Products sold at face value (such as local airtime, data, bills and pay-TV) are never sold above face value.</li>
          <li><strong>Be clear with your customers.</strong> Show your customers the full price, including every fee, before they pay. Do not advertise a price you will not honour.</li>
        </ul>
      </Section>

      <Section id="plans" title="6. Plans, fees and promotions">
        <ul>
          <li><strong>Plans.</strong> The Standard plan is free. The Premium plan is a monthly subscription, at the price shown in SHQ, paid from your wallet. It adds chargeback protection, priority support and other benefits listed in SHQ. If your wallet cannot pay a renewal, we warn you and keep Premium for 7 days, then move you to Standard. If you cancel, Premium lasts until the end of the month you paid for.</li>
          <li><strong>Fees.</strong> Where you use your own suppliers or payment gateways (section 13), our fees are taken from your wallet, at the rates shown in SHQ before you use them. We publish your rates, every fee charged and a monthly statement in SHQ.</li>
          <li><strong>Startup allowance.</strong> Where we offer it, a verified new reseller may receive a one-time promotional allowance that pays our wholesale price on customer-paid orders until it is used up. It is not money: it cannot be spent directly, withdrawn, transferred or paid out, and we may stop the programme or remove what is left of it at any time.</li>
          <li><strong>Customer welcome bonus.</strong> Where we switch it on for your store, we fund a small discount on an eligible customer&apos;s first purchase, once per customer, under the conditions shown in SHQ. We may end it at any time.</li>
        </ul>
      </Section>

      <Section id="stores" title="7. Your stores">
        <ul>
          <li><strong>Several stores.</strong> You can run up to five stores, each with its own name, address, design and template. Each store is part of your one reseller account: these terms apply to all of them, and your wallet pays for all of them.</li>
          <li><strong>Addresses.</strong> Each store gets an address on bitocard.com (for example yourstore.bitocard.com). We may refuse or change an address that is misleading, offensive, infringes someone&apos;s rights or is reserved by us. You do not own a bitocard.com address, and it ends when the store is closed.</li>
          <li><strong>Templates and designs.</strong> A store&apos;s template decides what it sells (for example top-ups only, or gift cards only) and its design decides how it looks. You may change them; changing a template starts its home page again. The crypto desk template is offered only where we have switched crypto trading on for you, and its customers also agree to our crypto terms.</li>
          <li><strong>Publishing.</strong> You decide when a store is published. You can take it offline at any time. Customers of a closed store can still sign in and see what they bought.</li>
          <li><strong>Visits.</strong> We count page views and daily visitors on your stores, without cookies and without keeping anything that identifies a visitor, and show you the totals in SHQ.</li>
        </ul>
      </Section>

      <Section id="content" title="8. What you publish on your stores">
        <p>You can write your stores&apos; words, upload logos and images, and arrange their home pages. You are responsible for all of it. Everything you publish must:</p>
        <ul>
          <li><strong>Be yours to use.</strong> You must own, or have permission to use, every logo, image, name and text you upload or write. Do not use other businesses&apos; logos, brand names or product images except to describe a product you genuinely sell, as the brand owner allows.</li>
          <li><strong>Be honest.</strong> No misleading claims about products, prices, delivery times, discounts or availability. No promises BitoCard does not make: for example guaranteed income or returns, instant delivery we do not offer, products or countries we do not supply, or that BitoCard or a brand endorses you.</li>
          <li><strong>Contain no one&apos;s personal data.</strong> Do not upload pictures or details of people without their permission, and never ID documents, card details or anyone&apos;s private information.</li>
          <li><strong>Be lawful and decent.</strong> Nothing illegal, hateful, violent, sexual, defamatory, threatening or harmful to children; nothing that encourages fraud, gambling or breaking the law; no malicious code, hidden links or attempts to collect sign-in or payment details.</li>
          <li><strong>Keep customers on BitoCard&apos;s checkout.</strong> Do not ask customers to pay or contact you outside the store for an order placed through it, other than through payment gateways you connected as section 13 allows.</li>
        </ul>
        <p>You give us a worldwide, royalty-free licence to host, copy, resize, display and deliver what you publish, only to run your stores and show them to you, your customers and our reviewers. You keep ownership of it, and the licence ends when you remove it or close the store, except for copies we must keep by law or in backups for a short time.</p>
        <p>We do not check everything before it is published, but we may review it at any time. If something breaks these terms or the law, or someone credibly complains about it, we may remove it, unpublish the page or the store, or suspend the store, and we will tell you why unless the law prevents us. You must answer complaints about your content and help us deal with them. If a claim is made against us because of what you published, you must cover our reasonable costs of dealing with it.</p>
      </Section>

      <Section id="domains" title="9. Domains">
        <p>This section applies once we switch domains on for you.</p>
        <ul>
          <li><strong>Connecting a domain you own.</strong> You can point a domain you already own at a store. You must own or control it, and you remain responsible for it and its registration. We may refuse or disconnect a domain that infringes someone&apos;s rights or is used for abuse.</li>
          <li><strong>Buying a domain through BitoCard.</strong> We buy it for you from our registrar partner, in your name and contact details: <strong>you are its registrant and own it</strong>, subject to the registrar&apos;s terms and the rules of its ending (such as .com). The registrar may email you to confirm your contact details; if you do not confirm them, the domain can be suspended. Give true contact details, and keep them up to date.</li>
          <li><strong>Price.</strong> We show the first year&apos;s price and the renewal price together before you buy. They include our margin over the registrar&apos;s price and are paid from your wallet. Domain purchases are not refundable once registered.</li>
          <li><strong>Renewals.</strong> We remind you before a domain expires. With automatic renewal on, we renew it for a year from your wallet about 14 days before it expires. If your wallet cannot pay, we tell you and try again; if it is still unpaid when it expires, the domain stops serving your store, and after the registrar&apos;s grace period it can be lost for good.</li>
          <li><strong>Transferring out.</strong> You can ask for a domain&apos;s transfer code in SHQ at any time (subject to the registrar&apos;s rules, such as a wait after registration) and move it to another registrar.</li>
          <li><strong>DNS and email.</strong> Where your domain&apos;s DNS runs on our partner, you can edit its records in SHQ; we keep the records your store needs. You are responsible for your domain&apos;s email set-up. We may send your store&apos;s order emails from your domain once you have set it up for that.</li>
          <li><strong>Abuse.</strong> We may suspend a domain, or ask the registrar to, if it is used for fraud, phishing, spam, malware or anything unlawful.</li>
        </ul>
      </Section>

      <Section id="customers" title="10. Your customers">
        <ul>
          <li><strong>Your customers are yours.</strong> Customers who buy on your store have an account at that store only, and you serve them: you answer their questions and handle their problems first (section 11).</li>
          <li><strong>Who controls their data.</strong> As seller of record for the products we supply, BitoCard controls the personal data needed for those sales (orders, payments, tax and fraud checks). You control the data you use for your own relationship with your customers, such as marketing. You need your own privacy notice for what you control, and you must use customers&apos; data only lawfully and for your store. We will offer you a data protection agreement setting out these roles before your store takes payments.</li>
          <li><strong>Identity checks.</strong> Some products need your customer to pass an identity check before they buy. Where we let you turn these checks off for your store or for a customer, you take responsibility for knowing that customer, and for any loss, chargeback or fine that follows from a sale we would otherwise have checked.</li>
          <li><strong>Reviewing your customers&apos; IDs.</strong> If your business is registered and has passed its business check, we may let you review your own customers&apos; identity checks on BitoCard Verify. If we do, you must keep their documents and selfies confidential, look at them only to decide their check, never copy, download for other uses, share or keep them, allow only trusted team members to review, and make honest decisions you can explain. Your decision is yours, and you are responsible for it. We may take this away at any time and review any decision.</li>
          <li><strong>Through the API.</strong> When you sell from your own systems, you keep your own customers and their sign-in. You must have the right to send us any personal data you send, and only what an order needs.</li>
        </ul>
      </Section>

      <Section id="disputes" title="11. Problems, refunds and chargebacks">
        <ul>
          <li><strong>You answer first.</strong> When a customer reports a problem with an order, you investigate it and reply to them. You can resolve it yourself where no money needs to move. Otherwise you pass it to BitoCard with an honest report of what you found and what you recommend.</li>
          <li><strong>BitoCard decides.</strong> We decide problems passed to us, refunds and anything that moves money, and we may ask you for more first. Our decision is final between you and us, without affecting your customer&apos;s legal rights.</li>
          <li><strong>Refunds.</strong> A refunded sale is reversed: your customer gets their money back the way they paid, our wholesale price comes back from our side, and your profit on it is taken back from your wallet.</li>
          <li><strong>Chargebacks.</strong> If a customer disputes a card payment with their bank, we hold the disputed amount from your wallet while it is decided, and withdrawals wait. If it is lost, the amount and any shortfall are yours, unless you are on Premium, whose chargeback protection covers it. Payments into your own gateway (section 13) are yours to handle.</li>
        </ul>
      </Section>

      <Section id="products" title="12. Products with their own rules">
        <ul>
          <li><strong>Codes and keys.</strong> Gift card codes, licence keys and eSIM activation codes are like cash: whoever holds one can use it. Deliver them only to your customer, keep them secret and never put them in public places.</li>
          <li><strong>Virtual numbers.</strong> Numbers are monthly and renewed from your wallet: your customer decides to renew and your wallet pays (you charge your customer as you agree with them). A number not renewed is paused at expiry and deleted for good 15 days later. Some countries require the user&apos;s documents before a number works.</li>
          <li><strong>eSIMs and software.</strong> Refunds follow the supplier&apos;s rules: usually only an unused, uninstalled eSIM, and never a licence key that has been revealed. Show these rules to your customer before they buy.</li>
          <li><strong>Crypto.</strong> Coin wallets, deposits and withdrawals, running your own exchange desk and trading with BitoCard are offered only in countries where we have taken legal advice and switched them on. Where we do, they follow our crypto terms and the rules shown in SHQ, including network fees, daily limits, a 24-hour wait on new withdrawal addresses, sanctions screening and our review of withdrawals. Send coins only on the network shown; coins sent to the wrong network or address may be lost. If you run a desk, you are the counterparty to your customers&apos; trades from the reserves you fund; if our desk serves them instead, we are. If you leave Premium or we switch crypto off, you can still withdraw what you hold.</li>
        </ul>
      </Section>

      <Section id="integrations" title="13. Your own suppliers and payment gateways">
        <p>This section applies once we allow you to connect your own supplier or payment gateway accounts.</p>
        <ul>
          <li><strong>Your accounts.</strong> You open them with the provider, agree its terms, fund them and pay its charges. We never hold the money in them.</li>
          <li><strong>You are the seller.</strong> For a sale fulfilled by your own supplier, you are the seller of record: you are responsible for the product, its tax, receipts and your customer&apos;s rights, and you own that sale&apos;s data. We process it for you to run the sale, under a data processing agreement.</li>
          <li><strong>Your gateway.</strong> Your store&apos;s customers may pay into your own gateway account. Then our fee and the order&apos;s cost come from your wallet, and refunds go back through your account.</li>
          <li><strong>Our fees.</strong> Our fee rates for using your own integrations are shown in SHQ before you use them. We calculate each fee exactly and carry any fraction of the smallest currency unit to your next transaction rather than rounding it up. We hold the fee before the transaction, take it if it succeeds and give it back if it fails.</li>
          <li><strong>Your credentials.</strong> We store your credentials encrypted and use them only for your own orders and payments. We may suspend a connection that is misused or that the provider stops supporting.</li>
        </ul>
      </Section>

      <Section id="api" title="14. Using our API">
        <ul>
          <li>Keep your API keys and webhook secrets secret, use only the permissions you need, and rotate a key you think has leaked.</li>
          <li>Verify our webhooks&apos; signatures, and treat our API, not a webhook, as the record of an order.</li>
          <li>Stay within our rate limits, and do not test our security, scrape our catalogue for others or resell API access.</li>
          <li>Live orders through the API are real and are paid from your wallet. Use your sandbox to test.</li>
        </ul>
      </Section>

      <Section id="rules" title="15. Things you must not do">
        <ul>
          <li>Break the law, including consumer, tax, sanctions, anti-money laundering, data protection and advertising laws in the countries you sell to.</li>
          <li>Sell to anyone you know or suspect is using a product for fraud, money laundering or another crime, or help anyone get around our checks or limits.</li>
          <li>Use stolen cards, payments or identities, or create orders or accounts to abuse a promotion.</li>
          <li>Interfere with BitoCard, other resellers or their customers.</li>
        </ul>
        <p>We may refuse an order, hold funds we reasonably believe are linked to fraud or a breach of these terms while we investigate, and report suspicious activity where the law requires it.</p>
      </Section>

      <Section id="ending" title="16. Suspension and closing your account">
        <ul>
          <li>You can close your account at any time once your orders, disputes and chargebacks are settled.</li>
          <li>We may suspend your account or a store at once if you break these terms, if the law or a regulator requires it, or to protect customers, suppliers or BitoCard. We tell you why unless the law prevents us, and lift it when the reason has gone.</li>
          <li>We may end these terms by giving you 30 days&apos; notice, or at once for a serious breach.</li>
          <li>When your account closes, your stores go offline. We pay out your withdrawable profit after the payout hold, less what you owe us. Money you topped up is spent only on what you owe, and anything left is returned to where it came from where the payment provider allows. Domains you bought stay yours to transfer.</li>
        </ul>
      </Section>

      <Section id="liability" title="17. Responsibility">
        <p>We will provide BitoCard with reasonable care and skill. Suppliers, networks, payment providers and registrars sometimes fail; we will put right what we can, such as refunding an undelivered order, but to the extent the law allows we are not liable for indirect or consequential loss, or for loss of profit, revenue, business or goodwill. Our total liability to you in any 12 months is limited to the fees and subscriptions you paid us in that time, plus any money of yours we hold.</p>
        <p>Nothing in these terms limits liability that cannot be limited by law, including for fraud, or for death or personal injury caused by negligence.</p>
      </Section>

      <Section id="law" title="18. Changes, governing law and contact">
        <p>We may change these terms. We will tell you in SHQ or by email at least 30 days before a change that is not in your favour takes effect, unless the law requires it sooner; if you do not agree, you may close your account before it does.</p>
        <p>These terms are governed by the law that applies to the company you contract with:</p>
        <ul>
          {legalEntities.map(entity => (
            <li key={entity.name}><strong>{entity.name}</strong>: {entity.governingLaw}, with disputes heard by {entity.courts}.</li>
          ))}
        </ul>
        <p>Email <ContactEmail /> with any question about these terms. Our <Link href="/documents/privacy">privacy notice</Link> explains how we handle personal information.</p>
      </Section>
    </LegalPage>
  );
}
