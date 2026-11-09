// @vitest-environment jsdom
// The `/handoff` page: reads the code and where to land from the fragment, clears it from the address bar at once,
// and has this site's server exchange it.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const continueSignIn = vi.fn(async () => ({ ok: false as const, unreachable: false }));
vi.mock("@/lib/handoff-actions", () => ({ continueSignIn }));
const { default: HandoffPage } = await import("@/app/handoff/page");

describe("the handoff landing", () => {
  it("reads the fragment, clears it and asks the server to exchange the code once", async () => {
    window.history.replaceState(null, "", "/handoff#c=bch_code123&n=%2Fapply");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(HandoffPage)));
    expect(continueSignIn).toHaveBeenCalledTimes(1);
    expect(continueSignIn).toHaveBeenCalledWith("bch_code123", "/apply");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/handoff");
    // Refused: a way to sign in again, back to where they were going.
    expect(host.textContent).toContain("This sign-in link has expired");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/signin?next=%2Fapply");
    act(() => root.unmount());
  });
});
