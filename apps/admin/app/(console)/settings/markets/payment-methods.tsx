"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge, Button, errorMessage, Notice, Skeleton, Toggle } from "@bitocard/admin-ui";
import {
  type MarketPaymentMethod,
  type PaymentGateway,
  type PaymentMethodPurpose,
  reorder,
  usePaymentMethodsQuery,
  useSetPaymentMethodsMutation,
} from "@bitocard/api-client/admin";

const purposes: Array<{ key: PaymentMethodPurpose; title: string; help: string }> = [
  { key: "wallet_top_up", title: "Wallet top-ups", help: "How resellers here fund their wallet." },
  { key: "checkout", title: "Customer checkout", help: "How customers here pay on bitocard.com." },
];

/**
 * A market's payment methods: which gateways are offered for wallet top-ups and for customer checkout, and in which
 * order payers see them. A gateway also needs its credentials (Settings > Integrations) to take live payments.
 */
export function PaymentMethods({ code, country, editable }: { code: string; country: string; editable: boolean }) {
  const { data, error } = usePaymentMethodsQuery(code);
  const [save, state] = useSetPaymentMethodsMutation();

  if (!data) return error ? <Notice tone="red">{errorMessage(error)}</Notice> : <Skeleton className="h-32 w-full" />;

  const enabledOf = (list: MarketPaymentMethod[]) => list.filter(item => item.enabled).sort((a, b) => a.position - b.position).map(item => item.gateway);
  const change = (purpose: PaymentMethodPurpose, enabled: PaymentGateway[]) => save({ code, purpose, enabled });

  return (
    <div className="space-y-3 px-4 pb-4 sm:px-6">
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {purposes.map(purpose => {
          const list = data[purpose.key];
          const enabled = enabledOf(list);
          return (
            <section key={purpose.key} aria-label={`${purpose.title} in ${country}`} className="rounded-xl border border-line">
              <header className="border-b border-line px-4 py-3">
                <h3 className="text-sm font-semibold">{purpose.title}</h3>
                <p className="text-xs text-muted">{purpose.help}</p>
              </header>
              <ul className="divide-y divide-line">
                {list.map(item => {
                  const at = enabled.indexOf(item.gateway);
                  return (
                    <li key={item.gateway} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Toggle
                        label={`${item.name} for ${purpose.title.toLowerCase()} in ${country}`}
                        checked={item.enabled}
                        disabled={!editable || state.isLoading}
                        onChange={on => change(purpose.key, on ? [...enabled, item.gateway] : enabled.filter(gateway => gateway !== item.gateway))}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {item.enabled ? <span className="mr-1 text-muted">{at + 1}.</span> : null}
                          {item.name}
                        </p>
                        <p className="text-xs text-muted">Payers see “{item.label}”</p>
                      </div>
                      {!item.configured ? (
                        <Badge tone="amber">Not set up</Badge>
                      ) : item.supported === false ? (
                        <Badge tone="grey">Not available in {code}</Badge>
                      ) : null}
                      {item.enabled && editable ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" aria-label={`Move ${item.name} up`} disabled={at === 0 || state.isLoading} onClick={() => change(purpose.key, reorder(enabled, item.gateway, -1))} icon={<ArrowUp className="size-4" aria-hidden />} />
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${item.name} down`}
                            disabled={at === enabled.length - 1 || state.isLoading}
                            onClick={() => change(purpose.key, reorder(enabled, item.gateway, 1))}
                            icon={<ArrowDown className="size-4" aria-hidden />}
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        Only methods switched on here and set up in Settings &gt; Integrations (credentials saved, Sandbox off) take live payments. In the sandbox every method switched on is
        simulated.
      </p>
    </div>
  );
}
