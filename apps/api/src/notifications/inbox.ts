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
  'domain.purchased': { realm: 'reseller', roles: ['admin'], severity: 'success', label: 'Domain bought' },
  'domain.purchase_failed': { realm: 'reseller', roles: ['admin'], severity: 'warning', label: 'Domain purchase failed' },
  'domain.active': { realm: 'reseller', roles: ['admin'], severity: 'success', label: 'Store live on its domain' },
  'domain.renewal_due': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'warning', label: 'Domain renewal due' },
  'domain.renewed': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'success', label: 'Domain renewed' },
  'domain.renewal_failed': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'critical', label: 'Domain renewal failed' },
  'domain.expired': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'critical', label: 'Domain expired' },
  'domain.suspended': { realm: 'reseller', roles: ['admin'], severity: 'critical', label: 'Domain suspended' },
  'account.suspended': { realm: 'reseller', roles: ['admin', 'developer', 'finance', 'support'], severity: 'critical', label: 'Account suspended' },
  'account.reinstated': { realm: 'reseller', roles: ['admin', 'developer', 'finance', 'support'], severity: 'success', label: 'Account no longer suspended' },
  'connection.approved': { realm: 'reseller', roles: ['admin'], severity: 'success', label: 'Own integration approved' },
  'connection.rejected': { realm: 'reseller', roles: ['admin'], severity: 'warning', label: 'Own integration rejected' },
  'connection.suspended': { realm: 'reseller', roles: ['admin'], severity: 'critical', label: 'Own integration suspended' },
  'connection.reinstated': { realm: 'reseller', roles: ['admin'], severity: 'success', label: 'Own integration reinstated' },
  'connection.sync_failed': { realm: 'reseller', roles: ['admin', 'developer'], severity: 'warning', label: 'Own catalogue sync failed' },
  'supplier_notification.failed': { realm: 'reseller', roles: ['admin', 'developer'], severity: 'warning', label: 'Supplier notification not processed' },
  'order.needs_review': { realm: 'reseller', roles: ['admin', 'support'], severity: 'warning', label: 'Order outcome unclear' },
  'top_up.credited': { realm: 'reseller', roles: ['finance'], severity: 'success', label: 'Wallet topped up' },
  'store.checkout_refused': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'warning', label: 'Store order turned away' },
  'number.expiring': { realm: 'reseller', roles: ['admin', 'support', 'finance'], severity: 'warning', label: 'Virtual number expiring' },
  'number.renewal_failed': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'warning', label: 'Virtual number not renewed' },
  'exchange.reserve_low': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'warning', label: 'Exchange desk reserve running low' },
  'crypto.deposit_credited': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'success', label: 'Coin deposit arrived' },
  'crypto.withdrawal_sent': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'success', label: 'Coin withdrawal sent' },
  'crypto.withdrawal_failed': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'warning', label: 'Coin withdrawal not sent' },
  'crypto.address_added': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'critical', label: 'Coin withdrawal address added' },
  'number.expired': { realm: 'reseller', roles: ['admin', 'support', 'finance'], severity: 'critical', label: 'Virtual number paused' },
  'number.deleted': { realm: 'reseller', roles: ['admin', 'support'], severity: 'warning', label: 'Virtual number deleted' },
  'payout.paid': { realm: 'reseller', roles: ['finance'], severity: 'success', label: 'Withdrawal paid' },
  'payout.failed': { realm: 'reseller', roles: ['finance'], severity: 'critical', label: 'Withdrawal failed' },
  'bank_account.added': { realm: 'reseller', roles: ['finance'], severity: 'info', label: 'Payout bank account added' },
  'dispute.opened': { realm: 'reseller', roles: ['admin', 'support'], severity: 'warning', label: 'Customer dispute opened' },
  'dispute.updated': { realm: 'reseller', roles: ['admin', 'support'], severity: 'info', label: 'Dispute updated' },
  'support.ticket_created': { realm: 'reseller', roles: ['admin', 'support'], severity: 'info', label: 'New support ticket' },
  'support.ticket_replied': { realm: 'reseller', roles: ['admin', 'support'], severity: 'info', label: 'Support ticket reply' },
  'support.ticket_updated': { realm: 'reseller', roles: ['admin', 'support'], severity: 'info', label: 'Support ticket updated' },
  'support.chat_waiting': { realm: 'reseller', roles: ['admin', 'support'], severity: 'warning', label: 'A customer is waiting in chat' },
  'support.chat_replied': { realm: 'reseller', roles: ['admin', 'support'], severity: 'info', label: 'BitoCard replied in chat' },
  'support.bot_paused': { realm: 'reseller', roles: ['admin'], severity: 'warning', label: 'Assistant paused' },
  'support.knowledge_stale': { realm: 'reseller', roles: ['admin'], severity: 'info', label: 'Assistant knowledge out of date' },
  'chargeback.opened': { realm: 'reseller', roles: ['finance'], severity: 'critical', label: 'Chargeback opened' },
  'chargeback.closed': { realm: 'reseller', roles: ['finance'], severity: 'warning', label: 'Chargeback decided' },
  'plan.renewal_failed': { realm: 'reseller', roles: ['finance'], severity: 'critical', label: 'Plan renewal failed' },
  'plan.ended': { realm: 'reseller', roles: ['finance'], severity: 'warning', label: 'Plan ended' },
  'invoice.closed': { realm: 'reseller', roles: ['finance'], severity: 'warning', label: 'Invoice to pay' },
  'invoice.overdue': { realm: 'reseller', roles: ['finance'], severity: 'critical', label: 'Invoice overdue' },
  'plan.stores_renewing': { realm: 'reseller', roles: ['finance'], severity: 'warning', label: 'Store plans renewing' },
  'plan.feature_changed': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'warning', label: 'Plan features changed' },
  'webhook_endpoint.disabled': { realm: 'reseller', roles: ['admin', 'developer'], severity: 'critical', label: 'Webhook endpoint disabled' },
  'verification.updated': { realm: 'reseller', roles: [], severity: 'info', label: 'Identity check updated' },
  'kyc.customer_submitted': { realm: 'reseller', roles: ['admin'], severity: 'info', label: 'Customer identity check to review' },
  'team.member_joined': { realm: 'reseller', roles: ['admin'], severity: 'info', label: 'Team member joined' },
  'startup_allowance.granted': { realm: 'reseller', roles: ['finance'], severity: 'success', label: 'Startup allowance granted' },
  'startup_allowance.revoked': { realm: 'reseller', roles: ['finance'], severity: 'warning', label: 'Startup allowance revoked' },
  'fee.refunded': { realm: 'reseller', roles: ['finance'], severity: 'info', label: 'BitoCard fee refunded' },

  // Personal (security) ----------------------------------------------------------------------------------------------
  'security.password_changed': { realm: 'personal', severity: 'warning', label: 'Password changed' },
  'security.email_changed': { realm: 'personal', severity: 'warning', label: 'Sign-in email changed' },
  'security.email_added': { realm: 'personal', severity: 'warning', label: 'Email address added' },
  'security.phone_added': { realm: 'personal', severity: 'warning', label: 'Phone number added or made primary' },

  // BitoCard admins --------------------------------------------------------------------------------------------------
  'admin.reseller.signed_up': { realm: 'admin', roles: ['operations', 'support'], severity: 'info', label: 'New reseller' },
  'admin.store.address_failed': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Store address not set up' },
  'admin.domain.renewal_unclear': { realm: 'admin', roles: ['operations', 'finance'], severity: 'warning', label: 'Domain renewal unconfirmed' },
  'admin.connection.review': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Own integration to review' },
  'admin.verification.review': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Identity check to review' },
  'admin.kyc.submitted': { realm: 'admin', roles: ['operations', 'support'], severity: 'info', label: 'BitoCard Verify check to review' },
  'admin.order.needs_review': { realm: 'admin', roles: ['operations', 'support'], severity: 'warning', label: 'Order in the exception queue' },
  'admin.supplier_notification.failed': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Supplier notification not processed' },
  'admin.payout.failed': { realm: 'admin', roles: ['finance'], severity: 'critical', label: 'Withdrawal failed' },
  'admin.checkout.refund_stuck': { realm: 'admin', roles: ['finance'], severity: 'critical', label: 'Customer refund refused' },
  'admin.order.cost_mismatch': { realm: 'admin', roles: ['finance', 'operations'], severity: 'warning', label: 'Supplier charged a different amount' },
  'admin.dispute.escalated': { realm: 'admin', roles: ['support', 'operations', 'finance'], severity: 'warning', label: 'Dispute escalated' },
  'admin.classifieds.dispute_opened': { realm: 'admin', roles: ['support', 'operations', 'finance'], severity: 'warning', label: 'BitoCard Shop Safe pay dispute opened' },
  'admin.classifieds.dispute_message': { realm: 'admin', roles: ['support', 'operations', 'finance'], severity: 'info', label: 'New message on a BitoCard Shop dispute' },
  'admin.classifieds.same_person': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'Safe pay refused: one person on both sides' },
  'admin.classifieds.seller_limited': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'BitoCard Shop seller reached the Safe pay strike limit' },
  'admin.classifieds.payout_review': { realm: 'admin', roles: ['finance'], severity: 'warning', label: 'BitoCard Shop payout waiting for review' },
  'admin.dispute.updated': { realm: 'admin', roles: ['support', 'operations', 'finance'], severity: 'info', label: 'Dispute updated' },
  'admin.support.ticket_created': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: 'New support ticket for BitoCard' },
  'admin.support.ticket_replied': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: 'Support ticket reply' },
  'admin.support.chat_waiting': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'Someone is waiting in chat' },
  'admin.support.issue_closed': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: 'Engineering closed a ticket’s issue' },
  'admin.chargeback.opened': { realm: 'admin', roles: ['finance'], severity: 'warning', label: 'Chargeback opened' },
  'admin.payment.gateway_refused': { realm: 'admin', roles: ['finance', 'operations'], severity: 'warning', label: 'A payment gateway refused to open a payment' },
  'admin.payment.unmatched': { realm: 'admin', roles: ['finance'], severity: 'warning', label: 'Payment that could not be credited' },
  'admin.payment.unmatched_refund_stuck': { realm: 'admin', roles: ['finance'], severity: 'critical', label: 'Refund of an uncredited payment refused' },
  'admin.reserved_account.unmatched_deposit': { realm: 'admin', roles: ['finance', 'operations'], severity: 'warning', label: 'Bank transfer to an account number not credited' },
  'admin.tax.rate_unconfirmed': { realm: 'admin', roles: ['finance', 'operations'], severity: 'warning', label: 'Sale refused: tax rate not confirmed' },
  'admin.fx.paused': { realm: 'admin', roles: ['finance'], severity: 'critical', label: 'Conversions paused' },
  'admin.vpn.attention': { realm: 'admin', roles: ['operations', 'support'], severity: 'warning', label: 'VPN account needs attention' },
  'admin.vpn.credit_low': { realm: 'admin', roles: ['operations', 'finance'], severity: 'critical', label: 'VPN supplier credit low' },
  'admin.esim.top_up_unclear': { realm: 'admin', roles: ['operations', 'support'], severity: 'warning', label: 'eSIM top-up unconfirmed' },
  'admin.crypto.withdrawal_review': { realm: 'admin', roles: ['operations', 'finance'], severity: 'warning', label: 'Crypto withdrawal to approve' },
  'admin.crypto.withdrawal_stuck': { realm: 'admin', roles: ['operations', 'finance'], severity: 'critical', label: 'Crypto withdrawal unconfirmed' },
  'admin.crypto.address_flagged': { realm: 'admin', roles: ['operations', 'finance'], severity: 'critical', label: 'Withdrawal address on a sanctions list' },
  'admin.customer_payout.unclear': { realm: 'admin', roles: ['finance'], severity: 'critical', label: 'Customer bank payout outcome unclear' },
  'admin.crypto.custody_shortfall': { realm: 'admin', roles: ['finance', 'operations'], severity: 'critical', label: 'Crypto custody shortfall' },
  'admin.crypto.deposit_stuck': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Crypto deposit cannot be settled' },
  'admin.wallet.manual_top_up': { realm: 'admin', roles: ['finance'], severity: 'info', label: 'Wallet topped up by hand' },
  'admin.supplier.funded': { realm: 'admin', roles: ['finance', 'operations'], severity: 'info', label: 'Supplier funded by hand' },
  'admin.exchange.reserve_low': { realm: 'admin', roles: ['finance', 'operations'], severity: 'warning', label: 'Exchange reserve running low' },
  'admin.exchange.price_divergence': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Exchange price sources disagree' },

  // Storefront customers (baselined: sent once customer accounts exist) -----------------------------------------------
  'customer.order.completed': { realm: 'customer', severity: 'success', label: 'Order delivered', push: true },
  'customer.order.failed': { realm: 'customer', severity: 'warning', label: 'Order could not be completed', push: true },
  'customer.dispute.updated': { realm: 'customer', severity: 'info', label: 'Dispute updated', push: true },
  'customer.support.ticket_replied': { realm: 'customer', severity: 'info', label: 'Reply to your support ticket', push: true },
  'customer.support.ticket_resolved': { realm: 'customer', severity: 'success', label: 'Support ticket resolved', push: true },
  'customer.support.chat_replied': { realm: 'customer', severity: 'info', label: 'Reply in chat', push: true },
  'customer.order.refunded': { realm: 'customer', severity: 'info', label: 'Order refunded', push: true },
  'customer.wallet.credited': { realm: 'customer', severity: 'success', label: 'Money added to your wallet', push: true },
  'customer.esim.low_data': { realm: 'customer', severity: 'warning', label: 'eSIM data running low', push: true },
  'customer.classifieds.listing_live': { realm: 'customer', severity: 'success', label: 'Your BitoCard Shop ad is live', push: true },
  'customer.classifieds.listing_rejected': { realm: 'customer', severity: 'warning', label: 'Your BitoCard Shop ad needs changes', push: true },
  'customer.classifieds.listing_removed': { realm: 'customer', severity: 'warning', label: 'Your BitoCard Shop ad was removed', push: true },
  'customer.classifieds.message': { realm: 'customer', severity: 'info', label: 'New BitoCard Shop message', push: true },
  'customer.classifieds.offer': { realm: 'customer', severity: 'info', label: 'New offer on BitoCard Shop', push: true },
  'customer.classifieds.offer_accepted': { realm: 'customer', severity: 'success', label: 'Your BitoCard Shop offer was accepted', push: true },
  'customer.classifieds.offer_declined': { realm: 'customer', severity: 'info', label: 'Your BitoCard Shop offer was declined', push: true },
  'customer.classifieds.order_requested': { realm: 'customer', severity: 'info', label: 'Safe pay request on BitoCard Shop', push: true },
  'customer.classifieds.order_accepted': { realm: 'customer', severity: 'success', label: 'Safe pay request accepted: pay now', push: true },
  'customer.classifieds.order_declined': { realm: 'customer', severity: 'warning', label: 'Safe pay request declined', push: true },
  'customer.classifieds.order_lapsed': { realm: 'customer', severity: 'warning', label: 'Safe pay request ended', push: true },
  'customer.classifieds.order_cancelled': { realm: 'customer', severity: 'warning', label: 'Safe pay order cancelled', push: true },
  'customer.classifieds.order_paid': { realm: 'customer', severity: 'success', label: 'Safe pay order paid: hand it over', push: true },
  'customer.classifieds.order_sent': { realm: 'customer', severity: 'info', label: 'Your Safe pay order was sent', push: true },
  'customer.classifieds.order_released': { realm: 'customer', severity: 'success', label: 'Safe pay money released', push: true },
  'customer.classifieds.order_refunded': { realm: 'customer', severity: 'info', label: 'Safe pay order refunded', push: true },
  'customer.classifieds.order_disputed': { realm: 'customer', severity: 'warning', label: 'A Safe pay order is disputed', push: true },
  'customer.classifieds.dispute_message': { realm: 'customer', severity: 'info', label: 'New message on a Safe pay dispute', push: true },
  'customer.classifieds.dispute_decided': { realm: 'customer', severity: 'info', label: 'Safe pay dispute decided', push: true },
  'customer.classifieds.safe_pay_limited': { realm: 'customer', severity: 'warning', label: 'You cannot take Safe pay orders for now', push: true },
  'customer.esim.expiring': { realm: 'customer', severity: 'warning', label: 'eSIM about to expire', push: true },
  'customer.gift_card_sale.accepted': { realm: 'customer', severity: 'success', label: 'Gift card sale accepted', push: true },
  'customer.gift_card_sale.declined': { realm: 'customer', severity: 'warning', label: 'Gift card sale declined', push: true },
  'customer.p2p.trade_completed': { realm: 'customer', severity: 'success', label: 'P2P trade completed', push: true },
  'customer.exchange.completed': { realm: 'customer', severity: 'success', label: 'Exchange completed', push: true },
  'customer.crypto.deposit_credited': { realm: 'customer', severity: 'success', label: 'Crypto deposit arrived', push: true },
  'customer.crypto.frozen': { realm: 'customer', severity: 'warning', label: 'Crypto frozen', push: true, locked: true },
  'customer.crypto.withdrawal_sent': { realm: 'customer', severity: 'success', label: 'Crypto withdrawal sent', push: true },
  'customer.crypto.withdrawal_failed': { realm: 'customer', severity: 'warning', label: 'Crypto withdrawal not sent', push: true },
  'customer.crypto.address_added': { realm: 'customer', severity: 'warning', label: 'Withdrawal address added', push: true, locked: true },
  'customer.payout.paid': { realm: 'customer', severity: 'success', label: 'Money sent to your bank', push: true },
  'customer.payout.failed': { realm: 'customer', severity: 'warning', label: 'Bank payout failed', push: true },
  'customer.security.bank_account_added': { realm: 'customer', severity: 'warning', label: 'Bank account added', push: true, locked: true },
  'customer.verification.updated': { realm: 'customer', severity: 'info', label: 'Identity check updated', push: true },
  'customer.security.password_changed': { realm: 'customer', severity: 'warning', label: 'Password changed', push: true, locked: true },
  'customer.security.email_changed': { realm: 'customer', severity: 'warning', label: 'Sign-in email changed', push: true, locked: true },
} satisfies Record<string, ResellerType | AdminType | PersonalType | CustomerType>;

export type NotificationType = keyof typeof notificationTypes;
export type ResellerNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'reseller' ? K : never }[NotificationType];
export type AdminNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'admin' ? K : never }[NotificationType];
export type PersonalNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'personal' ? K : never }[NotificationType];
export type CustomerNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'customer' ? K : never }[NotificationType];
