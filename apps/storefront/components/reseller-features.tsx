import type { ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BadgePercent,
  Bell,
  Code2,
  CreditCard,
  Gamepad2,
  Gift,
  Globe2,
  KeyRound,
  Landmark,
  Lock,
  Plug,
  ShieldCheck,
  Smartphone,
  Store,
  Tv,
  Users,
  Wallet,
  Wifi,
  Zap,
} from "lucide-react";

/** Drawn in code, never a screenshot: what each part of SHQ and the store looks like, for illustration only. */
function Art({ tone, children }: { tone: "pink" | "blue" | "green" | "violet" | "amber"; children: ReactNode }) {
  return (
    <div className={`feature-art art-${tone}`} aria-hidden="true">
      <div className="art-card">{children}</div>
    </div>
  );
}

const StoreArt = () => (
  <Art tone="pink">
    <div className="art-browser">
      <span className="art-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="art-address">adadigital.bitocard.com</span>
    </div>
    <div className="art-store-head">
      <span className="art-logo">A</span>
      <strong>Ada Digital</strong>
      <span className="art-swatches">
        <i style={{ background: "#070f4c" }} />
        <i style={{ background: "#ff2382" }} />
        <i style={{ background: "#2477ff" }} />
      </span>
    </div>
    <div className="art-tiles">
      <span>
        <Gift />
        Gift cards
      </span>
      <span>
        <Smartphone />
        Airtime
      </span>
      <span>
        <Wifi />
        Data
      </span>
    </div>
  </Art>
);

const CatalogueArt = () => (
  <Art tone="blue">
    <div className="art-grid">
      {[
        [Gift, "Gift cards"],
        [Smartphone, "Airtime"],
        [Wifi, "Data"],
        [Tv, "Pay-TV"],
        [Zap, "Electricity"],
        [Globe2, "eSIM"],
        [Gamepad2, "Gaming"],
        [KeyRound, "Software"],
        [CreditCard, "Cards"],
      ].map(([Icon, label]) => {
        const Glyph = Icon as typeof Gift;
        return (
          <span key={label as string}>
            <Glyph />
            {label as string}
          </span>
        );
      })}
    </div>
  </Art>
);

const PricingArt = () => (
  <Art tone="green">
    <p className="art-label">Amazon gift card · $25</p>
    <div className="art-price-row">
      <span>Wholesale</span>
      <strong>$24.10</strong>
    </div>
    <div className="art-price-row art-price-yours">
      <span>Your price</span>
      <strong>$26.50</strong>
    </div>
    <div className="art-meter">
      <i style={{ width: "36%" }} />
    </div>
    <div className="art-price-row art-profit">
      <span>Your profit</span>
      <strong>+$2.40</strong>
    </div>
  </Art>
);

const WalletArt = () => (
  <Art tone="violet">
    <div className="art-balance">
      <span>Wallet</span>
      <strong>₦ 850,000.00</strong>
      <small>Available for orders</small>
    </div>
    <div className="art-buttons">
      <span>
        <Wallet />
        Top up
      </span>
      <span>
        <Landmark />
        Withdraw profit
      </span>
    </div>
    <ul className="art-list">
      <li>
        <span>Bank transfer</span>
        <b className="art-plus">+ ₦500,000</b>
      </li>
      <li>
        <span>Order 1042</span>
        <b>− ₦24,100</b>
      </li>
    </ul>
  </Art>
);

const ApiArt = () => (
  <Art tone="amber">
    <pre className="art-code">
      <span className="c-key">POST</span> /v1/orders{"\n"}
      <span className="c-dim">Authorization: Bearer bc_test_…</span>
      {"\n\n"}
      {"{"}
      {"\n"}
      {"  "}
      <span className="c-key">&quot;quote&quot;</span>: <span className="c-str">&quot;qt_8f2…&quot;</span>,{"\n"}
      {"  "}
      <span className="c-key">&quot;customer_reference&quot;</span>: <span className="c-str">&quot;cust_77&quot;</span>
      {"\n"}
      {"}"}
      {"\n\n"}
      <span className="c-ok">201 · order.completed</span>
    </pre>
  </Art>
);

const DomainArt = () => (
  <Art tone="pink">
    <div className="art-domain">
      <span className="art-address">adadigital.bitocard.com</span>
      <ArrowRight />
      <span className="art-address art-address-own">
        <Lock />
        shop.adadigital.com
      </span>
    </div>
    <ul className="art-checks">
      <li>
        <BadgeCheck />
        Ownership verified
      </li>
      <li>
        <BadgeCheck />
        HTTPS certificate
      </li>
      <li>
        <BadgeCheck />
        Renewal reminders
      </li>
    </ul>
  </Art>
);

const IntegrationsArt = () => (
  <Art tone="blue">
    <ul className="art-connections">
      {[
        ["Your supplier account", "Connected"],
        ["Your payment gateway", "Connected"],
        ["Another supplier", "Connect"],
      ].map(([name, state]) => (
        <li key={name}>
          <span className="art-plug">
            <Plug />
          </span>
          <span>{name}</span>
          <b className={state === "Connected" ? "art-on" : "art-off"}>{state}</b>
        </li>
      ))}
    </ul>
  </Art>
);

const TeamArt = () => (
  <Art tone="green">
    <ul className="art-team">
      {[
        ["AO", "Ada Obi", "Owner"],
        ["KM", "Kwame Mensah", "Admin"],
        ["WN", "Wanjiru N.", "Support"],
      ].map(([initials, name, role]) => (
        <li key={name}>
          <span className="art-avatar">{initials}</span>
          <span>{name}</span>
          <b>{role}</b>
        </li>
      ))}
    </ul>
    <div className="art-toast">
      <Bell />
      <span>
        <strong>Order delivered</strong>
        <small>Airtime ₦2,000 to 0803 ••• 4417</small>
      </span>
    </div>
  </Art>
);

const SecurityArt = () => (
  <Art tone="violet">
    <div className="art-shield">
      <ShieldCheck />
    </div>
    <ul className="art-checks">
      <li>
        <BadgeCheck />
        Identity checked
      </li>
      <li>
        <BadgeCheck />
        Two-step sign-in for BitoCard staff
      </li>
      <li>
        <BadgeCheck />
        Encrypted keys and codes
      </li>
      <li>
        <BadgeCheck />
        Signed webhooks
      </li>
    </ul>
  </Art>
);

type Feature = { id: string; icon: typeof Store; eyebrow: string; title: string; body: string; points: string[]; art: () => ReactNode; label?: string };

/** Every reseller feature, in the order a new reseller meets them. Planned ones say so. */
const features: Feature[] = [
  {
    id: "store",
    icon: Store,
    eyebrow: "Your store",
    title: "A branded store, set up in minutes",
    body: "Choose your store name and BitoCard subdomain, add your logo and colours, pick your products and publish. Your customers shop under your brand.",
    points: ["Your name, logo and colours", "Starts at yourname.bitocard.com", "Your customers sign in at your store"],
    art: StoreArt,
  },
  {
    id: "catalogue",
    icon: Gift,
    eyebrow: "Catalogue",
    title: "One catalogue of digital products",
    body: "Sell gift cards, mobile airtime and data from one catalogue, with more categories such as bills and pay-TV, eSIMs and software as each market is enabled.",
    points: ["Choose what your store sells", "Delivered digitally by BitoCard", "Availability varies by market"],
    art: CatalogueArt,
  },
  {
    id: "pricing",
    icon: BadgePercent,
    eyebrow: "Your prices",
    title: "You set the price, you keep the profit",
    body: "Add your markup on top of BitoCard’s wholesale price and see your profit on every sale. A price cap keeps your customers’ prices fair.",
    points: ["Markups per product or category", "Profit shown before you publish", "No fees for using the API"],
    art: PricingArt,
  },
  {
    id: "wallet",
    icon: Wallet,
    eyebrow: "Wallet and payouts",
    title: "A wallet that pays for orders and pays you",
    body: "Top up your reseller wallet by card or bank transfer, with your own bank account for transfers where available. Your profit becomes withdrawable to your verified bank account after a short hold.",
    points: ["Funds are checked before every order", "Clear history of every movement", "Withdraw profit to your bank"],
    art: WalletArt,
  },
  {
    id: "api",
    icon: Code2,
    eyebrow: "Developers",
    title: "Sell from your own website or app",
    body: "Everything in BitoCard is an API first. Use test keys in the sandbox, then go live with the same catalogue, prices and orders as your hosted store.",
    points: ["Sandbox with simulated orders", "Signed webhooks for every event", "Your own customer references"],
    art: ApiArt,
  },
  {
    id: "domain",
    icon: Globe2,
    eyebrow: "Domains",
    title: "Your own domain",
    body: "Start on your BitoCard subdomain today. Connecting your own domain, with ownership checks and HTTPS, is on the way.",
    points: ["Buy a .com through BitoCard or connect your own", "Renewal prices shown up front", "Your subdomain keeps working"],
    art: DomainArt,
    label: "Planned",
  },
  {
    id: "integrations",
    icon: Plug,
    eyebrow: "Integrations",
    title: "Bring your own suppliers and payment gateways",
    body: "Connect accounts you hold with suppliers and payment gateways in your country, and run them through your BitoCard store for a small fee per transaction.",
    points: ["Offered integrations only, checked on connection", "Your credentials, encrypted and used only for you", "Available on selected plans"],
    art: IntegrationsArt,
    label: "Planned",
  },
  {
    id: "team",
    icon: Users,
    eyebrow: "Team and alerts",
    title: "Run it with your team",
    body: "Invite staff with the right role for each person, and get notified about orders, wallet movements and anything that needs attention, in SHQ and in your browser.",
    points: ["Owner, admin, support and more", "In-app and browser notifications", "Several businesses under one sign-in"],
    art: TeamArt,
  },
  {
    id: "security",
    icon: Lock,
    eyebrow: "Trust",
    title: "Built to keep you and your customers safe",
    body: "Every reseller is identity-checked before going live. Delivery codes, keys and credentials are encrypted, and BitoCard looks after the supplier side so you can focus on your customers.",
    points: ["Identity checks before going live", "Encrypted codes and credentials", "Support from the BitoCard team"],
    art: SecurityArt,
  },
];

/** The reseller page below the first screen: every feature, alternating text and illustration, each with a sign-up. */
export function ResellerFeatures({ signup }: { signup: string }) {
  return (
    <section className="features" aria-labelledby="features-title">
      <div className="features-intro">
        <p className="status">Features</p>
        <h2 id="features-title">
          Everything you need to <span>sell digital products</span>
        </h2>
        <p className="lead">From your first product to your own domain: what you get when you open a BitoCard store.</p>
      </div>
      <ol className="feature-list">
        {features.map(feature => {
          const Icon = feature.icon;
          const Illustration = feature.art;
          return (
            <li key={feature.id} id={feature.id} className="feature">
              <div className="feature-copy">
                <p className="feature-eyebrow">
                  <span className="feature-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  {feature.eyebrow}
                  {feature.label ? <span className="feature-label">{feature.label}</span> : null}
                </p>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                <ul>
                  {feature.points.map(point => (
                    <li key={point}>
                      <BadgeCheck aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
                <a className="button button-primary" href={signup}>
                  Register<span aria-hidden="true"> →</span>
                </a>
              </div>
              <Illustration />
            </li>
          );
        })}
      </ol>
      <p className="features-note">Illustrations only; not real stores, prices or accounts. Planned features are not available yet.</p>
    </section>
  );
}
