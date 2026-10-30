"use client";

import { useState } from "react";
import { EyeOff, Plus } from "lucide-react";
import { Button, errorMessage, Notice, PageHeader, QueryView, Skeleton, Tabs } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { usePlanSettingsQuery } from "@bitocard/api-client/admin";
import { FeatureMatrix } from "@/components/plans/feature-matrix";
import { PlanDetails, PlanAvailability } from "@/components/plans/plan-details";
import { LocalPrices } from "@/components/plans/local-prices";
import { NewPlanDialog } from "@/components/plans/new-plan-dialog";

/** Plans & fees > Plans: every plan and what it includes, each plan's details and prices, and new plans. */
export default function PlansPage() {
  const admin = useAdmin();
  const editable = can(admin, "finance");
  const settings = usePlanSettingsQuery();
  const [chosen, setChosen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <UdozoShell section="plans" current="/plans" crumbs={[{ label: "Plans & fees", href: "/plans" }, { label: "Plans" }]}>
      <PageHeader
        title="Plans"
        description="Startup is free. Other plans are billed monthly from the reseller's live wallet, in their own currency, and include the features you switch on for them."
        actions={
          editable && settings.data ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
              New plan
            </Button>
          ) : undefined
        }
      />
      {!editable ? <Notice tone="grey">Only finance admins can change plans.</Notice> : null}
      <QueryView query={settings} message={error => errorMessage(error, "Could not load the plans.")} loading={<Skeleton className="h-96 w-full" />}>
        {data => {
          const plan = data.plans.find(item => item.code === chosen) ?? data.plans.find(item => !item.free) ?? data.plans[0];
          return (
            <div className="space-y-5">
              <FeatureMatrix settings={data} editable={editable} />
              {plan ? (
                <section aria-label="Plan details" className="space-y-5">
                  <Tabs
                    label="Plan"
                    variant="pills"
                    value={plan.code}
                    onChange={setChosen}
                    items={data.plans.map(item => ({ value: item.code, label: item.available ? item.name : `${item.name} (hidden)`, count: item.resellers }))}
                  />
                  {!plan.available ? (
                    <Notice tone="amber" title="Hidden">
                      <span className="inline-flex items-center gap-1.5">
                        <EyeOff className="size-4" aria-hidden /> {`${plan.name} is not offered to resellers. Those on it keep it.`}
                      </span>
                    </Notice>
                  ) : null}
                  {/* Keyed by plan, so each form starts from that plan's saved values. */}
                  <div key={plan.code} className="space-y-5">
                    <PlanDetails plan={plan} editable={editable} />
                    <PlanAvailability plan={plan} editable={editable} onDeleted={() => setChosen(null)} />
                    <LocalPrices plan={plan} editable={editable} />
                  </div>
                </section>
              ) : null}
              <NewPlanDialog
                key={creating ? "open" : "closed"}
                settings={data}
                open={creating}
                onClose={() => setCreating(false)}
                onCreated={code => {
                  setCreating(false);
                  setChosen(code);
                }}
              />
            </div>
          );
        }}
      </QueryView>
    </UdozoShell>
  );
}
