// @vitest-environment jsdom
// Post an ad as a wizard: title and category; photos and video; price and details; where to sell; location and
// delivery; then the terms and Post. Each step says what it still needs before Next opens the following one, a saved
// draft carries on at its first unfinished step, the terms are a box ticked on the last step (accepted before posting),
// and a refusal from the API opens the step holding its field.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopMyListing, ShopState, ShopTopCategory } from "@bitocard/api-client/classifieds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));

type Answer = { ok: true; data: unknown } | { ok: false; message: string; code: string | null; param: string | null; signIn: boolean };
let terms = { version: "2026-11-01", path: "/legal/terms", accepted: false, previous_version: null as string | null };
let submitAnswer: Answer;
const createListing = vi.fn(async (): Promise<Answer> => ({ ok: true, data: { id: "11111111-1111-4111-8111-111111111111" } }));
const updateListing = vi.fn<(id: string, fields: Record<string, unknown>) => Promise<Answer>>(async () => ({ ok: true, data: {} }));
const submitListing = vi.fn(async () => submitAnswer);
const acceptShopTerms = vi.fn(async (version: string): Promise<Answer> => ({ ok: true, data: { ...terms, version, accepted: true } }));
vi.mock("@/lib/shop-actions", () => ({
  createListing: () => createListing(),
  updateListing: (id: string, fields: Record<string, unknown>) => updateListing(id, fields),
  submitListing: () => submitListing(),
  shopTerms: async () => terms,
  acceptShopTerms: (version: string) => acceptShopTerms(version),
  loadListing: async () => ({ ok: false, message: "", code: null, param: null, signIn: false }),
  removeMedia: async () => ({ ok: true, data: {} }),
  reorderPhotos: async () => ({ ok: true, data: {} }),
  searchFeatures: async () => ({ ok: true, data: [] }),
  suggestFeature: async () => ({ ok: true, data: {} }),
  detectModel: async () => ({ ok: true, data: { object: "classified_model_match", brand: null, model: null } }),
  videoUploadUrl: async () => ({ ok: false, message: "", code: null, param: null, signIn: false }),
}));

// The posting journey's steps, as the form tells them (never what was typed).
const told: unknown[] = [];
vi.mock("@/lib/posting-actions", () => ({ recordPostingStep: async (step: unknown) => void told.push(step) }));

const { ListingForm } = await import("@/components/account/listing-form");
const { firstIncomplete, stepOf, stepProblem } = await import("@/lib/post-steps");

const categoryId = "22222222-2222-4222-8222-222222222222";
const categories = [{ id: "top", slug: "phones", name: "Phones and tablets", icon: "smartphone", children: [{ id: categoryId, slug: "mobile-phones", name: "Mobile phones", icon: "smartphone", features: [] }] }] as unknown as ShopTopCategory[];
const states = [{ slug: "lagos", name: "Lagos", areas: [{ id: "33333333-3333-4333-8333-333333333333", name: "Ikeja" }] }] as unknown as ShopState[];

const draft = (extra: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    status: "draft",
    title: "iPhone 13 Pro, 256 GB",
    category: { id: categoryId },
    price: { kind: "fixed", amount: 52000000 },
    condition: "used",
    delivery: "none",
    pickup: true,
    delivery_fees: { within_state: null, nationwide: null },
    contact: "both",
    area: null,
    description: "",
    features: [],
    photos: [1, 2, 3, 4].map(n => ({ id: `photo-${n}`, url: `https://cdn.udozo.test/${n}.jpg`, status: "ready" })),
    video: null,
    on_shop: true,
    resale: { enabled: false, discount_bps: null, markup_max_bps: null },
    stock: 1,
    review_reason: null,
    ...extra,
  }) as unknown as ShopMyListing;

const mounted: Array<() => void> = [];
function mount(listing: ShopMyListing | null) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(ListingForm, { listing, categories, states, currency: "NGN", country: "NG", phoneConfirmed: false, minPhotos: 4 })));
  mounted.push(() => act(() => root.unmount()));
  return host;
}
const button = (host: HTMLElement, text: string | RegExp) => {
  const found = [...host.querySelectorAll("button")].find(item => (typeof text === "string" ? item.textContent?.trim() === text : text.test(item.textContent ?? "")));
  if (!found) throw new Error(`No button ${text}`);
  return found;
};
const click = async (element: HTMLElement) => act(async () => void element.click());
const type = (input: HTMLInputElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const stepLine = (host: HTMLElement) => host.querySelector("nav[aria-label='Steps'] p")?.textContent;
const alert = (host: HTMLElement) => host.querySelector("[role='alert']")?.textContent;

beforeEach(() => {
  window.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as unknown as number;
  terms = { version: "2026-11-01", path: "/legal/terms", accepted: false, previous_version: null };
  submitAnswer = { ok: true, data: { status: "active" } };
});
afterEach(() => {
  told.length = 0;
  for (const unmount of mounted.splice(0)) unmount();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("the steps", () => {
  it("are in the order asked for, each holding its own fields", () => {
    expect(["title", "category_id"].map(stepOf)).toEqual([0, 0]);
    expect(["photos", "video"].map(stepOf)).toEqual([1, 1]);
    expect(["price", "price_kind", "condition", "features[2].value", "description"].map(stepOf)).toEqual([2, 2, 2, 2, 2]);
    expect(["on_shop", "stock", "resale_discount_bps"].map(stepOf)).toEqual([3, 3, 3]);
    expect(["area_id", "delivery_fee_state", "pickup", "contact"].map(stepOf)).toEqual([4, 4, 4, 4]);
    expect(stepOf("terms")).toBe(5);
    expect(stepOf("something_else")).toBeNull();
    expect(stepOf(null)).toBeNull();
  });

  it("each says what it still needs, the API's rules asked early; the video never holds one back", () => {
    const values = { title: "Sofa", categoryId: null, readyPhotos: 0, uploadingPhotos: 0, failedPhotos: 0, minPhotos: 4, priceKind: "fixed" as const, priceMinor: null, condition: null, onShop: false, resale: false, areaId: null };
    expect(stepProblem(0, values)?.param).toBe("title");
    expect(stepProblem(0, { ...values, title: "Three-seat sofa" })?.param).toBe("category_id");
    expect(stepProblem(1, { ...values, readyPhotos: 3 })?.message).toBe("Add at least 4 photos.");
    expect(stepProblem(1, { ...values, readyPhotos: 4, uploadingPhotos: 1 })?.message).toBe("Wait for your photos to finish uploading.");
    expect(stepProblem(1, { ...values, readyPhotos: 4 })).toBeNull();
    expect(stepProblem(2, values)?.param).toBe("price");
    expect(stepProblem(2, { ...values, priceKind: "on_request" })?.param).toBe("condition");
    expect(stepProblem(3, values)?.param).toBe("on_shop");
    expect(stepProblem(3, { ...values, resale: true })).toBeNull();
    expect(stepProblem(4, values)?.param).toBe("area_id");
    expect(firstIncomplete({ ...values, title: "Three-seat sofa", categoryId, readyPhotos: 4, priceKind: "on_request", condition: "new", onShop: true })).toBe(4);
  });
});

describe("posting an ad", () => {
  it("starts with the title and category, and Next waits until both are given", async () => {
    const host = mount(null);
    expect(stepLine(host)).toBe("Step 1 of 6: Title and category");
    expect(host.textContent).not.toContain("Add photos");
    await click(button(host, /^Next: Photos/));
    expect(alert(host)).toBe("Give your ad a title of at least 5 characters.");
    expect(stepLine(host)).toBe("Step 1 of 6: Title and category");

    await type(host.querySelector("input[placeholder^='e.g. iPhone']")!, "Three-seat sofa");
    await click(button(host, /^Next: Photos/));
    expect(alert(host)).toBe("Choose a category.");
    await click(button(host, "Phones and tablets"));
    await click(button(host, "Mobile phones"));
    await click(button(host, /^Next: Photos/));
    expect(stepLine(host)).toBe("Step 2 of 6: Photos and video");
    expect(host.textContent).toContain("Add photos");
    expect(host.textContent).toContain("Add video");
    expect(host.querySelector("input[placeholder^='e.g. iPhone']")).toBeNull();

    await click(button(host, /^Next: Details/));
    expect(alert(host)).toBe("Add at least 4 photos.");
    await click(button(host, /Previous/));
    expect(stepLine(host)).toBe("Step 1 of 6: Title and category");
    expect((host.querySelector("input[placeholder^='e.g. iPhone']") as HTMLInputElement).value).toBe("Three-seat sofa");
  });

  it("carries a saved draft on at its first unfinished step, every step one tap away", async () => {
    const host = mount(draft());
    expect(stepLine(host)).toBe("Step 5 of 6: Location and delivery");
    expect(host.textContent).toContain("How buyers reach you");
    const steps = [...host.querySelectorAll("nav[aria-label='Steps'] ol button")] as HTMLButtonElement[];
    expect(steps.map(item => item.disabled)).toEqual([false, false, false, false, false, false]);
    await click(steps[3]!);
    expect(stepLine(host)).toBe("Step 4 of 6: Where to sell");
    expect(host.textContent).toContain("How many do you have in stock?");
    await click(steps[2]!);
    expect(host.textContent).toContain("Description");
    expect(host.textContent).toContain("Condition");
  });

  it("asks for the terms on the last step and accepts them before posting", async () => {
    const host = mount(draft({ area: { id: "33333333-3333-4333-8333-333333333333", state: { slug: "lagos" } } }));
    expect(stepLine(host)).toBe("Step 6 of 6: Terms and post");
    await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
    expect(host.textContent).toContain("Check your ad");
    expect(host.textContent).toContain("Ikeja, Lagos");
    expect(host.textContent).toContain("4 photos");
    expect(host.querySelector("a[href='/legal/terms']")).not.toBeNull();

    await click(button(host, "Post ad"));
    expect(alert(host)).toBe("Tick the box to accept Udozo's terms, then post your ad.");
    expect(submitListing).not.toHaveBeenCalled();

    const box = host.querySelector("input[type='checkbox']") as HTMLInputElement;
    await click(box);
    await click(button(host, "Post ad"));
    await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
    expect(acceptShopTerms).toHaveBeenCalledWith("2026-11-01");
    expect(submitListing).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/account/listings?posted=live");
  });

  it("says the terms are accepted already, and a refusal opens the step holding its field", async () => {
    terms = { ...terms, accepted: true };
    submitAnswer = { ok: false, message: "Remove the photo that could not be used, or add it again.", code: "media_failed", param: "photos", signIn: false };
    const host = mount(draft({ area: { id: "33333333-3333-4333-8333-333333333333", state: { slug: "lagos" } } }));
    await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
    expect(host.textContent).toContain("You have accepted Udozo's terms");
    expect(host.querySelector("input[type='checkbox']")).toBeNull();
    await click(button(host, "Post ad"));
    await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
    expect(acceptShopTerms).not.toHaveBeenCalled();
    expect(stepLine(host)).toBe("Step 2 of 6: Photos and video");
    expect(alert(host)).toBe("Remove the photo that could not be used, or add it again.");
  });
});

describe("editing a live ad", () => {
  const live = () => draft({ status: "active", price: { kind: "on_request", amount: null }, area: { id: "33333333-3333-4333-8333-333333333333", state: { slug: "lagos" } } });
  const pause = (ms: number) => act(async () => void (await new Promise(resolve => setTimeout(resolve, ms))));
  const steps = (host: HTMLElement) => [...host.querySelectorAll("nav[aria-label='Steps'] ol button")] as HTMLButtonElement[];
  const refusal: Answer = { ok: false, message: "Add a price.", code: "listing_incomplete", param: "price", signIn: false };

  it("keeps Fixed when it is refused for want of a price, and sends it again with the price", async () => {
    updateListing.mockResolvedValueOnce(refusal);
    const host = mount(live());
    await click(steps(host)[2]!);
    await click(button(host, "Fixed"));
    await pause(800);
    expect(updateListing).toHaveBeenCalledTimes(1);
    expect(alert(host)).toBe("Add a price.");

    await type(host.querySelector("#price") as HTMLInputElement, "41,000");
    await pause(800);
    expect(updateListing).toHaveBeenCalledTimes(2);
    expect(updateListing.mock.calls[1]![1]).toEqual({ price_kind: "fixed", price: "41,000" });
    expect(alert(host)).toBeUndefined();
  });

  it("Save changes stays on the ad, showing why, while the last change is refused", async () => {
    const tooHigh: Answer = { ok: false, message: "That price is too high.", code: "parameter_invalid", param: "price", signIn: false };
    updateListing.mockResolvedValue(tooHigh);
    const host = mount(live());
    await click(steps(host)[2]!);
    await click(button(host, "Fixed"));
    await type(host.querySelector("#price") as HTMLInputElement, "41,000");
    await click(steps(host)[5]!);
    await click(button(host, "Save changes"));
    await pause(0);
    expect(updateListing.mock.calls.at(-1)![1]).toEqual({ price_kind: "fixed", price: "41,000" });
    expect(push).not.toHaveBeenCalled();
    expect(stepLine(host)).toBe("Step 3 of 6: Price and details");
    expect(alert(host)).toBe("That price is too high.");
    updateListing.mockReset();
    updateListing.mockResolvedValue({ ok: true, data: {} });
  });
});

describe("the posting journey", () => {
  it("tells Udozo Sell was opened, each step reached and what a step still needed, never what was typed", async () => {
    const host = mount(null);
    await click(button(host, /^Next: Photos/));
    await type(host.querySelector("input[placeholder^='e.g. iPhone']")!, "Three-seat sofa");
    await click(button(host, "Phones and tablets"));
    await click(button(host, "Mobile phones"));
    await click(button(host, /^Next: Photos/));
    await click(button(host, /Previous/));
    await click(button(host, /^Next: Photos/));
    await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
    expect(told).toEqual([
      { type: "sell_opened", source: "direct" },
      { type: "step_refused", step: "basics", param: "title", listing_id: null },
      // Told as the draft is being made: the API adds it to the seller's open journey.
      { type: "step_reached", step: "media", listing_id: null },
    ]);
    expect(JSON.stringify(told)).not.toContain("sofa");
  });

  it("a draft reopened says so; the terms box unticked is told as the post step's field", async () => {
    const host = mount(draft({ area: { id: "33333333-3333-4333-8333-333333333333", state: { slug: "lagos" } } }));
    await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
    await click(button(host, "Post ad"));
    expect(told).toEqual([
      { type: "form_resumed", listing_id: "11111111-1111-4111-8111-111111111111" },
      { type: "post_pressed", listing_id: "11111111-1111-4111-8111-111111111111" },
      { type: "step_refused", step: "post", param: "terms", listing_id: "11111111-1111-4111-8111-111111111111" },
    ]);
  });

  it("editing a live ad tells nothing", async () => {
    mount(draft({ status: "active" }));
    await act(async () => void (await new Promise(resolve => setTimeout(resolve, 0))));
    expect(told).toEqual([]);
  });
});
