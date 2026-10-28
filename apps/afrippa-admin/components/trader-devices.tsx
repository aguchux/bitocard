"use client";

import { Badge, Card, CardHeader, DataTable, formatDateTime } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type TraderDevice, useTraderDevicesQuery } from "@bitocard/api-client/afrippa-admin";

/**
 * The browsers a trader used on afrippa.com (never their IDs), newest first, and any other trader who used the same one:
 * the same device on both sides of an order is refused as the same person.
 */
export function TraderDevices({ id }: { id: string }) {
  const query = useTraderDevicesQuery(id);
  return (
    <Card>
      <CardHeader title="Devices" description="Browsers this trader used on afrippa.com. A device shared with another trader stops orders between them." />
      <DataTable<TraderDevice>
        caption="Devices"
        rows={query.data?.data}
        loading={query.isLoading}
        rowKey={device => device.id}
        empty="No devices recorded yet."
        columns={[
          { key: "first", header: "First used", cell: device => formatDateTime(device.first_seen_at) },
          { key: "last", header: "Last used", cell: device => formatDateTime(device.last_seen_at) },
          {
            key: "shared",
            header: "Also used by",
            cell: device =>
              device.shared_with.length ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="amber">Shared</Badge>
                  {device.shared_with.map(other => (
                    <AppLink key={other.id} href={`/crypto/customers/${other.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                      {other.email}
                    </AppLink>
                  ))}
                </span>
              ) : (
                <span className="text-muted">Nobody else</span>
              ),
          },
        ]}
      />
    </Card>
  );
}
