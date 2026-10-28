import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewShell } from "@/components/review";
import { brand } from "@/lib/brand";

export const metadata: Metadata = { title: "Review ID checks" };

/** Resellers review their customers' checks on BitoCard's Verify only: Afrippa's are reviewed in its admin. */
export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  if (!brand.review) notFound();
  return <ReviewShell>{children}</ReviewShell>;
}
