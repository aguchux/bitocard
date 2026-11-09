import { redirect } from "next/navigation";

/** A store's purchases page, on udozo.com: the account's UdozoPay orders. */
export default function Purchases() {
  redirect("/account/orders");
}
