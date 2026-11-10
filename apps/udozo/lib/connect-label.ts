import type { ShopOrder } from "@bitocard/api-client/classifieds";

/**
 * A Connect order's parcel label (docs/UDOZO_CONNECT_PLAN.md, phase 5): what the QR code holds and what is printed.
 * Only the order's number, the centre and the item: never the buyer's name, phone or address. The centre's staff find
 * the order by its number (`connect.udozo.com`'s Find reads the QR code's first part, the number).
 */
export function labelFor(order: Pick<ShopOrder, "number" | "fulfilment" | "status" | "role" | "listing" | "quantity"> & { connect?: ShopOrder["connect"] }) {
  if (order.fulfilment !== "connect" || !order.connect || order.role !== "seller") return null;
  if (!["paid", "sent"].includes(order.status)) return null;
  const centre = order.connect.centre;
  return {
    /** The QR code's text: the order number first (what staff search by), then the centre. */
    qr: `${order.number} ${centre.number}`,
    number: order.number,
    centre: { name: centre.name, number: centre.number, address: `${centre.address}, ${centre.area}, ${centre.state}`, hours: centre.hours, phone: centre.phone },
    item: order.quantity > 1 ? `${order.listing.title} (${order.quantity} units)` : order.listing.title,
  };
}
