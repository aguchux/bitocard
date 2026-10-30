import { jsonLdText } from "@/lib/seo";

/** Structured data for search engines, as a script tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(data) }} />;
}
