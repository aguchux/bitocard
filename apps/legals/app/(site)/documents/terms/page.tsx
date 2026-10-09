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
        <p>When a service launches, it will be governed by separate terms, such as reseller and customer agreements, which you will need to accept before using it.</p>
      </Section>

      <Section id="problems" title="3. Problems with an order">
        <p>If something is wrong with an order you bought on a BitoCard store (for example a code does not work, or you were charged but not delivered), report it from the order&apos;s page in your account: choose &ldquo;Report a problem with this order&rdquo; and tell us what happened. You can follow it and reply under &ldquo;Your disputes&rdquo;.</p>
        <ul>
          <li><strong>The store answers first.</strong> If you bought from a reseller&apos;s store, that store investigates your problem and replies to you. It can resolve it with you, or pass it to BitoCard with its findings.</li>
          <li><strong>BitoCard decides what it is passed.</strong> BitoCard reviews the problem and the store&apos;s findings and decides. It may ask the store for more information first. If you bought from BitoCard&apos;s own store, BitoCard handles your problem from the start.</li>
          <li><strong>Refunds go back to how you paid.</strong> If you are refunded, the money returns to the card, bank account or mobile money wallet you paid with. Banks and mobile money providers can take a few days to show it.</li>
        </ul>
        <p>We tell you by email or in your account when your problem has a reply or a decision. Reporting a problem does not affect your statutory rights as a consumer, or your right to dispute a card payment with your bank. If you dispute a payment with your bank, we may share your order&apos;s details with the payment provider and the store to respond to it.</p>
      </Section>

      <Section id="no-advice" title="4. No financial advice">
        <p>Nothing on these websites is financial, investment, legal or tax advice, and we do not promise any level of income or profit from reselling.</p>
      </Section>

      <Section id="use" title="5. Using the websites">
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

      <Section id="ip" title="6. Intellectual property">
        <p>The BitoCard name and logo, and the text, design and code of these websites, belong to the Golojan group or its licensors and are protected by intellectual property laws. You may view and share links to our pages, but you may not copy, adapt or use our brand or content for commercial purposes without our written permission.</p>
        <p>Other product and brand names, including gift card brands, belong to their owners. Their mention does not imply endorsement or a relationship with us.</p>
      </Section>

      <Section id="links" title="7. Links to other websites">
        <p>Where we link to other websites, we do so for convenience. We do not control them and are not responsible for their content or practices.</p>
      </Section>

      <Section id="availability" title="8. Availability and changes">
        <p>We may change, suspend or withdraw any part of the websites at any time. We do not guarantee that they will always be available, uninterrupted or free from errors.</p>
      </Section>

      <Section id="liability" title="9. Our responsibility to you">
        <p>We provide the websites free of charge and “as is”. To the extent the law allows, we make no warranties about their content, accuracy or availability.</p>
        <p>To the extent the law allows, we are not liable for any indirect or consequential loss, or for loss of profit, revenue, business or data, arising from your use of the websites or your reliance on their content.</p>
        <p>Nothing in these terms limits or excludes liability that cannot be limited or excluded by law, including liability for death or personal injury caused by negligence, or for fraud. Nothing in these terms affects your statutory rights as a consumer.</p>
      </Section>

      <Section id="law" title="10. Governing law and disputes">
        <p>These terms are governed by the law that applies to the company you contract with:</p>
        <ul>
          {legalEntities.map(entity => (
            <li key={entity.name}><strong>{entity.name}</strong>: {entity.governingLaw}, with disputes heard by {entity.courts}.</li>
          ))}
        </ul>
        <p>If you are a consumer, you keep the protection of the mandatory laws of the country where you live. You may also bring proceedings in your local courts where your local law allows it. This includes consumers in the European Union, Scotland, Northern Ireland and Quebec.</p>
        <p>Before starting formal proceedings, please contact us at <ContactEmail /> so we can try to resolve the issue.</p>
      </Section>

      <Section id="general" title="11. General">
        <p>If any part of these terms is found to be unenforceable, the rest remains in effect. If we do not enforce a term straight away, we can still enforce it later. We may update these terms; the version on this page at the time you use the websites applies. Our <Link href="/documents/privacy">privacy notice</Link> and <Link href="/documents/cookies">cookie notice</Link> explain how we handle personal information.</p>
      </Section>

      <Section id="contact" title="12. Contact us">
        <p>Email <ContactEmail /> with any question about these terms.</p>
      </Section>
    </LegalPage>
  );
}
