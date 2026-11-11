import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Udozo POS's server helpers, actions, route handlers and screens. Node by default (screens opt into jsdom);
// `request.ts` mocks `next/headers` and `server-only` before any helper loads.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node", pool: "threads", include: ["test/**/*.test.{ts,tsx}"], setupFiles: ["test/request.ts"], testTimeout: 20000 },
});
