import Image from "next/image";

export default function Home() {
  return (
    <main>
      <header><Image src="/bitocard-logo.png" alt="" width={64} height={64} /><span>Bito<span className="pink">Card</span></span></header>
      <p className="badge">Coming soon</p>
      <h1>Administration</h1>
      <p className="lead">The future workspace for BitoCard platform operators.</p>
      <section><h2>Workspace in preparation</h2><p>Operator access, reseller approvals and transaction review will be added as the platform develops.</p></section>
      <footer>A Golojan Ltd venture</footer>
    </main>
  );
}
