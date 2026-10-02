import { defineConfig, globalIgnores } from "eslint/config";
import node from "@bitocard/eslint-config/node";

export default defineConfig([...node, globalIgnores(["src/generated/**"])]);
