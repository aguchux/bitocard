"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, formatDateTime } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { useClearResaleStrikesMutation, useResaleStandingQuery } from "@bitocard/api-client/admin";

/**
 * A reseller's resale strikes: resale orders their stores cancelled in 90 days, against the country's limit. At the
 * limit their Resale shops cannot take orders until operations lift it (strikes before then stop counting).
 */
export function ResaleStandingCard({ resellerId }: { resellerId: string }) {
  const admin = useAdmin();
  const standing = useResaleStandingQuery(resellerId);
  const [clear] = useClearResaleStrikesMutation();
  const [clearing, setClearing] = useState(false);
  const data = standing.data;
  if (!data || (!data.strikes && !data.cleared_at)) return null;
  return (
    <Card>
      <CardHeader
        title="Resale strikes"
        description="Resale orders this reseller’s stores cancelled in the last 90 days."
        actions={data.limited ? <Badge tone="red">Checkout paused</Badge> : <Badge tone="grey">{`${data.strikes} of ${data.strike_limit}`}</Badge>}
      />
      <div className="space-y-3 px-5 pb-5 text-sm sm:px-6">
        <p className="text-muted">
          {data.strikes} of {data.strike_limit} strikes{data.cleared_at ? `; last lifted ${formatDateTime(data.cleared_at)}` : ""}.
        </p>
        {data.limited && can(admin, "operations") ? (
          <Button variant="secondary" onClick={() => setClearing(true)}>
            Lift the pause
          </Button>
        ) : null}
      </div>
      <ActionDialog
        open={clearing}
        onClose={() => setClearing(false)}
        title="Lift this reseller’s resale pause?"
        description="Their Resale shops take orders again, and strikes before now stop counting."
        confirmLabel="Lift the pause"
        onConfirm={reason => clear({ resellerId, reason }).unwrap()}
      />
    </Card>
  );
}
