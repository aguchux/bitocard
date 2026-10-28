"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, formatDateTime, KeyValue, Notice, Skeleton, errorMessage } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { useClearTraderStrikesMutation, useResetTraderTwoStepMutation, useTraderStandingQuery } from "@bitocard/api-client/afrippa-admin";

type Mode = "live" | "test";

/**
 * A trader's standing in one mode: strikes (appeals lost and reports upheld) against the limit, cancellations today and
 * what stops them now, with clearing their strikes and resetting a lost two-step method (operations, after step-up).
 */
export function TraderStanding({ id, mode }: { id: string; mode: Mode }) {
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const query = useTraderStandingQuery({ id, mode });
  const [clear] = useClearTraderStrikesMutation();
  const [reset] = useResetTraderTwoStepMutation();
  const [dialog, setDialog] = useState<"clear" | "reset" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const standing = query.data;

  return (
    <Card>
      <CardHeader
        title="Standing"
        description={`${mode === "test" ? "Sandbox" : "Live"} trading. Strikes are appeals lost and reports upheld in the last ${standing?.strike_window_days ?? 90} days.`}
        actions={
          operations ? (
            <span className="flex flex-wrap gap-2">
              {standing && standing.strikes > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setDialog("clear")}>
                  Clear strikes
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setDialog("reset")}>
                Reset two-step
              </Button>
            </span>
          ) : null
        }
      />
      <div className="space-y-4 px-5 pb-5">
        {done ? <Notice tone="green">{done}</Notice> : null}
        {query.error && !standing ? <Notice tone="red">{errorMessage(query.error)}</Notice> : null}
        {!standing ? (
          query.isLoading ? <Skeleton className="h-24 w-full" /> : null
        ) : (
          <>
            {standing.restriction ? (
              <Notice tone={standing.restriction.code === "trading_suspended" ? "red" : "amber"} title={standing.restriction.code === "trading_suspended" ? "Trading paused" : "Restricted"}>
                {standing.restriction.message}
                {standing.restriction.until ? ` Until ${formatDateTime(standing.restriction.until)}.` : null}
              </Notice>
            ) : null}
            <KeyValue
              items={[
                {
                  label: "Strikes",
                  value: (
                    <span className="flex items-center gap-2">
                      {standing.strikes} of {standing.strike_limit}
                      {standing.strikes >= standing.strike_limit ? <Badge tone="red">At the limit</Badge> : null}
                    </span>
                  ),
                },
                { label: "Cancelled as buyer today", value: `${standing.cancellations_today} of ${standing.cancellation_limit}` },
                { label: "Strikes last cleared", value: formatDateTime(standing.cleared_at) },
              ]}
            />
            {standing.lost_appeals.length || standing.upheld_reports.length ? (
              <ul className="space-y-1 text-sm">
                {standing.lost_appeals.map(item => (
                  <li key={item.order_id}>
                    Appeal lost on{" "}
                    <AppLink href={`/orders/${item.order_id}`} className="font-semibold text-brand-600 hover:underline">
                      {item.number}
                    </AppLink>{" "}
                    <span className="text-muted">· {formatDateTime(item.decided_at)}</span>
                  </li>
                ))}
                {standing.upheld_reports.map(item => (
                  <li key={item.report_id}>
                    Report {item.number} upheld <span className="text-muted">· {formatDateTime(item.decided_at)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
      <ActionDialog
        open={dialog === "clear"}
        onClose={() => setDialog(null)}
        title="Clear their strikes"
        description="Strikes before now stop counting, so a paused trader can trade again. They are told."
        confirmLabel="Clear strikes"
        onConfirm={async reason => {
          await clear({ id, mode, reason }).unwrap();
          setDone("Their strikes are cleared.");
        }}
      />
      <ActionDialog
        open={dialog === "reset"}
        onClose={() => setDialog(null)}
        title="Reset their two-step sign-in"
        description="Only for a trader who lost every method and proved who they are. Their method is cleared, they are signed out everywhere and set one up again, and on-chain withdrawals are held for 24 hours. They are told."
        confirmLabel="Reset two-step"
        tone="danger"
        onConfirm={async reason => {
          await reset({ id, reason }).unwrap();
          setDone("Their two-step sign-in is reset. Withdrawals are held for 24 hours.");
        }}
      />
    </Card>
  );
}
