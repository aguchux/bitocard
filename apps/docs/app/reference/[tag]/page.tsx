import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MethodBadge, OperationView } from "@/components/operation-view";
import { inline } from "@/components/schema-view";
import { operationsFor, sections, tagBySlug, tagIntros, tagSlug, tags } from "@/lib/openapi";

export const dynamicParams = false;

export function generateStaticParams() {
  return tags.map(tag => ({ tag: tagSlug(tag) }));
}

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  const tag = tagBySlug((await params).tag);
  if (!tag) return {};
  const description = (tagIntros[tag] ?? `${tag} endpoints of the BitoCard API.`).replace(/`/g, "");
  return { title: `${tag} API`, description, alternates: { canonical: `/reference/${tagSlug(tag)}` }, openGraph: { title: `${tag} · BitoCard API`, description } };
}

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  const tag = tagBySlug((await params).tag);
  if (!tag) notFound();
  const operations = operationsFor(tag);
  const section = sections.find(item => item.tags.includes(tag));

  return (
    <div>
      <header className="max-w-4xl space-y-4 pb-6">
        <p className="text-sm font-semibold text-[#e0116d]">
          <Link href="/reference">API reference</Link>
          {section ? ` · ${section.title}` : ""}
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight text-[#070f4c]">{tag}</h1>
        {tagIntros[tag] ? <p className="schema-description text-lg text-slate-600" dangerouslySetInnerHTML={{ __html: inline(tagIntros[tag]) }} /> : null}
        <ul className="flex flex-col gap-1.5 rounded-2xl border border-slate-200 p-4">
          {operations.map(operation => (
            <li key={operation.id}>
              <a href={`#${operation.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm hover:text-[#e0116d]">
                <MethodBadge method={operation.method} small />
                <span className="font-mono text-[13px] text-slate-700">{operation.path}</span>
                <span className="text-slate-500">{operation.summary}</span>
              </a>
            </li>
          ))}
        </ul>
      </header>
      {operations.map(operation => (
        <OperationView key={operation.id} operation={operation} />
      ))}
    </div>
  );
}
