import { redirect } from "next/navigation";

/** A store's purchases page, on udozo.com: the account's Safe pay orders. */
export default function Purchases() {
  redirect("/account/orders");
}
