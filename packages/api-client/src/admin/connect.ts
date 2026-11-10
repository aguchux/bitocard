import { bitocardApi } from '../base';

/** Where a Connect Centre application stands (`ConnectApplicationsService` in Udozo's API). */
export const connectApplicationStatuses = ['draft', 'submitted', 'changes_requested', 'visit_scheduled', 'visited', 'approved', 'rejected', 'withdrawn'] as const;
export type ConnectApplicationStatus = (typeof connectApplicationStatuses)[number];
export const connectApplicationStatusLabels: Record<ConnectApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  changes_requested: 'Changes requested',
  visit_scheduled: 'Visit scheduled',
  visited: 'Visited',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export type ConnectPhotoKind = 'shopfront' | 'counter' | 'storage' | 'other';
export const connectPhotoKindLabels: Record<ConnectPhotoKind, string> = { shopfront: 'Shopfront', counter: 'Counter', storage: 'Where items are kept', other: 'Other' };

export type ConnectApplicationVisit = {
  at: string;
  note: string | null;
  visitor: { id: string; name: string; phone: string | null; kind: 'staff' | 'agent' } | null;
  confirmed_at: string | null;
  /** The applicant asked for another time, saying why. */
  reschedule_note: string | null;
  visited_at: string | null;
  passed: boolean | null;
  report: string | null;
};

/** An application to run a Connect Centre, as Udozo's team sees it. Money is in minor units. */
export type ConnectApplication = {
  object: 'connect_application';
  id: string;
  /** CA-000123 */
  number: string;
  status: ConnectApplicationStatus;
  country: string;
  business_name: string | null;
  registration_number: string | null;
  state: { id: string; name: string } | null;
  area: { id: string; name: string } | null;
  address: string | null;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  hours: string | null;
  phone: string | null;
  capacity: number | null;
  person_name: string | null;
  person_role: string | null;
  photos: Array<{ id: string; url: string; kind: ConnectPhotoKind }>;
  deposit: { amount: number | null; currency: string; paid_at: string | null; returned_at: string | null };
  submitted_at: string | null;
  changes: { note: string; at: string | null } | null;
  visit: ConnectApplicationVisit | null;
  decision: { at: string; reason: string | null } | null;
  withdrawn_at: string | null;
  centre: { id: string; number: string; status: string } | null;
  created_at: string;
  updated_at: string;
};

export type ConnectApplicationListItem = ConnectApplication & { applicant: { id: string; name: string; email: string } | null };

export type ConnectRequirement = { key: string; met: boolean; label: string };

export type ConnectApplicationDetail = ConnectApplication & {
  applicant: { id: string; name: string; email: string; phone: string | null; phone_confirmed: boolean; identity_checked: boolean; since: string };
  requirements: ConnectRequirement[];
};

export type ConnectApplicationList = { object: 'list'; total: number; data: ConnectApplicationListItem[] };
export type ConnectApplicationFilter = { status?: ConnectApplicationStatus; country?: string; q?: string; limit?: number; offset?: number };

/** Who visits applicants' offices: Udozo's staff, or agents once they finish Udozo's training. */
export type ConnectVisitor = {
  object: 'connect_visitor';
  id: string;
  country: string;
  name: string;
  phone: string | null;
  email: string | null;
  kind: 'staff' | 'agent';
  trained_at: string | null;
  /** Active, and trained if an agent. */
  can_visit: boolean;
  active: boolean;
  created_at: string;
};
export type ConnectVisitorInput = { country?: string; name?: string; phone?: string | null; email?: string | null; kind?: 'staff' | 'agent'; trained?: boolean; active?: boolean };

/** A market's state, open for Connect unless switched off. */
export type ConnectState = { id: string; name: string; slug: string; open: boolean };
export type ConnectStateList = { object: 'list'; country: string; data: ConnectState[] };

/** A market's deposit, in minor units; null until finance sets it (applications cannot be submitted). */
export type ConnectSettings = {
  object: 'connect_settings';
  country: string;
  name: string;
  currency: string;
  deposit: number | null;
  /** The Connect fee buyers pay on each Connect order (null: not set, so no Connect orders in the market). */
  fee: { kind: 'percent'; bps: number } | { kind: 'fixed'; amount: number } | null;
  /** The centre's part of Connect fees (Udozo has the rest), and the buyer's free time to collect. */
  centre_share_bps: number;
  buyer_free_hours: number;
  /** Returns to sellers: due days after ready, hours to answer before it is accepted by itself, the seller's days to collect. */
  return_due_days: number;
  return_answer_hours: number;
  seller_collect_days: number;
  /** Storage: a day's demurrage and Loss of care penalty as shares of the shipping charge, and the penalty's daily cap. */
  demurrage_bps: number;
  loc_penalty_bps: number;
  loc_penalty_cap: number;
  /** Abandoned, then auctioned, this many days into Loss of care; what an auction left over is claimed within claim_days of the sale. */
  abandoned_after_days: number;
  auction_after_days: number;
  claim_days: number;
};

/** A warehouse Udozo runs: the Final Return Address abandoned items are picked up to. */
export type ConnectWarehouse = {
  object: 'connect_warehouse';
  id: string;
  country: string;
  state: { id: string; name: string };
  name: string;
  address: string;
  hours: string;
  phone: string;
  contact_name: string | null;
  active: boolean;
  created_at: string;
  /** In lists: centres sending to it, and items it holds. */
  centres?: number;
  holding?: number;
};
export type ConnectWarehouseInput = Partial<{ country: string; state_id: string; name: string; address: string; hours: string; phone: string; contact_name: string | null; active: boolean }>;

/** A centre's Final Return Address, abandoned items waiting there and its next pickup. */
export type ConnectFinalReturnAddress = {
  object: 'connect_final_return_address';
  warehouse: ConnectWarehouse | null;
  awaiting_pickup: number;
  next_pickup: { id: string; number: string; day: string; collector: string } | null;
};

/** Udozo's pickup of a centre's abandoned items to its Final Return Address. */
export type ConnectPickup = {
  object: 'connect_pickup';
  id: string;
  number: string;
  day: string;
  collector: string;
  status: 'scheduled' | 'collected' | 'delivered' | 'cancelled';
  note: string | null;
  /** For Udozo's collector to give the centre, while it is scheduled. */
  code?: string | null;
  centre: { id: string; number: string; name: string; address: string };
  warehouse: ConnectWarehouse;
  items: Array<{ order_id: string; number: string; title: string; shelf: string | null; status: 'waiting' | 'handed_over' | 'received' | 'missing' | 'removed'; handed_over_at: string | null; received_at: string | null }>;
  collected_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

/** A centre with abandoned items waiting for a pickup. */
export type ConnectAwaitingPickup = { centre: { id: string; number: string; name: string; country: string }; final_return_address: { id: string; name: string } | null; awaiting: number; scheduled: number };

/** An abandoned item at one of Udozo's warehouses. */
export type ConnectWarehouseItem = {
  object: 'connect_warehouse_item';
  order_id: string;
  number: string;
  title: string;
  price: number;
  currency: string;
  warehouse: { id: string; name: string } | null;
  centre: { id: string; name: string } | null;
  return_id: string | null;
  loss_of_care_at: string | null;
  abandoned_at: string | null;
  received_at: string | null;
};

/** What needs attention at a centre, in the report. */
export type ConnectFlag = 'over_capacity' | 'overdue_items' | 'missing_items' | 'loss_of_care' | 'late_arrivals' | 'high_uncollected' | 'paused' | 'closed';

/** Udozo Connect's report: what every centre holds now and how it did over the period, the money and the people behind problems. */
export type ConnectReport = {
  object: 'connect_report';
  days: number;
  country: string | null;
  now: { centres: number; holding: number; overdue: number; missing: number; loss_of_care: number; late_arrivals: number };
  period: { orders: number; handed_over: number; not_collected: number; refused_at_check_in: number; refused_at_counter: number; returns_collected: number; uncollected_pct: number | null };
  money: Array<{ currency: string; connect_fees: number; centres: number; udozo: number; storage_buyers: number; storage_sellers: number }>;
  centres: Array<{
    id: string;
    number: string;
    name: string;
    status: ConnectCentre['status'];
    country: string;
    state: string;
    area: string;
    capacity: number | null;
    now: { holding: number; overdue: number; missing: number; loss_of_care: number; late_arrivals: number };
    period: { orders: number; handed_over: number; not_collected: number; refused_at_check_in: number; refused_at_counter: number; uncollected_pct: number | null };
    flags: ConnectFlag[];
  }>;
  sellers: Array<{ id: string; name: string | null; email: string | null; refused: number; damaged: number; storage_owed: { amount: number; currency: string } | null }>;
  buyers: Array<{ id: string; name: string | null; email: string | null; not_collected: number; refused_at_counter: number }>;
};

/** An item a centre holds now, as Udozo's team sees it on the centre's page. */
export type ConnectHeldItem = {
  object: 'connect_held_item';
  order_id: string;
  number: string;
  title: string;
  status: string;
  price: number;
  currency: string;
  shelf: string | null;
  received_at: string | null;
  ready_at: string | null;
  collect_by: string | null;
  overdue: boolean;
  missing_since: string | null;
  seen_at: string | null;
  return: { number: string; status: string; loss_of_care_at: string | null } | null;
  buyer_owed: number;
  seller_owed: number;
};

/** An item a Connect Centre's stock check did not find, until found again or handed over. */
export type ConnectMissingItem = {
  object: 'connect_missing_item';
  order_id: string;
  number: string;
  title: string;
  status: string;
  price: number;
  currency: string;
  centre: { id: string; name: string; number: string; country: string } | null;
  /** The storage place it should be on. */
  shelf: string | null;
  received_at: string | null;
  missing_since: string;
  /** When a stock check last found it. */
  seen_at: string | null;
};

/** A Connect Centre's return of an item to its seller. */
export type ConnectReturn = {
  object: 'connect_return';
  id: string;
  /** RT-000123 */
  number: string;
  order: { id: string; number: string; title: string };
  centre: { id: string; name: string };
  seller: { name: string };
  reason: 'not_collected' | 'refused_at_check_in' | 'refused_at_counter' | 'damaged';
  note: string | null;
  status: 'requested' | 'accepted' | 'collected' | 'cancelled';
  answer_by: string;
  decided_by: 'seller' | 'admin' | 'auto' | null;
  decided_at: string | null;
  collect_by: string | null;
  collected_at: string | null;
  return_fee: number | null;
  currency: string;
  code_tries_left: number | null;
  created_at: string;
};
/** What a change sends (anything left out stays). */
export type ConnectSettingsChange = {
  country: string;
  deposit?: number | null;
  fee_kind?: 'percent' | 'fixed' | null;
  fee_bps?: number;
  fee?: number;
  centre_share_bps?: number;
  buyer_free_hours?: number;
  return_due_days?: number;
  return_answer_hours?: number;
  seller_collect_days?: number;
  demurrage_bps?: number;
  loc_penalty_bps?: number;
  loc_penalty_cap?: number;
  abandoned_after_days?: number;
  auction_after_days?: number;
  claim_days?: number;
};

export type ConnectCentre = {
  object: 'connect_centre';
  id: string;
  /** CC-000123 */
  number: string;
  name: string;
  status: 'active' | 'paused' | 'closed';
  /** Why it is paused: by its partner (a holiday, until a day or not) or by Udozo (only Udozo lifts it). */
  paused: ConnectCentrePause | null;
  country: string;
  state: string;
  area: string;
  address: string;
  hours: string;
  phone: string;
  capacity: number;
  deposit: { amount: number; currency: string };
  partner: { id: string; name: string; email: string };
  application_id: string | null;
  created_at: string;
};

const clean = (values: Record<string, string | number | undefined>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));

export type ConnectCentrePause = { by: 'partner' | 'udozo'; reason: string | null; until: string | null };
export type ConnectCentreRole = 'owner' | 'manager' | 'staff';
export const connectCentreRoleLabels: Record<ConnectCentreRole, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };

/** One centre as Udozo's team sees it: its office, its people on connect.udozo.com and its storage places. */
export type ConnectCentreDetail = {
  object: 'connect_centre';
  id: string;
  number: string;
  name: string;
  status: ConnectCentre['status'];
  paused: ConnectCentrePause | null;
  closed: { at: string | null; reason: string | null } | null;
  country: string;
  state: { id: string; name: string };
  area: { id: string; name: string };
  address: string;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  hours: string;
  phone: string;
  capacity: number;
  photos: string[];
  deposit: { amount: number; currency: string };
  /** How many people work there. */
  people: number;
  created_at: string;
  partner: { id: string; name: string; email: string; phone: string | null };
  application_id: string | null;
  members: { object: 'connect_centre_member'; id: string; role: ConnectCentreRole; name: string; email: string; phone: string | null; since: string }[];
  /** Its storage places, those in use first. */
  shelves: { object: 'connect_shelf'; id: string; code: string; label: string | null; capacity: number | null; active: boolean; position: number }[];
};

const changed = (id: string) => ['ConnectApplications' as const, { type: 'ConnectApplications' as const, id }, 'Activity' as const];

/**
 * Udozo Connect (admin.udozo.com): Connect Centre applications, the visitors who check offices, the states Connect is
 * open in, each market's deposit and the centres approval made. Support and operations read; operations act; finance
 * sets the deposit (inside the step-up window).
 */
export const connectApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    connectApplications: build.query<ConnectApplicationList, ConnectApplicationFilter>({
      query: filter => ({ url: '/v1/admin/connect/applications', params: clean(filter) }),
      providesTags: ['ConnectApplications'],
    }),
    connectApplication: build.query<ConnectApplicationDetail, string>({
      query: id => `/v1/admin/connect/applications/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'ConnectApplications', id }],
    }),
    requestConnectChanges: build.mutation<ConnectApplicationDetail, { id: string; note: string }>({
      query: ({ id, note }) => ({ url: `/v1/admin/connect/applications/${id}/request-changes`, method: 'POST', body: { note } }),
      invalidatesTags: (_result, _error, { id }) => changed(id),
    }),
    scheduleConnectVisit: build.mutation<ConnectApplicationDetail, { id: string; visitor_id: string; at: string; note?: string | null }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/connect/applications/${id}/visit`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => changed(id),
    }),
    recordConnectVisit: build.mutation<ConnectApplicationDetail, { id: string; passed: boolean; report: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/connect/applications/${id}/visit/result`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => changed(id),
    }),
    approveConnectApplication: build.mutation<ConnectApplicationDetail, { id: string }>({
      query: ({ id }) => ({ url: `/v1/admin/connect/applications/${id}/approve`, method: 'POST' }),
      invalidatesTags: (_result, _error, { id }) => [...changed(id), 'ConnectCentres'],
    }),
    rejectConnectApplication: build.mutation<ConnectApplicationDetail, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/connect/applications/${id}/reject`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { id }) => changed(id),
    }),

    connectVisitors: build.query<{ object: 'list'; data: ConnectVisitor[] }, string | void>({
      query: country => ({ url: '/v1/admin/connect/visitors', params: clean({ country: country ?? undefined }) }),
      providesTags: ['ConnectVisitors'],
    }),
    createConnectVisitor: build.mutation<ConnectVisitor, ConnectVisitorInput & { country: string; name: string }>({
      query: body => ({ url: '/v1/admin/connect/visitors', method: 'POST', body }),
      invalidatesTags: ['ConnectVisitors', 'Activity'],
    }),
    updateConnectVisitor: build.mutation<ConnectVisitor, ConnectVisitorInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/connect/visitors/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['ConnectVisitors', 'Activity'],
    }),

    connectStates: build.query<ConnectStateList, string>({
      query: country => `/v1/admin/connect/states/${country}`,
      providesTags: (_result, _error, country) => [{ type: 'ConnectStates', id: country }],
    }),
    setConnectState: build.mutation<{ object: 'connect_state'; id: string; name: string; country: string; open: boolean }, { id: string; country: string; enabled: boolean }>({
      query: ({ id, enabled }) => ({ url: `/v1/admin/connect/states/${id}`, method: 'PUT', body: { enabled } }),
      invalidatesTags: (_result, _error, { country }) => [{ type: 'ConnectStates', id: country }, 'ConnectApplications', 'Activity'],
    }),

    connectSettings: build.query<ConnectSettings, string>({
      query: country => `/v1/admin/connect/settings/${country}`,
      providesTags: (_result, _error, country) => [{ type: 'ConnectSettings', id: country }],
    }),
    setConnectSettings: build.mutation<ConnectSettings, ConnectSettingsChange>({
      query: ({ country, ...body }) => ({ url: `/v1/admin/connect/settings/${country}`, method: 'PUT', body }),
      invalidatesTags: (_result, _error, { country }) => [{ type: 'ConnectSettings', id: country }, 'ConnectApplications', 'Activity'],
    }),

    connectCentres: build.query<{ object: 'list'; data: ConnectCentre[] }, { country?: string; status?: ConnectCentre['status'] } | void>({
      query: filter => ({ url: '/v1/admin/connect/centres', params: clean({ country: filter?.country, status: filter?.status }) }),
      providesTags: ['ConnectCentres'],
    }),
    connectCentre: build.query<ConnectCentreDetail, string>({
      query: id => `/v1/admin/connect/centres/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'ConnectCentres', id }],
    }),
    connectReturns: build.query<{ object: 'list'; data: ConnectReturn[] }, { status?: ConnectReturn['status']; country?: string } | void>({
      query: filter => ({ url: '/v1/admin/connect/returns', params: clean({ status: filter?.status, country: filter?.country }) }),
      providesTags: ['ConnectCentres'],
    }),
    connectReport: build.query<ConnectReport, { country?: string; days?: number } | void>({
      query: filter => ({ url: '/v1/admin/connect/report', params: clean({ country: filter?.country, days: filter?.days }) }),
      providesTags: ['ConnectCentres'],
    }),
    connectCentreItems: build.query<{ object: 'list'; data: ConnectHeldItem[] }, string>({
      query: id => `/v1/admin/connect/centres/${id}/items`,
      providesTags: (_result, _error, id) => [{ type: 'ConnectCentres', id }],
    }),
    connectWarehouses: build.query<{ object: 'list'; data: ConnectWarehouse[] }, { country?: string } | void>({
      query: filter => ({ url: '/v1/admin/connect/warehouses', params: clean({ country: filter?.country }) }),
      providesTags: ['ConnectCentres'],
    }),
    createConnectWarehouse: build.mutation<ConnectWarehouse, ConnectWarehouseInput>({
      query: body => ({ url: '/v1/admin/connect/warehouses', method: 'POST', body }),
      invalidatesTags: ['ConnectCentres', 'Activity'],
    }),
    updateConnectWarehouse: build.mutation<ConnectWarehouse, ConnectWarehouseInput & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/connect/warehouses/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['ConnectCentres', 'Activity'],
    }),
    connectFinalReturnAddress: build.query<ConnectFinalReturnAddress, string>({
      query: id => `/v1/admin/connect/centres/${id}/final-return-address`,
      providesTags: (_result, _error, id) => [{ type: 'ConnectCentres', id }],
    }),
    setConnectFinalReturnAddress: build.mutation<ConnectFinalReturnAddress, { id: string; warehouse_id: string | null }>({
      query: ({ id, warehouse_id }) => ({ url: `/v1/admin/connect/centres/${id}/final-return-address`, method: 'PUT', body: { warehouse_id } }),
      invalidatesTags: (_result, _error, { id }) => ['ConnectCentres', { type: 'ConnectCentres', id }, 'Activity'],
    }),
    connectAwaitingPickups: build.query<{ object: 'list'; data: ConnectAwaitingPickup[] }, { country?: string } | void>({
      query: filter => ({ url: '/v1/admin/connect/pickups/awaiting', params: clean({ country: filter?.country }) }),
      providesTags: ['ConnectCentres'],
    }),
    connectPickups: build.query<{ object: 'list'; data: ConnectPickup[] }, { status?: ConnectPickup['status']; country?: string } | void>({
      query: filter => ({ url: '/v1/admin/connect/pickups', params: clean({ status: filter?.status, country: filter?.country }) }),
      providesTags: ['ConnectCentres'],
    }),
    scheduleConnectPickup: build.mutation<ConnectPickup, { centre_id: string; day: string; collector: string; note?: string | null }>({
      query: body => ({ url: '/v1/admin/connect/pickups', method: 'POST', body }),
      invalidatesTags: ['ConnectCentres', 'Activity'],
    }),
    cancelConnectPickup: build.mutation<ConnectPickup, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/connect/pickups/${id}/cancel`, method: 'POST', body: { reason } }),
      invalidatesTags: ['ConnectCentres', 'Activity'],
    }),
    receiveConnectPickup: build.mutation<ConnectPickup, { id: string; order_ids: string[]; missing?: string[] }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/connect/pickups/${id}/receive`, method: 'POST', body }),
      invalidatesTags: ['ConnectCentres', 'Activity'],
    }),
    connectWarehouseItems: build.query<{ object: 'list'; data: ConnectWarehouseItem[] }, { warehouse_id?: string } | void>({
      query: filter => ({ url: '/v1/admin/connect/warehouse-items', params: clean({ warehouse_id: filter?.warehouse_id }) }),
      providesTags: ['ConnectCentres'],
    }),
    handBackAtWarehouse: build.mutation<ConnectReturn, { id: string; code: string }>({
      query: ({ id, code }) => ({ url: `/v1/admin/connect/returns/${id}/hand-back`, method: 'POST', body: { code } }),
      invalidatesTags: ['ConnectCentres', 'Activity'],
    }),
    connectMissing: build.query<{ object: 'list'; data: ConnectMissingItem[] }, { country?: string } | void>({
      query: filter => ({ url: '/v1/admin/connect/missing', params: clean({ country: filter?.country }) }),
      providesTags: ['ConnectCentres'],
    }),
    approveConnectReturn: build.mutation<ConnectReturn, { id: string }>({
      query: ({ id }) => ({ url: `/v1/admin/connect/returns/${id}/approve`, method: 'POST', body: {} }),
      invalidatesTags: ['ConnectCentres', 'Activity'],
    }),
    setConnectCentreStatus: build.mutation<ConnectCentreDetail, { id: string; action: 'pause' | 'reinstate' | 'close'; reason: string }>({
      query: ({ id, action, reason }) => ({ url: `/v1/admin/connect/centres/${id}/${action}`, method: 'POST', body: { reason } }),
      invalidatesTags: (_result, _error, { id }) => ['ConnectCentres', { type: 'ConnectCentres', id }, 'Activity'],
    }),
  }),
});

export const {
  useConnectApplicationsQuery,
  useConnectApplicationQuery,
  useRequestConnectChangesMutation,
  useScheduleConnectVisitMutation,
  useRecordConnectVisitMutation,
  useApproveConnectApplicationMutation,
  useRejectConnectApplicationMutation,
  useConnectVisitorsQuery,
  useCreateConnectVisitorMutation,
  useUpdateConnectVisitorMutation,
  useConnectStatesQuery,
  useSetConnectStateMutation,
  useConnectSettingsQuery,
  useSetConnectSettingsMutation,
  useConnectCentresQuery,
  useConnectCentreQuery,
  useSetConnectCentreStatusMutation,
  useConnectReturnsQuery,
  useConnectMissingQuery,
  useConnectWarehousesQuery,
  useCreateConnectWarehouseMutation,
  useUpdateConnectWarehouseMutation,
  useConnectFinalReturnAddressQuery,
  useSetConnectFinalReturnAddressMutation,
  useConnectAwaitingPickupsQuery,
  useConnectPickupsQuery,
  useScheduleConnectPickupMutation,
  useCancelConnectPickupMutation,
  useReceiveConnectPickupMutation,
  useConnectWarehouseItemsQuery,
  useHandBackAtWarehouseMutation,
  useConnectReportQuery,
  useConnectCentreItemsQuery,
  useApproveConnectReturnMutation,
} = connectApi;
