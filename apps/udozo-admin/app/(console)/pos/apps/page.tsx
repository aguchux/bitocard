"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, errorMessage, Field, Input, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type PosAppPlatform, posAppPlatforms, type PosApps, usePosAppsQuery, useSetPosAppMutation } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";

const platforms: Record<PosAppPlatform, { name: string; store: string; example: string }> = {
  android: { name: "Android", store: "Google Play", example: "https://play.google.com/store/apps/details?id=com.udozo.pos" },
  ios: { name: "iPhone and iPad", store: "the App Store", example: "https://apps.apple.com/ng/app/udozo-pos/id1234567890" },
  windows: { name: "Windows", store: "the Microsoft Store", example: "https://apps.microsoft.com/detail/9NXXXXXXXXXX" },
};

function AppLink({ platform, url, edits }: { platform: PosAppPlatform; url: string | null; edits: boolean }) {
  const words = platforms[platform];
  const [value, setValue] = useState(url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [save, { isLoading }] = useSetPosAppMutation();
  const id = `pos-app-${platform}`;

  const send = async (next: string | null) => {
    setError(null);
    setSaved(false);
    try {
      await save({ platform, url: next }).unwrap();
      if (next === null) setValue("");
      setSaved(true);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <Card>
      <CardHeader title={words.name} description={`Where pos.udozo.com's ${words.name} button goes: the app's page on ${words.store}.`} actions={<Badge tone={url ? "green" : "grey"}>{url ? "Linked" : "Coming soon"}</Badge>} />
      {edits ? (
        <form
          className="grid gap-3"
          onSubmit={event => {
            event.preventDefault();
            const typed = value.trim();
            if (!typed) setError(`Give the app's address on ${words.store}, or Clear the link.`);
            else void send(typed);
          }}
        >
          <Field label="Store address" htmlFor={id} hint={`Like ${words.example}`} error={error ?? undefined}>
            <Input id={id} type="url" value={value} onChange={event => setValue(event.target.value)} placeholder={words.example} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" loading={isLoading}>
              Save link
            </Button>
            {url ? (
              <Button type="button" size="sm" variant="ghost" disabled={isLoading} onClick={() => void send(null)}>
                Clear link
              </Button>
            ) : null}
            {saved ? (
              <span className="text-sm text-green-700" role="status">
                Saved.
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="break-all text-sm text-ink">{url ?? "No link yet: the button says Coming soon."}</p>
      )}
    </Card>
  );
}

/** POS > App links: the store pages pos.udozo.com's download buttons open. Until one is set, its button says Coming soon. */
export default function PosAppsPage() {
  const admin = useAdmin();
  const query = usePosAppsQuery();
  return (
    <UdozoShell section="pos" current="/pos/apps" crumbs={[{ label: "POS", href: "/pos/accounts" }, { label: "App links" }]}>
      <PageHeader title="App links" description="Set each app's store page once it is published. pos.udozo.com never serves an installer: Windows is from the Microsoft Store only." />
      <div className="mt-6">
        <QueryView query={query} loading={<Skeleton className="h-72 w-full" />}>
          {(apps: PosApps) => (
            <div className="grid gap-4">
              {posAppPlatforms.map(platform => (
                <AppLink key={platform} platform={platform} url={apps[platform]} edits={can(admin, "operations")} />
              ))}
            </div>
          )}
        </QueryView>
      </div>
    </UdozoShell>
  );
}
