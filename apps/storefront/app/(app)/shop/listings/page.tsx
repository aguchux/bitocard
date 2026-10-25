import { redirect } from "next/navigation";

/** My listings is the Shop tab's own page. */
export default function MyListings() {
  redirect("/shop");
}
