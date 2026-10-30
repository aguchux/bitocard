"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Notice, PageHeader, Select, Textarea, errorMessage, ticketCategoryLabels } from "@bitocard/admin-ui";
import { type TicketCategory, type TicketRequester, ticketCategories, useOpenTicketMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NewTicketForm() {
  const id = useId();
  const router = useRouter();
  const [open, state] = useOpenTicketMutation();
  const [requester, setRequester] = useState<TicketRequester>("reseller");
  const [category, setCategory] = useState<TicketCategory>("technical");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const orderOk = !orderId.trim() || uuid.test(orderId.trim());
  const valid = subject.trim().length >= 3 && message.trim().length >= 3 && orderOk;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const created = await open({
      requester,
      category,
      subject: subject.trim(),
      message: message.trim(),
      ...(orderId.trim() ? { order_id: orderId.trim() } : {}),
      ...(requester === "customer" && customerReference.trim() ? { customer_reference: customerReference.trim() } : {}),
    })
      .unwrap()
      .catch(() => null);
    if (created) router.push(`/support/${created.id}`);
  };

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Field label="Who is asking?" htmlFor={`${id}-requester`}>
          <Select id={`${id}-requester`} value={requester} onChange={event => setRequester(event.target.value as TicketRequester)}>
            <option value="reseller">Me: a question for Udozo</option>
            <option value="customer">A customer of mine, on my own systems: I will answer it</option>
          </Select>
        </Field>
        {requester === "reseller" ? (
          <Notice tone="blue">Udozo answers your questions here, and you are told when it replies.</Notice>
        ) : (
          <Notice tone="blue">Track a question from a customer on your own systems. Your store’s customers open their own tickets from their account.</Notice>
        )}
        <Field label="About" htmlFor={`${id}-category`}>
          <Select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value as TicketCategory)}>
            {ticketCategories.map(item => (
              <option key={item} value={item}>
                {ticketCategoryLabels[item]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject" htmlFor={`${id}-subject`}>
          <Input id={`${id}-subject`} maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} />
        </Field>
        <Field label="Your question" htmlFor={`${id}-message`}>
          <Textarea id={`${id}-message`} rows={6} maxLength={5000} value={message} onChange={event => setMessage(event.target.value)} />
        </Field>
        <Field label="Order ID (optional)" htmlFor={`${id}-order`} error={orderOk ? undefined : "That is not an order ID."}>
          <Input id={`${id}-order`} autoComplete="off" value={orderId} onChange={event => setOrderId(event.target.value)} />
        </Field>
        {requester === "customer" ? (
          <Field label="Your customer reference (optional)" htmlFor={`${id}-customer`}>
            <Input id={`${id}-customer`} autoComplete="off" maxLength={200} value={customerReference} onChange={event => setCustomerReference(event.target.value)} />
          </Field>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.push("/support")}>
            Cancel
          </Button>
          <Button type="submit" loading={state.isLoading} disabled={!valid}>
            Open ticket
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function NewTicketPage() {
  const { membership } = useReseller();
  const allowed = can(membership, "admin", "support");
  return (
    <ShqShell section="support" current="/support/new" crumbs={[{ label: "Support", href: "/support" }, { label: "New ticket" }]}>
      <PageHeader title="New ticket" description="Ask Udozo a question, or track one from a customer on your own systems." />
      {allowed ? (
        <NewTicketForm />
      ) : (
        <Notice tone="grey" title="No access to support">
          Only the owner and admin or support members handle support tickets.
        </Notice>
      )}
    </ShqShell>
  );
}
