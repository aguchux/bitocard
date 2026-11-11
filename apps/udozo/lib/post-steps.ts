/**
 * Post an ad's steps, in order: title and category; photos and video; price, condition, features and description;
 * where to sell; location, delivery and how buyers reach the seller; then the terms and posting. Every step is saved as
 * the seller goes, so moving between them never loses anything.
 */
export const postSteps = [
  { key: "basics", title: "Title and category", short: "Basics" },
  { key: "media", title: "Photos and video", short: "Photos" },
  { key: "details", title: "Price and details", short: "Details" },
  { key: "where", title: "Where to sell", short: "Where" },
  { key: "place", title: "Location and delivery", short: "Location" },
  { key: "post", title: "Terms and post", short: "Post" },
] as const;

export type PostStepKey = (typeof postSteps)[number]["key"];

/** The last step: the terms and Post. */
export const lastPostStep = postSteps.length - 1;

/**
 * The step holding the field the API named (`param`), so a refusal opens where it can be put right; null for one the
 * steps do not hold (the seller stays where they are).
 */
export function stepOf(param: string | null | undefined): number | null {
  if (!param) return null;
  if (param === "terms") return lastPostStep;
  if (param === "title" || param === "category_id") return 0;
  if (param === "photos" || param === "video" || param.startsWith("media")) return 1;
  if (param === "price" || param === "price_kind" || param === "sale_method" || param.startsWith("auction") || param === "safe_pay" || param === "condition" || param.startsWith("features") || param === "description") return 2;
  if (param === "on_shop" || param === "stock" || param.startsWith("resale") || param === "pos_enabled" || param === "barcode" || param === "reorder_level") return 3;
  if (param === "area_id" || param.startsWith("delivery") || param.startsWith("connect") || param === "pickup" || param === "contact") return 4;
  return null;
}

/** What the steps check before moving on: the ad as it stands in the form. */
export type PostValues = {
  title: string;
  categoryId: string | null;
  readyPhotos: number;
  uploadingPhotos: number;
  failedPhotos: number;
  minPhotos: number;
  priceKind: "fixed" | "negotiable" | "on_request";
  priceMinor: number | null;
  /** Sold at its price, or by auction (its price the starting price, with a length in days). */
  saleMethod?: "fixed" | "auction";
  auctionDays?: number | null;
  condition: string | null;
  onShop: boolean;
  resale: boolean;
  /** Sold at the seller's shop through Udozo POS. */
  pos?: boolean;
  /** Sold at the shop only: never public, so no photos, condition or area are needed, only a price for the till. */
  shopOnly?: boolean;
  areaId: string | null;
};

export type StepProblem = { message: string; param: string };

/**
 * What a step still needs before the next one, in the API's words and naming its field (null when it is complete).
 * The same rules the API checks on posting (`requireComplete`, the photos, at least one place to sell), asked early so
 * the seller puts each right on its own step. The video is optional and never holds a step back.
 */
export function stepProblem(step: number, values: PostValues): StepProblem | null {
  switch (step) {
    case 0:
      if (values.title.trim().length < 5) return { message: "Give your ad a title of at least 5 characters.", param: "title" };
      if (!values.categoryId) return { message: "Choose a category.", param: "category_id" };
      return null;
    case 1:
      if (values.uploadingPhotos > 0) return { message: "Wait for your photos to finish uploading.", param: "photos" };
      if (values.failedPhotos > 0) return { message: "Remove the photo that could not be used, or add it again.", param: "photos" };
      if (!values.shopOnly && values.readyPhotos < values.minPhotos) return { message: `Add at least ${values.minPhotos} photos.`, param: "photos" };
      return null;
    case 2:
      if (values.saleMethod === "auction") {
        if (!values.priceMinor) return { message: "Enter the starting price: bidding starts there.", param: "price" };
        if (!values.auctionDays) return { message: "Choose how long the auction runs.", param: "auction_days" };
      }
      if (values.shopOnly) {
        if (values.priceKind === "on_request" || !values.priceMinor) return { message: "Enter the price your till sells it at.", param: "price" };
        return null;
      }
      if (values.priceKind !== "on_request" && !values.priceMinor) return { message: "Enter the price, or choose Contact for price.", param: "price" };
      if (!values.condition) return { message: "Choose its condition.", param: "condition" };
      return null;
    case 3:
      if (!values.onShop && !values.resale && !values.pos) return { message: "Choose at least one place to sell it.", param: "on_shop" };
      return null;
    case 4:
      if (!values.shopOnly && !values.areaId) return { message: "Choose where it is: the area it is in.", param: "area_id" };
      return null;
    default:
      return null;
  }
}

/** The first step still missing something (the last step when none is), where a saved draft carries on. */
export function firstIncomplete(values: PostValues): number {
  for (let step = 0; step < lastPostStep; step++) if (stepProblem(step, values)) return step;
  return lastPostStep;
}
