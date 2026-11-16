import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Seller HQ's screens in jsdom, as Udozo's Seller HQ tests run.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "jsdom", pool: "threads", include: ["test/**/*.test.{ts,tsx}"], testTimeout: 20000 },
});
