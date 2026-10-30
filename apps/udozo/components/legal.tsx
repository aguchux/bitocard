import Link from "next/link";
import type { ReactNode } from "react";
import { type LegalBlock, type LegalDocument, legalDocuments, legalVersion } from "@/lib/legal";

export const legalDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${legalVersion}T00:00:00Z`));

/** Says plainly that these are drafts: Udozo's documents are reviewed by lawyers in each market before it opens. */
export function DraftNotice() {
  return (
    <p role="note" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
      <strong>Draft for lawyers&apos; review.</strong> Udozo is not open for real payments yet. These documents describe how it works and will be reviewed by qualified lawyers in each market before it opens.
    </p>
  );
}

/** A legal page's frame (inside the global layout's header and footer): a narrow readable column and links to the other documents. */
export function LegalFrame({ current, children }: { current: string | null; children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 pt-5 sm:pt-8">
      {children}
      <nav aria-label="Legal documents" className="border-t border-navy-200 pt-6">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          <li>
            <Link href="/legal" aria-current={current === null ? "page" : undefined} className="text-navy-600 hover:text-navy-900 aria-[current=page]:text-brand-700">
              All documents
            </Link>
          </li>
          {legalDocuments.map(doc => (
            <li key={doc.slug}>
              <Link href={`/legal/${doc.slug}`} aria-current={current === doc.slug ? "page" : undefined} className="text-navy-600 hover:text-navy-900 aria-[current=page]:text-brand-700">
                {doc.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
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
    <div className="overflow-x-auto rounded-2xl ring-1 ring-navy-200">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-navy-50 text-navy-900">
          <tr>
            {block.table.head.map(cell => (
              <th key={cell} scope="col" className="px-3 py-2 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100 bg-white">
          {block.table.rows.map(row => (
            <tr key={row.join("|")}>
              {row.map((cell, index) => (
                <td key={index} className="px-3 py-2 align-top break-words">
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
    <article className="grid gap-6">
      <header className="grid gap-2">
        <p className="text-sm font-semibold text-brand-700">Udozo</p>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{doc.title}</h1>
        <p className="text-sm text-navy-500">
          Version {legalVersion} · last updated {legalDate}
        </p>
      </header>
      <DraftNotice />
      <nav aria-label="Contents" className="rounded-2xl border border-navy-200 bg-white p-4">
        <p className="text-sm font-semibold text-navy-900">Contents</p>
        <ol className="mt-2 space-y-1 text-sm">
          {doc.sections.map(section => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-navy-600 underline-offset-2 hover:text-navy-900 hover:underline">
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {doc.sections.map(section => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-24 space-y-3 text-[15px] leading-relaxed text-navy-700">
          <h2 id={`${section.id}-heading`} className="text-lg font-bold text-navy-900">
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
