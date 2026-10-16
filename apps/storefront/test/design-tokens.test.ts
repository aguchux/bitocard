// The store's colours and fonts come from the shared tokens (@bitocard/ui/styles/tokens.css): no hard-coded hex
// colour classes (`bg-[#ff2382]`, use `bg-brand-500`), and Inter is loaded once, in the root layout.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = ["app", "components", "lib"].flatMap(dir => sources(join(root, dir)));
const matching = (pattern: RegExp) =>
  files.flatMap(file => [...readFileSync(file, "utf8").matchAll(pattern)].map(match => `${relative(root, file)}: ${match[0]}`));

describe("design tokens", () => {
  test("no hex colour classes: use the token utilities", () => {
    expect(matching(/-\[#[0-9a-fA-F]{3,8}\]/g)).toEqual([]);
  });

  test("no font-family classes: font-sans and font-display are Inter", () => {
    expect(matching(/font-\[family-name:[^\]]*\]/g)).toEqual([]);
  });

  test("Inter is loaded once, in the root layout", () => {
    expect(files.filter(file => readFileSync(file, "utf8").includes("next/font/")).map(file => relative(root, file).replaceAll("\\", "/"))).toEqual(["app/layout.tsx"]);
  });

  test("the global styles take the shared tokens and never set Arial", () => {
    const css = readFileSync(join(root, "app/globals.css"), "utf8");
    expect(css).toContain('@import "@bitocard/ui/styles/tokens.css";');
    expect(css).not.toMatch(/Arial/);
  });
});
