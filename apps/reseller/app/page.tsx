import Image from "next/image";

export default function Home() {
  return (
    <main>
      <header><Image src="/bitocard-logo.png" alt="" width={64} height={64} /><span>Bito<span className="pink">Card</span></span></header>
      <p className="badge">Coming soon</p>
      <h1>Reseller workspace</h1>
      <p className="lead">Your future home for managing your BitoCard store.</p>
      <section><h2>Your business, your brand</h2><p>Store settings, product selection, pricing and reports are planned. Reseller onboarding is not yet available.</p></section>
      <footer>A Golojan Ltd venture</footer>
    </main>
  );
}
