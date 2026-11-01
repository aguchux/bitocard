import { ogImageSize } from "@bitocard/ui/og-image";
import { marketFor } from "@/lib/api";
import { textCard } from "@/lib/og";
import { findCategory } from "@/lib/places";
import { categoriesOf } from "@/lib/reference";

export const alt = "A category of listings on Udozo";
export const size = ogImageSize;
export const contentType = "image/png";

/** A category's social preview: what is for sale, where, and its subcategories. */
export default async function CategoryImage({ params }: { params: Promise<{ cc: string; category: string }> }) {
  const { cc, category: slug } = await params;
  const [market, categories] = await Promise.all([marketFor(cc), categoriesOf(cc)]);
  const found = findCategory(categories, slug);
  if (!market || !found) return textCard({ eyebrow: "Udozo", title: "Buy and sell near you", line: "Chat with sellers and pay with Safe pay." });
  const line = found.children.length ? found.children.slice(0, 4).map(child => child.name).join(" · ") : "Chat with sellers near you and pay with Safe pay.";
  return textCard({ eyebrow: `Udozo ${market.name}`, title: `${found.category.name} for sale`, line });
}
