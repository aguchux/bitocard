import { redirect } from "next/navigation";

/** Brands moved to Catalog > Brands; old links land there. */
export default function StorefrontBrandsRedirect() {
  redirect("/catalog/brands");
}
