import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/** Shared ESLint config for every BitoCard Next.js app and React package. */
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A const read before its declaration only throws when that line runs (inside a callback, once data has loaded),
    // so builds and quick checks miss it and the page crashes in production. Functions and types are hoisted: allowed.
    rules: { "@typescript-eslint/no-use-before-define": ["error", { functions: false, classes: false, variables: true, typedefs: false, ignoreTypeReferences: true }] },
  },
  globalIgnores([".next/**", "out/**", "build/**", ".vercel/**", "next-env.d.ts"]),
]);
