"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, Field, Notice, QueryView, Select, Skeleton, StatusBadge, Tabs, Textarea, errorMessage } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { botStatusLabels, providerLabels, type AssistantContext } from "@bitocard/admin-ui/support";
import { shopMoney, type ShopAssistantCard } from "@bitocard/api-client/classifieds";
import {
  type AssistantThreadRow,
  type ShopBotRole,
  type SupportBot,
  useActivateSupportBotMutation,
  useAssignShopBotMutation,
  useAssistantThreadQuery,
  useAssistantThreadsQuery,
  useBotKnowledgeQuery,
  useCountriesQuery,
  useGenerateBotKnowledgeMutation,
  useMakeShopBotDefaultMutation,
  usePauseSupportBotMutation,
  useRefreshShopBotKnowledgeMutation,
  useRunShopBotEvalsMutation,
  useSaveBotKnowledgeMutation,
  useShopBotEvalsQuery,
  useShopBotKnowledgeQuery,
  useTestSupportBotMutation,
  useUpdateSupportBotMutation,
} from "@bitocard/api-client/admin";
import { languageLabel, ShopAssistantForm, shopRoleLabels } from "./form";

const base = "/v1/admin/support/bots" as const;
type Tab = "profile" | "countries" | "knowledge" | "try" | "conversations" | "evals";

/** A card from a tool, as admins read it in Try it and in a conversation: the facts the person saw beside the answer. */
export function CardPreview({ card }: { card: ShopAssistantCard }) {
  const box = "rounded-xl border border-line bg-white p-3 text-sm";
  switch (card.type) {
    case "listings":
    case "compare":
      return (
        <ul className={`${box} space-y-1`}>
          {card.items.map(item => (
            <li key={item.id} className="flex justify-between gap-3">
              <a href={item.url} target="_blank" rel="noreferrer" className="truncate font-semibold text-brand-600 hover:underline">
                {item.title}
              </a>
              <span className="shrink-0 text-muted">{item.price.amount === null ? "On request" : shopMoney(item.price.amount, item.price.currency)}</span>
            </li>
          ))}
        </ul>
      );
    case "price_range":
      return <p className={box}>{`${card.category}: usually ${shopMoney(card.low, card.currency)} to ${shopMoney(card.high, card.currency)} (median ${shopMoney(card.median, card.currency)}, ${card.count} listings)`}</p>;
    case "safe_pay":
      return <p className={box}>{`Safe pay: ${shopMoney(card.price, card.currency)} + fee ${shopMoney(card.fee, card.currency)} = ${shopMoney(card.total, card.currency)}`}</p>;
    case "checklist":
      return (
        <ul className={`${box} list-disc pl-6`}>
          {card.items.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "message_draft":
      return <p className={box}>{`Draft to the seller of ${card.title}: “${card.text}”`}</p>;
    case "person":
      return <p className={box}>{`Offered a person: ${card.reason}`}</p>;
    case "orders":
    case "my_listings":
      return <p className={box}>{`${card.items.length} of their ${card.type === "orders" ? "orders" : "listings"}`}</p>;
    default:
      return <pre className={`${box} overflow-x-auto whitespace-pre-wrap text-xs`}>{JSON.stringify(card, null, 2)}</pre>;
  }
}

function Countries({ bot }: { bot: SupportBot }) {
  const countries = useCountriesQuery();
  const [assign, state] = useAssignShopBotMutation();
  const [makeDefault] = useMakeShopBotDefaultMutation();
  const [rows, setRows] = useState(bot.shop?.assignments.map(item => ({ country: item.country, language: item.language })) ?? []);
  const [confirm, setConfirm] = useState(false);
  const shop = bot.shop!;
  if (shop.default) {
    return (
      <Card className="space-y-3 p-5">
        <Notice tone="blue" title="The default">
          {`${bot.name} answers in every country where BitoCard Shop is open and no other assistant is assigned: ${shop.countries.join(", ") || "none open yet"}.`}
        </Notice>
        <p className="text-sm text-muted">Pausing it leaves those countries without an assistant. To replace it, make another assistant the default.</p>
      </Card>
    );
  }
  const options = countries.data?.data ?? [];
  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-muted">It takes over from the default in these countries, for all its languages or one. At most one active assistant answers a country and language: activating this one replaces whoever answers there now.</p>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={`${row.country}-${row.language ?? "all"}-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Select aria-label="Country" value={row.country} onChange={event => setRows(current => current.map((item, at) => (at === index ? { ...item, country: event.target.value } : item)))}>
              {options.map(country => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Language" value={row.language ?? ""} onChange={event => setRows(current => current.map((item, at) => (at === index ? { ...item, language: event.target.value || null } : item)))}>
              <option value="">All its languages</option>
              {shop.languages.map(language => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => setRows(current => current.filter((_item, at) => at !== index))}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="secondary" disabled={!options.length} onClick={() => setRows(current => [...current, { country: options[0]?.code ?? "NG", language: null }])}>
          Add a country
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Make it the default
          </Button>
          <Button loading={state.isLoading} onClick={() => void assign({ id: bot.id, assignments: rows })}>
            Save countries
          </Button>
        </div>
      </div>
      <ActionDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Make ${bot.name} the default`}
        description="It will answer every open country without its own assistant. The current default is paused and loses that role; this assistant's own countries are cleared."
        confirmLabel="Make default"
        requireReason={false}
        onConfirm={async () => {
          await makeDefault(bot.id).unwrap();
        }}
      />
    </Card>
  );
}

function Knowledge({ bot }: { bot: SupportBot }) {
  const shared = useBotKnowledgeQuery({ base, id: bot.id });
  const countries = useShopBotKnowledgeQuery(bot.id);
  const [save, saveState] = useSaveBotKnowledgeMutation();
  const [generate, generateState] = useGenerateBotKnowledgeMutation();
  const [refresh, refreshState] = useRefreshShopBotKnowledgeMutation();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const text = draft ?? shared.data?.current?.content ?? "";
  const stale = countries.data?.data.filter(item => item.served && item.stale) ?? [];
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-ink">BitoCard’s sections, per country</h3>
            <p className="text-sm text-muted">Generated from each market’s live data (categories, posting rules, Safe pay fees and deadlines, the Safe Trade Guide), refreshed every day by themselves.</p>
          </div>
          <Button loading={refreshState.isLoading} onClick={() => void refresh({ id: bot.id })}>
            {stale.length ? `Update ${stale.map(item => item.country).join(", ")}` : "Check for changes"}
          </Button>
        </div>
        {refreshState.error ? <Notice tone="red">{errorMessage(refreshState.error)}</Notice> : null}
        <QueryView query={countries} loading={<Skeleton className="h-24 w-full" />}>
          {data =>
            data.data.length ? (
              <ul className="divide-y divide-line">
                {data.data.map(item => (
                  <li key={item.country} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-ink">
                        {item.country} {item.version ? <span className="text-sm font-normal text-muted">{`version ${item.version}, ${new Date(item.generated_at!).toLocaleDateString("en-GB")}`}</span> : null}
                      </p>
                      <div className="flex items-center gap-2">
                        {!item.version ? <Badge tone="amber">Not generated</Badge> : item.stale ? <Badge tone="amber">Market changed</Badge> : <Badge tone="green">Up to date</Badge>}
                        {item.content ? (
                          <Button variant="secondary" onClick={() => setOpen(open === item.country ? null : item.country)}>
                            {open === item.country ? "Hide" : "Read"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {item.stale && item.version ? (
                      <p className="text-xs text-muted">
                        {item.sections
                          .filter(section => section.state !== "unchanged")
                          .map(section => `${section.title} (${section.state === "added" ? "new" : `+${section.added} −${section.removed}`})`)
                          .join(" · ")}
                      </p>
                    ) : null}
                    {open === item.country ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-canvas p-3 text-xs">{item.content}</pre> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{bot.shop?.default ? "No country has BitoCard Shop open yet." : "Assign it to a country first."}</p>
            )
          }
        </QueryView>
      </Card>
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-ink">Your own sections (every country)</h3>
            <p className="text-sm text-muted">Who it is, the questions people ask most, and what it must not do. BitoCard never changes this document.</p>
          </div>
          {!text ? (
            <Button
              variant="secondary"
              loading={generateState.isLoading}
              onClick={async () => {
                const made = await generate({ base, id: bot.id }).unwrap().catch(() => null);
                if (made) setDraft(made.content);
              }}
            >
              Start from the template
            </Button>
          ) : null}
        </div>
        <Field label="Document (Markdown)" htmlFor="shop-shared-knowledge">
          <Textarea id="shop-shared-knowledge" rows={14} value={text} onChange={event => setDraft(event.target.value)} />
        </Field>
        {saveState.error ? <Notice tone="red">{errorMessage(saveState.error)}</Notice> : null}
        <div className="flex justify-end">
          <Button
            loading={saveState.isLoading}
            disabled={!text.trim() || draft === null}
            onClick={async () => {
              await save({ base, id: bot.id, content: text, source: "edited" }).unwrap();
              setDraft(null);
            }}
          >
            Save document
          </Button>
        </div>
      </Card>
    </div>
  );
}

function TryIt({ bot }: { bot: SupportBot }) {
  const [test, state] = useTestSupportBotMutation();
  const countries = bot.shop?.countries ?? [];
  const [country, setCountry] = useState(countries[0] ?? "NG");
  const [surface, setSurface] = useState<ShopBotRole>((bot.roles[0] as ShopBotRole) ?? "browse");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Array<{ role: "user" | "assistant"; content: string; cards?: ShopAssistantCard[] }>>([]);
  const ask = async () => {
    const next = [...turns, { role: "user" as const, content: question.trim() }];
    setTurns(next);
    setQuestion("");
    const answer = await test({ base, id: bot.id, country, surface, messages: next.map(({ role, content }) => ({ role, content })) })
      .unwrap()
      .catch(() => null);
    if (answer) setTurns([...next, { role: "assistant", content: answer.reply, cards: (answer.cards ?? []) as ShopAssistantCard[] }]);
  };
  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-muted">Its tools read the market’s real listings (nothing is changed). Signed out; usage counts as a test.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Market" htmlFor="try-country">
          <Select id="try-country" value={country} onChange={event => setCountry(event.target.value)}>
            {(countries.length ? countries : ["NG"]).map(code => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="As" htmlFor="try-surface">
          <Select id="try-surface" value={surface} onChange={event => setSurface(event.target.value as ShopBotRole)}>
            {(bot.roles as ShopBotRole[]).map(role => (
              <option key={role} value={role}>
                {shopRoleLabels[role]?.title ?? role}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ol className="space-y-3">
        {turns.map((turn, index) => (
          <li key={index} className={turn.role === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-brand-50 p-3 text-sm" : "max-w-[90%] space-y-2"}>
            {turn.role === "assistant" ? <p className="rounded-2xl border border-line p-3 text-sm whitespace-pre-wrap">{turn.content || "(no words, only cards)"}</p> : turn.content}
            {turn.cards?.map((card, at) => (
              <CardPreview key={at} card={card} />
            ))}
          </li>
        ))}
      </ol>
      {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <div className="flex gap-2">
        <Textarea aria-label="Question" rows={2} value={question} onChange={event => setQuestion(event.target.value)} placeholder="A used iPhone 13 under ₦400,000 near Ikeja" />
        <Button loading={state.isLoading} disabled={!question.trim()} onClick={() => void ask()}>
          Ask
        </Button>
      </div>
      {turns.length ? (
        <Button variant="secondary" onClick={() => setTurns([])}>
          Start again
        </Button>
      ) : null}
    </Card>
  );
}

function Thread({ bot, thread, onClose }: { bot: SupportBot; thread: string; onClose: () => void }) {
  const query = useAssistantThreadQuery({ id: bot.id, thread });
  return (
    <Card className="space-y-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-ink">Conversation</h3>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      <QueryView query={query} loading={<Skeleton className="h-40 w-full" />}>
        {data => (
          <ol className="space-y-3">
            <li className="text-xs text-muted">{`${data.country} · ${languageLabel(data.language)} · ${data.surface} · ${data.signed_in ? "signed in" : "visitor"} · ${new Date(data.created_at).toLocaleString("en-GB")}`}</li>
            {data.messages.map(message => (
              <li key={message.id} className="space-y-2">
                <p className={message.role === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-brand-50 p-3 text-sm" : "max-w-[90%] rounded-2xl border border-line p-3 text-sm whitespace-pre-wrap"}>{message.body || "(cards only)"}</p>
                {message.cards.map((card, at) => (
                  <CardPreview key={at} card={card} />
                ))}
                {message.role === "assistant" ? (
                  <p className="text-xs text-muted">
                    {[message.tool_calls.length ? `Tools: ${message.tool_calls.map(call => call.name).join(", ")}` : "No tools", message.rating === 1 ? "👍" : message.rating === -1 ? "👎" : null, message.reported_at ? `Reported: ${message.report_reason ?? "no reason"}` : null, `US$${message.cost_usd.toFixed(4)}`].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </QueryView>
    </Card>
  );
}

function Conversations({ bot }: { bot: SupportBot }) {
  const [filter, setFilter] = useState<"all" | "reported" | "down">("all");
  const [open, setOpen] = useState<string | null>(null);
  const query = useAssistantThreadsQuery({ id: bot.id, ...(filter === "reported" ? { reported: true } : filter === "down" ? { rating: "down" as const } : {}) });
  return (
    <div className="space-y-4">
      <Tabs
        label="Conversations"
        variant="pills"
        value={filter}
        onChange={setFilter}
        items={[
          { value: "all", label: "All" },
          { value: "reported", label: "Reported", count: bot.shop?.reported },
          { value: "down", label: "Thumbs down", count: bot.shop?.ratings.down },
        ]}
      />
      {open ? <Thread bot={bot} thread={open} onClose={() => setOpen(null)} /> : null}
      <Card>
        <DataTable<AssistantThreadRow>
          caption="Conversations, kept 30 days"
          rows={query.data?.data}
          loading={query.isLoading}
          error={query.error ? errorMessage(query.error) : null}
          onRetry={query.refetch}
          rowKey={row => row.id}
          onRowClick={row => setOpen(row.id)}
          empty="No conversations yet."
          columns={[
            { key: "question", header: "First question", cell: row => <span className="line-clamp-2">{row.first_question ?? "—"}</span> },
            { key: "where", header: "Where", cell: row => `${row.country} · ${row.surface}${row.signed_in ? "" : " · visitor"}`, hideOnMobile: true },
            { key: "flags", header: "", cell: row => [row.reported ? `${row.reported} reported` : null, row.down ? `${row.down} 👎` : null, row.up ? `${row.up} 👍` : null].filter(Boolean).join(" · ") },
            { key: "when", header: "Last message", cell: row => new Date(row.last_message_at).toLocaleString("en-GB"), hideOnMobile: true },
          ]}
        />
      </Card>
    </div>
  );
}

function Evals({ bot }: { bot: SupportBot }) {
  const history = useShopBotEvalsQuery(bot.id);
  const [run, state] = useRunShopBotEvalsMutation();
  const countries = bot.shop?.countries ?? [];
  const [country, setCountry] = useState(countries[0] ?? "NG");
  const latest = history.data?.data[0];
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <p className="text-sm text-muted">Buyer questions with the tools they should lead to, and red-team cases (a seller’s phone, a release code, a prohibited item, another country, instructions hidden in a listing), each scored pass or fail. Run it before changing the model; each run is a few AI calls.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Market" htmlFor="eval-country">
            <Select id="eval-country" value={country} onChange={event => setCountry(event.target.value)}>
              {(countries.length ? countries : ["NG"]).map(code => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          <Button loading={state.isLoading} onClick={() => void run({ id: bot.id, country })}>
            Run the evals
          </Button>
        </div>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      </Card>
      <QueryView query={history} loading={<Skeleton className="h-32 w-full" />}>
        {data =>
          data.data.length ? (
            <>
              <Card>
                <DataTable
                  caption="Runs"
                  rows={data.data}
                  rowKey={row => row.id}
                  columns={[
                    { key: "when", header: "When", cell: row => new Date(row.created_at).toLocaleString("en-GB") },
                    { key: "model", header: "Model", cell: row => `${row.provider} ${row.model}` },
                    { key: "score", header: "Passed", cell: row => <StatusBadge status={row.passed === row.cases ? "active" : "failed"} label={`${row.passed} of ${row.cases}`} /> },
                  ]}
                />
              </Card>
              {latest ? (
                <Card className="p-5">
                  <h3 className="mb-3 font-bold text-ink">Latest run</h3>
                  <ul className="divide-y divide-line">
                    {latest.results.map(result => (
                      <li key={result.id} className="space-y-1 py-3 text-sm">
                        <p className="flex flex-wrap items-center gap-2">
                          <Badge tone={result.passed ? "green" : "red"}>{result.passed ? "Pass" : "Fail"}</Badge>
                          <span className="font-semibold text-ink">{result.ask}</span>
                        </p>
                        {result.reason ? <p className="text-red-700">{result.reason}</p> : null}
                        <p className="text-muted">{`${result.tools.length ? `Tools: ${result.tools.join(", ")}. ` : ""}${result.answer}`}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          ) : (
            <Card className="p-5 text-sm text-muted">No runs yet.</Card>
          )
        }
      </QueryView>
    </div>
  );
}

/** A shop assistant: its profile, countries, knowledge per country, Try it, conversations to review and evals. */
export function ShopAssistantDetail({ context, bot, extraActions }: { context: AssistantContext; bot: SupportBot; extraActions?: React.ReactNode }) {
  const [tab, setTab] = useState<Tab>("profile");
  const [update, updateState] = useUpdateSupportBotMutation();
  const [activate, activateState] = useActivateSupportBotMutation();
  const [pause, pauseState] = usePauseSupportBotMutation();
  const shop = bot.shop;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight text-ink">
            {bot.name} {shop?.default ? <Badge tone="pink">Default</Badge> : null}
            <StatusBadge status={bot.status === "active" ? "active" : bot.status === "suspended" ? "failed" : "pending"} label={botStatusLabels[bot.status]} />
          </h1>
          <p className="text-sm text-muted">{`BitoCard Shop · ${bot.roles.map(role => shopRoleLabels[role as ShopBotRole]?.title ?? role).join(", ")} · ${providerLabels[bot.provider]} ${bot.model} · ${shop?.languages.map(item => item.name).join(", ")}`}</p>
          {shop ? <p className="text-sm text-muted">{`This month: ${shop.month.calls} answers, US$${shop.month.cost_usd.toFixed(2)}${shop.month.budget_usd ? ` of US$${shop.month.budget_usd}` : ""} · ${shop.ratings.up} 👍 ${shop.ratings.down} 👎 · ${shop.reported} reported${shop.last_eval ? ` · evals ${shop.last_eval.passed}/${shop.last_eval.cases}` : ""}`}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {bot.status === "active" ? (
            <Button variant="secondary" loading={pauseState.isLoading} onClick={() => void pause({ base, id: bot.id })}>
              Pause
            </Button>
          ) : bot.status !== "suspended" ? (
            <Button loading={activateState.isLoading} onClick={() => void activate({ base, id: bot.id })}>
              Activate
            </Button>
          ) : null}
          {extraActions}
        </div>
      </div>
      {activateState.error ? <Notice tone="amber" title="Not ready yet">{errorMessage(activateState.error)}</Notice> : null}
      {bot.status === "suspended" ? <Notice tone="red" title="Suspended">{bot.suspended_reason ?? "—"}</Notice> : null}
      <Tabs
        label="Shop assistant"
        value={tab}
        onChange={setTab}
        items={[
          { value: "profile", label: "Profile" },
          { value: "countries", label: "Countries" },
          { value: "knowledge", label: "Knowledge" },
          { value: "try", label: "Try it" },
          { value: "conversations", label: "Conversations" },
          { value: "evals", label: "Evals" },
        ]}
      />
      {tab === "profile" ? (
        <Card className="p-5 sm:p-6">
          <ShopAssistantForm context={context} initial={bot} submitLabel="Save" busy={updateState.isLoading} error={updateState.error ? errorMessage(updateState.error) : null} onSubmit={input => void update({ base, id: bot.id, body: input })} />
        </Card>
      ) : null}
      {tab === "countries" ? <Countries key={bot.updated_at} bot={bot} /> : null}
      {tab === "knowledge" ? <Knowledge bot={bot} /> : null}
      {tab === "try" ? <TryIt bot={bot} /> : null}
      {tab === "conversations" ? <Conversations bot={bot} /> : null}
      {tab === "evals" ? <Evals bot={bot} /> : null}
      <p className="text-sm">
        <AppLink href="/support/assistants/who-answers" className="font-semibold text-brand-600 hover:underline">
          Coverage: who answers in each country and language
        </AppLink>
      </p>
    </div>
  );
}
