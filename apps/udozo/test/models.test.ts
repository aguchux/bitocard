// @vitest-environment jsdom
// The models of Udozo's brands on udozo.com: the listing form's model field (the chosen brand's list, a model typed by
// hand, and with no brand any brand's model, which brings its brand), the title's brand and model offered and never
// applied unasked, a chosen model cleared when the brand changes, and buyers filtering by model once one brand is chosen.
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopBrand, ShopCategory, ShopModel, ShopModelMatch, ShopSearch } from "@bitocard/api-client/classifieds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const brand = (name: string): ShopBrand => ({ object: "classified_brand", slug: name.toLowerCase(), name, logo_url: null, color: null });
const model = (name: string, extra: Partial<ShopModel> = {}): ShopModel => ({ object: "classified_model", name, ...extra });
const categoryId = "8b7e5d1c-0000-4000-8000-000000000001";

const searchModels = vi.fn(async (q: string, named: string): Promise<{ ok: true; data: ShopModel[] }> => {
  if (!named) return { ok: true, data: q.length >= 2 ? [model("Corolla", { brand: brand("Toyota") })] : [] };
  const list = named === "Toyota" ? [model("Corolla"), model("Camry")] : [model("Accord")];
  return { ok: true, data: list.filter(item => item.name.toLowerCase().startsWith(q.toLowerCase())) };
});
const searchBrands = vi.fn(async () => ({ ok: true as const, data: [brand("Toyota"), brand("Honda")] }));
let match: ShopModelMatch = { object: "classified_model_match", brand: null, model: null };
const detectModel = vi.fn(async () => ({ ok: true as const, data: match }));
vi.mock("@/lib/shop-actions", () => ({
  searchModels: (q: string, named: string) => searchModels(q, named),
  searchBrands: () => searchBrands(),
  detectModel: () => detectModel(),
  searchFeatures: async () => ({ ok: true, data: [] }),
  suggestFeature: async () => ({ ok: true, data: {} }),
}));
const shopApi = vi.fn(async (path: string) => ({ ok: true, data: { data: path ? [model("Corolla", { listings: 4 }), model("Camry", { listings: 0 })] : [] } }));
vi.mock("@/lib/api", () => ({ query: (params: Record<string, unknown>) => `?${new URLSearchParams(params as Record<string, string>)}`, shopApi: (path: string) => shopApi(path) }));

const { ModelField } = await import("@/components/account/model-field");
const { FeaturesField } = await import("@/components/account/listing-form");
const { Results } = await import("@/components/results");
const { modelFilters } = await import("@/lib/brands");
const { readFilters } = await import("@/lib/search");

const mounted: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  match = { object: "classified_model_match", brand: null, model: null };
});
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.clearAllMocks();
});

const settle = async () => act(async () => void (await vi.runAllTimersAsync()));
const type = (input: HTMLInputElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const focus = (input: HTMLInputElement) => act(() => input.focus());
const options = (host: HTMLElement) => [...host.querySelectorAll('[role="option"]')].map(item => item.textContent);
const choose = (host: HTMLElement, text: string) => act(() => (([...host.querySelectorAll('[role="option"]')].find(item => item.textContent?.includes(text)) as HTMLElement).click()));

function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push(() => act(() => root.unmount()));
  return host;
}

describe("the model field", () => {
  function Field({ named, onPick }: { named: string; onPick: (item: ShopModel) => void }) {
    const [value, setValue] = useState("");
    return createElement(ModelField, { value, brand: named, categoryId, label: "Model", placeholder: "e.g. Corolla", onChange: setValue, onPick });
  }

  it("shows the chosen brand's models as soon as it opens, and those matching what is typed", async () => {
    const host = mount(createElement(Field, { named: "Toyota", onPick: vi.fn() }));
    const input = host.querySelector("input")!;
    focus(input);
    await settle();
    expect(options(host)).toEqual(["Corolla", "Camry"]);
    type(input, "cam");
    await settle();
    expect(options(host)[0]).toBe("Camry");
  });

  it("takes a model the list lacks, as typed", async () => {
    const host = mount(createElement(Field, { named: "Toyota", onPick: vi.fn() }));
    const input = host.querySelector("input")!;
    focus(input);
    type(input, "Hilux Revo");
    await settle();
    expect(options(host).at(-1)).toContain("Use “Hilux Revo”");
    expect(host.textContent).toContain("you can still use it");
    expect(input.value).toBe("Hilux Revo");
  });

  it("with no brand yet, finds any brand's model and says whose it is", async () => {
    const onPick = vi.fn();
    const host = mount(createElement(Field, { named: "", onPick }));
    const input = host.querySelector("input")!;
    expect(input.placeholder).toBe("e.g. Corolla");
    focus(input);
    type(input, "cor");
    await settle();
    expect(options(host)[0]).toContain("Toyota");
    choose(host, "Corolla");
    expect(onPick.mock.calls[0]?.[0].brand.name).toBe("Toyota");
  });
});

describe("the features on the listing form", () => {
  const def = (key: string, name: string) => ({ key, name, icon: "tag", data_type: "text", unit: null, choices: [], placeholder: null, default_value: null });
  const suggested = [def("brand", "Brand"), def("model", "Model"), def("colour", "Colour")] as never[];
  type Row = { key: string; value: string };
  let latest: Row[] = [];

  function Form({ title, start }: { title: string; start: Row[] }) {
    const [rows, setRows] = useState(start.map(row => ({ ...def(row.key, row.key), value: row.value })));
    latest = rows;
    return createElement(FeaturesField as never, { suggested, rows, categoryId, title, onChange: setRows, invalid: null });
  }
  const values = () => latest.map(row => [row.key, row.value]);

  it("choosing a brand asks for its model next, straight after it", async () => {
    const host = mount(createElement(Form, { title: "", start: [{ key: "brand", value: "" }, { key: "colour", value: "Red" }] }));
    focus(host.querySelector('input[aria-label="brand"]')!);
    await settle();
    choose(host, "Toyota");
    expect(values()).toEqual([["brand", "Toyota"], ["model", ""], ["colour", "Red"]]);
  });

  it("changing the brand clears a model chosen from the old list, and leaves one the seller typed", async () => {
    const host = mount(createElement(Form, { title: "", start: [{ key: "brand", value: "Toyota" }, { key: "model", value: "" }] }));
    focus(host.querySelector('input[aria-label="model"]')!);
    await settle();
    choose(host, "Corolla");
    expect(values()).toEqual([["brand", "Toyota"], ["model", "Corolla"]]);
    focus(host.querySelector('input[aria-label="brand"]')!);
    await settle();
    choose(host, "Honda");
    expect(values()).toEqual([["brand", "Honda"], ["model", ""]]);

    const typed = mount(createElement(Form, { title: "", start: [{ key: "brand", value: "Toyota" }, { key: "model", value: "My own model" }] }));
    focus(typed.querySelector('input[aria-label="brand"]')!);
    await settle();
    choose(typed, "Honda");
    expect(values()).toEqual([["brand", "Honda"], ["model", "My own model"]]);
  });

  it("offers what the title names, and only applies it when asked", async () => {
    match = { object: "classified_model_match", brand: brand("Toyota"), model: "Corolla" };
    const host = mount(createElement(Form, { title: "Toyota Corolla 2015", start: [] }));
    await settle();
    expect(host.textContent).toContain("From your title: Toyota Corolla");
    expect(values()).toEqual([]);
    act(() => ([...host.querySelectorAll("button")].find(item => item.textContent === "Use this") as HTMLElement).click());
    expect(values()).toEqual([["brand", "Toyota"], ["model", "Corolla"]]);
    expect(host.textContent).not.toContain("From your title");
  });

  it("offers only what is missing, never another brand's model, and goes away when declined", async () => {
    match = { object: "classified_model_match", brand: brand("Toyota"), model: "Corolla" };
    const same = mount(createElement(Form, { title: "Toyota Corolla", start: [{ key: "brand", value: "toyota" }] }));
    await settle();
    expect(same.textContent).toContain("From your title: toyota Corolla");
    const other = mount(createElement(Form, { title: "Toyota Corolla", start: [{ key: "brand", value: "Honda" }] }));
    await settle();
    expect(other.textContent).not.toContain("From your title");
    const declined = mount(createElement(Form, { title: "Toyota Corolla", start: [] }));
    await settle();
    act(() => (declined.querySelector('[aria-label="Not Toyota Corolla"]') as HTMLElement).click());
    expect(declined.textContent).not.toContain("From your title");
    expect(values()).toEqual([]);
  });
});

describe("the model filter", () => {
  const category = { slug: "cars", name: "Cars", features: [] } as unknown as ShopCategory;
  const filters = (features: string[]) => ({ ...readFilters({}), features });

  it("waits until one brand is chosen, then offers its models with live listings", async () => {
    expect(await modelFilters(category, filters([]), "NG")).toEqual([]);
    expect(await modelFilters(category, filters(["brand:Toyota,Honda"]), "NG")).toEqual([]);
    expect(await modelFilters(null, filters(["brand:Toyota"]), "NG")).toEqual([]);
    expect(shopApi).not.toHaveBeenCalled();
    const offered = await modelFilters(category, filters(["brand:Toyota"]), "NG");
    expect(offered.map(item => item.name)).toEqual(["Corolla"]);
    expect(shopApi.mock.calls[0]?.[0]).toContain("/v1/classifieds/models?category=cars&brand=Toyota&country=NG");
  });

  it("is a row of checkboxes the plain form sends, with the counts", () => {
    const html = renderToStaticMarkup(
      createElement(Results, {
        result: { data: [], total: 0, tiers: [] } as unknown as ShopSearch,
        filters: filters(["brand:Toyota", "model:Corolla"]),
        path: "/ng/c/cars",
        category,
        brands: [brand("Toyota")],
        models: [model("Corolla", { listings: 4 }), model("Camry", { listings: 2 })],
        place: { country: "Nigeria" },
        currency: "NGN",
      }),
    );
    expect(html).toContain("<legend");
    expect(html).toMatch(/<input[^>]*name="f.model"[^>]*checked=""[^>]*value="Corolla"/);
    expect(html).toContain('name="f.model" value="Camry"');
  });
});
