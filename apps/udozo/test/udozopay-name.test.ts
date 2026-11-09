// Safe pay is UdozoPay (9 November 2026, the owner's request; docs/UDOZO_CONNECT_PLAN.md, phase 1): the old name is
// never written again in Udozo's apps, API or the shared screens they use, except where a line says it was renamed.
// Its old addresses redirect for good, and new copy uses `payName` and `connectName`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { connectName, payName } from "@bitocard/api-client/classifieds";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const roots = ["apps/udozo", "apps/udozo-admin", "apps/udozo-shq", "apps/udozo-api/src", "apps/udozo-api/test", "packages/api-client/src", "packages/ui/src"];
const skip = new Set(["node_modules", ".next", "dist", "generated", ".turbo", "coverage"]);
const self = fileURLToPath(import.meta.url);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (skip.has(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|mjs|css)$/.test(name) && path !== self ? [path] : [];
  });
}

describe("UdozoPay", () => {
  it("is the name everywhere: Safe pay appears only where a line says it was renamed", () => {
    const stray = roots.flatMap(root =>
      sources(join(repo, root)).flatMap(path =>
        readFileSync(path, "utf8")
          .split("\n")
          .filter(line => /safe pay/i.test(line) && !/(was|called) Safe pay|Safe pay (is|until)|udozopay\|safe pay/i.test(line))
          .map(line => `${path.slice(repo.length)}: ${line.trim()}`),
      ),
    );
    expect(stray).toEqual([]);
  });

  it("is one constant, as part of Udozo Connect", () => {
    expect(payName).toBe("UdozoPay");
    expect(connectName).toBe("Udozo Connect");
  });

  it("moves its old addresses for good", () => {
    const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    expect(config).toContain('{ source: "/account/safe-pay", destination: "/account/udozopay", permanent: true }');
    expect(config).toContain('{ source: "/legal/safe-pay", destination: "/legal/udozopay", permanent: true }');
    const guide = readFileSync(new URL("../app/(global)/safe-trade/page.tsx", import.meta.url), "utf8");
    expect(guide).toContain('<section id="udozopay"');
    expect(guide, "old links to #safe-pay still land on it").toContain('<span id="safe-pay" aria-hidden="true" />');
  });
});
