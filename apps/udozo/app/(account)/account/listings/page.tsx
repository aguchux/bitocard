import { redirect } from "next/navigation";

/** My listings is the account's own page. */
export default function MyListings() {
  redirect("/account");
}
