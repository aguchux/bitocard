import { bitocardApi } from '../base';

/** What making a reseller's owner a bitocard.com customer would do (`AccountSwitchService.customerPreview`). */
export type ResellerCustomerPreview = {
  object: 'reseller_customer_preview';
  owner: { name: string; email: string; email_confirmed: boolean; has_password: boolean } | null;
  /** They are a bitocard.com customer already: nothing new is made. */
  existing_customer_id: string | null;
  reseller_status: 'pending' | 'active' | 'suspended';
  /** BitoCard holds live money for the reseller: it cannot be suspended at the same time. */
  holds_money: boolean;
  published_stores: number;
};

/** What making a bitocard.com customer a reseller would do (`AccountSwitchService.resellerPreview`). */
export type CustomerResellerPreview = {
  object: 'customer_reseller_preview';
  customer: { name: string; email: string; email_confirmed: boolean; country: string | null };
  /** They already own a reseller account: nothing new is made. */
  existing_reseller_id: string | null;
  seller_hq_person: boolean;
  /** Reseller sign-up is open in the customer's country. */
  country_open: boolean;
  country_name: string | null;
};

export type AccountSwitch = {
  object: 'account_switch';
  customer?: { id: string; email: string; created: boolean };
  reseller?: { id: string; name?: string; status: 'pending' | 'active' | 'suspended' };
  user?: { id: string; created: boolean };
};

/** Moving people between reseller and customer accounts, from their pages in the admin app (operations, after step-up). */
export const adminAccountSwitchApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    resellerCustomerPreview: build.query<ResellerCustomerPreview, string>({
      query: id => `/v1/admin/resellers/${id}/make-customer`,
      providesTags: (_result, _error, id) => [{ type: 'Reseller', id }, 'StoreCustomer'],
    }),
    makeResellerCustomer: build.mutation<AccountSwitch, { id: string; reason: string; suspend_reseller?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/resellers/${id}/make-customer`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Reseller', id }, 'Reseller', 'StoreCustomer', 'Activity', 'Overview'],
    }),
    customerResellerPreview: build.query<CustomerResellerPreview, string>({
      query: id => `/v1/admin/storefront/customers/${id}/make-reseller`,
      providesTags: ['StoreCustomer', 'Reseller'],
    }),
    makeCustomerReseller: build.mutation<AccountSwitch, { id: string; business_name: string; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/storefront/customers/${id}/make-reseller`, method: 'POST', body }),
      invalidatesTags: ['StoreCustomer', 'Reseller', 'Activity', 'Overview'],
    }),
  }),
});

export const { useResellerCustomerPreviewQuery, useMakeResellerCustomerMutation, useCustomerResellerPreviewQuery, useMakeCustomerResellerMutation } = adminAccountSwitchApi;
