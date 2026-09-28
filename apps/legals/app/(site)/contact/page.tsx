import Link from "next/link";
import { legalContact } from "@bitocard/ui/legal";
import { JsonLd, organizationId, organizationSchema } from "@bitocard/ui/seo";
import { appUrl } from "@bitocard/ui/site";
import { EntityCards, PageBanner, Section } from "@/components/blocks";
import { Icon, type IconName } from "@/components/icons";
import { breadcrumbSchema, pageMetadata } from "@/components/seo";

const seo = { title: "Contact", description: "Contact BitoCard’s legal and privacy team: ask a question, make a privacy request, report a security issue, and see how quickly we reply in your region.", path: "/contact" };

export const metadata = pageMetadata(seo);

const mailto = (subject: string) => `mailto:${legalContact}?subject=${encodeURIComponent(subject)}`;

const reasons: { icon: IconName; title: string; body: string; subject: string; action: string }[] = [
  { icon: "document", title: "Legal questions", body: "Questions about our terms, notices or the companies behind BitoCard.", subject: "Legal question", action: "Ask a question" },
  { icon: "shield", title: "Privacy requests", body: "Access, correct or delete your information, or use any other privacy right.", subject: "Privacy request", action: "Make a request" },
  { icon: "bug", title: "Security issues", body: "Found a vulnerability on one of our websites? Tell us privately so we can fix it.", subject: "Security report", action: "Report an issue" },
];

const steps = [
  { title: "Email us", body: "Tell us which right you want to use and the country you live in. Include your name and the email address you used with us, if any." },
  { title: "We confirm who you are", body: "We may ask for information to verify your identity before acting. An authorised agent can ask for you if they show they are authorised." },
  { title: "We act on it, free", body: "We will not charge you or treat you differently for using your rights, and we will explain what we have done." },
  { title: "Not satisfied?", body: "You can appeal our decision by replying to it, or complain to the data protection regulator where you live." },
];

export default function ContactPage() {
  const url = appUrl("legals", seo.path);
  return (
    <>
      <JsonLd data={{
        "@context": "https://schema.org",
        "@graph": [
          organizationSchema(),
          { "@type": "ContactPage", "@id": url, url, name: seo.title, description: seo.description, inLanguage: "en-GB", isPartOf: { "@id": `${appUrl("legals")}#website` }, about: { "@id": organizationId() }, breadcrumb: { "@id": `${url}#breadcrumb` } },
          breadcrumbSchema(seo),
        ],
      }} />
      <PageBanner trail={[{ href: "/", label: "Home" }]} current="Contact" eyebrow="Legal & privacy team" title="Talk to our" accent="legal team." lead="One address reaches every Golojan company behind BitoCard, wherever you are. Ask a question, use your privacy rights or report a security issue.">
        <a className="contact-email" href={`mailto:${legalContact}`}><Icon name="mail" /> {legalContact}</a>
      </PageBanner>

      <Section id="reasons" title="How can we help?">
        <ul className="reason-grid">
          {reasons.map(reason => (
            <li key={reason.title}>
              <span className="doc-icon"><Icon name={reason.icon} /></span>
              <h3>{reason.title}</h3>
              <p>{reason.body}</p>
              <a className="doc-more" href={mailto(reason.subject)}>{reason.action} <span aria-hidden="true">→</span></a>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="requests" title="How privacy requests work" lead={<>The full details are in our <Link href="/documents/privacy#rights">privacy notice</Link>.</>}>
        <ol className="steps">
          {steps.map((step, index) => (
            <li key={step.title}><span className="step-number" aria-hidden="true">{index + 1}</span><h3>{step.title}</h3><p>{step.body}</p></li>
          ))}
        </ol>
      </Section>

      <Section id="timescales" title="How quickly we reply" lead="We reply within the time the law where you live requires. For example:">
        <div className="legal-table timescales">
          <table>
            <caption>Response times for privacy requests</caption>
            <thead><tr><th scope="col">Where you live</th><th scope="col">We reply within</th></tr></thead>
            <tbody>
              <tr><th scope="row">United Kingdom and European Economic Area</th><td>One month. For complex requests this can be extended by up to two more months, and we will tell you why.</td></tr>
              <tr><th scope="row">California</th><td>45 days. This can be extended by another 45 days where necessary, and we will tell you why.</td></tr>
              <tr><th scope="row">Canada</th><td>30 days. This can be extended in limited cases allowed by law, and we will tell you.</td></tr>
              <tr><th scope="row">Everywhere else</th><td>The time your local law requires.</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="responsible" title="Who is responsible" lead="BitoCard is operated by Golojan group companies. The company responsible for you depends on where you are.">
        <EntityCards />
      </Section>

      <Section id="complaints" title="Complaining to a regulator">
        <div className="next-note">
          <p><Icon name="flag" /> You can complain to the data protection regulator where you live, such as the UK Information Commissioner’s Office, your EEA data protection authority, the Office of the Privacy Commissioner of Canada, the Nigeria Data Protection Commission or South Africa’s Information Regulator. We would appreciate the chance to put things right first. See the full list for each region in our <Link href="/documents/privacy#regions">privacy notice</Link>.</p>
        </div>
      </Section>
    </>
  );
}
