import Link from "next/link";
import { Brand } from "@bitocard/ui/brand";
import { brand } from "@bitocard/ui/site";
import { LegalNav } from "@/components/legal-nav";

export default function LegalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <Link className="wordmark" href="/"><Brand /></Link>
        <Link className="legal-back" href="/">Back to home</Link>
      </header>
      <LegalNav />
      <main className="legal-main">{children}</main>
      <footer><span>{brand.credit}</span></footer>
    </div>
  );
}
