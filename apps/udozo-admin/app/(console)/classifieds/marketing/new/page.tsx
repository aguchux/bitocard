"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Button, Card, CardHeader, errorMessage, Field, Input, Notice, PageHeader, Select, Textarea } from "@bitocard/admin-ui";
import { useAdmin } from "@bitocard/admin-ui/shell";
import { useCreateMarketingProspectMutation, useInviteByEmailMutation, useMarketingSummaryQuery } from "@bitocard/api-client/admin";
import { MarketSelect } from "@/components/marketing/market";
import { UdozoShell } from "@/components/shell";

/**
 * Marketing > Add or invite: invite anyone by email to sign up and sell on Udozo (an ordinary Udozo account, never the
 * admin), or add a seller by hand to reach on WhatsApp. Both are tracked in the pipeline.
 */
export default function MarketingNewPage() {
  const id = useId();
  const router = useRouter();
  const admin = useAdmin();
  const summary = useMarketingSummaryQuery();
  const owners = summary.data?.owners ?? [];

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [message, setMessage] = useState("");
  const [inviteOwner, setInviteOwner] = useState(admin?.id ?? "");
  const [inviteCountry, setInviteCountry] = useState("NG");
  const [invite, inviting] = useInviteByEmailMutation();
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [phones, setPhones] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [source, setSource] = useState("Jiji");
  const [notes, setNotes] = useState("");
  const [owner, setOwner] = useState("");
  const [country, setCountry] = useState("NG");
  const [create, creating] = useCreateMarketingProspectMutation();
  const [addError, setAddError] = useState<string | null>(null);

  const sendInvite = async (event: FormEvent) => {
    event.preventDefault();
    setInviteError(null);
    try {
      const sent = await invite({ email: inviteEmail.trim(), name: inviteName.trim() || undefined, message: message.trim() || undefined, owner_id: inviteOwner || undefined, country: inviteCountry }).unwrap();
      router.push(`/classifieds/marketing/${sent.id}`);
    } catch (problem) {
      setInviteError(errorMessage(problem));
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setAddError(null);
    try {
      const made = await create({
        name: name.trim(),
        store_name: storeName.trim() || undefined,
        phones: phones.split(/[;,]+/).map(item => item.trim()).filter(Boolean),
        email: email.trim() || undefined,
        categories: category.trim() ? [category.trim()] : undefined,
        location: location.trim() || undefined,
        source: source.trim() || undefined,
        notes: notes.trim() || undefined,
        owner_id: owner || undefined,
        country,
      }).unwrap();
      router.push(`/classifieds/marketing/${made.id}`);
    } catch (problem) {
      setAddError(errorMessage(problem));
    }
  };

  const ownerOptions = (value: string, onChange: (value: string) => void, field: string) => (
    <Select id={field} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">No one yet</option>
      {owners.map(item => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </Select>
  );

  return (
    <UdozoShell section="marketplace" current="/classifieds/marketing" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Marketing", href: "/classifieds/marketing" }, { label: "Add or invite" }]}>
      <PageHeader title="Add or invite a seller" description="Invite anyone by email to sign up and sell on Udozo, or add a seller you will reach on WhatsApp. Their invite link tracks the click and the sign-up." />
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Invite by email" description="They get an invitation from you to create a Udozo account and sell, with their own link. It is a seller's account, never access to this admin." />
          <form onSubmit={sendInvite} className="grid gap-4 p-5 sm:px-6" noValidate>
            {inviteError ? <Notice tone="red">{inviteError}</Notice> : null}
            <Field label="Email" htmlFor={`${id}-invite-email`}>
              <Input id={`${id}-invite-email`} type="email" required value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="seller@example.com" />
            </Field>
            <Field label="Their name (optional)" htmlFor={`${id}-invite-name`}>
              <Input id={`${id}-invite-name`} maxLength={120} value={inviteName} onChange={event => setInviteName(event.target.value)} />
            </Field>
            <Field label="Your message (optional)" htmlFor={`${id}-invite-message`} hint="Leave empty for Udozo's standard invitation. Their link is added at the end.">
              <Textarea id={`${id}-invite-message`} rows={4} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} />
            </Field>
            <Field label="Country" htmlFor={`${id}-invite-country`} hint="Where they sell, to file them under that market.">
              <MarketSelect id={`${id}-invite-country`} value={inviteCountry} onChange={setInviteCountry} />
            </Field>
            <Field label="Who follows them up" htmlFor={`${id}-invite-owner`}>
              {ownerOptions(inviteOwner, setInviteOwner, `${id}-invite-owner`)}
            </Field>
            <Button type="submit" loading={inviting.isLoading} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())}>
              Send the invitation
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader title="Add a seller" description="Someone you found on Jiji or elsewhere. A phone number or an email is needed to reach them." />
          <form onSubmit={add} className="grid gap-4 p-5 sm:grid-cols-2 sm:px-6" noValidate>
            {addError ? (
              <div className="sm:col-span-2">
                <Notice tone="red">{addError}</Notice>
              </div>
            ) : null}
            <Field label="Seller or store name" htmlFor={`${id}-name`}>
              <Input id={`${id}-name`} maxLength={120} value={name} onChange={event => setName(event.target.value)} />
            </Field>
            <Field label="Store name (optional)" htmlFor={`${id}-store`}>
              <Input id={`${id}-store`} maxLength={120} value={storeName} onChange={event => setStoreName(event.target.value)} />
            </Field>
            <Field label="Country" htmlFor={`${id}-country`} hint="Their numbers are read with its dialling code.">
              <MarketSelect id={`${id}-country`} value={country} onChange={setCountry} />
            </Field>
            <Field label="Phone numbers" htmlFor={`${id}-phones`} hint="Separate two with a semicolon.">
              <Input id={`${id}-phones`} inputMode="tel" value={phones} onChange={event => setPhones(event.target.value)} placeholder="0803 123 4567" />
            </Field>
            <Field label="Email (optional)" htmlFor={`${id}-email`}>
              <Input id={`${id}-email`} type="email" value={email} onChange={event => setEmail(event.target.value)} />
            </Field>
            <Field label="Product category" htmlFor={`${id}-category`}>
              <Input id={`${id}-category`} maxLength={80} value={category} onChange={event => setCategory(event.target.value)} placeholder="Mobile Phones" />
            </Field>
            <Field label="Location" htmlFor={`${id}-location`}>
              <Input id={`${id}-location`} maxLength={120} value={location} onChange={event => setLocation(event.target.value)} placeholder="Lagos, Ikeja" />
            </Field>
            <Field label="Found on" htmlFor={`${id}-source`}>
              <Input id={`${id}-source`} maxLength={60} value={source} onChange={event => setSource(event.target.value)} />
            </Field>
            <Field label="Who reaches out" htmlFor={`${id}-owner`}>
              {ownerOptions(owner, setOwner, `${id}-owner`)}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes (optional)" htmlFor={`${id}-notes`}>
                <Textarea id={`${id}-notes`} rows={3} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" loading={creating.isLoading} disabled={name.trim().length < 2 || (!phones.trim() && !email.trim())}>
                Add the seller
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </UdozoShell>
  );
}
