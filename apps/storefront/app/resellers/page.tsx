import type { Metadata } from "next";
import { BrandLockup } from "@bitocard/ui/brand-lockup";
import { legalDocuments } from "@bitocard/ui/legal";
import { JsonLd, organizationId, organizationSchema } from "@bitocard/ui/seo";
import { appUrl, brand } from "@bitocard/ui/site";
import { InfoDialog } from "@/components/info-dialog";
import { ResellerFeatures } from "@/components/reseller-features";
import { StorefrontPreview } from "@/components/storefront-preview";
import "./resellers.css";

const title = "Launch your own gift card, airtime & data store";
const description = "Build your own branded store for digital gift cards, mobile airtime and data. Choose your products, set your prices and grow your reseller business with BitoCard.";

export const metadata: Metadata = {
  title,
  description,
  keywords: ["gift card reseller", "digital gift card store", "airtime reseller", "data bundle reseller", "white-label storefront", "reseller platform", "BitoCard"],
  alternates: { canonical: "/resellers" },
  openGraph: { url: "/resellers", title: `${title} | BitoCard`, description },
  twitter: { title: `${title} | BitoCard`, description },
};

function HowItWorks() {
  return (
    <>
      <ol>
        <li>Register in SHQ, BitoCard&apos;s Seller Head Quarters, and pass the identity check.</li>
        <li>Choose your store name and BitoCard subdomain, add your branding, select products and set your customer prices.</li>
        <li>Fund your reseller wallet before accepting paid orders, or sell through the API from your own website or app.</li>
      </ol>
      <p>Our goal is store setup in five minutes. Verification, funding and readiness for your first order may take longer. Product availability varies by market.</p>
    </>
  );
}

function ForResellers() {
  return (
    <>
      <p>Build your own brand with a storefront for digital gift cards, airtime, data and more. Manage your catalogue, customer prices, orders and reports in SHQ.</p>
      <p>Your store starts on a BitoCard subdomain; verified custom domains and the reseller API are available as your business grows.</p>
      <p>Registration is open to resellers based in our pilot markets: Nigeria, Ghana and Kenya.</p>
    </>
  );
}

/**
 * The reseller landing page: what BitoCard offers resellers, before they register in SHQ. The first screen fits the
 * viewport (headline, Register, the illustrative store); every feature follows below, each with its own Register.
 */
export default function Resellers() {
  const signup = appUrl("shq", "/signup");
  return (
    <div className="site-shell">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            organizationSchema(),
            { "@type": "WebPage", "@id": `${appUrl("storefront", "/resellers")}#webpage`, url: appUrl("storefront", "/resellers"), name: title, description, inLanguage: "en-GB", publisher: { "@id": organizationId() } },
          ],
        }}
      />
      <div className="first-screen">
        <header className="site-header">
          <BrandLockup tagline="Digital store in 5 minutes" />
          <nav aria-label="Resellers">
            <InfoDialog id="nav-how" title="How it works" variant="nav">
              <HowItWorks />
            </InfoDialog>
            <a className="button button-nav" href="#features-title">
              Features
            </a>
            <a className="button button-nav" href={appUrl("shq", "/signin")}>
              Sign in
            </a>
          </nav>
        </header>
        <main>
          <section className="hero-copy" aria-labelledby="headline">
            <p className="status">For resellers</p>
            <h1 id="headline">
              Your digital store.
              <br />
              <span>Ready in minutes.</span>
            </h1>
            <p className="lead">Launch your branded storefront for gift cards, airtime and data. BitoCard handles the products and fulfilment.</p>
            <div className="actions">
              <a className="button button-primary" href={signup}>
                Register<span aria-hidden="true"> →</span>
              </a>
              <InfoDialog id="how-it-works" title="How it works" label="See how it works">
                <HowItWorks />
              </InfoDialog>
              <InfoDialog id="for-resellers" title="For resellers">
                <ForResellers />
              </InfoDialog>
            </div>
            <p className="setup-note">Five-minute store setup is our goal. Verification and funding may take longer.</p>
          </section>
          <StorefrontPreview />
        </main>
        <a className="scroll-hint" href="#features-title">
          See every feature<span aria-hidden="true"> ↓</span>
        </a>
      </div>
      <ResellerFeatures signup={signup} />
      <section className="final-cta" aria-labelledby="final-cta-title">
        <h2 id="final-cta-title">Ready to open your store?</h2>
        <p>Register in SHQ, pass the identity check and set up your store. Registration is open to resellers based in Nigeria, Ghana and Kenya.</p>
        <div className="actions">
          <a className="button button-primary" href={signup}>
            Register<span aria-hidden="true"> →</span>
          </a>
          <a className="button button-light" href={appUrl("shq", "/signin")}>
            Sign in
          </a>
        </div>
      </section>
      <footer className="home-footer">
        <span>{brand.credit}</span>
        <nav aria-label="Legal">
          {legalDocuments.map(doc => (
            <a key={doc.href} href={appUrl("legals", doc.href)}>
              {doc.short}
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
