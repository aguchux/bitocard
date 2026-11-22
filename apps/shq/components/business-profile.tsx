"use client";

import { useState, type FormEvent } from "react";
import { Building2, UserRound } from "lucide-react";
import { Button, Card, CardHeader, ErrorState, errorMessage, Field, Input, KeyValue, Notice, Skeleton, Textarea } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { type BusinessProfile, useBusinessProfileQuery, useUpdateBusinessProfileMutation } from "@bitocard/api-client/reseller";

type Draft = Record<"legal_name" | "address_line" | "city" | "state" | "postal_code" | "phone" | "description", string>;

const draftOf = (profile: BusinessProfile): Draft => ({
  legal_name: profile.legal_name ?? "",
  address_line: profile.address_line ?? "",
  city: profile.city ?? "",
  state: profile.state ?? "",
  postal_code: profile.postal_code ?? "",
  phone: profile.phone ?? "",
  description: profile.description ?? "",
});

/** Only the fields that changed, trimmed (an empty one clears it). */
export function changedFields(before: Draft, after: Draft): Partial<Draft> {
  const changed: Partial<Draft> = {};
  for (const key of Object.keys(after) as (keyof Draft)[]) if (after[key].trim() !== before[key].trim()) changed[key] = after[key].trim();
  return changed;
}

/** How the account sells, with a link to change it on the identity check. */
function AccountTypeLine({ profile }: { profile: BusinessProfile }) {
  const business = profile.account_type === "business";
  const Icon = business ? Building2 : UserRound;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-canvas p-4 text-sm">
      <Icon className="size-5 text-brand-600" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-ink">{business ? "You sell as a business" : "You sell as an individual"}</span>
        <span className="block text-muted">
          {business
            ? profile.business_verified
              ? "Your registered business is verified."
              : "Your business still needs its check before it can sell live."
            : "Selling as a registered business? Switch to a business account and verify it."}
        </span>
      </span>
      <AppLink href="/settings/verification" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
        {business ? "Identity check" : "Switch to business"}
      </AppLink>
    </div>
  );
}

function ProfileForm({ profile, manage }: { profile: BusinessProfile; manage: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile));
  const [saved, setSaved] = useState(false);
  const [update, state] = useUpdateBusinessProfileMutation();
  const changes = changedFields(draftOf(profile), draft);
  const field = (key: keyof Draft) => ({
    value: draft[key],
    disabled: !manage,
    onChange: (event: { target: { value: string } }) => {
      setSaved(false);
      setDraft(current => ({ ...current, [key]: event.target.value }));
    },
  });
  const error = state.error && "data" in state.error ? (state.error.data as { error?: { param?: string; message?: string } })?.error : undefined;
  const fieldError = (key: keyof Draft) => (error?.param === key ? error.message : undefined);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const done = await update(changes)
      .unwrap()
      .catch(() => null);
    if (done) {
      setDraft(draftOf(done));
      setSaved(true);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      {state.error && !error?.param ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      {saved ? <Notice tone="green">Business profile saved.</Notice> : null}
      <Field label="Legal name" htmlFor="profile-legal-name" hint="As registered, if your business is registered." error={fieldError("legal_name")}>
        <Input id="profile-legal-name" maxLength={200} autoComplete="organization" {...field("legal_name")} />
      </Field>
      <Field label="Address" htmlFor="profile-address" error={fieldError("address_line")}>
        <Input id="profile-address" maxLength={200} autoComplete="street-address" {...field("address_line")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="City" htmlFor="profile-city" error={fieldError("city")}>
          <Input id="profile-city" maxLength={80} autoComplete="address-level2" {...field("city")} />
        </Field>
        <Field label="State" htmlFor="profile-state" error={fieldError("state")}>
          <Input id="profile-state" maxLength={80} autoComplete="address-level1" {...field("state")} />
        </Field>
        <Field label="Postal code" htmlFor="profile-postal" hint="Optional." error={fieldError("postal_code")}>
          <Input id="profile-postal" maxLength={20} autoComplete="postal-code" {...field("postal_code")} />
        </Field>
      </div>
      <Field label="Telephone" htmlFor="profile-phone" hint="Where customers and BitoCard can call the business. No code is sent." error={fieldError("phone")}>
        <Input id="profile-phone" type="tel" maxLength={25} autoComplete="tel" placeholder="+234 803 123 4567" {...field("phone")} />
      </Field>
      <Field label="What the business does" htmlFor="profile-description" hint={`${draft.description.length} of 1,000 characters.`} error={fieldError("description")}>
        <Textarea id="profile-description" rows={4} maxLength={1000} {...field("description")} />
      </Field>
      {manage ? (
        <Button type="submit" loading={state.isLoading} disabled={Object.keys(changes).length === 0}>
          Save profile
        </Button>
      ) : null}
    </form>
  );
}

/** The business profile: the legal name, address, telephone and description, and how the account sells. */
export function BusinessProfileCard({ manage }: { manage: boolean }) {
  const profile = useBusinessProfileQuery();
  return (
    <Card>
      <CardHeader title="Business profile" description={manage ? "Shown to BitoCard and prefilled into your business check." : "Only the owner or an admin can change these."} />
      <div className="space-y-6 p-5 sm:p-6">
        {profile.data ? (
          <>
            <AccountTypeLine profile={profile.data} />
            <ProfileForm key={profile.data.account_type} profile={profile.data} manage={manage} />
            {profile.data.verified_business ? (
              <KeyValue
                items={[
                  {
                    label: "Verified registered name",
                    value: profile.data.verified_business.registered_name ?? "—",
                  },
                  {
                    label: "Registration number",
                    value: profile.data.verified_business.registration_number ?? "—",
                  },
                  {
                    label: "Verified address",
                    value: profile.data.verified_business.business_address ?? "—",
                  },
                ]}
              />
            ) : null}
          </>
        ) : profile.error ? (
          <ErrorState message={errorMessage(profile.error, "Could not load your business profile.")} onRetry={profile.refetch} />
        ) : (
          <Skeleton className="h-72 w-full" />
        )}
      </div>
    </Card>
  );
}
