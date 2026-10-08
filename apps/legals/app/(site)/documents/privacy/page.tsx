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
        <p>This notice explains how BitoCard handles personal information when you visit our websites, create a customer account on our store at bitocard.com, buy from it, or contact us.</p>
        <p>We will update this notice before we launch any other service that collects more.</p>
      </>}
    >
      <Section id="who" title="1. Who we are">
        <p>BitoCard is operated by companies in the Golojan group. The company responsible for your personal information depends on where you are. Depending on local law, it is your “controller”, “business”, “organisation”, “responsible party” or “data fiduciary”.</p>
        <EntityTable caption="Responsible entity by region" />
        <p>If your region is not listed, Golojan Technologies LLC is responsible. You can reach any of these companies at <ContactEmail />.</p>
      </Section>

      <Section id="scope" title="2. What this notice covers">
        <p>This notice covers bitocard.com and its subdomains, including our main site (bitocard.com), this legal site and our documentation, reseller, administration and API sites, and any email you send us. It does not cover third-party websites we link to.</p>
      </Section>

      <Section id="collect" title="3. What we collect">
        <h3>When you visit our websites</h3>
        <p>Like any website, our servers receive technical information so they can deliver pages and protect the service. This includes your IP address, browser and device type, the pages you request, the referring page, and the date and time of your visit. Our hosting provider processes this information in server and security logs.</p>
        <h3>When you choose your country on our store</h3>
        <p>If you tell our store which country you shop from (or that you want to see everything), we remember that choice in a cookie on your device so the store can show products for your country. We use it only for that, keep no record of it against you, and you can change or delete it at any time. See our <Link href="/documents/cookies">cookie notice</Link>.</p>
        <h3>When you create an account on our store</h3>
        <p>Your name, your email address, and your password, which we store only as a one-way hash we cannot reverse. We also keep when you signed in, failed sign-in attempts (to protect your account), and the codes we email to confirm your address or reset your password, stored only as hashes. A cookie keeps you signed in; see our <Link href="/documents/cookies">cookie notice</Link>.</p>
        <h3>When you buy from our store</h3>
        <p>What you bought, its value and price, when, and the details needed to deliver it: for example the mobile number to top up, the smartcard or meter number to pay (and the account name the provider returns for you to confirm), or the email address to send codes to. We keep the codes, PINs and licence keys you buy encrypted, and show them only to you.</p>
        <p>Each order has its own page, linked from its emails. It shows the order only to you: signed in to the account that bought it, or after you enter a code we email to the order&apos;s address (kept only as a hash, valid for 10 minutes). We record when its codes were first shown there and how often, so the store can help if a code is disputed, and we email you when they are shown (at most once a day) so you notice if it was not you.</p>
        <p>If you buy a virtual phone number, we keep the SMS it receives and sends (the other party&apos;s number, the text, kept encrypted, and when) for 90 days, so you can read them on your order&apos;s page, and so can the store that sold it to you. They are deleted with the number if it is not renewed. We email you before your number expires, when it is paused, and before it is deleted.</p>
        <p>You pay on the payment provider&apos;s secure page. We never receive or store your full card number, card security code or mobile money PIN. The provider tells us the payment&apos;s amount, status, reference and the method you used, which we keep with your order and use for refunds.</p>
        <h3>When an identity check is needed</h3>
        <p>For some products in some countries, the law or our fraud controls require you to verify your identity once before buying. In Nigeria we check your BVN with Flutterwave, after you approve it on your bank&apos;s page; we pass your BVN on and do not keep it. Elsewhere, Didit checks an identity document and compares it with a selfie, which involves biometric data, and we ask for your explicit consent first. We keep only the outcome, your verified name and the document&apos;s country, never images or document numbers.</p>
        <h3>When you contact us</h3>
        <p>If you email us, we receive your email address, your name if you include it, and the content of your message.</p>
        <h3>What we do not collect</h3>
        <p>We do not collect your full card details or precise location, and we do not use analytics, advertising or tracking cookies. See our <Link href="/documents/cookies">cookie notice</Link>.</p>
        <p>Apart from biometric data in identity checks, with your explicit consent, we do not collect sensitive personal information, and we do not make decisions about you based solely on automated processing, including profiling. If an identity check fails, you can ask for it to be reviewed by a person.</p>
      </Section>

      <Section id="use" title="4. How we use it and our legal bases">
        <div className="legal-table">
          <table>
            <caption>Purposes and legal bases</caption>
            <thead><tr><th scope="col">Purpose</th><th scope="col">Information</th><th scope="col">Legal basis (where required)</th></tr></thead>
            <tbody>
              <tr><th scope="row">Deliver the website, keep it secure, and prevent abuse and fraud</th><td>Technical information</td><td>Our legitimate interests in running a secure website</td></tr>
              <tr><th scope="row">Provide your account, take your payment, deliver your order, send its codes and receipts, and refund you if we cannot deliver</th><td>Account, order and payment information</td><td>Performance of our contract with you</td></tr>
              <tr><th scope="row">Check your identity where the law or fraud controls require it, and prevent fraud</th><td>Account and order information, identity check results; biometric data during a document check</td><td>Legal obligation, or our legitimate interests in preventing fraud; explicit consent for biometric data</td></tr>
              <tr><th scope="row">Keep accounting and tax records</th><td>Order and payment information</td><td>Legal obligation</td></tr>
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
          <li><strong>Payment providers</strong> that take your payment and send refunds: Stripe (cards), Flutterwave (cards, bank transfer and mobile money), Monnify (Nigerian bank transfer and cards) and pawaPay (mobile money), depending on your country and the method you choose. Each also processes your payment under its own privacy notice.</li>
          <li><strong>Identity check providers</strong>, where a check is needed: Flutterwave (BVN checks in Nigeria) and Didit (document and selfie checks elsewhere).</li>
          <li><strong>The companies that fulfil your order</strong>, such as the mobile network, pay-TV operator or utility, which receive only what they need to deliver it (for example the number to top up).</li>
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
          <li>Your account is kept while it is open. Ask us to close it at any time; we then delete your account details within 30 days, except what we must keep for the records below.</li>
          <li>Orders, payments and refunds are kept for as long as accounting and tax laws require, usually six years after the order.</li>
          <li>Identity check outcomes are kept while your account is open and for up to five years after, where anti-fraud or anti-money-laundering rules require it.</li>
          <li>Correspondence is kept for as long as we need it to deal with your enquiry, then for up to two years, unless a longer period is needed to meet a legal obligation or to establish or defend a legal claim.</li>
        </ul>
      </Section>

      <Section id="security" title="8. Security">
        <p>We use encrypted connections (HTTPS), security headers and access controls, and we choose providers with strong security practices. No method of transmission or storage is completely secure, but we work to protect your information and will notify you and regulators of a breach where the law requires it.</p>
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
