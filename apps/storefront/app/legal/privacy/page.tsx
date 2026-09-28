import type { Metadata } from "next";
import Link from "next/link";
import { ContactEmail, EntityTable, LegalPage, Section } from "@/components/legal";

export const metadata: Metadata = {
  title: "Privacy notice | BitoCard",
  description: "How BitoCard handles personal information on its websites, and your privacy rights in Europe, the Americas, Africa and Asia.",
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyNotice() {
  return (
    <LegalPage
      title="Privacy notice"
      intro={<>
        <p>This notice explains how BitoCard handles personal information when you visit our websites or contact us. BitoCard is coming soon: we do not yet offer accounts, payments, wallets or transactions, and we collect very little personal information.</p>
        <p>We will update this notice before we launch any service that collects more.</p>
      </>}
    >
      <Section id="who" title="1. Who we are">
        <p>BitoCard is operated by companies in the Golojan group. The company responsible for your personal information depends on where you are. Depending on local law, it is your “controller”, “business”, “organisation”, “responsible party” or “data fiduciary”.</p>
        <EntityTable caption="Responsible entity by region" />
        <p>If your region is not listed, Golojan Technologies LLC is responsible. You can reach any of these companies at <ContactEmail />.</p>
      </Section>

      <Section id="scope" title="2. What this notice covers">
        <p>This notice covers the BitoCard websites, including this coming-soon site and our documentation, reseller, administration and API sites, and any email you send us. It does not cover third-party websites we link to.</p>
      </Section>

      <Section id="collect" title="3. What we collect">
        <h3>When you visit our websites</h3>
        <p>Like any website, our servers receive technical information so they can deliver pages and protect the service. This includes your IP address, browser and device type, the pages you request, the referring page, and the date and time of your visit. Our hosting provider processes this information in server and security logs.</p>
        <h3>When you contact us</h3>
        <p>If you email us, we receive your email address, your name if you include it, and the content of your message.</p>
        <h3>What we do not collect</h3>
        <p>We do not currently collect account details, payment information, gift card codes, identity documents or precise location. There is no signup form. We do not use analytics, advertising or tracking cookies. See our <Link href="/legal/cookies">cookie notice</Link>.</p>
        <p>We do not collect sensitive personal information, and we do not make decisions about you based solely on automated processing, including profiling.</p>
      </Section>

      <Section id="use" title="4. How we use it and our legal bases">
        <div className="legal-table">
          <table>
            <caption>Purposes and legal bases</caption>
            <thead><tr><th scope="col">Purpose</th><th scope="col">Information</th><th scope="col">Legal basis (where required)</th></tr></thead>
            <tbody>
              <tr><th scope="row">Deliver the website, keep it secure, and prevent abuse and fraud</th><td>Technical information</td><td>Our legitimate interests in running a secure website</td></tr>
              <tr><th scope="row">Reply to your enquiries</th><td>Contact details and message</td><td>Our legitimate interests in responding to you, or steps you ask us to take before entering into a contract</td></tr>
              <tr><th scope="row">Meet legal obligations, and establish or defend legal claims</th><td>Any of the above, where relevant</td><td>Legal obligation, or our legitimate interests</td></tr>
            </tbody>
          </table>
        </div>
        <p>Where the law requires consent, such as for non-essential cookies in some countries, we will ask for it first, and you can withdraw it at any time.</p>
      </Section>

      <Section id="share" title="5. Who we share it with">
        <ul>
          <li><strong>Service providers</strong> who act on our instructions. Vercel Inc. hosts our websites and delivers them through its global network. Our email provider handles messages you send us.</li>
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
        <p>Golojan LLC is the controller under the UK GDPR, the EU General Data Protection Regulation and the Swiss Federal Act on Data Protection. Our legal bases are set out in section 4. You may complain to the UK Information Commissioner’s Office, the data protection authority in the EEA country where you live or work, or the Swiss Federal Data Protection and Information Commissioner. We would appreciate the chance to address your concern first.</p>

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
