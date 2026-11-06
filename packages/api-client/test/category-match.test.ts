// What a seller types on Post an ad finds its subcategory by name or by its search words: "carpet", "plastic chairs"
// or "cups" each land in the right place, the best fits first.
import { describe, expect, test } from "vitest";
import { catchAllsOf, categoryMatch, matchCategories, type ShopCategory, type ShopTopCategory } from "../src/classifieds";

const child = (slug: string, name: string, keywords: string[]): ShopCategory => ({ object: "classified_category", id: slug, slug, name, icon: "tag", b2b: false, keywords, safety_checklist: [], features: [] });
const top = (slug: string, name: string, children: ShopCategory[]): ShopTopCategory => ({ ...child(slug, name, []), children });

const tree = [
  top("home-garden", "Home and living", [
    child("furniture", "Furniture", ["sofa", "chair", "table", "wardrobe"]),
    child("plastic-furniture", "Plastic chairs and tables", ["plastic chair", "plastic table", "monobloc", "party chair"]),
    child("carpets-rugs", "Carpets, rugs and curtains", ["carpet", "rug", "curtain", "door mat"]),
    child("tableware", "Plates, cups and dinnerware", ["plate", "cup", "mug", "ceramic", "dinner set"]),
  ]),
  top("fashion", "Fashion", [child("bags", "Bags", ["bag", "backpack"]), child("fabrics", "Fabrics and textiles", ["ankara", "lace", "fabric"])]),
];
const slugs = (typed: string) => matchCategories(tree, typed).map(found => found.child.slug);

describe("finding a category by what was typed", () => {
  test("its name first, then its search words", () => {
    expect(slugs("carpet")[0]).toBe("carpets-rugs");
    expect(slugs("rugs")).toEqual(["carpets-rugs"]);
    expect(slugs("cups")).toEqual(["tableware"]);
    expect(slugs("ankara")).toEqual(["fabrics"]);
    expect(slugs("fashion")).toEqual(["bags", "fabrics"], "a top category's name finds its subcategories");
  });

  test("words holding a whole search word find it, ahead of looser fits", () => {
    expect(slugs("plastic chairs")[0]).toBe("plastic-furniture");
    expect(slugs("ceramic plates for sale")).toContain("tableware");
    expect(slugs("monob")).toEqual(["plastic-furniture"], "the start of a search word");
  });

  test("a short or unrelated word finds little", () => {
    expect(slugs("a")).toEqual([]);
    expect(slugs("ac")).not.toContain("bags", "only the start of a search word counts");
    expect(slugs("helicopter")).toEqual([]);
  });

  test("scores say how well it fits", () => {
    const rugs = tree[0]!.children[2]!;
    expect(categoryMatch(rugs, "Home and living", "carpets")).toBe(4);
    expect(categoryMatch(rugs, "Home and living", "door m")).toBe(3);
    expect(categoryMatch(rugs, "Home and living", "big door mat")).toBe(2);
    expect(categoryMatch({ name: "Old", keywords: undefined }, "Home", "x y")).toBe(0);
  });
});

describe("what fits no category", () => {
  test("Other items, then Other services, where the market has them", () => {
    const withCatchAlls = [
      ...tree,
      top("services", "Services", [child("cleaning", "Cleaning", ["cleaner"]), child("other-services", "Other services", ["house sitting"])]),
      top("everything-else", "Everything else", [child("other-items", "Other items", ["miscellaneous"])]),
    ];
    expect(catchAllsOf(withCatchAlls).map(found => [found.parent.slug, found.child.slug])).toEqual([["everything-else", "other-items"], ["services", "other-services"]]);
    expect(catchAllsOf(tree)).toEqual([]);
  });
});
