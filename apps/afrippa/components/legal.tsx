import Link from "next/link";
import type { ReactNode } from "react";
import { globalMarket } from "@afrippa/ui/market";
import { Header } from "@/components/header";
import { type LegalBlock, type LegalDocument, legalDocuments, legalVersion } from "@/lib/legal";

export const legalDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${legalVersion}T00:00:00Z`));

/** Says plainly that these are drafts: Afrippa's documents are reviewed by lawyers in each market before it opens. */
export function DraftNotice() {
  return (
    <p role="note" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
      <strong>Draft for lawyers&apos; review.</strong> Afrippa is not open for live trading yet. These documents describe how it works and will be reviewed by qualified lawyers in each market before it opens.
    </p>
  );
}

/** A legal page's frame: the header, a narrow readable column and links to the other documents. */
export function LegalFrame({ current, children }: { current: string | null; children: ReactNode }) {
  return (
    <>
      <Header current={globalMarket} />
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        {children}
        <nav aria-label="Legal documents" className="border-t border-slate-200 pt-6">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            <li>
              <Link href="/legal" aria-current={current === null ? "page" : undefined} className="text-slate-600 hover:text-navy-900 aria-[current=page]:text-brand-700">
                All documents
              </Link>
            </li>
            {legalDocuments.map(doc => (
              <li key={doc.slug}>
                <Link href={`/legal/${doc.slug}`} aria-current={current === doc.slug ? "page" : undefined} className="text-slate-600 hover:text-navy-900 aria-[current=page]:text-brand-700">
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") return <p>{block}</p>;
  if ("list" in block)
    return (
      <ul className="list-disc space-y-1.5 pl-5">
        {block.list.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  // Tables scroll inside themselves on phones, never the page.
  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-slate-50 text-navy-900">
          <tr>
            {block.table.head.map(cell => (
              <th key={cell} scope="col" className="px-3 py-2 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {block.table.rows.map(row => (
            <tr key={row.join("|")}>
              {row.map((cell, index) => (
                <td key={index} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One document: its title and date, the draft notice, contents, then each section with an anchor. */
export function LegalArticle({ doc }: { doc: LegalDocument }) {
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="text-sm font-semibold text-brand-700">Afrippa</p>
        <h1 className="font-display text-3xl font-extrabold text-navy-900 sm:text-4xl">{doc.title}</h1>
        <p className="text-sm text-slate-500">
          Version {legalVersion} · last updated {legalDate}
        </p>
      </header>
      <DraftNotice />
      <nav aria-label="Contents" className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
        <p className="text-sm font-semibold text-navy-900">Contents</p>
        <ol className="mt-2 space-y-1 text-sm">
          {doc.sections.map(section => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-slate-600 underline-offset-2 hover:text-navy-900 hover:underline">
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {doc.sections.map(section => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24 space-y-3 text-[15px] leading-relaxed text-slate-700">
          <h2 id={`${section.id}-heading`} className="font-display text-xl font-bold text-navy-900">
            {section.heading}
          </h2>
          {section.body.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </section>
      ))}
    </article>
  );
}
