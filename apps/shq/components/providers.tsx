"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Provider } from "react-redux";
import { makeStore } from "@bitocard/api-client";
import { LinkProvider } from "@bitocard/admin-ui/shell";

/** One Redux store (the API cache) per browser tab, and Next.js links for the shared components. */
export function Providers({ children }: { children: ReactNode }) {
  const [store] = useState(makeStore);
  return (
    <Provider store={store}>
      <LinkProvider link={Link}>{children}</LinkProvider>
    </Provider>
  );
}
