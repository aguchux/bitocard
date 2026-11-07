// Editing one's own seller page in place (7 November 2026, the owner's request): the cover is cut to 4:1 around where
// the seller slides it, the slider moves the way the picture can move, and the line beside the name offers a username.
import { describe, expect, test, vi } from "vitest";
import { coverCrop, coverSize } from "@bitocard/ui/image";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/ng/seller/chinedu", useSearchParams: () => new URLSearchParams() }));

const { coverAxis, coverMinimum, coverProblem, CoverButton } = await import("@/components/seller-edit");
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { usernameLine } = await import("@/lib/username");

describe("the cover", () => {
  test("is cut to 4:1 around where it is slid", () => {
    expect(coverSize).toEqual({ width: 1600, height: 400 });
    // A photo taller than 4:1 keeps its whole width and moves up and down.
    expect(coverCrop(2000, 1500, 0.5)).toEqual({ x: 0, y: 500, width: 2000, height: 500 });
    expect(coverCrop(2000, 1500, 0)).toEqual({ x: 0, y: 0, width: 2000, height: 500 });
    expect(coverCrop(2000, 1500, 1)).toEqual({ x: 0, y: 1000, width: 2000, height: 500 });
    // A panorama keeps its whole height and moves sideways.
    expect(coverCrop(3000, 500, 0.5)).toEqual({ x: 500, y: 0, width: 2000, height: 500 });
    expect(coverCrop(3000, 500, 2)).toEqual({ x: 1000, y: 0, width: 2000, height: 500 });
    expect(coverCrop(0, 500)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect([coverAxis(2000, 1500), coverAxis(3000, 500), coverAxis(800, 200)]).toEqual(["y", "x", "y"]);
  });
});

describe("the cover's size", () => {
  test("is said in the editor, and a picture too small once cut to 4:1 is refused before it is sent", () => {
    const html = renderToStaticMarkup(createElement(CoverButton, { url: null }));
    expect(html).toContain("Best size: 1600 × 400 pixels");
    expect(html).toContain("At least 600 × 150 pixels");
    expect(coverMinimum).toEqual({ width: 600, height: 150 });
    expect(coverProblem(1600, 400)).toBeNull();
    expect(coverProblem(600, 150)).toBeNull();
    // 800 × 600 is cut to 800 × 200: wide enough and tall enough.
    expect(coverProblem(800, 600)).toBeNull();
    // 500 × 500 is cut to 500 × 125.
    expect(coverProblem(500, 500)).toContain("500 × 125");
    // A thin panorama, 3000 × 120, keeps only 480 × 120.
    expect(coverProblem(3000, 120)).toContain("480 × 120");
  });
});

describe("beside the name", () => {
  test("everyone sees the @username; its owner can change it, or choose one", () => {
    expect(usernameLine("chinedu", false, null)).toEqual({ username: "@chinedu", action: null });
    expect(usernameLine("chinedu", true, null)).toEqual({ username: "@chinedu", action: { text: "Change", href: "/account/profile/username" } });
    expect(usernameLine(null, false, null)).toBeNull();
    expect(usernameLine(null, true, { eligible: true, posted: 6, required: 5 })?.action?.text).toBe("Choose a username");
    expect(usernameLine(null, true, { eligible: false, posted: 1, required: 5 })?.action?.text).toBe("Post 4 more ads to choose a username");
    expect(usernameLine(null, true, null)?.action?.text, "the status could not be read").toBe("Choose a username");
  });
});
