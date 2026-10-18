"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CloudOff, ExternalLink, History, Monitor, Plus, Rocket, RotateCcw, Smartphone, Tablet } from "lucide-react";
import type { StoreSection as Section, StoreSectionType as SectionType } from "@bitocard/api-client/storefront";
import { errorMessage, formatDateTime, formatRelative } from "../format";
import { ActionDialog } from "../ui/action-dialog";
import { Dialog, Tabs } from "../ui/data";
import { Button, PageHeader } from "../ui/primitives";
import { Badge, Notice } from "../ui/status";
import { Canvas, sectionIcons } from "./canvas";
import { addSection, type Breakpoint, cleanForSave, duplicateSection, moveSection, removeSection, sectionIndexFromParam, sectionTitle, sectionTypes, setRows, setSpan, toggleHidden } from "./grid";
import { type EditorSources, EditorSourcesProvider, Inspector } from "./inspector";

const breakpoints: Array<{ value: Breakpoint; label: string; icon: typeof Monitor }> = [
  { value: "lg", label: "Desktop · 12 columns", icon: Monitor },
  { value: "md", label: "Tablet · 6 columns", icon: Tablet },
  { value: "sm", label: "Phone · 1 column", icon: Smartphone },
];

type SaveFailure = { message: string; index: number | null };
type Confirm = "publish" | "unpublish" | "reset" | { restore: number } | { remove: string };

/** What a home page editor works on: the admin app gives bitocard.com's page, SHQ a reseller store's. */
export type HomeEditorPage = {
  /** The draft as loaded. */
  draft: Section[];
  updatedAt: string;
  /** Shoppers see a published version (else the default or the design's starting page). */
  live: boolean;
  version: number | null;
  /** The draft differs from what shoppers see. */
  unpublishedChanges: boolean;
  versions: Array<{ version: number; publishedAt: string; restorable?: boolean; note?: string }>;
};

export type HomeEditorProps = {
  page: HomeEditorPage;
  /** The section types this page offers, in the "Add section" menu's order. */
  allowed: readonly SectionType[];
  title: ReactNode;
  description: ReactNode;
  editable: boolean;
  previewable: boolean;
  sources: EditorSources;
  /** Words for this page: what publishing does, what "reset" starts from. */
  copy: { publish: string; reset: { label: string; description: string }; empty: string; viewOnly?: string; notLive: string };
  actions: {
    saveDraft: (sections: Section[]) => Promise<unknown>;
    publish: () => Promise<unknown>;
    /** Taking the page offline (bitocard.com only). */
    unpublish?: () => Promise<unknown>;
    /** Each returns the new draft. */
    reset: () => Promise<Section[]>;
    restore: (version: number) => Promise<Section[]>;
    /** A preview address for the saved draft. */
    preview: () => Promise<string>;
  };
  /** More above the canvas, for example the store's design choices. */
  children?: ReactNode;
};

/**
 * The home page editor: a local working copy of the draft, saved automatically; the grid canvas (desktop, tablet,
 * phone) with drag and keyboard reordering; the selected section's settings; publish, versions, reset and preview.
 * Shared by bitocard.com's Storefront Manager and resellers' store design in SHQ.
 */
export function HomeEditor({ page, allowed, title, description, editable, previewable, sources, copy, actions, children }: HomeEditorProps) {
  const [sections, setSections] = useState<Section[]>(page.draft);
  const [selectedId, setSelectedId] = useState<string | null>(page.draft[0]?.id ?? null);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("lg");
  // Edits are counted: the draft is saved when the count moves past the last saved one, and a failed save is not
  // retried until the next edit.
  const [edits, setEdits] = useState(0);
  const [savedEdits, setSavedEdits] = useState(0);
  const [failedEdits, setFailedEdits] = useState<number | null>(null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLink, setPreviewLink] = useState<string | null>(null);

  const dirty = edits !== savedEdits;

  const save = async (content: Section[], at: number) => {
    setSaving(true);
    try {
      await actions.saveDraft(cleanForSave(content));
      setSavedEdits(current => Math.max(current, at));
      setFailure(null);
      setFailedEdits(null);
      return true;
    } catch (error) {
      setFailedEdits(at);
      setFailure({ message: errorMessage(error), index: sectionIndexFromParam((error as { param?: string } | null)?.param) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editable || !dirty || saving || failedEdits === edits) return;
    const timer = setTimeout(() => void save(sections, edits), 800);
    return () => clearTimeout(timer);
    // `save` is recreated each render; the inputs below decide when to save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, edits, dirty, saving, failedEdits, editable]);

  const change = (next: Section[]) => {
    setSections(next);
    setEdits(count => count + 1);
  };

  /** Saves any unsaved edits now (before publishing or previewing); throws when the draft cannot be saved. */
  const flush = async () => {
    if (!editable || (!dirty && !saving)) return;
    const ok = await save(sections, edits);
    if (!ok) throw new Error("The draft has a problem that stops it saving. Fix the highlighted section first.");
  };

  /** Replaces the working copy with what the API returned (restore and reset). */
  const replace = (next: Section[]) => {
    const count = edits + 1;
    setSections(next);
    setEdits(count);
    setSavedEdits(count);
    setFailure(null);
    setFailedEdits(null);
    setSelectedId(next[0]?.id ?? null);
  };

  const openPreview = async () => {
    setPreviewError(null);
    setPreviewLink(null);
    setPreviewing(true);
    // Open the tab straight from the click so browsers do not block it, then send it to the preview.
    const tab = window.open("about:blank", "_blank");
    try {
      await flush();
      const url = await actions.preview();
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        setPreviewLink(url);
      }
    } catch (error) {
      tab?.close();
      setPreviewError(errorMessage(error));
    } finally {
      setPreviewing(false);
    }
  };

  const canvasActions = {
    select: setSelectedId,
    move: (from: number, to: number) => change(moveSection(sections, from, to)),
    setSpan: (id: string, bp: "lg" | "md", value: number) => change(setSpan(sections, id, bp, value)),
    setRows: (id: string, rows: number) => change(setRows(sections, id, rows)),
    toggleHidden: (id: string) => change(toggleHidden(sections, id)),
    duplicate: (id: string) => change(duplicateSection(sections, id)),
    remove: (id: string) => setConfirm({ remove: id }),
  };

  const add = (type: SectionType) => {
    const result = addSection(sections, type);
    change(result.sections);
    setSelectedId(result.id);
    setAdding(false);
  };

  const selectedIndex = sections.findIndex(section => section.id === selectedId);
  const selected = selectedIndex >= 0 ? sections[selectedIndex] : null;
  const invalidIndex = failure?.index ?? null;
  const status = !editable ? "View only" : saving ? "Saving…" : failure ? `Couldn't save: ${failure.message}` : dirty ? "Unsaved changes" : `Saved ${formatRelative(page.updatedAt)}`;
  const removing = confirm && typeof confirm === "object" && "remove" in confirm ? sections.find(section => section.id === confirm.remove) : null;
  const offered = sectionTypes.filter(item => allowed.includes(item.type));

  return (
    <EditorSourcesProvider value={sources}>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {title}
            {page.live && page.version ? <Badge tone="green">{`Live v${page.version}`}</Badge> : <Badge tone="grey">Not live</Badge>}
          </span>
        }
        description={description}
        actions={
          <>
            {previewable ? (
              <Button variant="secondary" icon={<ExternalLink className="size-4" aria-hidden />} loading={previewing} onClick={openPreview}>
                Preview
              </Button>
            ) : null}
            <Button variant="ghost" icon={<History className="size-4" aria-hidden />} onClick={() => setVersionsOpen(true)}>
              Versions
            </Button>
            {editable ? (
              <>
                <Button variant="ghost" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setConfirm("reset")}>
                  {copy.reset.label}
                </Button>
                {page.live && actions.unpublish ? (
                  <Button variant="ghost" icon={<CloudOff className="size-4" aria-hidden />} onClick={() => setConfirm("unpublish")}>
                    Take offline
                  </Button>
                ) : null}
                <Button icon={<Rocket className="size-4" aria-hidden />} onClick={() => setConfirm("publish")}>
                  Publish
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {children}

      {page.unpublishedChanges ? (
        <Notice tone="amber" title="Unpublished changes">
          {page.live ? "The draft differs from what visitors see. Publish to put it live." : copy.notLive}
        </Notice>
      ) : null}
      {previewError ? <Notice tone="red">{previewError}</Notice> : null}
      {previewLink ? (
        <Notice tone="blue" title="Your browser blocked the preview tab">
          <a href={previewLink} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            Open the preview
          </a>
          {" (the link works for a short time)."}
        </Notice>
      ) : null}
      {!editable && copy.viewOnly ? <Notice tone="blue">{copy.viewOnly}</Notice> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs variant="pills" label="Screen size" value={breakpoint} onChange={setBreakpoint} items={breakpoints.map(item => ({ value: item.value, label: item.label }))} />
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className={failure && editable ? "text-sm font-semibold text-red-700" : "text-sm text-muted"}>
            {status}
          </p>
          {editable ? (
            <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)} disabled={sections.length >= 40}>
              Add section
            </Button>
          ) : null}
        </div>
      </div>

      {failure && invalidIndex !== null && sections[invalidIndex] ? (
        <Notice tone="red" title={`Section ${invalidIndex + 1} needs fixing`}>
          <span>{failure.message} </span>
          <button type="button" className="font-semibold underline" onClick={() => setSelectedId(sections[invalidIndex].id)}>
            Show it
          </button>
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          {sections.length ? (
            <Canvas sections={sections} breakpoint={breakpoint} selectedId={selectedId} invalidIndex={invalidIndex} editable={editable} actions={canvasActions} />
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-canvas p-8 text-center text-sm text-muted">{copy.empty}</div>
          )}
          <p className="text-xs text-muted">
            {breakpoint === "sm"
              ? "On phones every section is full width, in order."
              : "Sections fill the grid row by row; a two-row section lets shorter ones stack beside it. Drag the handle, or focus it and use Space and the arrow keys, to reorder."}
          </p>
        </div>
        <div className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
          <Inspector
            key={selected?.id ?? "none"}
            section={selected}
            index={selectedIndex}
            error={failure && invalidIndex === selectedIndex ? failure.message : null}
            editable={editable}
            onChange={next => change(sections.map(section => (section.id === next.id ? next : section)))}
          />
        </div>
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add a section" description="It goes at the end of the page; drag it where you want it.">
        <ul className="space-y-2">
          {offered.map(item => {
            const Icon = sectionIcons[item.type];
            return (
              <li key={item.type}>
                <button type="button" onClick={() => add(item.type)} className="flex w-full items-start gap-3 rounded-xl border border-line p-3 text-left hover:border-brand-300 hover:bg-brand-50">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{item.label}</span>
                    <span className="block text-xs text-muted">{item.description}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>

      <Dialog open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Published versions" description="Restoring a version copies it into the draft; publish to put it live.">
        {page.versions.length ? (
          <ul className="divide-y divide-line">
            {page.versions.map(item => (
              <li key={item.version} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span className="text-sm">
                  <span className="flex items-center gap-2 font-semibold">
                    {`Version ${item.version}`}
                    {page.live && item.version === page.version ? <Badge tone="green">Live</Badge> : null}
                  </span>
                  <span className="block text-xs text-muted">{`Published ${formatDateTime(item.publishedAt)}${item.note ? ` · ${item.note}` : ""}`}</span>
                </span>
                {editable && item.restorable !== false ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setVersionsOpen(false);
                      setConfirm({ restore: item.version });
                    }}
                  >
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nothing has been published yet.</p>
        )}
      </Dialog>

      <ActionDialog
        open={confirm === "publish"}
        onClose={() => setConfirm(null)}
        title="Publish the home page?"
        description={copy.publish}
        confirmLabel="Publish"
        requireReason={false}
        onConfirm={async () => {
          await flush();
          await actions.publish();
        }}
      />
      {actions.unpublish ? (
        <ActionDialog
          open={confirm === "unpublish"}
          onClose={() => setConfirm(null)}
          title="Take the home page offline?"
          description="The page stops showing this layout until it is published again. The draft and versions are kept."
          confirmLabel="Take offline"
          tone="danger"
          requireReason={false}
          onConfirm={() => actions.unpublish!()}
        />
      ) : null}
      <ActionDialog
        open={confirm === "reset"}
        onClose={() => setConfirm(null)}
        title={`${copy.reset.label}?`}
        description={copy.reset.description}
        confirmLabel={copy.reset.label}
        tone="danger"
        requireReason={false}
        onConfirm={async () => replace(await actions.reset())}
      />
      <ActionDialog
        open={Boolean(confirm && typeof confirm === "object" && "restore" in confirm)}
        onClose={() => setConfirm(null)}
        title={confirm && typeof confirm === "object" && "restore" in confirm ? `Restore version ${confirm.restore}?` : "Restore version"}
        description="Its layout replaces your draft. What visitors see does not change until you publish."
        confirmLabel="Restore"
        requireReason={false}
        onConfirm={async () => {
          if (confirm && typeof confirm === "object" && "restore" in confirm) replace(await actions.restore(confirm.restore));
        }}
      />
      <ActionDialog
        open={Boolean(removing)}
        onClose={() => setConfirm(null)}
        title={removing ? `Delete “${sectionTitle(removing) || "this section"}”?` : "Delete section"}
        description="It is removed from the draft. To keep it without showing it, hide it instead."
        confirmLabel="Delete"
        tone="danger"
        requireReason={false}
        onConfirm={async () => {
          if (!removing) return;
          change(removeSection(sections, removing.id));
          if (selectedId === removing.id) setSelectedId(null);
        }}
      />
    </EditorSourcesProvider>
  );
}
