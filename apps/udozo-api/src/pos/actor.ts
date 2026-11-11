/** Who did something at the POS: the owner (their Udozo account) or one of their staff. */
export type PosBy = { customerId: string | null; staffId: string | null; name: string };

export const ownerBy = (owner: { id: string; name: string }): PosBy => ({ customerId: owner.id, staffId: null, name: owner.name });

/**
 * How much discount a member of staff may give at the till: their role's limit (basis points of the subtotal, null for
 * any), and a manager's if one gave their PIN. Absent for the owner, who gives any discount.
 */
export type DiscountRule = { limit: number | null; approverLimit?: number | null; approved: boolean };

/** What the till's actions take besides the basket: who did it, and the discount they may give. */
export type PosSellOptions = { by?: PosBy; discount?: DiscountRule };
