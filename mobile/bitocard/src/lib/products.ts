/**
 * Buying any product the app has no screen of its own for (electricity and other bills, pay-TV, software, VPN, mobile
 * money), as bitocard.com's buy form does it. Free of React Native, so it runs under `node --test`.
 */
import { toMinor } from './money.ts';
import type { StoreProductDetail } from './types.ts';

/** bitocard.com's words for each category (`apps/api/src/storefront/layout.ts`). */
export const categoryLabels: Record<string, string> = {
  gift_cards: 'Gift cards',
  airtime: 'Airtime',
  data: 'Data',
  bills: 'Electricity and bills',
  pay_tv: 'Pay-TV',
  software: 'Software',
  vpn: 'VPN',
  rdp: 'RDP',
  mobile_money: 'Mobile money',
};

/** Several at a time: gift cards and software licences (up to 10). */
export const takesQuantity = (category: string) => category === 'gift_cards' || category === 'software';

/** Codes and licence keys are also emailed: to the account's email unless the customer names another. */
export const emailsCodes = (category: string) => category === 'gift_cards' || category === 'software';

/** Who a product goes to, and how the field asking for it reads. Null: nothing to ask. */
export function recipientField(type: string | null): { kind: 'phone' | 'account'; label: string; hint: string } | null {
  if (type === 'phone') return { kind: 'phone', label: 'Mobile number', hint: 'The number to send it to.' };
  if (type === 'smartcard') return { kind: 'account', label: 'Smartcard or IUC number', hint: 'We check it with the provider before you pay.' };
  if (type === 'meter') return { kind: 'account', label: 'Meter number', hint: 'We check it with the provider before you pay.' };
  if (type === 'account') return { kind: 'account', label: 'Account number', hint: 'We check it with the provider before you pay.' };
  return null;
}

/**
 * The face value to buy, in minor units: the value chosen from a fixed list, else the typed amount within the range;
 * else why not.
 */
export function faceValueOf(detail: Pick<StoreProductDetail, 'denominations' | 'range' | 'face_currency'>, chosen: number | null, typed: string): { value: number } | { problem: string } {
  if (detail.denominations?.length) return chosen && detail.denominations.includes(chosen) ? { value: chosen } : { problem: 'Choose a value.' };
  if (!detail.range) return { problem: 'This product cannot be bought here yet.' };
  const value = toMinor(typed, detail.face_currency);
  if (!value) return { problem: 'Enter an amount.' };
  if (value < detail.range.min || value > detail.range.max) return { problem: 'Enter an amount within the range shown.' };
  return { value };
}

/** What a meter or smartcard check said, as lines to confirm before paying (never the number itself twice). */
export function recipientLines(recipient: Record<string, string> | null | undefined): [string, string][] {
  if (!recipient) return [];
  const labels: [string, string][] = [
    ['account_name', 'Name on the account'],
    ['current_package', 'Current package'],
    ['address', 'Address'],
    ['tariff', 'Tariff'],
    ['outstanding_balance', 'Outstanding balance'],
  ];
  return labels.filter(([key]) => typeof recipient[key] === 'string' && recipient[key]!.trim()).map(([key, label]) => [label, recipient[key]!]);
}

/** Who the order is for, as the API takes it: a meter or smartcard (and an optional phone), a phone, or where codes go. */
export function recipientOf(params: { phone?: string; account?: string; transaction?: string; email?: string }) {
  const recipient: { phone?: string; account_number?: string; transaction_type?: 'change' | 'renew'; email?: string } = {};
  if (params.account) recipient.account_number = params.account;
  if (params.phone) recipient.phone = params.phone;
  if (params.transaction === 'renew' || params.transaction === 'change') recipient.transaction_type = params.transaction;
  if (params.email) recipient.email = params.email;
  return Object.keys(recipient).length ? recipient : undefined;
}
