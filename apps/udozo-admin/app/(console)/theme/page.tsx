"use client";

import { useState } from "react";
import { Check, ExternalLink, Rocket, Save } from "lucide-react";
import { Badge, Button, Card, CardHeader, cn, errorMessage, Field, formatDateTime, Input, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { colorFields, hexColor, sameColors, themePreviewUrl, ThemeSwatch } from "@/components/theme";
import {
  type ThemeColorKey,
  type ThemeColors,
  type ThemeSettings,
  usePublishThemeMutation,
  useSaveThemeDraftMutation,
  useThemePreviewMutation,
  useThemeSettingsQuery,
} from "@bitocard/api-client/admin";

function ThemeEditor({ settings, editable }: { settings: ThemeSettings; editable: boolean }) {
  const [colors, setColors] = useState<ThemeColors>(settings.draft.colors);
  const [save, saveState] = useSaveThemeDraftMutation();
  const [preview, previewState] = useThemePreviewMutation();
  const [publish, publishState] = usePublishThemeMutation();
  const [published, setPublished] = useState(false);
  const failure = (saveState.error ?? null) as { param?: string } | null;
  const errorKey = failure?.param?.startsWith("colors.") ? (failure.param.slice("colors.".length) as ThemeColorKey) : null;
  const unsaved = !sameColors(colors, settings.draft.colors);
  const allValid = colorFields.every(({ key }) => hexColor.test(colors[key]));
  const draftIsLive = settings.published !== null && sameColors(settings.draft.colors, settings.published.colors);

  const choosePreset = async (key: string, presetColors: ThemeColors) => {
    setPublished(false);
    setColors(presetColors);
    await save({ preset: key }).unwrap().catch(() => undefined);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Ready-made themes" description="Choosing one saves it as the draft. Nothing changes for shoppers until you publish." />
          <ul className="grid gap-3 px-5 pb-5 sm:grid-cols-2 sm:px-6">
            {settings.presets.map(preset => {
              const chosen = settings.draft.preset === preset.key && !unsaved;
              return (
                <li key={preset.key}>
                  <button
                    type="button"
                    disabled={!editable || saveState.isLoading}
                    aria-pressed={chosen}
                    onClick={() => void choosePreset(preset.key, preset.colors)}
                    className={cn("flex w-full items-center gap-3 rounded-xl border p-3 text-left", chosen ? "border-brand-500 ring-2 ring-brand-500/30" : "border-line hover:border-ink/30")}
                  >
                    <span aria-hidden className="flex shrink-0 overflow-hidden rounded-lg border border-line">
                      {colorFields.map(({ key }) => (
                        <span key={key} className="size-7" style={{ background: preset.colors[key] }} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 font-semibold text-ink">{preset.name}</span>
                    {chosen ? <Check className="size-4 text-brand-600" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Your own colours" description="Each colour is checked for readable contrast when you save: text 4.5 to 1, highlights 3 to 1." />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 sm:px-6">
            {colorFields.map(({ key, label, hint }) => {
              const id = `theme-${key}`;
              const invalid = !hexColor.test(colors[key]);
              const error = invalid ? "Use #rrggbb, such as #070f4c." : errorKey === key ? errorMessage(saveState.error) : undefined;
              return (
                <Field key={key} label={label} htmlFor={id} hint={hint} error={error}>
                  <span className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label={`${label} colour picker`}
                      value={invalid ? "#000000" : colors[key].toLowerCase()}
                      disabled={!editable}
                      onChange={event => {
                        setPublished(false);
                        setColors(current => ({ ...current, [key]: event.target.value }));
                      }}
                      className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1"
                    />
                    <Input
                      id={id}
                      value={colors[key]}
                      disabled={!editable}
                      aria-invalid={Boolean(error)}
                      spellCheck={false}
                      onChange={event => {
                        setPublished(false);
                        setColors(current => ({ ...current, [key]: event.target.value.trim() }));
                      }}
                    />
                  </span>
                </Field>
              );
            })}
          </div>
          {saveState.error && !errorKey ? (
            <div className="px-5 pb-5 sm:px-6">
              <Notice tone="red">{errorMessage(saveState.error)}</Notice>
            </div>
          ) : null}
          {editable ? (
            <div className="flex flex-wrap gap-2 px-5 pb-5 sm:px-6">
              <Button
                icon={<Save className="size-4" aria-hidden />}
                loading={saveState.isLoading}
                disabled={!unsaved || !allValid}
                onClick={async () => {
                  await save({ colors }).unwrap().catch(() => undefined);
                }}
              >
                Save draft
              </Button>
              {unsaved ? (
                <Button variant="ghost" onClick={() => setColors(settings.draft.colors)}>
                  Undo changes
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Preview" description={unsaved ? "Your unsaved colours." : "The saved draft."} />
          <div className="space-y-4 px-5 pb-5 sm:px-6">
            <ThemeSwatch colors={colors} label="Theme preview" />
            {unsaved ? <Notice tone="amber">Save the draft to preview it on udozo.com or publish it.</Notice> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={<ExternalLink className="size-4" aria-hidden />}
                loading={previewState.isLoading}
                disabled={unsaved}
                onClick={async () => {
                  // Opened before the token arrives, so the browser treats it as the click's own window.
                  const opened = window.open("about:blank", "_blank");
                  const result = await preview().unwrap().catch(() => null);
                  if (result && opened) opened.location.href = themePreviewUrl(result.token);
                  else opened?.close();
                }}
              >
                Preview on udozo.com
              </Button>
              {editable ? (
                <Button
                  icon={<Rocket className="size-4" aria-hidden />}
                  loading={publishState.isLoading}
                  disabled={unsaved || draftIsLive}
                  onClick={async () => {
                    await publish()
                      .unwrap()
                      .then(() => setPublished(true))
                      .catch(() => undefined);
                  }}
                >
                  Publish
                </Button>
              ) : null}
            </div>
            {previewState.error ? <Notice tone="red">{errorMessage(previewState.error)}</Notice> : null}
            {publishState.error ? <Notice tone="red">{errorMessage(publishState.error)}</Notice> : null}
            {published ? <Notice tone="green">Published. Every Udozo app and email uses it within a minute.</Notice> : null}
          </div>
        </Card>
        <Card>
          <CardHeader title="Live now" />
          <div className="space-y-3 px-5 pb-5 sm:px-6">
            {settings.published ? (
              <>
                <ThemeSwatch colors={settings.published.colors} label="Live theme" />
                <p className="text-sm text-muted">{`Version ${settings.version}${settings.published_at ? `, published ${formatDateTime(settings.published_at)}` : ""}.`}</p>
              </>
            ) : (
              <p className="text-sm text-muted">Nothing published yet: Udozo&apos;s apps use the default theme (Navy and pink) until you publish one.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Theme: Udozo's colour theme for every app and email, from a ready-made theme or the admins' own colours. */
export default function ThemePage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const settings = useThemeSettingsQuery();
  return (
    <UdozoShell section="theme" current="/theme" crumbs={[{ label: "Theme", href: "/theme" }, { label: "Colour theme" }]}>
      <PageHeader
        title="Colour theme"
        description="The colours of every Udozo app and email. Save a draft, preview it on udozo.com, then publish."
        actions={settings.data ? <Badge tone={settings.data.published ? "green" : "grey"}>{settings.data.published ? `Live: version ${settings.data.version}` : "Not published yet"}</Badge> : undefined}
      />
      {!editable ? <Notice tone="grey">Only operations admins can change the theme.</Notice> : null}
      <QueryView query={settings} message={error => errorMessage(error, "Could not load the theme.")} loading={<Skeleton className="h-96 w-full" />}>
        {data => <ThemeEditor settings={data} editable={editable} />}
      </QueryView>
    </UdozoShell>
  );
}
