"use client";

import type { ReactNode } from "react";
import { setAdminProduct } from "@bitocard/api-client";

// Set when this module loads in the browser, before any screen asks the API anything: the shared admin hooks (signing
// in, the session gate, step-up, the inbox, tickets, chats, integrations) then call Afrippa's own admin realm.
setAdminProduct("afrippa");

/** Afrippa's admin realm for every request this app makes (see above). */
export function AfrippaAdminProduct({ children }: { children: ReactNode }) {
  return children;
}
