import Link from "next/link";
import { Brand } from "@bitocard/ui/brand";
import { InfoDialog } from "@/components/info-dialog";
import { StorefrontPreview } from "@/components/storefront-preview";

function HowItWorks() {
  return <><ol><li>Apply for verification and choose your store name and BitoCard subdomain.</li><li>Add your branding, select eligible products and set your customer prices.</li><li>Pre-fund your reseller wallet before accepting paid orders.</li></ol><p>Our goal is store setup in five minutes. Verification, funding and readiness for your first order may take longer. Product availability will vary by market.</p></>;
}
function ForResellers() {
  return <><p>Build your own brand with a planned storefront for digital gift cards, airtime and data. Manage your eligible catalogue, customer prices, orders and reports.</p><p>Hosted BitoCard subdomains are planned first. Optional verified custom domains and a reseller API will follow in later phases.</p><p>BitoCard is coming soon. Onboarding and transactions are not yet available.</p></>;
}

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link className="wordmark brand-lockup" href="/">
          <Brand />
          <span className="tagline">Start a store in 5 minutes</span>
        </Link>
        <nav aria-label="Information">
          <InfoDialog id="nav-how" title="How it works" variant="nav"><HowItWorks /></InfoDialog>
          <InfoDialog id="nav-resellers" title="For resellers" variant="nav"><ForResellers /></InfoDialog>
        </nav>
      </header>
      <main>
        <section className="hero-copy" aria-labelledby="headline">
          <p className="status">Coming soon</p>
          <h1 id="headline">Your digital store.<br /><span>Ready in minutes.</span></h1>
          <p className="lead">Launch your branded storefront for gift cards, airtime and data. BitoCard will handle the products and fulfilment.</p>
          <div className="actions">
            <InfoDialog id="how-it-works" title="How it works" label="See how it works" variant="primary"><HowItWorks /></InfoDialog>
            <InfoDialog id="for-resellers" title="For resellers"><ForResellers /></InfoDialog>
          </div>
          <p className="setup-note">Five-minute store setup is our goal. Verification and funding may take longer.</p>
        </section>
        <StorefrontPreview />
      </main>
      <footer><span>A Golojan Ltd venture</span></footer>
    </div>
  );
}
