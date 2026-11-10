import type { NotificationSeverity, ResellerRole } from '../generated/prisma/client.js';
import type { Product } from '../products/product.js';

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

type AfrippaAdminType = {
  /** Afrippa's own admins (admin.afrippa.com), never BitoCard's: its crypto, orders and traders. */
  realm: 'afrippa_admin';
  /** Afrippa admin roles who see it, besides its super admins. */
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
 * roles (BitoCard's admins, or Afrippa's for `afrippa_admin` ones); personal ones to the one person; customer ones to the one storefront customer. A new notification needs its
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
  'store.sandbox_without_domain': { realm: 'reseller', roles: ['admin'], severity: 'critical', label: 'Store back in the sandbox' },
  'store.watermark_cleared': { realm: 'reseller', roles: ['admin'], severity: 'warning', label: 'Photo watermark removed' },
  'account.suspended': { realm: 'reseller', roles: ['admin', 'developer', 'finance', 'support'], severity: 'critical', label: 'Account suspended' },
  'account.reinstated': { realm: 'reseller', roles: ['admin', 'developer', 'finance', 'support'], severity: 'success', label: 'Account no longer suspended' },
  'account.activated': { realm: 'reseller', roles: ['admin', 'developer', 'finance', 'support'], severity: 'success', label: 'Account activated' },
  'account.identity_required': { realm: 'reseller', roles: ['admin', 'developer', 'finance', 'support'], severity: 'warning', label: 'Identity check needed again' },
  'store.status_changed': { realm: 'reseller', roles: ['admin'], severity: 'critical', label: 'Store suspended or taken offline by Udozo' },
  'plan.store_assigned': { realm: 'reseller', roles: ['admin', 'finance'], severity: 'info', label: 'A store’s plan was changed by Udozo' },
  'billing.credit_limit_changed': { realm: 'reseller', roles: ['finance'], severity: 'info', label: 'Credit limit changed' },
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
  'resale.message_received': { realm: 'reseller', roles: ['admin', 'support'], severity: 'info', label: 'New message from a supplier' },
  'resale.deal_offered': { realm: 'reseller', roles: ['admin'], severity: 'info', label: 'A supplier offered you a deal' },
  'resale.deal_ended': { realm: 'reseller', roles: ['admin'], severity: 'info', label: 'A supplier deal ended' },
  'resale.note_decided': { realm: 'reseller', roles: ['admin'], severity: 'info', label: 'A supplier decided on your note' },
  'resale.listing_unavailable': { realm: 'reseller', roles: ['admin'], severity: 'warning', label: 'A resale listing stopped selling' },
  'resale.supplier_stopped': { realm: 'reseller', roles: ['admin'], severity: 'warning', label: 'A supplier stopped your reselling' },
  'resale.supplier_restored': { realm: 'reseller', roles: ['admin'], severity: 'success', label: 'A supplier lets you resell again' },
  'resale.checkout_restored': { realm: 'reseller', roles: ['admin', 'support'], severity: 'success', label: 'Resale shops can take orders again' },
  'resale.order_new': { realm: 'reseller', roles: ['admin', 'support'], severity: 'info', label: 'New resale order' },
  'resale.order_updated': { realm: 'reseller', roles: ['admin', 'support'], severity: 'info', label: 'Resale order updated' },
  'resale.order_message': { realm: 'reseller', roles: ['admin', 'support'], severity: 'info', label: 'New message on a resale order' },
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
  'security.two_step_changed': { realm: 'personal', severity: 'warning', label: 'Two-step sign-in changed' },
  'security.google_linked': { realm: 'personal', severity: 'warning', label: 'Google sign-in added' },
  'team.role_changed': { realm: 'personal', severity: 'info', label: 'Your role changed' },
  'team.removed': { realm: 'personal', severity: 'warning', label: 'Removed from a team' },

  // BitoCard admins --------------------------------------------------------------------------------------------------
  'admin.reseller.signed_up': { realm: 'admin', roles: ['operations', 'support'], severity: 'info', label: 'New reseller' },
  'admin.reseller.awaiting_activation': { realm: 'admin', roles: ['operations'], severity: 'warning', label: 'Verified reseller waiting to be activated' },
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
  'admin.classifieds.dispute_opened': { realm: 'admin', roles: ['support', 'operations', 'finance'], severity: 'warning', label: 'BitoCard Shop UdozoPay dispute opened' },
  'admin.classifieds.dispute_message': { realm: 'admin', roles: ['support', 'operations', 'finance'], severity: 'info', label: 'New message on a BitoCard Shop dispute' },
  'admin.classifieds.buy_orders_paused': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'A seller’s buy orders were paused' },
  'admin.classifieds.review_reported': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'A review was reported' },
  'admin.classifieds.review_held': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: 'A review waits for a moderator' },
  'admin.classifieds.listing_reported': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'A listing was reported' },
  'admin.classifieds.chat_reported': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'A chat was reported' },
  'admin.classifieds.seller_summary_reported': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: "A seller says Anjio's summary of them is wrong" },
  'admin.classifieds.interaction_flagged': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'A buyer said a seller asked them to pay outside Udozo or upfront' },
  'admin.classifieds.same_person': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'UdozoPay refused: one person on both sides' },
  'admin.classifieds.seller_limited': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'BitoCard Shop seller reached the UdozoPay strike limit' },
  'admin.classifieds.resale_store_report': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'A Resale shop was reported' },
  'admin.classifieds.payout_review': { realm: 'admin', roles: ['finance'], severity: 'warning', label: 'BitoCard Shop payout waiting for review' },
  'admin.dispute.updated': { realm: 'admin', roles: ['support', 'operations', 'finance'], severity: 'info', label: 'Dispute updated' },
  'admin.support.ticket_created': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: 'New support ticket for BitoCard' },
  'admin.support.ticket_replied': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: 'Support ticket reply' },
  'admin.support.chat_waiting': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'Someone is waiting in chat' },
  'admin.support.contact_message': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: 'New message from the Contact us form' },
  'admin.connect.application': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: 'A Connect Centre application to review' },
  'admin.connect.return': { realm: 'admin', roles: ['support', 'operations'], severity: 'info', label: 'A Connect Centre return to the seller' },
  'admin.connect.alert': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'A Connect Centre needs attention' },
  'admin.connect.missing': { realm: 'admin', roles: ['support', 'operations'], severity: 'warning', label: 'An item missing at a Connect Centre' },
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
  'admin.crypto.withdrawal_review': { realm: 'afrippa_admin', roles: ['operations', 'finance'], severity: 'warning', label: 'Crypto withdrawal to approve' },
  'admin.crypto.withdrawal_stuck': { realm: 'afrippa_admin', roles: ['operations', 'finance'], severity: 'critical', label: 'Crypto withdrawal unconfirmed' },
  'admin.crypto.address_flagged': { realm: 'afrippa_admin', roles: ['operations', 'finance'], severity: 'critical', label: 'Withdrawal address on a sanctions list' },
  'admin.customer_payout.unclear': { realm: 'admin', roles: ['finance'], severity: 'critical', label: 'Customer bank payout outcome unclear' },
  'admin.customer_payout.failed': { realm: 'admin', roles: ['finance'], severity: 'warning', label: 'Customer bank payout failed' },
  'admin.crypto.custody_shortfall': { realm: 'afrippa_admin', roles: ['finance', 'operations'], severity: 'critical', label: 'Crypto custody shortfall' },
  'admin.crypto.deposit_stuck': { realm: 'afrippa_admin', roles: ['operations'], severity: 'warning', label: 'Crypto deposit cannot be settled' },
  'admin.p2p.order_appealed': { realm: 'afrippa_admin', roles: ['operations', 'support'], severity: 'warning', label: 'An order was appealed' },
  'admin.p2p.report_opened': { realm: 'afrippa_admin', roles: ['operations', 'support'], severity: 'info', label: 'A trader was reported' },
  'admin.p2p.merchant_applied': { realm: 'afrippa_admin', roles: ['operations'], severity: 'info', label: 'A trader applied to be a merchant' },
  'admin.afrippa.ticket_created': { realm: 'afrippa_admin', roles: ['support', 'operations'], severity: 'info', label: 'New support ticket from a trader' },
  'admin.afrippa.ticket_replied': { realm: 'afrippa_admin', roles: ['support', 'operations'], severity: 'info', label: 'A trader replied to a ticket' },
  'admin.afrippa.chat_waiting': { realm: 'afrippa_admin', roles: ['support', 'operations'], severity: 'warning', label: 'A trader is waiting in chat' },
  'admin.afrippa.kyc_submitted': { realm: 'afrippa_admin', roles: ['operations', 'support'], severity: 'info', label: 'A trader identity check to review' },
  'admin.wallet.manual_top_up': { realm: 'admin', roles: ['finance'], severity: 'info', label: 'Wallet topped up by hand' },
  'admin.supplier.funded': { realm: 'admin', roles: ['finance', 'operations'], severity: 'info', label: 'Supplier funded by hand' },

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
  'customer.classifieds.username_removed': { realm: 'customer', severity: 'warning', label: 'Udozo removed your username', push: true },
  'customer.classifieds.account_suspended': { realm: 'customer', severity: 'critical', label: 'Your selling was suspended', push: true, locked: true },
  'customer.classifieds.account_restored': { realm: 'customer', severity: 'success', label: 'You can sell again', push: true },
  'customer.classifieds.listing_in_review': { realm: 'customer', severity: 'warning', label: 'Your ad is being checked again', push: true },
  'customer.classifieds.listing_expired': { realm: 'customer', severity: 'info', label: 'Your ad expired', push: true },
  'customer.classifieds.out_of_stock': { realm: 'customer', severity: 'warning', label: 'Your ad is out of stock', push: true },
  'customer.classifieds.post_reminder': { realm: 'customer', severity: 'info', label: 'Reminders to finish and post your ad', push: true },
  'customer.classifieds.avatar_removed': { realm: 'customer', severity: 'warning', label: 'Udozo removed your profile photo', push: true },
  'customer.classifieds.banner_removed': { realm: 'customer', severity: 'warning', label: 'Udozo removed your profile cover', push: true },
  'customer.classifieds.reviews_blocked': { realm: 'customer', severity: 'warning', label: 'Reviewing paused or restored', push: true },
  'customer.classifieds.review_moderated': { realm: 'customer', severity: 'info', label: 'A review about you was removed or restored', push: true },
  'customer.classifieds.report_decided': { realm: 'customer', severity: 'info', label: 'Your report was reviewed', push: false },
  'customer.classifieds.summary_updated': { realm: 'customer', severity: 'info', label: 'Anjio’s summary of you was reviewed', push: false },
  'customer.classifieds.buy_orders_paused': { realm: 'customer', severity: 'warning', label: 'Buy orders paused or resumed', push: true },
  'customer.classifieds.safe_pay_restored': { realm: 'customer', severity: 'success', label: 'You can take UdozoPay orders again', push: true },
  'customer.classifieds.payout_held': { realm: 'customer', severity: 'warning', label: 'UdozoPay money held for review', push: true },
  'customer.classifieds.message': { realm: 'customer', severity: 'info', label: 'New BitoCard Shop message', push: true },
  'customer.classifieds.offer': { realm: 'customer', severity: 'info', label: 'New offer on BitoCard Shop', push: true },
  'customer.classifieds.wanted_match': { realm: 'customer', severity: 'info', label: 'A buyer is looking for something you sell', push: true },
  'customer.classifieds.wanted_response': { realm: 'customer', severity: 'info', label: 'A seller answered your request', push: true },
  'customer.connect.application': { realm: 'customer', severity: 'info', label: 'Your Connect Centre application', push: true },
  'customer.connect.return': { realm: 'customer', severity: 'info', label: 'An item returning to its seller', push: true },
  'customer.connect.auction': { realm: 'customer', severity: 'info', label: 'Udozo auctions', push: true },
  'customer.connect.centre': { realm: 'customer', severity: 'info', label: 'Your Connect Centre', push: true },
  'customer.classifieds.contact_request': { realm: 'customer', severity: 'info', label: 'A buyer asked for your contact details', push: true },
  'customer.classifieds.contact_answered': { realm: 'customer', severity: 'info', label: 'A seller answered your contact request', push: true },
  'customer.classifieds.callback_request': { realm: 'customer', severity: 'info', label: 'A buyer asked you to call them back', push: true },
  'customer.classifieds.whatsapp_shared': { realm: 'customer', severity: 'info', label: 'A buyer got your WhatsApp number', push: true },
  'customer.classifieds.call_incoming': { realm: 'customer', severity: 'warning', label: 'Someone is calling you on Udozo', push: true },
  'customer.classifieds.call_missed': { realm: 'customer', severity: 'info', label: 'You missed a call on Udozo', push: true },
  'customer.classifieds.offer_accepted': { realm: 'customer', severity: 'success', label: 'Your BitoCard Shop offer was accepted', push: true },
  'customer.classifieds.offer_declined': { realm: 'customer', severity: 'info', label: 'Your BitoCard Shop offer was declined', push: true },
  'customer.classifieds.buy_request': { realm: 'customer', severity: 'info', label: 'A buyer asked to buy your listing', push: true },
  'customer.classifieds.buy_countered': { realm: 'customer', severity: 'info', label: 'A seller offered you a price', push: true },
  'customer.classifieds.buy_accepted': { realm: 'customer', severity: 'success', label: 'Your buy order was accepted', push: true },
  'customer.classifieds.buy_declined': { realm: 'customer', severity: 'info', label: 'Your buy order was declined', push: true },
  'customer.classifieds.buy_lapsed': { realm: 'customer', severity: 'info', label: 'A buy order ended without an answer', push: true },
  'customer.classifieds.buy_cancelled': { realm: 'customer', severity: 'warning', label: 'A buy order was cancelled', push: true },
  'customer.classifieds.buy_meet_reminder': { realm: 'customer', severity: 'warning', label: 'A buy order ends soon', push: true },
  'customer.classifieds.buy_bought': { realm: 'customer', severity: 'info', label: 'A buyer says they bought your item', push: true },
  'customer.classifieds.buy_completed': { realm: 'customer', severity: 'success', label: 'A buy order was completed', push: true },
  'customer.classifieds.buy_voided': { realm: 'customer', severity: 'warning', label: 'A buyer said they did not buy', push: true },
  'customer.classifieds.buy_updated': { realm: 'customer', severity: 'info', label: 'A buy order changed', push: true },
  'customer.classifieds.review_invite': { realm: 'customer', severity: 'info', label: 'Rate a seller you bought from', push: true },
  'customer.classifieds.review_reminder': { realm: 'customer', severity: 'info', label: 'A reminder to rate a seller', push: false },
  'customer.classifieds.review_received': { realm: 'customer', severity: 'info', label: 'A buyer reviewed you', push: true },
  'customer.classifieds.review_reply': { realm: 'customer', severity: 'info', label: 'A reply on a review', push: true },
  'customer.classifieds.review_removed': { realm: 'customer', severity: 'warning', label: 'Udozo removed or restored your review', push: true },
  'customer.classifieds.order_requested': { realm: 'customer', severity: 'info', label: 'UdozoPay request on BitoCard Shop', push: true },
  'customer.classifieds.order_accepted': { realm: 'customer', severity: 'success', label: 'UdozoPay request accepted: pay now', push: true },
  'customer.classifieds.order_declined': { realm: 'customer', severity: 'warning', label: 'UdozoPay request declined', push: true },
  'customer.classifieds.order_lapsed': { realm: 'customer', severity: 'warning', label: 'UdozoPay request ended', push: true },
  'customer.classifieds.order_cancelled': { realm: 'customer', severity: 'warning', label: 'UdozoPay order cancelled', push: true },
  'customer.classifieds.order_paid': { realm: 'customer', severity: 'success', label: 'UdozoPay order paid: hand it over', push: true },
  'customer.classifieds.order_sent': { realm: 'customer', severity: 'info', label: 'Your UdozoPay order was sent', push: true },
  'customer.classifieds.order_reminder': { realm: 'customer', severity: 'warning', label: 'A UdozoPay deadline is near', push: true },
  'customer.classifieds.order_released': { realm: 'customer', severity: 'success', label: 'UdozoPay money released', push: true },
  'customer.classifieds.order_refunded': { realm: 'customer', severity: 'info', label: 'UdozoPay order refunded', push: true },
  'customer.classifieds.order_disputed': { realm: 'customer', severity: 'warning', label: 'A UdozoPay order is disputed', push: true },
  'customer.classifieds.dispute_message': { realm: 'customer', severity: 'info', label: 'New message on a UdozoPay dispute', push: true },
  'customer.classifieds.order_message': { realm: 'customer', severity: 'info', label: 'New message on a resale order', push: true },
  'customer.classifieds.shipment': { realm: 'customer', severity: 'info', label: 'Your parcel’s tracking was updated', push: true },
  'customer.purchase.updated': { realm: 'customer', severity: 'info', label: 'Your order was updated', push: true },
  'customer.purchase.message': { realm: 'customer', severity: 'info', label: 'New message from the store about your order', push: true },
  'customer.classifieds.dispute_decided': { realm: 'customer', severity: 'info', label: 'UdozoPay dispute decided', push: true },
  'customer.classifieds.safe_pay_limited': { realm: 'customer', severity: 'warning', label: 'You cannot take UdozoPay orders for now', push: true },
  'customer.resale.reseller_added': { realm: 'customer', severity: 'info', label: 'A reseller is selling your listing', push: true },
  'customer.resale.message': { realm: 'customer', severity: 'info', label: 'New message from a reseller', push: true },
  'customer.resale.note_pending': { realm: 'customer', severity: 'info', label: 'A reseller’s note needs your approval', push: true },
  'customer.resale.deal_answered': { realm: 'customer', severity: 'info', label: 'A reseller answered your deal', push: true },
  'customer.esim.expiring': { realm: 'customer', severity: 'warning', label: 'eSIM about to expire', push: true },
  'customer.gift_card_sale.accepted': { realm: 'customer', severity: 'success', label: 'Gift card sale accepted', push: true },
  'customer.gift_card_sale.declined': { realm: 'customer', severity: 'warning', label: 'Gift card sale declined', push: true },
  'customer.p2p.order_opened': { realm: 'customer', severity: 'info', label: 'New order on your ad', push: true },
  'customer.p2p.order_paid': { realm: 'customer', severity: 'warning', label: 'Buyer says they paid', push: true },
  'customer.p2p.order_released': { realm: 'customer', severity: 'success', label: 'Coins released', push: true },
  'customer.p2p.order_cancelled': { realm: 'customer', severity: 'info', label: 'Order cancelled or expired', push: true },
  'customer.p2p.order_appealed': { realm: 'customer', severity: 'warning', label: 'Order appealed', push: true },
  'customer.p2p.order_decided': { realm: 'customer', severity: 'info', label: 'Appeal decided', push: true },
  'customer.p2p.order_message': { realm: 'customer', severity: 'info', label: 'Message in an order', push: true },
  'customer.p2p.order_reminder': { realm: 'customer', severity: 'warning', label: 'Order waiting on you', push: true },
  'customer.p2p.standing_changed': { realm: 'customer', severity: 'warning', label: 'Trading paused or restored', push: true, locked: true },
  'customer.p2p.feedback_received': { realm: 'customer', severity: 'info', label: 'Feedback received', push: true },
  'customer.p2p.report_decided': { realm: 'customer', severity: 'info', label: 'Report reviewed', push: true },
  'customer.p2p.merchant_changed': { realm: 'customer', severity: 'info', label: 'Merchant status changed', push: true },
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
  'customer.security.two_step_changed': { realm: 'customer', severity: 'warning', label: 'Two-step sign-in changed', push: true, locked: true },
  'customer.security.payment_method_added': { realm: 'customer', severity: 'warning', label: 'Payment method added', push: true, locked: true },
  'customer.security.new_device': { realm: 'customer', severity: 'warning', label: 'A new device signed in', push: true, locked: true },
  'customer.security.email_changed': { realm: 'customer', severity: 'warning', label: 'Sign-in email changed', push: true, locked: true },
  'customer.security.phone_changed': { realm: 'customer', severity: 'warning', label: 'Mobile number changed', push: true, locked: true },
} satisfies Record<string, ResellerType | AdminType | AfrippaAdminType | PersonalType | CustomerType>;

export type NotificationType = keyof typeof notificationTypes;

/**
 * BitoCard's own notices, which Udozo never sends, lists or lets anyone set a preference for: digital-product orders,
 * suppliers and resellers' own integrations, virtual numbers, eSIMs, VPN, gift card sales, catalogue disputes,
 * chargebacks, the startup allowance, BitoCard's fees, store support assistants, reserved accounts, crypto and P2P.
 */
const bitocardNotificationTypes: ReadonlySet<string> = new Set([
  'connection.approved', 'connection.rejected', 'connection.suspended', 'connection.reinstated', 'connection.sync_failed',
  'supplier_notification.failed', 'order.needs_review', 'store.checkout_refused', 'number.expiring', 'number.renewal_failed',
  'number.expired', 'number.deleted', 'dispute.opened', 'dispute.updated', 'support.bot_paused', 'support.knowledge_stale',
  'chargeback.opened', 'chargeback.closed', 'kyc.customer_submitted', 'startup_allowance.granted', 'startup_allowance.revoked',
  'fee.refunded', 'admin.connection.review', 'admin.order.needs_review', 'admin.supplier_notification.failed',
  'admin.checkout.refund_stuck', 'admin.order.cost_mismatch', 'admin.dispute.escalated', 'admin.dispute.updated',
  'admin.chargeback.opened', 'admin.reserved_account.unmatched_deposit', 'admin.tax.rate_unconfirmed', 'admin.vpn.attention',
  'admin.vpn.credit_low', 'admin.esim.top_up_unclear', 'admin.supplier.funded', 'customer.order.completed',
  'customer.order.failed', 'customer.order.refunded', 'customer.dispute.updated', 'customer.esim.low_data',
  'customer.esim.expiring', 'customer.gift_card_sale.accepted', 'customer.gift_card_sale.declined',
  'customer.security.payment_method_added', 'customer.security.new_device',
]);
const bitocardNotificationPrefixes = ['admin.crypto.', 'admin.afrippa.', 'customer.crypto.', 'customer.p2p.'];

/** The notification types a product sends and lists (Udozo's leave out BitoCard's own, above). */
export const notificationTypesFor = (product: Product): NotificationType[] =>
  (Object.keys(notificationTypes) as NotificationType[]).filter(
    type => product !== 'udozo' || (!bitocardNotificationTypes.has(type) && !bitocardNotificationPrefixes.some(prefix => type.startsWith(prefix))),
  );
export type ResellerNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'reseller' ? K : never }[NotificationType];
export type AdminNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'admin' ? K : never }[NotificationType];
export type AfrippaAdminNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'afrippa_admin' ? K : never }[NotificationType];
export type PersonalNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'personal' ? K : never }[NotificationType];
export type CustomerNotificationType = { [K in NotificationType]: (typeof notificationTypes)[K]['realm'] extends 'customer' ? K : never }[NotificationType];
