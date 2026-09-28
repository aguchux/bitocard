import { Brand } from "@bitocard/ui/brand";

type IconName = "gift" | "phone" | "wifi" | "home" | "orders" | "account" | "search";
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    gift: <><path d="M3 9h18v4H3zM5 13v9h14v-9M12 9v13" /><path d="M12 9C3 9 4 1 8 3c3 1 4 6 4 6Zm0 0c9 0 8-8 4-6-3 1-4 6-4 6Z" /></>,
    phone: <path d="m7 3 3 5-3 3c2 3 3 4 6 6l3-3 5 3c0 4-3 5-6 3C8 17 4 13 2 6c-1-3 2-5 5-3Z" />,
    wifi: <><path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 16a6 6 0 0 1 7 0" /><circle cx="12" cy="20" r="1" /></>,
    home: <><path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10" /></>,
    orders: <><path d="M6 2h9l4 4v16H6zM14 2v5h5M9 11h7M9 15h7M9 19h5" /></>,
    account: <><circle cx="12" cy="7" r="4" /><path d="M3 22v-3c0-7 18-7 18 0v3Z" /></>,
    search: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function StorefrontPreview() {
  return (
    <figure className="phone-stage" aria-label="Illustrative storefront preview, not an active shop">
      <div className="phone">
        <div className="phone-screen">
          <div className="phone-status" aria-hidden="true"><span>9:41</span><span className="phone-notch" /><span>▴ ▰</span></div>
          <div className="phone-content">
            <div className="store-header"><span className="wordmark"><Brand /></span><span className="menu-lines" aria-hidden="true" /></div>
            <h2>Everything<br />your customers<br />need, <span>in one place.</span></h2>
            <div className="mock-search"><Icon name="search" /><span>Search products...</span></div>
            <div className="products">
              {([{ name: "Gift cards", detail: "Discover the possibilities", icon: "gift", tone: "pink" }, { name: "Airtime", detail: "Keep in touch", icon: "phone", tone: "blue" }, { name: "Data", detail: "Stay connected", icon: "wifi", tone: "green" }] as const).map(product => (
                <div className={`product product-${product.tone}`} key={product.name}><span className="product-icon"><Icon name={product.icon} /></span><div><h3>{product.name}</h3><p>{product.detail}</p></div><span className="product-arrow" aria-hidden="true">›</span></div>
              ))}
            </div>
          </div>
          <div className="store-tabs" aria-hidden="true"><span className="active"><Icon name="home" />Home</span><span><Icon name="orders" />Orders</span><span><Icon name="account" />Account</span></div>
          <div className="home-indicator" />
        </div>
      </div>
      <figcaption>Illustrative preview · Availability varies by market</figcaption>
    </figure>
  );
}
