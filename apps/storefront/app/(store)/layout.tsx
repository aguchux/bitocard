import { Inter } from "next/font/google";
import { StoreFooter, StoreHeader } from "@/components/store/layout";
import { storeNavigation } from "@/lib/navigation";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

/** The store's pages: header with the category menus, the page, and the footer. */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const { groups } = await storeNavigation();
  return (
    <div className={`${inter.variable} store min-h-svh bg-[#fcfdff] font-[family-name:var(--font-inter)] text-[#070f4c]`}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <StoreHeader groups={groups} />
      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <StoreFooter groups={groups} />
    </div>
  );
}
