"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardHeader, DataTable, errorMessage, formatDateTime, KeyValue } from "@bitocard/admin-ui";
import { type CoinWithdrawal, useCoinWithdrawalsQuery } from "@bitocard/api-client/reseller";
import { can, useReseller } from "@/components/reseller";
import { coinAmount } from "../shared";
import { coinRoles, withdrawalInProgress, WithdrawalStatus } from "../coin-parts";
import { reviewText } from "./amounts";

export function Withdrawals({ onEnterCode }: { onEnterCode: (withdrawal: CoinWithdrawal) => void }) {
  const { membership } = useReseller();
  const allowed = can(membership, ...coinRoles);
  const [polling, setPolling] = useState(false);
  const list = useCoinWithdrawalsQuery(undefined, {
    pollingInterval: polling ? 15_000 : 0,
    skipPollingIfUnfocused: true,
  });
  const rows = list.data?.data;
  const moving = Boolean(rows?.some(row => withdrawalInProgress(row.status)));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- polling follows the fetched list
    setPolling(moving);
  }, [moving]);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = rows?.find(row => row.id === openId) ?? null;
  return (
    <Card>
      <CardHeader title="Withdrawals" description="Newest first. Choose one to see its transaction." />
      <div className="mt-4">
        <DataTable<CoinWithdrawal>
          caption="Withdrawals"
          rows={rows}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          onRetry={() => void list.refetch()}
          rowKey={row => row.id}
          empty="No withdrawals yet."
          onRowClick={row => setOpenId(current => (current === row.id ? null : row.id))}
          columns={[
            {
              key: "number",
              header: "Withdrawal",
              cell: row => <span className="font-semibold text-ink">{row.number}</span>,
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              cell: row => (
                <span className="tabular-nums">
                  {coinAmount(row.amount)} {row.asset}
                </span>
              ),
            },
            {
              key: "network",
              header: "Network",
              hideOnMobile: true,
              cell: row => row.network,
            },
            {
              key: "status",
              header: "Status",
              cell: row => <WithdrawalStatus status={row.status} />,
            },
            {
              key: "date",
              header: "Asked",
              hideOnMobile: true,
              cell: row => formatDateTime(row.created_at),
            },
            {
              key: "action",
              header: "",
              align: "right",
              cell: row =>
                row.status === "awaiting_code" && allowed ? (
                  <Button
                    variant="secondary"
                    onClick={event => {
                      event.stopPropagation();
                      onEnterCode(row);
                    }}
                  >
                    Enter code
                  </Button>
                ) : null,
            },
          ]}
        />
      </div>
      {opened ? (
        <div className="border-t border-line px-5 py-5 sm:px-6" aria-live="polite">
          <h3 className="text-sm font-bold text-ink">{opened.number}</h3>
          <KeyValue
            className="mt-3"
            items={[
              {
                label: "To",
                value: <span className="break-all font-mono text-xs">{opened.address}</span>,
              },
              { label: "Network", value: opened.network },
              {
                label: "Network fee",
                value: `${coinAmount(opened.fee)} ${opened.asset}`,
              },
              {
                label: "Total from your wallet",
                value: `${coinAmount(opened.total)} ${opened.asset}`,
              },
              {
                label: "Transaction",
                value: opened.tx_hash ? <span className="break-all font-mono text-xs">{opened.tx_hash}</span> : "Not sent yet",
              },
              { label: "Confirmations", value: opened.confirmations },
              ...(opened.review_reason
                ? [
                    {
                      label: "Reviewed because",
                      value: reviewText[opened.review_reason] ?? opened.review_reason,
                    },
                  ]
                : []),
              {
                label: "Completed",
                value: formatDateTime(opened.completed_at),
              },
            ]}
          />
        </div>
      ) : null}
    </Card>
  );
}
