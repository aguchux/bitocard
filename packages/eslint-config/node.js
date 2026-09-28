import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Shared ESLint config for Node services (the NestJS API). */
export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  globalIgnores(["dist/**", ".vercel/**"]),
]);
