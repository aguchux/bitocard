"use client";

import { Suspense, useId, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Field, Input, Notice, PageHeader, Select, Skeleton, Textarea, disputeTopicLabels, errorMessage } from "@bitocard/admin-ui";
import { type DisputeTopic, useOpenDisputeMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const topics: Record<"customer" | "reseller", DisputeTopic[]> = {
  customer: ["order", "payment", "trade", "other"],
  reseller: ["funding", "order", "payment", "other"],
};

function NewDisputeForm() {
  const id = useId();
  const router = useRouter();
  const search = useSearchParams();
  const [open, state] = useOpenDisputeMutation();
  const [kind, setKind] = useState<"customer" | "reseller">(search.get("kind") === "reseller" ? "reseller" : "customer");
  const [topic, setTopic] = useState<DisputeTopic>(kind === "reseller" ? "funding" : "order");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState(search.get("order") ?? "");
  const [topUpId, setTopUpId] = useState(search.get("top_up") ?? "");
  const [customerReference, setCustomerReference] = useState("");
  const orderOk = !orderId.trim() || uuid.test(orderId.trim());
  const topUpOk = !topUpId.trim() || uuid.test(topUpId.trim());
  const valid = subject.trim().length >= 3 && message.trim().length >= 3 && orderOk && topUpOk;

  const changeKind = (value: "customer" | "reseller") => {
    setKind(value);
    setTopic(topics[value][0]);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const created = await open({
      kind,
      topic,
      subject: subject.trim(),
      message: message.trim(),
      ...(orderId.trim() ? { order_id: orderId.trim() } : {}),
      ...(kind === "reseller" && topUpId.trim() ? { top_up_id: topUpId.trim() } : {}),
      ...(kind === "customer" && customerReference.trim() ? { customer_reference: customerReference.trim() } : {}),
    })
      .unwrap()
      .catch(() => null);
    if (created) router.push(`/disputes/${created.id}`);
  };

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Whose dispute?" htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} value={kind} onChange={event => changeKind(event.target.value as "customer" | "reseller")}>
            <option value="customer">A customer&apos;s: I will investigate it</option>
            <option value="reseller">Mine, with BitoCard: BitoCard decides it</option>
          </Select>
        </Field>
        {kind === "reseller" ? (
          <Notice tone="blue">Your own disputes go straight to BitoCard, for example a top-up that was paid but not credited.</Notice>
        ) : (
          <Notice tone="blue">Log a complaint from a customer on your own systems. Disputes your store&apos;s customers raise appear here by themselves.</Notice>
        )}
        <Field label="About" htmlFor={`${id}-topic`}>
          <Select id={`${id}-topic`} value={topic} onChange={event => setTopic(event.target.value as DisputeTopic)}>
            {topics[kind].map(item => (
              <option key={item} value={item}>
                {disputeTopicLabels[item]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject" htmlFor={`${id}-subject`}>
          <Input id={`${id}-subject`} maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} />
        </Field>
        <Field label="What happened" htmlFor={`${id}-message`}>
          <Textarea id={`${id}-message`} rows={5} maxLength={5000} value={message} onChange={event => setMessage(event.target.value)} />
        </Field>
        <Field label="Order ID (optional)" htmlFor={`${id}-order`} error={orderOk ? undefined : "That is not an order ID."}>
          <Input id={`${id}-order`} autoComplete="off" value={orderId} onChange={event => setOrderId(event.target.value)} />
        </Field>
        {kind === "reseller" ? (
          <Field label="Top-up ID (optional)" htmlFor={`${id}-topup`} error={topUpOk ? undefined : "That is not a top-up ID."}>
            <Input id={`${id}-topup`} autoComplete="off" value={topUpId} onChange={event => setTopUpId(event.target.value)} />
          </Field>
        ) : (
          <Field label="Your customer reference (optional)" htmlFor={`${id}-customer`}>
            <Input id={`${id}-customer`} autoComplete="off" maxLength={200} value={customerReference} onChange={event => setCustomerReference(event.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.push("/disputes")}>
            Cancel
          </Button>
          <Button type="submit" loading={state.isLoading} disabled={!valid}>
            Open dispute
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function NewDisputePage() {
  const { membership } = useReseller();
  const allowed = can(membership, "admin", "support", "finance");
  return (
    <ShqShell section="orders" current="/disputes" crumbs={[{ label: "Orders", href: "/orders" }, { label: "Disputes", href: "/disputes" }, { label: "New dispute" }]}>
      <PageHeader title="New dispute" description="Log a customer’s dispute to investigate, or open your own dispute with BitoCard." />
      {allowed ? (
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <NewDisputeForm />
        </Suspense>
      ) : (
        <Notice tone="grey" title="No access to disputes">
          Only the owner and admin, support or finance members handle disputes.
        </Notice>
      )}
    </ShqShell>
  );
}
