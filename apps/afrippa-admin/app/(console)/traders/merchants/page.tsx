"use client";

import { useState } from "react";
import {
  ActionDialog,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Dialog,
  errorMessage,
  Field,
  FilterSelect,
  formatDateTime,
  Input,
  Notice,
  PageHeader,
  QueryView,
  Skeleton,
  type Column,
  type Tone,
} from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type MerchantRule,
  type MerchantStatus,
  type P2pMerchant,
  useDecideMerchantMutation,
  useMerchantRulesQuery,
  useP2pMerchantsQuery,
  useRemoveMerchantRuleMutation,
  useRevokeMerchantMutation,
  useSetMerchantRuleMutation,
} from "@bitocard/api-client/afrippa-admin";
import { AfrippaShell } from "@/components/shell";

const tones: Record<MerchantStatus, [string, Tone]> = {
  applied: ["Applied", "amber"],
  active: ["Merchant", "green"],
  suspended: ["Suspended", "red"],
  rejected: ["Rejected", "grey"],
  revoked: ["Revoked", "grey"],
};
const marketLabel = (market: string) =>
  market === "WW" ? "All of Afrippa" : market;
const percent = (bps: number) => `${bps / 100}%`;

type Open = { merchant: P2pMerchant; action: "approve" | "reject" | "revoke" };

/** Setting who may apply in one market (or all of Afrippa). */
function RuleDialog({
  rule,
  onClose,
}: {
  rule: MerchantRule | "new";
  onClose: () => void;
}) {
  const existing = rule === "new" ? null : rule;
  const [market, setMarket] = useState(existing?.market ?? "");
  const [orders, setOrders] = useState(String(existing?.min_orders ?? 100));
  const [completion, setCompletion] = useState(
    String((existing?.min_completion_bps ?? 9800) / 100),
  );
  const [windowDays, setWindowDays] = useState(
    String(existing?.window_days ?? 90),
  );
  const [accountDays, setAccountDays] = useState(
    String(existing?.min_account_days ?? 30),
  );
  const [save, state] = useSetMerchantRuleMutation();
  const whole = (value: string, max: number) =>
    /^\d+$/.test(value) && Number(value) <= max;
  const code = market.trim().toUpperCase();
  const completionBps = Math.round(Number(completion) * 100);
  const valid =
    /^[A-Z]{2}$/.test(code) &&
    whole(orders, 100000) &&
    /^\d{1,3}(\.\d{1,2})?$/.test(completion) &&
    completionBps <= 10000 &&
    whole(windowDays, 365) &&
    Number(windowDays) >= 1 &&
    whole(accountDays, 3650);
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        existing
          ? `Thresholds: ${marketLabel(existing.market)}`
          : "Thresholds for one market"
      }
      description="A trader meeting every threshold can apply; Afrippa's operations still decide each application. A market's own thresholds win over all of Afrippa's."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            loading={state.isLoading}
            onClick={async () => {
              const saved = await save({
                market: code,
                min_orders: Number(orders),
                min_completion_bps: completionBps,
                window_days: Number(windowDays),
                min_account_days: Number(accountDays),
              })
                .unwrap()
                .catch(() => null);
              if (saved) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {state.error ? (
          <Notice tone="red">{errorMessage(state.error)}</Notice>
        ) : null}
        {existing ? null : (
          <Field
            label="Market"
            htmlFor="rule-market"
            hint="A country code (NG, GH…)."
          >
            <Input
              id="rule-market"
              maxLength={2}
              value={market}
              onChange={(event) => setMarket(event.target.value)}
            />
          </Field>
        )}
        <Field label="Completed orders" htmlFor="rule-orders">
          <Input
            id="rule-orders"
            inputMode="numeric"
            value={orders}
            onChange={(event) => setOrders(event.target.value)}
          />
        </Field>
        <Field label="Completion rate (%)" htmlFor="rule-completion">
          <Input
            id="rule-completion"
            inputMode="decimal"
            value={completion}
            onChange={(event) => setCompletion(event.target.value)}
          />
        </Field>
        <Field label="Over (days)" htmlFor="rule-window">
          <Input
            id="rule-window"
            inputMode="numeric"
            value={windowDays}
            onChange={(event) => setWindowDays(event.target.value)}
          />
        </Field>
        <Field label="Account age (days)" htmlFor="rule-age">
          <Input
            id="rule-age"
            inputMode="numeric"
            value={accountDays}
            onChange={(event) => setAccountDays(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function Rules({ edits }: { edits: boolean }) {
  const query = useMerchantRulesQuery();
  const [remove, removing] = useRemoveMerchantRuleMutation();
  const [editing, setEditing] = useState<MerchantRule | "new" | null>(null);
  const columns: Array<Column<MerchantRule>> = [
    {
      key: "market",
      header: "Market",
      cell: (rule) => (
        <span className="font-semibold text-ink">
          {marketLabel(rule.market)}
        </span>
      ),
    },
    { key: "orders", header: "Orders", cell: (rule) => rule.min_orders },
    {
      key: "completion",
      header: "Completion",
      cell: (rule) =>
        `${percent(rule.min_completion_bps)} over ${rule.window_days} days`,
    },
    {
      key: "age",
      header: "Account age",
      cell: (rule) => `${rule.min_account_days} days`,
    },
    {
      key: "actions",
      header: "",
      cell: (rule) =>
        edits ? (
          <span className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(rule)}>
              Change
            </Button>
            {rule.market === "WW" ? null : (
              <Button
                variant="ghost"
                loading={removing.isLoading}
                onClick={() =>
                  void remove(rule.market)
                    .unwrap()
                    .catch(() => null)
                }
              >
                Remove
              </Button>
            )}
          </span>
        ) : null,
    },
  ];
  return (
    <Card className="mt-6">
      <CardHeader
        title="Who can apply"
        description="Thresholds a trader must meet to apply, and to stay a merchant: the daily check suspends merchants who fall below them, and a strike suspends at once."
        actions={
          edits ? (
            <Button variant="secondary" onClick={() => setEditing("new")}>
              Set a market
            </Button>
          ) : null
        }
      />
      {removing.error ? (
        <Notice tone="red">{errorMessage(removing.error)}</Notice>
      ) : null}
      <QueryView query={query} loading={<Skeleton className="h-32" />}>
        {(data) => (
          <DataTable
            columns={columns}
            rows={data.data}
            rowKey={(rule) => rule.market}
            empty="No thresholds."
          />
        )}
      </QueryView>
      {editing ? (
        <RuleDialog rule={editing} onClose={() => setEditing(null)} />
      ) : null}
    </Card>
  );
}

/**
 * Traders > Merchants: applications, oldest first, with where each trader stands; operations approve (after step-up)
 * or reject, and revoke a merchant with a reason the trader sees. Below, the thresholds for applying.
 */
export default function MerchantsPage() {
  const admin = useAdmin();
  const [status, setStatus] = useState<MerchantStatus | "">("applied");
  const query = useP2pMerchantsQuery(status ? { status } : {});
  const [decide] = useDecideMerchantMutation();
  const [revoke] = useRevokeMerchantMutation();
  const [open, setOpen] = useState<Open | null>(null);
  const decides = can(admin, "operations");

  const columns: Array<Column<P2pMerchant>> = [
    {
      key: "trader",
      header: "Trader",
      cell: (merchant) => (
        <span className="block min-w-0">
          <span className="block font-semibold text-ink">
            {merchant.customer.nickname ?? merchant.customer.name}
          </span>
          <span className="block text-xs text-muted">
            {merchant.customer.email} ·{" "}
            {merchant.customer.country ?? "No country"} ·{" "}
            {merchant.mode === "test" ? "Sandbox · " : ""}applied{" "}
            {formatDateTime(merchant.applied_at)}
          </span>
          <AppLink
            href={`/crypto/customers/${merchant.customer.id}`}
            className="text-xs font-semibold text-brand-600 hover:underline"
          >
            Wallets and standing
          </AppLink>
          {merchant.note ? (
            <span className="mt-1 block text-xs text-muted">
              Note: {merchant.note}
            </span>
          ) : null}
          {merchant.suspended_reason ? (
            <span className="mt-1 block text-xs text-muted">
              Suspended:{" "}
              {merchant.suspended_reason === "strike"
                ? "a strike"
                : "below the thresholds"}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "requirements",
      header: "Where they stand",
      hideOnMobile: true,
      cell: (merchant) => (
        <ul className="space-y-0.5 text-xs">
          {merchant.requirements.map((item) => (
            <li
              key={item.key}
              className={item.met ? "text-ink" : "text-red-700"}
            >
              {item.met ? "✓" : "✗"} {item.label}: {item.value} (needs{" "}
              {item.needed})
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (merchant) => (
        <Badge tone={tones[merchant.status][1]}>
          {tones[merchant.status][0]}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (merchant) =>
        !decides ? null : merchant.status === "applied" ? (
          <span className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setOpen({ merchant, action: "approve" })}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              onClick={() => setOpen({ merchant, action: "reject" })}
            >
              Reject
            </Button>
          </span>
        ) : merchant.status === "active" || merchant.status === "suspended" ? (
          <Button
            variant="ghost"
            onClick={() => setOpen({ merchant, action: "revoke" })}
          >
            Revoke
          </Button>
        ) : null,
    },
  ];

  const who =
    open?.merchant.customer.nickname ?? open?.merchant.customer.name ?? "";
  return (
    <AfrippaShell
      section="traders"
      current="/traders/merchants"
      crumbs={[
        { label: "Traders", href: "/verifications" },
        { label: "Merchants" },
      ]}
    >
      <PageHeader
        title="Merchants"
        description="Traders with a strong record apply to be merchants: a badge on their ads, a filter of their own and the market's merchant limits."
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <FilterSelect
          id="status"
          label="Status"
          value={status}
          onChange={(value) => setStatus(value as typeof status)}
          options={[
            { value: "applied", label: "Applications" },
            { value: "active", label: "Merchants" },
            { value: "suspended", label: "Suspended" },
            { value: "revoked", label: "Revoked" },
            { value: "rejected", label: "Rejected" },
            { value: "", label: "All" },
          ]}
        />
      </div>
      <Card>
        <QueryView query={query} loading={<Skeleton className="h-64" />}>
          {(data) => (
            <DataTable
              columns={columns}
              rows={data.data}
              rowKey={(merchant) => merchant.id}
              empty="Nobody here."
            />
          )}
        </QueryView>
      </Card>
      <Rules edits={decides} />
      {open ? (
        <ActionDialog
          open
          onClose={() => setOpen(null)}
          title={
            open.action === "approve"
              ? `Make ${who} a merchant?`
              : open.action === "reject"
                ? `Reject ${who}'s application?`
                : `Revoke ${who}'s merchant status?`
          }
          description={
            open.action === "approve"
              ? "Their ads carry the merchant badge and the market's merchant limits apply to them. A strike suspends it at once."
              : open.action === "reject"
                ? "They see your note and can apply again."
                : "They see your reason. Revoked merchants can apply again once they qualify."
          }
          confirmLabel={
            open.action === "approve"
              ? "Approve"
              : open.action === "reject"
                ? "Reject"
                : "Revoke"
          }
          tone={open.action === "approve" ? "primary" : "danger"}
          onConfirm={(note) =>
            open.action === "revoke"
              ? revoke({ id: open.merchant.id, reason: note }).unwrap()
              : decide({
                  id: open.merchant.id,
                  outcome: open.action,
                  note,
                }).unwrap()
          }
        />
      ) : null}
    </AfrippaShell>
  );
}
