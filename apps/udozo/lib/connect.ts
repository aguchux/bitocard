/**
 * Udozo Connect's own site, connect.udozo.com (docs/UDOZO_CONNECT_PLAN.md): where Connect Centres apply and, later, run
 * their office. udozo.com links there, and its notices' `/connect/...` addresses redirect there (next.config.ts).
 */
export const connectUrl = (process.env.NEXT_PUBLIC_CONNECT_URL ?? "https://connect.udozo.com").replace(/\/$/, "");
/** Udozo POS's own site, pos.udozo.com, where a shop owner signs up and runs their till. */
export const posUrl = (process.env.NEXT_PUBLIC_POS_URL ?? "https://pos.udozo.com").replace(/\/$/, "");
