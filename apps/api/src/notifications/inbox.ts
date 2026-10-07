import type { NotificationSeverity, ResellerRole } from '../generated/prisma/client.js';

type ResellerType = {
  realm: 'reseller';
  /** Reseller staff roles who see it, besides the owner (who sees every reseller notification). */
  roles: ResellerRole[];
  severity: NotificationSeverity;
  label: string;
};

type AdminType = {
  realm: 'admin';
  /** Admin roles who see it, besides super admins (who see every admin notification). */
  roles: string[];
  severity: NotificationSeverity;
  label: string;
};

type PersonalType = {
  /** Only the person it is about, in their own realm, whatever their role. */
  realm: 'personal';
  severity: NotificationSeverity;
  label: string;
};

type CustomerType = {
  /**
   * A hosted-storefront customer, about their own orders and account at one store. Shown under the store's brand
   * (name, address, logo); never names BitoCard's suppliers or costs. Sent once customer accounts exist (hosted
   * checkout, M10; gift-card sales later), with `InboxService.customer`.
   */
  realm: 'customer';
  severity: NotificationSeverity;
  label: string;
  /** Pushed unless the customer turns it off. */
  push: boolean;
  /** Always pushed (security notices). */
  locked?: boolean;
};

/**
 * Every in-app notification, who sees it and how serious it is. Recipients are worked out when it is created: reseller
 * notifications go to the owner plus the members whose role is listed; admin ones to super admins plus the listed admin
 * roles; personal ones to the one person; customer ones to the one storefront customer. A new notification needs its
 * entry here (and in AGENTS.md).
 */
export const notificationTypes = {
  // Reseller accounts ------------------------------------------------------------------------------------------------
  'connection.approved': { realm: 'reseller', roles: ['admin'], severity: 'success', label: 'Own integration approved' },
  'connection.rejected': { realm: 'reseller', roles: ['admin'], severity: 'warning', label: 'Own integration rejected' },
  'connection.suspended': { realm: 'reseller', roles: ['admin'], severity: 'critical', label: 'Own integration suspended' },
  'connection.reinstated': { realm: 'reseller', roles: ['admin'], severity: 'success', label: 'Own integration reinstated' },
  'connection.sync_failed': { realm: 'reseller', roles: ['admin', 'developer'], severity: 'warning', label: 'Own catalogue sync failed' },
  'supplier_notification.failed': { realm: 'reseller', roles: ['admin', 'developer'], severity: 'warning', label: 'Supplier notification not processed' },
  'order.needs_review': { realm: 'reseller', roles: ['admin', 'support'], severity: 'warning', label: 'Order outcome unclear' },
  'top_up.credited': { realm: 'reseller', roles: ['finance'], severity: 'success', label: 'Wallet topped up' },
  'store.checkout_refused': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'warning', label: 'Store order turned away' },
  'payout.paid': { realm: 'reseller', roles: ['finance'], severity: 'success', label: 'Withdrawal paid' },
  'payout.failed': { realm: 'reseller', roles: ['finance'], severity: 'critical', label: 'Withdrawal failed' },
  'bank_account.added': { realm: 'reseller', roles: ['finance'], severity: 'info', label: 'Payout bank account added' },
  'plan.renewal_failed': { realm: 'reseller', roles: ['finance'], severity: 'critical', label: 'Plan renewal failed' },
  'plan.ended': { realm: 'reseller', roles: ['finance'], severity: 'warning', label: 'Plan ended' },
  'webhook_endpoint.disabled': { realm: 'reseller', roles: ['admin', 'developer'], severity: 'critical', label: 'Webhook endpoint disabled' },
  'verification.updated': { realm: 'reseller', roles: [], severity: 'info', label: 'Identity check updated' },
  'team.member_joined': { realm: 'reseller', roles: ['admin'], severity: 'info', label: 'Team member joined' },
  'startup_allowance.granted': { realm: 'reseller', roles: ['finance'], severity: 'success', label: 'Startup allowance granted' },
  'startup_allowance.revoked': { realm: 'reseller', roles: ['finance'], severity: 'warning', label: 'Startup allowance revoked' },
  'fee.refunded': { realm: 'reseller', roles: ['finance'], severity: 'info', label: 'BitoCard fee refunded' },

  // Personal (security) ----------------------------------------------------------------------------------------------
  'security.password_changed': { realm: 'personal', severity: 'warning', label: 'Password changed' },
  'security.email_changed': { realm: 'personal', severity: 'warning', label: 'Sign-in email changed' },
  'security.email_added': { realm: 'personal', severity: 'warning', label: 'Email address added' },

  // BitoCard admins --------------------------------------------------------------------------------------------------
  'admin.reseller.signed_up': { realm: 'admin', roles: ['operations', 'support'], severity: 'info', label: 'New reseller' },
  'admin.connection.review': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Own integration to review' },
  'admin.verification.review': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Identity check to review' },
  'admin.order.needs_review': { realm: 'admin', roles: ['operations', 'support'], severity: 'warning', label: 'Order in the exception queue' },
  'admin.supplier_notification.failed': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Supplier notification not processed' },
  'admin.payout.failed': { realm: 'admin', roles: ['finance'], severity: 'critical', label: 'Withdrawal failed' },
  'admin.checkout.refund_stuck': { realm: 'admin', roles: ['finance'], severity: 'critical', label: 'Customer refund refused' },
  'admin.fx.paused': { realm: 'admin', roles: ['finance'], severity: 'critical', label: 'Conversions paused' },

  // Storefront customers (baselined: sent once customer accounts exist) -----------------------------------------------
  'customer.order.completed': { realm: 'customer', severity: 'success', label: 'Order delivered', push: true },
  'customer.order.failed': { realm: 'customer', severity: 'warning', label: 'Order could not be completed', push: true },
  'customer.order.refunded': { realm: 'customer', severity: 'info', label: 'Order refunded', push: true },
  'customer.wallet.credited': { realm: 'customer', severity: 'success', label: 'Money added to your wallet', push: true },
  'customer.gift_card_sale.accepted': { realm: 'customer', severity: 'success', label: 'Gift card sale accepted', push: true },
  'customer.gift_card_sale.declined': { realm: 'customer', severity: 'warning', label: 'Gift card sale declined', push: true },
  'customer.verification.updated': { realm: 'customer', severity: 'info', label: 'Identity check updated', push: true },
  'customer.security.password_changed': { realm: 'customer', severity: 'warning', label: 'Password changed', push: true, locked: true },
  'customer.security.email_changed': { realm: 'customer', severity: 'warning', label: 'Sign-in email changed', push: true, locked: true },
} satisfies Record<string, ResellerType | AdminType | PersonalType | CustomerType>;

export type NotificationType = keyof typeof notificationTypes;
export type ResellerNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'reseller' ? K : never }[NotificationType];
export type AdminNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'admin' ? K : never }[NotificationType];
export type PersonalNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'personal' ? K : never }[NotificationType];
export type CustomerNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'customer' ? K : never }[NotificationType];
