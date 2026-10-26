import { describe, expect, it } from "vitest";
import { offlineWorker } from "@bitocard/ui/offline-worker";
import manifest from "@/app/manifest";
import { GET } from "@/app/sw.js/route";

// The prompt's rules and dialog are shared (@bitocard/ui/install, install-ui) and tested with BitoCard Shop's.
describe("bitocard.com as an app", () => {
  it("is installable: a standalone manifest with its icons, and its service worker at /sw.js", async () => {
    const app = manifest();
    expect([app.display, app.start_url, app.scope, app.id]).toEqual(["standalone", "/", "/", "/"]);
    expect(app.icons?.some(icon => icon.sizes === "512x512")).toBe(true);
    const res = GET();
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(await res.text()).toBe(offlineWorker("BitoCard"));
  });
});
