import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { guides, loadGuide } from "@/lib/guides";

export const dynamicParams = false;

export function generateStaticParams() {
  return guides.map(guide => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = await loadGuide((await params).slug);
  if (!guide) return {};
  return { title: guide.title, description: guide.description, alternates: { canonical: `/guides/${guide.slug}` }, openGraph: { title: guide.title, description: guide.description } };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = await loadGuide((await params).slug);
  if (!guide) notFound();
  const at = guides.findIndex(item => item.slug === guide.slug);
  const previous = guides[at - 1];
  const next = guides[at + 1];
  const contents = guide.headings.filter(heading => heading.depth === 2);

  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1">
        <p className="mb-3 text-sm font-semibold text-[#e0116d]">{guide.group}</p>
        <div className="prose-docs" dangerouslySetInnerHTML={{ __html: guide.html }} />
        <nav aria-label="Guides" className="mt-16 grid max-w-3xl gap-3 border-t border-slate-200 pt-6 sm:grid-cols-2">
          {previous ? (
            <Link href={`/guides/${previous.slug}`} className="flex items-center gap-2 rounded-xl border border-slate-200 p-4 hover:border-slate-300">
              <ArrowLeft className="size-4 text-slate-400" aria-hidden />
              <span>
                <span className="block text-xs text-slate-500">Previous</span>
                <span className="font-semibold text-[#070f4c]">{previous.title}</span>
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/guides/${next.slug}`} className="flex items-center justify-end gap-2 rounded-xl border border-slate-200 p-4 text-right hover:border-slate-300">
              <span>
                <span className="block text-xs text-slate-500">Next</span>
                <span className="font-semibold text-[#070f4c]">{next.title}</span>
              </span>
              <ArrowRight className="size-4 text-slate-400" aria-hidden />
            </Link>
          ) : (
            <Link href="/reference" className="flex items-center justify-end gap-2 rounded-xl border border-slate-200 p-4 text-right hover:border-slate-300">
              <span>
                <span className="block text-xs text-slate-500">Next</span>
                <span className="font-semibold text-[#070f4c]">API reference</span>
              </span>
              <ArrowRight className="size-4 text-slate-400" aria-hidden />
            </Link>
          )}
        </nav>
      </article>
      {contents.length > 2 ? (
        <aside className="sticky top-24 hidden w-56 shrink-0 self-start 2xl:block">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">On this page</p>
          <ul className="space-y-1.5 text-sm">
            {contents.map(heading => (
              <li key={heading.id}>
                <a href={`#${heading.id}`} className="text-slate-600 hover:text-[#e0116d]">
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </div>
  );
}
