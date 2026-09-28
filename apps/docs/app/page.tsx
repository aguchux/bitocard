import Image from "next/image";

export default function Home() {
  return (
    <main>
      <header><Image src="/bitocard-logo.png" alt="" width={64} height={64} /><span>Bito<span className="pink">Card</span></span></header>
      <p className="badge">Coming soon</p>
      <h1>Documentation</h1>
      <p className="lead">Guides for building your BitoCard business.</p>
      <section><h2>Store setup</h2><p>Choose a store name, add your branding and select eligible products. Verification and funding are required before paid orders can begin.</p></section>
      <footer>A Golojan Ltd venture</footer>
    </main>
  );
}
