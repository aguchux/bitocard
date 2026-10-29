"use client";

import { useState } from "react";
import {
  ActionDialog,
  Badge,
  Button,
  Card,
  CardHeader,
  errorMessage,
  PageHeader,
  QueryView,
  Select,
  Skeleton,
} from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type AfrippaMarkets,
  type AfrippaMarketSwitch,
  type MarketReadiness,
  type MarketSwitchState,
  useAfrippaMarketsQuery,
  useSetMarketSwitchMutation,
  useSetStoreModeMutation,
} from "@bitocard/api-client/afrippa-admin";
import { AfrippaShell } from "@/components/shell";

const order: AfrippaMarketSwitch[] = [
  "crypto_app",
  "crypto_wallets",
  "p2p_trading",
  "crypto_global",
  "crypto_cross_border",
  "crypto_install_prompt",
];

/** On, off, or following (a country follows all of Afrippa; all of Afrippa follows the default, off). */
function SwitchControl({
  name,
  state,
  country,
  label,
  disabled,
}: {
  name: AfrippaMarketSwitch;
  state: MarketSwitchState;
  country: string | null;
  label: string;
  disabled: boolean;
}) {
  const [save, saving] = useSetMarketSwitchMutation();
  const value = state.set === null ? "follow" : state.set ? "on" : "off";
  const follows = country
    ? `Follow all of Afrippa (${state.on ? "on" : "off"})`
    : "Off (default)";
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink">{label}</span>
        <Select
          aria-label={`${label}${country ? ` in ${country}` : " for all of Afrippa"}`}
          className="w-auto min-w-44"
          value={value}
          disabled={disabled || saving.isLoading}
          onChange={(event) => {
            const next = event.target.value;
            void save({
              key: name,
              ...(country ? { country_code: country } : {}),
              enabled: next === "follow" ? null : next === "on",
            })
              .unwrap()
              .catch(() => null);
          }}
        >
          <option value="on">On</option>
          <option value="off">Off</option>
          <option value="follow">{follows}</option>
        </Select>
      </div>
      {saving.error ? (
        <p className="mt-1 text-sm text-red-600">
          {errorMessage(saving.error)}
        </p>
      ) : null}
    </div>
  );
}

function Readiness({ ready, live }: { ready: MarketReadiness; live: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone={ready.fee_rates ? "green" : live ? "red" : "amber"}>
        {ready.fee_rates ? "Fee rates set" : "No fee rates"}
      </Badge>
      <Badge tone={ready.limits ? "green" : live ? "red" : "amber"}>
        {ready.limits ? "Live limits set" : "No live limits"}
      </Badge>
    </div>
  );
}

/** The store's mode: the sandbox (test coins, simulated payments) or live, moved by operations with a reason. */
function StoreMode({
  markets,
  edits,
}: {
  markets: AfrippaMarkets;
  edits: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [save] = useSetStoreModeMutation();
  const live = markets.store_mode === "live";
  return (
    <Card className="space-y-3 p-5">
      <CardHeader
        className="px-0 pt-0"
        title={
          <span className="flex items-center gap-2">
            Afrippa is {live ? "live" : "in the sandbox"}{" "}
            <Badge tone={live ? "green" : "amber"}>
              {live ? "Live" : "Sandbox"}
            </Badge>
          </span>
        }
        description={
          live
            ? "Traders hold real coins and pay each other real money. Each market still needs its fee rates and live limits before trading in it."
            : "Traders use test coins and nothing real moves. Go live only once the legal review, the signer, screening and the pilot markets' fee rates and limits are in place."
        }
        actions={
          edits ? (
            <Button
              variant={live ? "secondary" : "primary"}
              onClick={() => setOpen(true)}
            >
              {live ? "Back to the sandbox" : "Go live"}
            </Button>
          ) : null
        }
      />
      <ActionDialog
        open={open}
        onClose={() => setOpen(false)}
        title={
          live ? "Move Afrippa back to the sandbox?" : "Take Afrippa live?"
        }
        description={
          live
            ? "New business uses test coins again. Live balances stay as they are and are not shown in the sandbox."
            : "From now on, deposits, withdrawals and orders are real. Only markets you have opened, with fee rates and live limits, can trade."
        }
        confirmLabel={live ? "Move to the sandbox" : "Go live"}
        tone={live ? "primary" : "danger"}
        onConfirm={(reason) =>
          save({ mode: live ? "test" : "live", reason }).unwrap()
        }
      />
    </Card>
  );
}

/**
 * Settings > Markets: which markets are open (each switch for all of Afrippa or one country; a country is allowed only
 * when switched on by itself, never by all of Afrippa alone), what each still needs before trading live, and the
 * store's mode. Operations change them, after step-up; everyone else reads.
 */
export default function MarketsPage() {
  const admin = useAdmin();
  const query = useAfrippaMarketsQuery();
  const edits = can(admin, "operations");
  return (
    <AfrippaShell
      section="settings"
      current="/settings/markets"
      crumbs={[{ label: "Settings", href: "/settings" }, { label: "Markets" }]}
    >
      <PageHeader
        title="Markets"
        description="Open Afrippa country by country. Residents of a country trade only once it is switched on for that country by itself: switching something on for all of Afrippa never opens a country."
      />
      <QueryView query={query} loading={<Skeleton className="h-96 w-full" />}>
        {(markets) => {
          const live = markets.store_mode === "live";
          return (
            <div className="space-y-4">
              <StoreMode markets={markets} edits={edits} />
              <Card className="p-5">
                <CardHeader
                  className="px-0 pt-0"
                  title="All of Afrippa"
                  description="Each country follows these unless it is set by itself. The global market (US dollars) also needs its own fee rates and limits."
                  actions={
                    <Readiness ready={markets.global.ready} live={live} />
                  }
                />
                <div className="mt-2 divide-y divide-line">
                  {order
                    .filter((key) => markets.global.switches[key])
                    .map((key) => (
                      <SwitchControl
                        key={key}
                        name={key}
                        state={markets.global.switches[key]!}
                        country={null}
                        label={markets.definitions[key].label}
                        disabled={!edits}
                      />
                    ))}
                </div>
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                {markets.countries.map((country) => (
                  <Card key={country.code} className="p-5">
                    <CardHeader
                      className="px-0 pt-0"
                      title={
                        <span className="flex flex-wrap items-center gap-2">
                          {country.name}{" "}
                          <span className="text-muted">
                            ({country.code}, {country.currency})
                          </span>
                          <Badge tone={country.allowed ? "green" : "grey"}>
                            {country.allowed ? "Residents allowed" : "Closed"}
                          </Badge>
                        </span>
                      }
                      actions={<Readiness ready={country.ready} live={live} />}
                    />
                    <div className="mt-2 divide-y divide-line">
                      {order
                        .filter((key) => country.switches[key])
                        .map((key) => (
                          <SwitchControl
                            key={key}
                            name={key}
                            state={country.switches[key]!}
                            country={country.code}
                            label={markets.definitions[key].label}
                            disabled={!edits}
                          />
                        ))}
                    </div>
                  </Card>
                ))}
              </div>
              <Card className="space-y-2 p-5 text-sm text-muted">
                {order.map((key) => (
                  <p key={key}>
                    <span className="font-semibold text-ink">
                      {markets.definitions[key].label}:
                    </span>{" "}
                    {markets.definitions[key].description}
                  </p>
                ))}
              </Card>
            </div>
          );
        }}
      </QueryView>
    </AfrippaShell>
  );
}
