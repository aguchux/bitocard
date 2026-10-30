import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Udozo Seller HQ's screens in jsdom. Threads start faster than forked processes.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "jsdom", pool: "threads", include: ["test/**/*.test.{ts,tsx}"] },
});
