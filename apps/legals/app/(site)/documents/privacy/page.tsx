import Link from "next/link";
import { ContactEmail, EntityTable, LegalPage, Section } from "@/components/legal";
import { pageMetadata } from "@/components/seo";

const seo = { title: "Privacy notice", description: "How BitoCard handles personal information and your privacy rights under GDPR, US state laws, PIPEDA, NDPA, POPIA and Asian privacy laws.", path: "/documents/privacy" };

export const metadata = pageMetadata(seo);

export default function PrivacyNotice() {
  return (
    <LegalPage
      seo={seo}
      intro={<>
        <p>This notice explains how BitoCard handles personal information when you visit our websites, create a customer account on our store at bitocard.com, buy from it, buy and sell on BitoCard Shop (shop.bitocard.com), sell with BitoCard as a reseller, or contact us.</p>
        <p>We will update this notice before we launch any other service that collects more.</p>
      </>}
    >
      <Section id="who" title="1. Who we are">
        <p>BitoCard is operated by companies in the Golojan group. The company responsible for your personal information depends on where you are. Depending on local law, it is your “controller”, “business”, “organisation”, “responsible party” or “data fiduciary”.</p>
        <EntityTable caption="Responsible entity by region" />
        <p>If your region is not listed, Golojan Technologies LLC is responsible. You can reach any of these companies at <ContactEmail />.</p>
      </Section>

      <Section id="scope" title="2. What this notice covers">
        <p>This notice covers bitocard.com and its subdomains, including our main site (bitocard.com), BitoCard Shop (shop.bitocard.com), this legal site and our documentation, reseller, administration and API sites, and any email you send us. It does not cover third-party websites we link to.</p>
      </Section>

      <Section id="collect" title="3. What we collect">
        <h3>When you visit our websites</h3>
        <p>Like any website, our servers receive technical information so they can deliver pages and protect the service. This includes your IP address, browser and device type, the pages you request, the referring page, and the date and time of your visit. Our hosting provider processes this information in server and security logs.</p>
        <h3>When you choose your country on our store</h3>
        <p>If you tell our store which country you shop from (or that you want to see everything), we remember that choice in a cookie on your device so the store can show products for your country. We use it only for that, keep no record of it against you, and you can change or delete it at any time. See our <Link href="/documents/cookies">cookie notice</Link>.</p>
        <h3>When you create an account on our store</h3>
        <p>Your name, your email address, and your password, which we store only as a one-way hash we cannot reverse. We also keep when you signed in, failed sign-in attempts (to protect your account), and the codes we email to confirm your address or reset your password, stored only as hashes. A cookie keeps you signed in; see our <Link href="/documents/cookies">cookie notice</Link>.</p>
        <p>If you use the free public spins before signing in, we keep its server-set spin outcomes, total, market, expiry and claim status against a random claim token for up to 30 days. The cookie contains only that token. If you claim it, we link the claim to your customer account and keep the wallet ledger record for audit and fraud prevention.</p>
        <h3>When you buy from our store</h3>
        <p>What you bought, its value and price, when, and the details needed to deliver it: for example the mobile number to top up, the smartcard or meter number to pay (and the account name the provider returns for you to confirm), or the email address to send codes to. We keep the codes, PINs and licence keys you buy encrypted, and show them only to you.</p>
        <p>Each order has its own page, linked from its emails. It shows the order only to you: signed in to the account that bought it, or after you enter a code we email to the order&apos;s address (kept only as a hash, valid for 10 minutes). We record when its codes were first shown there and how often, so the store can help if a code is disputed, and we email you when they are shown (at most once a day) so you notice if it was not you.</p>
        <p>If you buy a virtual phone number, we keep the SMS it receives and sends (the other party&apos;s number, the text, kept encrypted, and when) for 90 days, so you can read them on your order&apos;s page, and so can the store that sold it to you. They are deleted with the number if it is not renewed. We email you before your number expires, when it is paused, and before it is deleted.</p>
        <p>You pay on the payment provider&apos;s secure page. We never receive or store your full card number, card security code or mobile money PIN. The provider tells us the payment&apos;s amount, status, reference and the method you used, which we keep with your order and use for refunds.</p>
        <h3>When you buy VPN access</h3>
        <p>We do not sell VPN access in any country yet. Where we do, we keep the VPN username we make for your order and its password (encrypted, shown only to you on your order&apos;s page), when your access started and ends, its status (for example active, ended or suspended), when you revealed your sign-in details and when you changed your password.</p>
        <p>We do not send the VPN network provider that runs the service your name, email address, phone number or payment details: it receives only the username and password we make and the dates your access starts and ends. When you connect, the provider necessarily handles your device&apos;s IP address and the traffic you send through it. We do not see which websites you visit or what you do while connected. Before we sell VPN access, we will set out here what connection information the provider keeps, and for how long. If the provider reports abuse of your access, we may receive the details of its report and match them to your order.</p>
        <h3>When you report a problem with an order</h3>
        <p>If you report a problem with an order (a dispute), we keep what you tell us: the subject, your messages and replies, which order and payment it is about, and when. We also keep the replies and notes of the store you bought from and of BitoCard, how the dispute was handled, and its outcome, such as a refund. The store that sold you the order sees your dispute and answers it first; BitoCard sees it too, and decides it if the store passes it on or if you bought from BitoCard&apos;s own store. Some notes are written only for the store and BitoCard and are not shown to you; you can ask for them as part of a request for your information (see section 10).</p>
        <p>If you dispute a card payment with your bank (a chargeback), the payment provider tells us the amount, its reason code and the outcome, and we keep these with your order and share them with the store that sold it.</p>
        <h3>When you cash out Safe pay sales to your bank</h3>
        <p>The bank accounts you add (bank, account name and account number, the number kept encrypted), when you added them, and each payout&apos;s amount, account, status and the transfer provider&apos;s reference. We check that the account is in the name verified by your identity check, and email you each time an account is added.</p>
        <h3>When an identity check is needed</h3>
        <p>For some products in some countries, and before you are paid out to your bank, the law or our fraud controls require you to verify your identity once. Resellers verify themselves, and their business, before they can sell.</p>
        <p><strong>In African countries we check identities ourselves, with BitoCard Verify</strong> (verify.bitocard.com). You give your name, date of birth, the type and number of your ID document, photos of the document, a selfie and a few short photos taken while you follow on-screen instructions (to show they are taken live). A business that is registered also gives its registered name, number and address, its registration certificate, a proof of address and a document listing its directors or owners. Your photos and selfie are biometric data: we ask for your explicit consent first. We remove location and device details from photos before storing them; documents are encrypted and kept in private storage in the United States, and your ID number is encrypted. A person reviews every check: our staff, or, where you are a customer of a store run by a registered business whose own checks we have verified, that store&apos;s staff, who can then see your documents to decide. We keep the documents of a declined check for 90 days, and of an approved check for up to five years after it, for our legal record keeping, then delete them.</p>
        <p>Elsewhere, Didit checks an identity document and compares it with a selfie, which involves biometric data, and we ask for your explicit consent first; from Didit we keep only the outcome, your verified name and the document&apos;s country, never images or document numbers. In Nigeria, opening a bank account number for your wallet may need your BVN, which we pass to Flutterwave after you approve it and do not keep (a reseller owner&apos;s is kept encrypted only until their accounts are opened).</p>
        <h3 id="shop">When you buy and sell on BitoCard Shop</h3>
        <p>BitoCard Shop is not open in any country yet. Where we open it, we keep:</p>
        <ul>
          <li><strong>Your listings:</strong> their title, description, features, price (and its changes), condition, category, the area you chose, photos and video, how you deliver and how buyers may contact you, their status and dates, and how many people contacted you about them. <strong>Live listings are public</strong>, on BitoCard Shop and in search engines and link previews, with your first name and the first letter of your last name and your badges (a confirmed phone, a passed identity check). We remove the hidden details phones add to photos and videos (such as where they were taken) before storing them, publicly, with DigitalOcean in the United States, and keep a one-way fingerprint of each photo to spot photos copied from another seller&apos;s listing.</li>
          <li><strong>Chats with buyers and sellers:</strong> the messages, photos (kept encrypted in private storage, seen only by the two of you), offers and their outcome, when each side read them, blocks, and when the seller first replied (shown as their response rate). A moderator reads a chat only when one of you reports it, or when it matters to a Safe pay dispute, and each reading is recorded.</li>
          <li><strong>Interest in listings:</strong> the listings you save, and that you asked to see a seller&apos;s phone number or started a chat (the seller sees how many people did). If a seller lets buyers see their phone number, signed-in buyers who ask see the seller&apos;s confirmed number.</li>
          <li><strong>Reports and safety:</strong> reports you make or that are made about you or your listings, our automatic checks and review of listings (see &ldquo;What we do not collect&rdquo;), and any suspension, with its reason.</li>
          <li><strong>Safe pay orders:</strong> the item, price, both fees, how it is handed over, the delivery address (kept encrypted and shown only to the seller, once the buyer has paid), the release code (kept encrypted and shown only to the buyer), any tracking note, the payment and its release or refund, the deadlines, and who ended the order and why; for sellers, their identity check and payout bank account (see &ldquo;When an identity check is needed&rdquo; and &ldquo;When you cash out Safe pay sales to your bank&rdquo;), strikes and any check of a payout. To stop one person being both the buyer and the seller, we compare the two people&apos;s identity checks (ID document, verified name and date of birth) and payout bank accounts.</li>
          <li><strong>Delivery of Safe pay orders:</strong> the seller&apos;s dispatch photos of the item and the sealed parcel (kept encrypted in private storage, seen only by the buyer, the seller, a reseller who sold it and BitoCard), the courier, tracking number and link, and each tracking update with its time.</li>
          <li><strong>Orders on a reseller&apos;s Resale shop:</strong> what is kept for a Safe pay order, plus the store and reseller it was bought from, the price figures each side is paid, your confirmed phone number when you bought (kept encrypted), the listing and the store&apos;s note as you saw them, and the order&apos;s two conversations: the chat between you and the store (where the supplier and the reseller both write, each message shown to you as the store&apos;s) and the supplier and reseller&apos;s own thread about it, which you never see. Once the supplier accepts, the supplier and the reseller see your name, phone number, email and delivery address to hand the item over or deliver it, until 30 days after the order ends; we record each time they are opened. We email you, the supplier and the reseller at each step of the order and before each deadline (to you in the store&apos;s name, sent through Resend from the store&apos;s own address where it has one); these emails never contain anyone&apos;s contact details, codes or messages, only a link to the order. BitoCard Shop sellers and buyers are emailed the same way about their Safe pay orders and their listings&apos; review.</li>
          <li><strong>Safe pay disputes:</strong> the reason, both sides&apos; messages and photos (kept encrypted in private storage), BitoCard&apos;s messages and its decision; on a resale order also the reseller&apos;s messages, and whose fault an upheld dispute was. The reseller sees the dispute and the buyer&apos;s first name and initial; the buyer sees the supplier&apos;s and the reseller&apos;s messages as the store&apos;s.</li>
          <li><strong>Reports of a reseller&apos;s store:</strong> who reported it (a buyer or a supplier), the store, the reason, what you wrote, the order it is about, and our decision and note. Only BitoCard sees who made a report; the reseller is told only when we uphold one. Kept like Safe pay orders.</li>
          <li><strong>Shop assistants</strong> (such as Anjio), where we switch them on: your questions, the answers, the listings it showed you, what it looked up, and your ratings and reports of answers. For a visitor, a cookie (<code>bc_assistant</code>) keeps the conversation on your browser; we keep only a one-way code of its token. To limit how many questions are asked from one place each day, we keep with each question a one-way code made from your IP address that changes every day.</li>
        </ul>
        <p><strong>Shop assistants and AI providers.</strong> A shop assistant&apos;s answers are written by Anthropic or OpenAI. We send them your question and the conversation so far, BitoCard Shop&apos;s own information for your country, and the public details of the listings it looks up. When you are signed in, it can also look up your own listings, your Safe pay orders (never codes) and which of your chats are waiting for a reply (never their messages). We send more only when you ask for it: a seller&apos;s own listing and its photos when they ask it to fill in the listing from its photos, and the latest messages of a chat when a seller asks it to suggest a reply there. Before anything is sent, numbers that look like phone, card or account numbers, codes and passwords are hidden, and we never send your email address, phone number, delivery address or payment details. If you ask for a person, the conversation is passed to our support team as a chat.</p>
        <h3>When you visit a store run by a reseller</h3>
        <p>When you open a page of a reseller&apos;s store hosted by BitoCard (on its bitocard.com address or its own domain), our server counts the page view for that store, so the reseller can see how many people visit it. We count without cookies and keep nothing about you: only, per store, address and day, how many pages were viewed and how many visitors there were. To count each visitor once a day, we keep a one-way code made from your IP address, your browser&apos;s description and the store&apos;s address, mixed with a random value that changes every day. At the end of the day the code and that day&apos;s random value are deleted, so visits can never be linked to you or to each other across days. Crawlers, link previews and pages loaded in advance are not counted. BitoCard&apos;s own store is not counted this way.</p>
        <h3>When you sell with BitoCard as a reseller</h3>
        <p>If you open a reseller account on Seller Head Quarters (shq.bitocard.com), or join a reseller&apos;s team, we keep:</p>
        <ul>
          <li>your name, email addresses, mobile numbers (the sign-in numbers you confirm with a code, and the number the owner gives when opening the reseller account, which is not confirmed and which our team uses only to reach you about your account) and your password, stored only as a one-way hash; your team role; when you signed in, the devices you signed in on and those you turned notifications on for;</li>
          <li>if you use two-step sign-in (your choice, or required by your reseller account): how you receive the second step (an authenticator app, a code emailed to your primary address or one texted to your confirmed mobile number), your authenticator app&apos;s secret key (kept encrypted), your recovery codes and the codes we send you (each stored only as a hash), when you set it up, and when BitoCard support reset it and why;</li>
          <li>your business: its name, country, plan and, after its business check, its type, registered name, number and address (see &ldquo;When an identity check is needed&rdquo;);</li>
          <li>your wallet, top-ups, orders, fees, invoices, what you owe and your credit limit, payouts and the accounts you add for payouts: bank accounts (the account number kept encrypted; we check the account name with the bank through Flutterwave before paying out) and mobile money wallets on your own confirmed phone number (kept encrypted), which we pass to pawaPay to find the wallet&apos;s network and to send the payout;</li>
          <li>your stores: their names, addresses, designs, pages and the logos and images you upload, with who uploaded each file and when. Uploaded files are stored with DigitalOcean in the United States and are public once you publish them on a store, so do not upload pictures of people or anyone&apos;s personal details;</li>
          <li>your domains, where we switch them on: if you buy a domain through BitoCard, the registrant contact details you give (name, organisation, email, phone and postal address), which we pass to our registrar, Vercel Inc., to register it in your name; registries may publish some of them in their public directories under their own rules. If you set your domain up to send your store&apos;s emails, those emails are sent through Resend from your domain;</li>
          <li>if you connect your own supplier or payment gateway accounts, their credentials, kept encrypted and used only for your own orders and payments, and the orders and payments made through them, which we process on your behalf;</li>
          <li>your API keys (only a hash and their last characters) and your webhook endpoints and their delivery logs.</li>
        </ul>
        <h3>When you chat with a store or ask for help</h3>
        <p>Your chats and questions (support tickets) with a store or with BitoCard: what you and those answering write, when, who answered (the store, BitoCard or an AI assistant), the order it is about if you choose one, and notes the store and BitoCard write for each other, which you do not see. The store you bought from sees your chats and questions with it; BitoCard sees them too and answers those passed to it.</p>
        <p><strong>Chatting without an account.</strong> If you chat with a store without signing in, we ask your name and email address so the store can answer you and email you when it replies while you are away. We do not check the email address. A cookie (<code>bc_chat</code>) keeps the chat on your browser for 30 days.</p>
        <p><strong>Photos and files.</strong> Photos (JPEG, PNG) and PDFs you or the store send in a chat are kept with the chat, encrypted, in private storage in the United States, seen only by you, the store and BitoCard, and deleted with the chat. We remove the hidden details phones add to photos (such as where they were taken). They are never sent to an AI assistant.</p>
        <p><strong>AI assistants.</strong> Where a store (or BitoCard) has switched on an AI assistant, your messages are sent to the AI provider it chose, Anthropic, OpenAI or DeepSeek, to write the answer, with the store&apos;s own information about its business and, so it can answer you personally, your name, email address, confirmed mobile number, country and currency from your account (as a visitor, the name and email you gave). Before anything is sent, card and account numbers, codes, PINs and passwords are hidden. The assistant can look up only what the store sells and your own orders at that store (what, when and their status, never codes). DeepSeek processes data in China. A store that uses its own account with one of these providers chooses that provider for its customers. We tell you in the chat that you are talking to an AI assistant, and you can ask for a person at any time.</p>
        <p><strong>Engineering.</strong> If your question shows a problem in our systems, we may describe it to our engineers on GitHub, with no names, email addresses, phone numbers, codes or account numbers.</p>
        <h3>When you contact us</h3>
        <p>If you email us, we receive your email address, your name if you include it, and the content of your message.</p>
        <h3>What we do not collect</h3>
        <p>We do not collect your full card details or precise location (on BitoCard Shop, &ldquo;Use my location&rdquo; finds the nearest area in your browser, and your position is never sent to us), and we do not use analytics, advertising or tracking cookies, or any tracker that follows you across sites or days. See our <Link href="/documents/cookies">cookie notice</Link>.</p>
        <p>Apart from biometric data in identity checks, with your explicit consent, we do not collect sensitive personal information, and we do not make decisions about you based solely on automated processing, including profiling, except that we automatically refuse a BitoCard Shop listing that uses a word for an item that may never be sold, and a Safe pay order whose buyer and seller our checks match as the same person. If an identity check fails, or a listing or order is refused, you can ask for it to be reviewed by a person.</p>
      </Section>

      <Section id="use" title="4. How we use it and our legal bases">
        <div className="legal-table">
          <table>
            <caption>Purposes and legal bases</caption>
            <thead><tr><th scope="col">Purpose</th><th scope="col">Information</th><th scope="col">Legal basis (where required)</th></tr></thead>
            <tbody>
              <tr><th scope="row">Deliver the website, keep it secure, and prevent abuse and fraud</th><td>Technical information</td><td>Our legitimate interests in running a secure website</td></tr>
              <tr><th scope="row">Provide your account, take your payment, deliver your order, send its codes and receipts, and refund you if we cannot deliver</th><td>Account, order and payment information</td><td>Performance of our contract with you</td></tr>
              <tr><th scope="row">Provide VPN access: set it up, end it when its term ends or it is refunded, change its password, and suspend it for abuse</th><td>Order information; your VPN username, password, status and dates; abuse reports from the VPN network provider</td><td>Performance of our contract with you; our legitimate interests in preventing abuse of the service; legal obligation where we must report it</td></tr>
              <tr><th scope="row">Handle problems you report with an order, decide them, and refund you or put things right</th><td>Account, order and payment information; your dispute and its messages</td><td>Performance of our contract with you, and our legitimate interests in resolving complaints fairly</td></tr>
              <tr><th scope="row">Respond to card payment disputes (chargebacks) and protect against fraud</th><td>Order and payment information; the dispute&apos;s details from the payment provider</td><td>Our legitimate interests in defending payments and preventing fraud</td></tr>
              <tr><th scope="row">Check your identity where the law or fraud controls require it, and prevent fraud</th><td>Account and order information, identity check results; biometric data during a document check</td><td>Legal obligation, or our legitimate interests in preventing fraud; explicit consent for biometric data</td></tr>
              <tr><th scope="row">Run BitoCard Shop: publish your listings, connect buyers and sellers through chats, offers and phone numbers, and save listings</th><td>Account information; listings, photos and videos; chats, offers and interest in listings</td><td>Performance of our contract with you</td></tr>
              <tr><th scope="row">Keep BitoCard Shop safe: check and review listings, handle reports, suspend accounts and prevent fraud</th><td>Listings and photo fingerprints; reports; chats that are reported; account information</td><td>Our legitimate interests in a safe marketplace and in preventing fraud; legal obligation where we must report it</td></tr>
              <tr><th scope="row">Provide Safe pay: hold the buyer&apos;s payment, release it to the seller or refund the buyer, decide disputes, and stop one person being both sides</th><td>Account, identity check and payout account information; Safe pay orders, delivery addresses and disputes</td><td>Performance of our contract with you; legal obligation, or our legitimate interests in preventing fraud and money laundering</td></tr>
              <tr><th scope="row">Answer your questions and help you buy and sell with a shop assistant, and review its answers to improve it</th><td>Your questions and its answers; the listings it looks up; your ratings and reports; for sellers who ask, their listing, its photos or a chat</td><td>Our legitimate interests in helping people use BitoCard Shop; performance of our contract with you for what you ask it to do</td></tr>
              <tr><th scope="row">Provide reseller accounts, stores, domains and payouts, and check resellers and their businesses</th><td>Reseller account, business, wallet, payout, store, domain and integration information; identity and business check results</td><td>Performance of our contract with the reseller; legal obligation, or our legitimate interests in preventing fraud, for the checks</td></tr>
              <tr><th scope="row">Show resellers how many people visit their stores</th><td>Technical information, reduced to daily counts the same day</td><td>Our legitimate interests, and the reseller&apos;s, in knowing how their store is used, in a way that keeps nothing about you</td></tr>
              <tr><th scope="row">Keep accounting and tax records</th><td>Order and payment information</td><td>Legal obligation</td></tr>
              <tr><th scope="row">Answer your chats and questions, with people and, where a store or BitoCard has switched one on, an AI assistant</th><td>Your messages and those answering them; your account and, if you choose one, an order</td><td>Performance of our contract with you, and our legitimate interests (and the store&apos;s) in helping customers quickly</td></tr>
              <tr><th scope="row">Reply to your enquiries</th><td>Contact details and message</td><td>Our legitimate interests in responding to you, or steps you ask us to take before entering into a contract</td></tr>
              <tr><th scope="row">Meet legal obligations, and establish or defend legal claims</th><td>Any of the above, where relevant</td><td>Legal obligation, or our legitimate interests</td></tr>
            </tbody>
          </table>
        </div>
        <p>Where the law requires consent, such as for non-essential cookies in some countries, we will ask for it first, and you can withdraw it at any time.</p>
      </Section>

      <Section id="share" title="5. Who we share it with">
        <ul>
          <li><strong>Service providers</strong> who act on our instructions. Vercel Inc. hosts our websites and delivers them through its global network, and our database host stores our records in the United States. Resend and MailerSend send our emails, including your codes and receipts. Our email provider handles messages you send us.</li>
          <li><strong>Our domain registrar</strong>, Vercel Inc., which receives the registrant contact details of domains resellers buy through BitoCard, and the registries of those domain endings. <strong>DigitalOcean</strong> stores the logos and images uploaded to stores and our sites, in the United States.</li>
          <li><strong>Payment providers</strong> that take your payment and send refunds: Stripe (cards), Flutterwave (cards, bank transfer and mobile money), Monnify (Nigerian bank transfer and cards), Paystack (cards, bank transfer, USSD and mobile money in Nigeria, Ghana, Kenya and South Africa) and pawaPay (mobile money), depending on your country and the method you choose. Flutterwave also sends payouts of Safe pay sales to your bank account, and pawaPay sends resellers&apos; withdrawals to their mobile money wallets. Each also processes your payment under its own privacy notice.</li>
          <li><strong>Identity check providers</strong>, where a check is needed: Didit (document and selfie checks outside Africa) and Flutterwave (BVN checks for Nigerian bank account numbers). In Africa we check identities ourselves (BitoCard Verify), storing documents with DigitalOcean in the United States.</li>
          <li><strong>The store you buy from</strong>, when it is a registered business whose own checks we have verified: its staff review your identity check and see your documents, only to verify you.</li>
          <li><strong>The store you bought from</strong>, if it is a reseller&apos;s store: it sees your account details, your orders and your disputes with it, so it can serve you and answer your problems. Each store also has its own privacy notice for what it does with your information.</li>
          <li><strong>The companies that fulfil your order</strong>, such as the mobile network, pay-TV operator or utility, which receive only what they need to deliver it (for example the number to top up). <strong>The VPN network provider</strong> that runs VPN access receives only a username and password we make for your order, never your name or contact details (see section 3).</li>
          <li><strong>AI providers</strong>, Anthropic, OpenAI and DeepSeek (which processes data in China), where a store or BitoCard has switched on an AI assistant: they receive your chat and question messages, with card and account numbers, codes, PINs and passwords hidden, your name, email address, confirmed mobile number, country and currency, and the store&apos;s information about its business, to write answers.</li>
          <li><strong>Other BitoCard Shop users and the public:</strong> live listings are public (see section 3), including in search engines and in previews when a listing&apos;s link is shared. The other person in a chat sees your first name and the first letter of your last name, your messages and your offers; a seller sees a Safe pay buyer&apos;s delivery address once they have paid; on a reseller&apos;s Resale shop, the supplier and the reseller see the buyer&apos;s name, phone number, email and address once the supplier accepts, and the courier the seller chooses receives the delivery address and whatever the seller gives it to deliver. <strong>AI providers</strong> Anthropic and OpenAI write shop assistants&apos; answers, receiving what section 3 describes.</li>
          <li><strong>Golojan group companies</strong> listed above, where needed to run BitoCard or answer you.</li>
          <li><strong>Authorities, courts and advisers</strong>, where the law requires it or to protect our rights, users or the public.</li>
          <li><strong>A buyer or successor</strong>, if all or part of our business is reorganised or sold, subject to this notice.</li>
        </ul>
        <p>We do not sell personal information. We do not share it for cross-context behavioural advertising or use it for targeted advertising.</p>
      </Section>

      <Section id="transfers" title="6. International transfers">
        <p>Our group companies are in the United States, the United Kingdom and Nigeria, and our websites are hosted mainly in the United States through a global network. Your information may therefore be processed outside your country.</p>
        <p>When we transfer personal information, we use the safeguards your local law requires. These include adequacy decisions, the European Commission’s Standard Contractual Clauses, the UK International Data Transfer Addendum, and contractual commitments that meet the Nigerian, South African, Canadian and Asian laws described below. Contact us for more information about these safeguards.</p>
      </Section>

      <Section id="retention" title="7. How long we keep it">
        <ul>
          <li>Server and security logs are kept by our hosting provider for a short period, usually no longer than 30 days.</li>
          <li>The daily code used to count a store&apos;s visitors is deleted at the end of the day. The daily counts, which contain no personal information, are kept for about 13 months.</li>
          <li>Uploaded images are kept while they are used on a store or our sites; uploads never completed are deleted within a day. A domain&apos;s registrant details are kept while it is registered through us, and as long as our records of its purchase.</li>
          <li>Your account is kept while it is open. Ask us to close it at any time; we then delete your account details within 30 days, except what we must keep for the records below.</li>
          <li>Orders, payments and refunds are kept for as long as accounting and tax laws require, usually six years after the order.</li>
          <li>VPN usernames, passwords, statuses and dates are kept with the order they belong to, like orders.</li>
          <li>Disputes and their messages are kept with the order they are about, for as long as we keep the order (usually six years after it), so we can deal with any claim about it.</li>
          <li>Bank accounts you add for payouts are kept until you remove them, and then only with the records of the payouts that used them.</li>
          <li>Identity check outcomes are kept while your account is open and for up to five years after, where anti-fraud or anti-money-laundering rules require it.</li>
          <li>BitoCard Shop listings are public while they are live (sold ones for about 30 days after), then kept, not public, while your account is open and with the records of any Safe pay order or report about them; a draft is deleted when you delete it. Chats with buyers and sellers are deleted with their photos 12 months after their last message, unless a report on them is still open. Shop assistant conversations are deleted 30 days after their last message, with the daily codes kept with them. Safe pay orders and disputes, with their messages and photos, are kept like orders and payments, usually six years after the order.</li>
          <li>Chats are deleted 12 months after they end, with their photos and files (and the name and email a visitor gave, once they have no chat left and have not been back for 12 months); support questions two years after they are resolved, with their messages.</li>
          <li>Correspondence is kept for as long as we need it to deal with your enquiry, then for up to two years, unless a longer period is needed to meet a legal obligation or to establish or defend a legal claim.</li>
        </ul>
      </Section>

      <Section id="security" title="8. Security">
        <p>We use encrypted connections (HTTPS), security headers and access controls, and we choose providers with strong security practices. Bank account numbers are encrypted. No method of transmission or storage is completely secure, but we work to protect your information and will notify you and regulators of a breach where the law requires it.</p>
      </Section>

      <Section id="children" title="9. Children">
        <p>Our websites are for adults and are not directed to children. We do not knowingly collect personal information from anyone under 18. If you believe a child has sent us personal information, contact us and we will delete it.</p>
      </Section>

      <Section id="rights" title="10. Your rights">
        <p>Depending on where you live, you may have the right to:</p>
        <ul>
          <li>know what personal information we hold about you and get a copy;</li>
          <li>correct inaccurate information;</li>
          <li>have your information deleted;</li>
          <li>restrict or object to our use of it;</li>
          <li>receive it in a portable format;</li>
          <li>withdraw consent where we rely on it;</li>
          <li>appeal our decision on your request; and</li>
          <li>complain to a data protection regulator.</li>
        </ul>
        <p>Some rights are limited by law: we must keep some records, such as those of your orders and payouts, for as long as anti-money-laundering, accounting and tax laws require.</p>
        <p>To use these rights, email <ContactEmail />. We may need to verify your identity first. We will not charge a fee or treat you differently for using your rights, and we will reply within the time your local law requires. You can also ask an authorised agent to make a request for you; we may ask for proof that they are authorised.</p>
      </Section>

      <Section id="regions" title="11. Information for your region">
        <h3 id="europe">United Kingdom, European Economic Area and Switzerland</h3>
        <p>Golojan Ltd (company no. 17481904, 12 Devon Road, Canterbury CT1 1RP) is the controller under the UK GDPR, the EU General Data Protection Regulation and the Swiss Federal Act on Data Protection. Our legal bases are set out in section 4. You may complain to the UK Information Commissioner’s Office, the data protection authority in the EEA country where you live or work, or the Swiss Federal Data Protection and Information Commissioner. We would appreciate the chance to address your concern first.</p>

        <h3 id="united-states">United States</h3>
        <p>This section applies to residents of California and of other states with comprehensive privacy laws, including Colorado, Connecticut, Texas, Utah and Virginia. In the last 12 months we have collected identifiers (such as IP address and email address) and internet activity on our websites (such as pages visited). We collect them from you and your device, for the purposes in section 4, and keep them as set out in section 7. We disclose them only to the service providers and recipients in section 5.</p>
        <p>We do not sell or share personal information, use it for targeted advertising or profiling, or collect sensitive personal information. We honour Global Privacy Control signals. You have the rights in section 10, including to know, correct and delete. If we decline your request, you can appeal by replying to our decision. If your appeal is denied, you may contact your state Attorney General.</p>

        <h3 id="canada">Canada</h3>
        <p>We handle personal information in line with the Personal Information Protection and Electronic Documents Act (PIPEDA), Quebec’s Act respecting the protection of personal information in the private sector, and similar provincial laws. You can reach the person responsible for privacy at <ContactEmail />. You may complain to the Office of the Privacy Commissioner of Canada or, in Quebec, the Commission d’accès à l’information.</p>

        <h3 id="africa">Africa</h3>
        <p>De-Golojan Technologies Ltd is responsible for personal information of people in Africa. We handle it in line with the Nigeria Data Protection Act 2023, South Africa’s Protection of Personal Information Act 2013 (POPIA), Kenya’s Data Protection Act 2019, Ghana’s Data Protection Act 2012 and other applicable national laws. You may complain to the Nigeria Data Protection Commission, South Africa’s Information Regulator, Kenya’s Office of the Data Protection Commissioner, Ghana’s Data Protection Commission, or the data protection authority in your country.</p>

        <h3 id="asia">Asia</h3>
        <p>We handle personal information in line with applicable laws, including India’s Digital Personal Data Protection Act 2023, Singapore’s Personal Data Protection Act 2012, Japan’s Act on the Protection of Personal Information, South Korea’s Personal Information Protection Act, the Philippines’ Data Privacy Act of 2012, Hong Kong’s Personal Data (Privacy) Ordinance, and the data protection laws of Indonesia, Malaysia, Thailand and the United Arab Emirates.</p>
        <p>Contact <ContactEmail /> first, including for grievances under Indian law. If you are not satisfied, you may complain to your local regulator, such as the Data Protection Board of India, Singapore’s Personal Data Protection Commission, Japan’s Personal Information Protection Commission, South Korea’s Personal Information Protection Commission, the Philippines’ National Privacy Commission or Hong Kong’s Office of the Privacy Commissioner for Personal Data.</p>

        <h3 id="elsewhere">Everywhere else</h3>
        <p>If you live elsewhere, you have the rights your local law gives you, and we will respect them. Contact us to use them.</p>
      </Section>

      <Section id="changes" title="12. Changes to this notice">
        <p>We will update this notice as BitoCard develops, and in particular before we launch accounts, payments or transactions. We will change the “last updated” date and, where the changes are significant, give notice in a prominent way.</p>
      </Section>

      <Section id="contact" title="13. Contact us">
        <p>Email <ContactEmail /> with any question or request about your personal information.</p>
      </Section>
    </LegalPage>
  );
}
