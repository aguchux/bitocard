import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Verify's server helpers, route handlers and pure step logic, in Node. Threads start faster than forked processes.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // `request.ts` mocks `next/headers` and `server-only` before any helper loads.
  test: { environment: "node", pool: "threads", include: ["test/**/*.test.ts", "test/**/*.test.tsx"], setupFiles: ["test/request.ts"] },
});
