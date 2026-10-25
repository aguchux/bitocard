import Link from "next/link";
import { legalEntities } from "@bitocard/ui/legal";
import { ContactEmail, EntityTable, LegalPage, Section } from "@/components/legal";
import { pageMetadata } from "@/components/seo";

const seo = { title: "Terms of use", description: "The terms for using BitoCard websites: acceptable use, intellectual property and governing law for Europe, the Americas, Africa and Asia.", path: "/documents/terms" };

export const metadata = pageMetadata(seo);

export default function TermsOfUse() {
  return (
    <LegalPage
      seo={seo}
      intro={<p>These terms apply when you use the BitoCard websites. By using them, you agree to these terms. If you do not agree, please do not use the websites.</p>}
    >
      <Section id="who" title="1. Who we are">
        <p>The BitoCard websites are operated by companies in the Golojan group. Your agreement is with the company for your region.</p>
        <EntityTable caption="Contracting entity by region" />
        <p>If your region is not listed, your agreement is with Golojan Technologies LLC. In these terms, “we”, “us” and “our” mean that company.</p>
      </Section>

      <Section id="coming-soon" title="2. BitoCard is coming soon">
        <p>You can create a customer account on our store at bitocard.com. Buying on the store opens country by country: before you can pay in your country, our terms of sale (delivery, refunds and the company you buy from) will be published here and shown before you pay. Until then, BitoCard does not offer wallets, payments, or the purchase, sale or trade of gift cards, airtime, data or any other product in your country.</p>
        <ul>
          <li>Until our terms of sale apply in your country, nothing on these websites is an offer to sell, buy or trade anything.</li>
          <li>Storefront images and previews are illustrative. They do not show live products, prices or availability.</li>
          <li>Planned features, products, markets, timings and prices may change or may not launch. Availability will vary by country and depends on local law, regulatory approval, payment and verification arrangements, and supplier coverage.</li>
          <li>Setup times, including our five-minute store setup goal, are goals, not promises. Verification, funding and readiness to take orders may take longer.</li>
        </ul>
        <p>Crypto wallets and peer-to-peer (P2P) trading are not offered in any country yet. Section 4 explains how they will work where we switch them on.</p>
        <p>VPN access is not sold in any country yet either. Section 5 sets out its terms for when it is.</p>
        <p>BitoCard Shop (shop.bitocard.com), our marketplace for buying and selling near you, is not open in any country yet. Buying and selling there, Safe pay and its shop assistants follow our <Link href="/documents/shop-terms">BitoCard Shop terms</Link>.</p>
        <p>When a service launches, it will be governed by separate terms, such as our <Link href="/documents/reseller-terms">reseller terms</Link> and customer terms of sale, which you will need to accept before using it.</p>
      </Section>

      <Section id="problems" title="3. Problems with an order">
        <p>If something is wrong with an order you bought on a BitoCard store (for example a code does not work, or you were charged but not delivered), report it from the order&apos;s page in your account: choose &ldquo;Report a problem with this order&rdquo; and tell us what happened. You can follow it and reply under &ldquo;Your disputes&rdquo;.</p>
        <ul>
          <li><strong>The store answers first.</strong> If you bought from a reseller&apos;s store, that store investigates your problem and replies to you. It can resolve it with you, or pass it to BitoCard with its findings.</li>
          <li><strong>BitoCard decides what it is passed.</strong> BitoCard reviews the problem and the store&apos;s findings and decides. It may ask the store for more information first. If you bought from BitoCard&apos;s own store, BitoCard handles your problem from the start.</li>
          <li><strong>Refunds go back to how you paid.</strong> If you are refunded, the money returns to the card, bank account or mobile money wallet you paid with. Banks and mobile money providers can take a few days to show it.</li>
        </ul>
        <p>We tell you by email or in your account when your problem has a reply or a decision. Reporting a problem does not affect your statutory rights as a consumer, or your right to dispute a card payment with your bank. If you dispute a payment with your bank, we may share your order&apos;s details with the payment provider and the store to respond to it.</p>
        <h3 id="help">Help, chat and AI assistants</h3>
        <p>You can ask a store a question from your account (&ldquo;Help &amp; support&rdquo;) or chat with it. The store answers first and can pass your question to BitoCard.</p>
        <ul>
          <li><strong>Some stores use an AI assistant.</strong> It always says it is an AI assistant, may answer your chat or your question, and can make mistakes. It cannot make refunds, promises or decisions about your money: those are made by the store and BitoCard, through &ldquo;Report a problem&rdquo; on your order.</li>
          <li><strong>You can ask for a person at any time</strong> (&ldquo;Talk to a person&rdquo;), and the assistant hands over by itself when it should.</li>
          <li><strong>Never send codes, PINs, passwords or card numbers</strong> in a chat or question. Neither a store nor BitoCard will ask for them, and the assistant hides them if you do.</li>
        </ul>
      </Section>

      <Section id="crypto" title="4. Crypto wallets and P2P trading">
        <p>This section applies only where we offer crypto wallets and P2P trading. <strong>We do not offer them in any country yet.</strong> We will switch them on country by country, and only after taking legal advice in that country. A store may choose not to offer them even where we do. Where they are not switched on for you, nothing in this section is an offer.</p>

        <h3 id="crypto-who">Who can use them</h3>
        <ul>
          <li>You need a customer account at a store on BitoCard, with a confirmed email address, in a country where we offer crypto. You trade in your account&apos;s country and its currency.</li>
          <li>You must be at least 18 and use your account only for yourself. You must not let anyone else use it, or use anyone else&apos;s.</li>
          <li>You must pass our identity check first: in Nigeria a BVN check, elsewhere a check of an identity document and a selfie. Our <Link href="/documents/privacy">privacy notice</Link> explains how these work.</li>
          <li>Stores that are still testing (sandbox stores) show test crypto that has no value and cannot be withdrawn.</li>
        </ul>

        <h3 id="crypto-custody">How we hold your crypto</h3>
        <ul>
          <li>You can hold USDT, USDC, BTC, ETH, BNB, POL, TRX, LTC and DOGE, on the networks we show for each coin when you deposit or withdraw. Some coins come on several networks (for example ETH on Ethereum, Arbitrum, Base and OP Mainnet): your balance is the same whichever network it arrived on, but send each deposit only on a network we show for it. We may add or remove coins and networks.</li>
          <li>We hold your crypto for you in wallets BitoCard controls. Their keys are kept in a key management service behind our signing service, and you do not hold them: you move your crypto only through BitoCard, as described here. The crypto we hold for customers is held together in BitoCard&apos;s wallets, and how much of it is yours is recorded in our records, which your balance shows.</li>
          <li>We check every day that our wallets hold what our records say we hold for customers.</li>
          <li>Your crypto balance is not a bank deposit or e-money. We do not pay interest on it, and we do not lend, stake or invest it.</li>
        </ul>

        <h3 id="crypto-market">The P2P market</h3>
        <ul>
          <li>Customers of every store on BitoCard, including bitocard.com, trade with each other in one market for each country. Prices are set by customers in their ads, not by BitoCard, and each trade is between you and the other customer.</li>
          <li>Other traders see you only by a nickname, which we create for you and which you can change once, and by how many trades you have completed. They never see your name, email address or store.</li>
          <li><strong>Ads.</strong> You can post up to 10 open ads to sell or buy a coin at a fixed price, with the smallest and largest trade you accept. A sell ad locks all the crypto it offers. A buy ad locks the money it needs, taken first from your P2P money and then from your wallet; if you change its price, we lock more or give back the difference. Locked amounts cannot be used for anything else while the ad is open. You can pause or close an ad at any time, and closing it gives back whatever is still locked.</li>
          <li><strong>Ads must be honest.</strong> Do not post ads you do not mean to honour, misleading prices or terms, or ads that ask anyone to pay or talk outside BitoCard.</li>
          <li><strong>Instant trades.</strong> When you take an ad, you see the price, the amount, our fee and what you will receive before you confirm. When you confirm, the trade completes at once: the seller&apos;s crypto goes to the buyer, less our fee, and the buyer&apos;s money goes to the seller&apos;s P2P money. Either everything moves or nothing does. If the ad&apos;s price or our fee has changed since you saw it, the trade is refused and you are not charged.</li>
          <li><strong>Completed trades are final.</strong> They cannot be cancelled or reversed. If you believe a trade was made through fraud or an error on our part, contact us and we will look into it.</li>
          <li><strong>Fees.</strong> Our P2P fee is a percentage of each trade, set for each coin and taken from the crypto the buyer receives. Withdrawals have their own network fee (see below). We show every fee before you confirm.</li>
        </ul>

        <h3 id="crypto-deposits">Deposits</h3>
        <ul>
          <li>You get your own deposit address for each network. Send only the coin shown, on the network shown. A different coin or token, the wrong network, or the wrong address may be lost, and we may not be able to recover it.</li>
          <li>We credit a deposit only once it has the number of network confirmations we require for that network. Larger deposits are also checked through a second, independent source first. Deposits can take longer when a network is busy or our providers cannot be reached.</li>
          <li>We record each coin to 6 decimal places (USDT, USDC and TRX) or 8 (BTC, ETH, BNB, POL, LTC and DOGE). Anything smaller is not credited.</li>
        </ul>

        <h3 id="crypto-withdrawals">Withdrawals</h3>
        <ul>
          <li>You can withdraw only to an address you have saved. You can use a new address 24 hours after adding it, and we email you every time one is added, so you notice if it was not you.</li>
          <li>Each withdrawal shows our network fee, which is added to the amount, the minimum for that network and your daily limit for that coin (over any 24 hours). We set the amount and fee aside and email you a code naming the amount, network and address. The withdrawal goes ahead only when you enter the code, within 30 minutes; otherwise it is cancelled and the amount returned. You can cancel it until it is sent.</li>
          <li>We screen every address against sanctions lists when you add it and again before we send to it, and we refuse addresses that are on them.</li>
          <li>Our team reviews some withdrawals before they are sent, for example large amounts, addresses we could not screen, and withdrawals soon after a card or mobile money top-up. We may approve or refuse them; a refused withdrawal&apos;s amount and fee are returned to you.</li>
          <li><strong>Check the address and network.</strong> Once a withdrawal is sent on the blockchain, it cannot be reversed. Crypto sent to a mistyped address or on the wrong network may be lost for good.</li>
          <li>A withdrawal is complete once the network has confirmed it. If it fails before it is sent, the amount and fee are returned to you.</li>
        </ul>

        <h3 id="crypto-freezes">Freezes and seizure</h3>
        <ul>
          <li>We may freeze an amount of your crypto, or your whole crypto account, for security reasons, if we suspect fraud or a breach of these terms, for legal or sanctions reasons, or where a court or authority requires it. A frozen amount cannot be used. While your account is frozen you cannot trade, post ads or withdraw, and your ads leave the market.</li>
          <li>We release a freeze when its reason ends. Where the law, a court or an authority requires it, or to make good losses caused by fraud, we may instead take the frozen crypto from your account.</li>
          <li>We may close any ad that breaks these terms or that we need to stop; whatever it locks goes back to you.</li>
          <li>We will tell you about a freeze unless the law or an authority prevents us.</li>
        </ul>

        <h3 id="crypto-closing">If crypto closes in your country or your store closes</h3>
        <p>We may stop crypto wallets or P2P trading in a country, stop offering a coin, or a store may close. You then cannot post ads or trade, but you can still see what you hold, close your ads (getting back what they lock), withdraw your crypto on chain and cash out your P2P money. Do not send new deposits after we tell you crypto is closing; a deposit to your address that arrives anyway is still credited to you once confirmed, and you can withdraw it.</p>

        <h3 id="crypto-cash-out">Cashing out P2P money to your bank</h3>
        <p>Money you receive from selling crypto is your P2P money. You can use it to buy crypto or cash it out to your bank:</p>
        <ul>
          <li>only to a bank account in the name verified by your identity check, never anyone else&apos;s. You can save up to 3 accounts; a new account can be used 24 hours after you add it, and we email you each time;</li>
          <li>each sale&apos;s money can be cashed out once your country&apos;s payout hold has passed, so a payment later reversed can still be put right. We show how much is held and the minimum amount;</li>
          <li>we send the transfer through our bank transfer provider. If the transfer fails, the money returns to your P2P money. If the provider&apos;s answer is unclear, we check with it, and the money stays set aside until we know: this can take longer.</li>
        </ul>
        <p>Money you add to your store wallet can be spent on crypto, but cannot itself be cashed out.</p>

        <h3 id="crypto-risks">Risks you should understand</h3>
        <ul>
          <li>Crypto prices can rise and fall sharply, and you can lose some or all of the value you hold. Stablecoins such as USDT and USDC aim to track the US dollar but may not.</li>
          <li>Crypto is not legal tender and not a bank deposit. It is not protected by any deposit protection or investor compensation scheme.</li>
          <li>Blockchain networks can be congested, change their rules or stop working, and their fees can change. Transfers on them cannot be reversed.</li>
          <li>Laws on crypto are changing and may require us to limit or stop the service in your country.</li>
          <li>You are responsible for any tax on your crypto and your trades.</li>
          <li>We do not give investment advice (see section 6). Only buy crypto you can afford to lose.</li>
        </ul>

        <h3 id="crypto-prohibited">What you must not do</h3>
        <ul>
          <li>launder money, finance terrorism, or deal in the proceeds of crime;</li>
          <li>commit or help fraud, including with stolen cards, accounts or payments;</li>
          <li>evade sanctions, or trade for or with anyone under sanctions;</li>
          <li>use someone else&apos;s account, identity or bank account, or let someone use yours;</li>
          <li>post misleading ads or manipulate prices.</li>
        </ul>
        <p>If you do, we may freeze your crypto and your account, cancel anything not yet completed, and report it to the authorities where the law requires it.</p>

        <h3 id="crypto-spin">Spin and win</h3>
        <p>Where we run it, Spin and win is a free BitoCard promotion: nothing is bought to take part. These rules apply:</p>
        <ul>
          <li>Where free public spins are open, you may take the number of visitor spins shown (six unless we set another number for your country) before signing in. We keep the results against a random browser claim for 30 days. Create an account or sign in on that browser to claim the total into your local or US dollar store wallet. A visitor claim is once only, cannot be transferred, and is removed if it has expired, the account has already started this promotion, or the account has already used that day&apos;s registered spins.</li>
          <li>Each person can win US$1 in crypto in all, once, whichever stores they use: an email address that has had it at one store cannot have it again at another. Opening other accounts to take part again is not allowed.</li>
          <li>You get between 50 and 100 spins, set when you first spin, and can spin as many times a day as the store shows, two unless we change it for your country (days start at midnight UTC). Each spin wins between US$0.01 and US$0.10, and your spins add up to exactly US$1. What each spin wins is set by us in advance, not by chance on the wheel: the wheel shows it, and shows only amounts that can be won.</li>
          <li>Wins are credited at once to your Spin and win rewards with us, in BNB, USDT or USDC as the wheel shows. USDT and USDC count as one US dollar each. BNB is worth the win at its US dollar price when you spin, rounded down; if we cannot get a price, that spin is credited in USDT instead.</li>
          <li>Rewards are store credit, not crypto you can take away: they cannot be withdrawn, sent to an address, sold on the P2P market or paid out to a bank. You can move them into your store wallet, in US dollars or your country&apos;s currency, and spend them there on the store&apos;s products like any wallet money (which is never withdrawn either). They are valued when you move them: USDT and USDC at one US dollar, BNB at its US dollar price then, rounded down to the cent, then converted at our exchange rate for wallets, shown before you confirm.</li>
          <li>You need everything our crypto wallets need (section 4): a confirmed email, your identity checked where required, and an account that is not frozen. Test stores pay test crypto with no value.</li>
          <li>We may end or change the promotion at any time, without affecting what you have already won: rewards you hold can still be moved into your wallet after it ends. We may take back rewards gained by breaking these rules.</li>
        </ul>
      </Section>

      <Section id="vpn" title="5. VPN access">
        <p>This section applies only where we sell VPN access. <strong>We do not sell it in any country yet.</strong> We will offer it country by country, only where we may lawfully sell it, and a store may choose not to sell it. Where it is not on sale to you, nothing in this section is an offer.</p>

        <h3 id="vpn-what">What you buy</h3>
        <ul>
          <li>Access to a VPN service for a fixed term of 30 days, used through the VPN apps and settings shown on your order, on up to the number of devices shown when you buy (10 at present) at the same time.</li>
          <li>BitoCard sells it to you, whichever store you buy from, and a VPN network provider runs the service for us. You get a username and password for it on your order&apos;s page.</li>
          <li>It is for you and the people in your household. You must not sell, share publicly or give away your sign-in details.</li>
        </ul>

        <h3 id="vpn-term">When it starts and ends</h3>
        <ul>
          <li>Access starts when your sign-in details are ready, usually within minutes of paying. It lasts at least 30 full days and ends at midnight UTC after that, at the time shown on your order&apos;s page.</li>
          <li><strong>It never renews automatically</strong> and we never charge you again for it. To keep using a VPN after it ends, buy VPN access again: each purchase is a new access with new sign-in details.</li>
          <li>You can change your password on your order&apos;s page while your access is active. Every device using the old password is then signed out.</li>
        </ul>

        <h3 id="vpn-refunds">Cancelling and refunds</h3>
        <ul>
          <li><strong>If we cannot set up your access</strong>, the order fails and you are refunded in full, the way you paid.</li>
          <li><strong>Before your sign-in details are first shown to you</strong>, you can cancel within 14 days of buying and be refunded in full: report a problem with the order (section 3).</li>
          <li><strong>Once they have been shown to you</strong>, the service has started at your request and, where the law allows, you can no longer cancel it just because you change your mind. If the VPN does not work for you and neither the store nor BitoCard can fix it, you will be refunded in full.</li>
          <li>Refunds go back the way you paid, and a refund ends your access straight away.</li>
          <li>This does not affect your statutory rights as a consumer.</li>
        </ul>

        <h3 id="vpn-limits">What a VPN does and does not do</h3>
        <ul>
          <li>A VPN is designed to encrypt the connection between your device and the VPN server, and to show the websites you visit the server&apos;s address instead of yours. It does not make you anonymous, does not protect you from viruses, scams or the websites and apps you use, and does not stop the websites you sign in to from knowing who you are.</li>
          <li>We do not promise any speed or server location, or that a particular website, app or streaming service will work through it. Some services refuse VPN connections.</li>
          <li>Using a VPN is restricted or illegal in some countries. You are responsible for using it lawfully where you are.</li>
        </ul>

        <h3 id="vpn-use">What you must not do</h3>
        <p>You must not use VPN access to break the law, or to:</p>
        <ul>
          <li>send spam, run scams or phishing, or commit fraud;</li>
          <li>attack, scan or gain unauthorised access to any system or network, or spread malware;</li>
          <li>share or obtain material that sexually exploits children, or any other illegal content;</li>
          <li>infringe anyone&apos;s copyright or other rights;</li>
          <li>harass or threaten anyone;</li>
          <li>overload the service, or resell or share access beyond your household.</li>
        </ul>
        <p>If you do, or if the VPN network provider reports abuse of your access, we may suspend or end it without a refund, and report it to the authorities where the law requires it. If we suspend your access by mistake, we will restore it, or refund you in full if you prefer. If the service stops for good for reasons that are not your fault, you will be refunded in full.</p>
      </Section>

      <Section id="no-advice" title="6. No financial advice">
        <p>Nothing on these websites is financial, investment, legal or tax advice, and we do not promise any level of income or profit from reselling.</p>
      </Section>

      <Section id="use" title="7. Using the websites">
        <p>You may use the websites for lawful, personal or business information purposes. You must not:</p>
        <ul>
          <li>break any law or anyone’s rights while using them;</li>
          <li>attempt to gain unauthorised access to, disrupt, overload or damage the websites or the systems behind them;</li>
          <li>introduce malware, or probe, scan or test for vulnerabilities without our written permission;</li>
          <li>scrape or copy content in bulk, or use automated means to access the websites other than standard search engine indexing;</li>
          <li>pretend to be BitoCard or the Golojan group, or claim a relationship with us that does not exist.</li>
        </ul>
        <p>If you believe you have found a security vulnerability, please report it to <ContactEmail />.</p>
      </Section>

      <Section id="ip" title="8. Intellectual property">
        <p>The BitoCard name and logo, and the text, design and code of these websites, belong to the Golojan group or its licensors and are protected by intellectual property laws. You may view and share links to our pages, but you may not copy, adapt or use our brand or content for commercial purposes without our written permission.</p>
        <p>Other product and brand names, including gift card brands, belong to their owners. Their mention does not imply endorsement or a relationship with us.</p>
      </Section>

      <Section id="links" title="9. Links to other websites">
        <p>Where we link to other websites, we do so for convenience. We do not control them and are not responsible for their content or practices.</p>
      </Section>

      <Section id="availability" title="10. Availability and changes">
        <p>We may change, suspend or withdraw any part of the websites at any time. We do not guarantee that they will always be available, uninterrupted or free from errors.</p>
      </Section>

      <Section id="liability" title="11. Our responsibility to you">
        <p>We provide the websites free of charge and “as is”. To the extent the law allows, we make no warranties about their content, accuracy or availability.</p>
        <p>To the extent the law allows, we are not liable for any indirect or consequential loss, or for loss of profit, revenue, business or data, arising from your use of the websites or your reliance on their content.</p>
        <p>Nothing in these terms limits or excludes liability that cannot be limited or excluded by law, including liability for death or personal injury caused by negligence, or for fraud. Nothing in these terms affects your statutory rights as a consumer.</p>
      </Section>

      <Section id="law" title="12. Governing law and disputes">
        <p>These terms are governed by the law that applies to the company you contract with:</p>
        <ul>
          {legalEntities.map(entity => (
            <li key={entity.name}><strong>{entity.name}</strong>: {entity.governingLaw}, with disputes heard by {entity.courts}.</li>
          ))}
        </ul>
        <p>If you are a consumer, you keep the protection of the mandatory laws of the country where you live. You may also bring proceedings in your local courts where your local law allows it. This includes consumers in the European Union, Scotland, Northern Ireland and Quebec.</p>
        <p>Before starting formal proceedings, please contact us at <ContactEmail /> so we can try to resolve the issue.</p>
      </Section>

      <Section id="general" title="13. General">
        <p>If any part of these terms is found to be unenforceable, the rest remains in effect. If we do not enforce a term straight away, we can still enforce it later. We may update these terms; the version on this page at the time you use the websites applies. Our <Link href="/documents/privacy">privacy notice</Link> and <Link href="/documents/cookies">cookie notice</Link> explain how we handle personal information.</p>
      </Section>

      <Section id="contact" title="14. Contact us">
        <p>Email <ContactEmail /> with any question about these terms.</p>
      </Section>
    </LegalPage>
  );
}
