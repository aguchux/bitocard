import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The storefront's server helpers and proxy, in Node. Threads start faster than forked processes under `npm run check`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // `request.ts` mocks `next/headers` and `server-only` before any helper loads.
  test: { environment: "node", pool: "threads", include: ["test/**/*.test.ts"], setupFiles: ["test/request.ts"] },
});
