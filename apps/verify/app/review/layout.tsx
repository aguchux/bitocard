import type { Metadata } from "next";
import { ReviewShell } from "@/components/review";

export const metadata: Metadata = { title: "Review ID checks" };

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <ReviewShell>{children}</ReviewShell>;
}
