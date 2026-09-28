import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BitoCard | Coming soon",
  icons: { icon: "/bitocard-logo.png", apple: "/bitocard-logo.png" },
  description: "A branded storefront for your digital goods business. BitoCard is coming soon. A Golojan Ltd venture.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
