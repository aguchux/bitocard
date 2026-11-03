"use client";

import { type ComponentType, type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, CloudOff, Copy, Eye, EyeOff, GripVertical, History, Monitor, Plus, RefreshCw, Rocket, RotateCcw, Rows3, Settings2, Smartphone, Tablet, Trash2, type LucideIcon } from "lucide-react";
import { cn, errorMessage, formatDateTime, formatRelative } from "../format";
import { ActionDialog } from "../ui/action-dialog";
import { Dialog, Tabs } from "../ui/data";
import { Button, Card, CardHeader, PageHeader } from "../ui/primitives";
import { Badge, Notice } from "../ui/status";
import { type Breakpoint, type GridSection, lgSpans, mdSpans } from "./grid";
import { type EditorSources, EditorSourcesProvider, Inspector } from "./inspector";
import { registryLabel, SectionIcon, type SectionRegistry, SectionRegistryProvider } from "./registry";
import {
  addBlock,
  addRow,
  blockCount,
  duplicateBlock,
  duplicateRow,
  type EditorRow,
  findBlock,
  maxBlocks,
  maxBlocksPerRow,
  maxRows,
  moveBlock,
  moveRow,
  removeBlock,
  removeRow,
  rowPlaceFromParam,
  type RowSelection,
  setBlockSpan,
  toggleBlockHidden,
  toggleRowHidden,
  updateBlock,
  updateRow,
} from "./rows";

const breakpoints: Array<{ value: Breakpoint; label: string; icon: LucideIcon; width: number }> = [
  { value: "lg", label: "Desktop", icon: Monitor, width: 1280 },
  { value: "md", label: "Tablet", icon: Tablet, width: 768 },
  { value: "sm", label: "Phone", icon: Smartphone, width: 390 },
];
/** A preview link is renewed this long before its 30 minutes run out. */
const previewRenewMs = 25 * 60_000;

export type RowsEditorPage<B extends GridSection> = {
  rows: EditorRow<B>[];
  updatedAt: string;
  live: boolean;
  version: number | null;
  unpublishedChanges: boolean;
  versions: Array<{ version: number; publishedAt: string; note?: string }>;
};

export type RowsEditorProps<B extends GridSection> = {
  page: RowsEditorPage<B>;
  /** The block types this page offers, in the "Add" menu's order. */
  allowed: readonly string[];
  /** The page's blocks: their defaults, cards and forms. */
  registry: SectionRegistry;
  /** A row's own settings (heading, See all, background, width, spacing). */
  RowForm: ComponentType<{ row: EditorRow<B>; onChange: (next: EditorRow<B>) => void }>;
  /** A new row's settings (no blocks yet). */
  blankRow: () => Omit<EditorRow<B>, "id" | "blocks">;
  /** What a block will show, drawn small on its card (from `resolve`); nothing until it is known. */
  Thumb?: ComponentType<{ block: B; resolved: unknown }>;
  title: ReactNode;
  description: ReactNode;
  editable: boolean;
  previewable: boolean;
  sources: EditorSources;
  copy: { publish: string; reset: { label: string; description: string }; empty: string; viewOnly?: string; notLive: string };
  actions: {
    saveDraft: (rows: EditorRow<B>[]) => Promise<unknown>;
    publish: () => Promise<unknown>;
    unpublish?: () => Promise<unknown>;
    reset: () => Promise<EditorRow<B>[]>;
    restore: (version: number) => Promise<EditorRow<B>[]>;
    /** A preview address for the saved draft (shown live beside the rows, and in its own tab). */
    preview: () => Promise<string>;
    /** Each block of these rows filled as visitors would see it, by block id (for the cards' thumbnails). */
    resolve?: (rows: EditorRow<B>[]) => Promise<Record<string, unknown>>;
  };
  children?: ReactNode;
};

type Confirm = "publish" | "unpublish" | "reset" | { restore: number } | { removeRow: string } | { removeBlock: string };

function IconButton({ label, icon: Icon, onClick, disabled, pressed }: { label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={event => {
        event.stopPropagation();
        onClick();
      }}
      className={cn("grid size-8 place-items-center rounded-md text-muted hover:bg-canvas hover:text-ink disabled:opacity-40", pressed && "bg-brand-50 text-brand-600")}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

type BlockActions = {
  select: (selection: RowSelection) => void;
  setSpan: (id: string, breakpoint: "lg" | "md", value: number) => void;
  toggleHidden: (id: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  moveTo: (id: string, rowId: string, index: number) => void;
};

function BlockCard<B extends GridSection>({
  block,
  index,
  row,
  rows,
  breakpoint,
  selected,
  invalid,
  editable,
  registry,
  thumb,
  actions,
}: {
  block: B;
  index: number;
  row: EditorRow<B>;
  rows: EditorRow<B>[];
  breakpoint: Breakpoint;
  selected: boolean;
  invalid: boolean;
  editable: boolean;
  registry: SectionRegistry;
  thumb: ReactNode;
  actions: BlockActions;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, disabled: !editable });
  const title = registry.title(block) || registryLabel(registry, block.type);
  const columns = breakpoint === "lg" ? 12 : breakpoint === "md" ? 6 : 1;
  const span = breakpoint === "sm" ? 1 : Math.min(columns, block.span[breakpoint]);
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition, gridColumn: `span ${span} / span ${span}` };
  const spanBreakpoint = breakpoint === "sm" ? null : breakpoint;
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-block-card={block.id}
      onClick={event => {
        event.stopPropagation();
        actions.select({ kind: "block", id: block.id });
      }}
      className={cn(
        "relative flex min-w-0 flex-col gap-2 rounded-xl border bg-white p-3 shadow-card",
        selected ? "border-brand-500 ring-2 ring-brand-100" : "border-line hover:border-brand-200",
        invalid && "border-red-500 ring-2 ring-red-100",
        block.hidden && "bg-canvas opacity-60",
        isDragging && "z-10 opacity-80 shadow-xl",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {editable ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${title} in its row`}
            onClick={event => event.stopPropagation()}
            className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-subtle hover:bg-canvas hover:text-ink active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600">
          <SectionIcon registry={registry} type={block.type} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold tracking-wide text-subtle uppercase">{registryLabel(registry, block.type)}</p>
          <button type="button" aria-pressed={selected} onClick={() => actions.select({ kind: "block", id: block.id })} className="block max-w-full truncate text-left text-sm font-bold text-ink hover:text-brand-600">
            {title}
          </button>
        </div>
      </div>
      {thumb ? <div className="min-w-0">{thumb}</div> : <p className="line-clamp-2 text-xs text-muted">{registry.summary(block)}</p>}
      <div className="flex flex-wrap gap-1">
        {block.hidden ? <Badge tone="grey">Hidden</Badge> : null}
        {invalid ? <Badge tone="red">Needs fixing</Badge> : null}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-line pt-2" onClick={event => event.stopPropagation()}>
        {spanBreakpoint ? (
          <>
            <label className="sr-only" htmlFor={`width-${block.id}`}>{`Width of ${title} on ${spanBreakpoint === "lg" ? "desktop" : "tablet"}`}</label>
            <select
              id={`width-${block.id}`}
              value={block.span[spanBreakpoint]}
              disabled={!editable}
              onChange={event => actions.setSpan(block.id, spanBreakpoint, Number(event.target.value))}
              className="h-8 cursor-pointer rounded-md border border-line bg-white px-1.5 text-xs font-semibold text-ink focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none disabled:cursor-not-allowed disabled:bg-canvas"
            >
              {(spanBreakpoint === "lg" ? lgSpans : mdSpans).map(value => (
                <option key={value} value={value}>{`${value}/${spanBreakpoint === "lg" ? 12 : 6}`}</option>
              ))}
            </select>
          </>
        ) : null}
        {rows.length > 1 && editable ? (
          <>
            <label className="sr-only" htmlFor={`row-of-${block.id}`}>{`Row of ${title}`}</label>
            <select
              id={`row-of-${block.id}`}
              value={row.id}
              onChange={event => actions.moveTo(block.id, event.target.value, Number.MAX_SAFE_INTEGER)}
              className="h-8 max-w-32 cursor-pointer rounded-md border border-line bg-white px-1.5 text-xs font-semibold text-ink focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            >
              {rows.map((option, n) => (
                <option key={option.id} value={option.id} disabled={option.id !== row.id && option.blocks.length >= maxBlocksPerRow}>{`Row ${n + 1}${option.title ? `: ${option.title}` : ""}`}</option>
              ))}
            </select>
          </>
        ) : null}
        <IconButton label={`Move ${title} left`} icon={ArrowUp} disabled={!editable || index === 0} onClick={() => actions.moveTo(block.id, row.id, index - 1)} />
        <IconButton label={`Move ${title} right`} icon={ArrowDown} disabled={!editable || index === row.blocks.length - 1} onClick={() => actions.moveTo(block.id, row.id, index + 1)} />
        <IconButton label={block.hidden ? `Show ${title}` : `Hide ${title}`} icon={block.hidden ? Eye : EyeOff} disabled={!editable} onClick={() => actions.toggleHidden(block.id)} />
        <IconButton label={`Duplicate ${title}`} icon={Copy} disabled={!editable || row.blocks.length >= maxBlocksPerRow} onClick={() => actions.duplicate(block.id)} />
        <IconButton label={`Delete ${title}`} icon={Trash2} disabled={!editable} onClick={() => actions.remove(block.id)} />
      </div>
    </div>
  );
}

function RowCard<B extends GridSection>({
  row,
  index,
  rows,
  breakpoint,
  selection,
  invalid,
  editable,
  registry,
  thumbs,
  onAddBlock,
  rowActions,
  blockActions,
}: {
  row: EditorRow<B>;
  index: number;
  rows: EditorRow<B>[];
  breakpoint: Breakpoint;
  selection: RowSelection;
  invalid: { row: number; block: number | null } | null;
  editable: boolean;
  registry: SectionRegistry;
  thumbs: (block: B) => ReactNode;
  onAddBlock: (rowId: string) => void;
  rowActions: { move: (from: number, to: number) => void; toggleHidden: (id: string) => void; duplicate: (id: string) => void; remove: (id: string) => void };
  blockActions: BlockActions;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `row:${row.id}`, disabled: !editable });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const label = row.title || `Row ${index + 1}`;
  const selected = selection?.kind === "row" && selection.id === row.id;
  const rowInvalid = invalid?.row === index && invalid.block === null;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = row.blocks.findIndex(block => block.id === over.id);
    if (to >= 0) blockActions.moveTo(String(active.id), row.id, to);
  };
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={label}
      data-row-card={row.id}
      onClick={() => blockActions.select({ kind: "row", id: row.id })}
      className={cn(
        "rounded-2xl border bg-white/70 p-3",
        selected ? "border-brand-500 ring-2 ring-brand-100" : "border-line",
        rowInvalid && "border-red-500 ring-2 ring-red-100",
        row.hidden && "opacity-60",
        isDragging && "z-10 shadow-xl",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {editable ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${label}`}
            onClick={event => event.stopPropagation()}
            className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-subtle hover:bg-canvas hover:text-ink active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-navy-50 text-navy-700">
          <Rows3 className="size-4" aria-hidden />
        </span>
        <button type="button" aria-pressed={selected} onClick={event => (event.stopPropagation(), blockActions.select({ kind: "row", id: row.id }))} className="min-w-0 flex-1 truncate text-left text-sm font-bold text-ink hover:text-brand-600">
          {label}
          <span className="ml-2 text-xs font-normal text-muted">{`${row.blocks.length} of ${maxBlocksPerRow} blocks${row.background !== "none" ? ` · ${row.background} background` : ""}`}</span>
        </button>
        {row.hidden ? <Badge tone="grey">Hidden</Badge> : null}
        <div className="flex items-center gap-0.5" onClick={event => event.stopPropagation()}>
          <IconButton label={`Settings of ${label}`} icon={Settings2} onClick={() => blockActions.select({ kind: "row", id: row.id })} pressed={selected} />
          <IconButton label={`Move ${label} up`} icon={ArrowUp} disabled={!editable || index === 0} onClick={() => rowActions.move(index, index - 1)} />
          <IconButton label={`Move ${label} down`} icon={ArrowDown} disabled={!editable || index === rows.length - 1} onClick={() => rowActions.move(index, index + 1)} />
          <IconButton label={row.hidden ? `Show ${label}` : `Hide ${label}`} icon={row.hidden ? Eye : EyeOff} disabled={!editable} onClick={() => rowActions.toggleHidden(row.id)} />
          <IconButton label={`Duplicate ${label}`} icon={Copy} disabled={!editable} onClick={() => rowActions.duplicate(row.id)} />
          <IconButton label={`Delete ${label}`} icon={Trash2} disabled={!editable} onClick={() => rowActions.remove(row.id)} />
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={row.blocks.map(block => block.id)} strategy={rectSortingStrategy} disabled={!editable}>
          <div className={cn("grid gap-3", breakpoint === "lg" ? "min-w-[36rem] grid-cols-12" : breakpoint === "md" ? "min-w-[26rem] grid-cols-6" : "mx-auto max-w-sm grid-cols-1")}>
            {row.blocks.map((block, n) => (
              <BlockCard
                key={block.id}
                block={block}
                index={n}
                row={row}
                rows={rows}
                breakpoint={breakpoint}
                selected={selection?.kind === "block" && selection.id === block.id}
                invalid={invalid?.row === index && invalid.block === n}
                editable={editable}
                registry={registry}
                thumb={thumbs(block)}
                actions={blockActions}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {editable && row.blocks.length < maxBlocksPerRow ? (
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            onAddBlock(row.id);
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2 text-sm font-semibold text-muted hover:border-brand-300 hover:text-brand-600"
        >
          <Plus className="size-4" aria-hidden />
          {`Add a block to ${label}`}
        </button>
      ) : null}
    </section>
  );
}

/**
 * The live preview: the saved draft as visitors will see it, framed at the chosen screen's width and scaled to fit.
 * After each save the editor tells it to read the draft again (in place, keeping its scroll); a click on a block in it
 * chooses that block here, and choosing one here scrolls the preview to it. Messages go only to, and are taken only
 * from, the preview's own origin.
 */
function LivePreview({ src, breakpoint, version, focus, onSelect, onRenew }: { src: string | null; breakpoint: Breakpoint; version: number; focus: string | null; onSelect: (row: string | null, block: string | null) => void; onRenew: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const width = breakpoints.find(item => item.value === breakpoint)!.width;
  const origin = (() => {
    try {
      return src ? new URL(src).origin : null;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.min(1, (entry?.contentRect.width ?? width) / width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);

  const post = useCallback((message: Record<string, unknown>) => {
    if (origin) frame.current?.contentWindow?.postMessage({ source: "udozo-editor", ...message }, origin);
  }, [origin]);

  useEffect(() => {
    if (version > 0) post({ type: "refresh" });
  }, [version, post]);
  useEffect(() => {
    if (focus) post({ type: "focus", id: focus });
  }, [focus, post]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!origin || event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { source?: unknown; type?: unknown; row?: unknown; block?: unknown } | null;
      if (data?.source !== "udozo-preview" || data.type !== "select") return;
      onSelect(typeof data.row === "string" ? data.row : null, typeof data.block === "string" ? data.block : null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, onSelect]);

  return (
    <Card>
      <CardHeader
        title="Live preview"
        description="The saved draft as visitors will see it. Click a block in it to change it."
        actions={
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" aria-hidden />} onClick={onRenew}>
            Reload
          </Button>
        }
      />
      <div ref={box} className="overflow-hidden px-3 pb-3 sm:px-5 sm:pb-5">
        {src ? (
          <div style={{ height: 760 * scale }} className="overflow-hidden rounded-xl border border-line bg-white">
            <iframe ref={frame} title="Live preview of the draft" src={src} style={{ width, height: 760, transform: `scale(${scale})`, transformOrigin: "0 0" }} className="block border-0" />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">The preview opens once the draft is saved.</p>
        )}
      </div>
    </Card>
  );
}

/**
 * The rows editor (udozo.com's home pages): rows stacked, each a card with its blocks on the 12/6/1-column grid; rows
 * reordered by drag or keyboard, blocks within a row likewise and to another row from their menu; the selected row's
 * settings or block's form beside them; every block showing what it will show (`Thumb`, from `resolve`); the live
 * preview of the saved draft; and saving as you go, publishing, versions, reset and a preview tab.
 */
export function RowsEditor<B extends GridSection>({ page, allowed, registry, RowForm, blankRow, Thumb, title, description, editable, previewable, sources, copy, actions, children }: RowsEditorProps<B>) {
  const [rows, setRows] = useState<EditorRow<B>[]>(page.rows);
  const [selection, setSelection] = useState<RowSelection>(page.rows[0]?.blocks[0] ? { kind: "block", id: page.rows[0].blocks[0].id } : null);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("lg");
  const [edits, setEdits] = useState(0);
  const [savedEdits, setSavedEdits] = useState(0);
  const [failedEdits, setFailedEdits] = useState<number | null>(null);
  const [failure, setFailure] = useState<{ message: string; place: { row: number; block: number | null } | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState<{ rowId: string | null } | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [saves, setSaves] = useState(0);
  const [resolved, setResolved] = useState<Record<string, unknown>>({});
  const dirty = edits !== savedEdits;

  const refreshResolved = useCallback(
    async (current: EditorRow<B>[]) => {
      if (!actions.resolve) return;
      try {
        setResolved(await actions.resolve(current));
      } catch {
        // Thumbnails are a help: the cards fall back to their summary.
      }
    },
    [actions],
  );

  const renewPreview = useCallback(async () => {
    if (!previewable) return;
    try {
      setPreviewSrc(await actions.preview());
      setPreviewError(null);
    } catch (error) {
      setPreviewError(errorMessage(error));
    }
  }, [actions, previewable]);

  useEffect(() => {
    const first = setTimeout(() => {
      void renewPreview();
      void refreshResolved(page.rows);
    }, 0);
    const timer = setInterval(() => void renewPreview(), previewRenewMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
    // Once, when the page opens: later saves refresh both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (content: EditorRow<B>[], at: number) => {
    setSaving(true);
    try {
      await actions.saveDraft(content);
      setSavedEdits(current => Math.max(current, at));
      setFailure(null);
      setFailedEdits(null);
      setSaves(count => count + 1);
      void refreshResolved(content);
      return true;
    } catch (error) {
      setFailedEdits(at);
      setFailure({ message: errorMessage(error), place: rowPlaceFromParam((error as { param?: string } | null)?.param) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editable || !dirty || saving || failedEdits === edits) return;
    const timer = setTimeout(() => void save(rows, edits), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, edits, dirty, saving, failedEdits, editable]);

  const change = (next: EditorRow<B>[]) => {
    setRows(next);
    setEdits(count => count + 1);
  };
  const flush = async () => {
    if (!editable || (!dirty && !saving)) return;
    if (!(await save(rows, edits))) throw new Error("The draft has a problem that stops it saving. Fix the highlighted row or block first.");
  };
  const replace = (next: EditorRow<B>[]) => {
    const count = edits + 1;
    setRows(next);
    setEdits(count);
    setSavedEdits(count);
    setFailure(null);
    setFailedEdits(null);
    setSelection(next[0] ? { kind: "row", id: next[0].id } : null);
    setSaves(value => value + 1);
    void refreshResolved(next);
  };

  const openTab = async () => {
    setPreviewError(null);
    const tab = window.open("about:blank", "_blank");
    try {
      await flush();
      const url = await actions.preview();
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      }
    } catch (error) {
      tab?.close();
      setPreviewError(errorMessage(error));
    }
  };

  const blockActions: BlockActions = {
    select: setSelection,
    setSpan: (id, bp, value) => change(setBlockSpan(rows, id, bp, value)),
    toggleHidden: id => change(toggleBlockHidden(rows, id)),
    duplicate: id => {
      const result = duplicateBlock(rows, id);
      if (result.id) {
        change(result.rows);
        setSelection({ kind: "block", id: result.id });
      }
    },
    remove: id => setConfirm({ removeBlock: id }),
    moveTo: (id, rowId, index) => change(moveBlock(rows, id, rowId, index)),
  };
  const rowActions = {
    move: (from: number, to: number) => change(moveRow(rows, from, to)),
    toggleHidden: (id: string) => change(toggleRowHidden(rows, id)),
    duplicate: (id: string) => {
      const result = duplicateRow(rows, id);
      if (result.id) {
        change(result.rows);
        setSelection({ kind: "row", id: result.id });
      }
    },
    remove: (id: string) => setConfirm({ removeRow: id }),
  };

  const add = (type: string) => {
    if (!adding) return;
    if (adding.rowId) {
      const result = addBlock(rows, adding.rowId, type, registry.newSection as (type: string, id: string) => B);
      change(result.rows);
      setSelection({ kind: "block", id: result.id });
    } else {
      const result = addRow(rows, type, registry.newSection as (type: string, id: string) => B, rows.length, blankRow);
      change(result.rows);
      setSelection({ kind: "block", id: result.blockId });
    }
    setAdding(null);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onRowDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rows.findIndex(row => `row:${row.id}` === active.id);
    const to = rows.findIndex(row => `row:${row.id}` === over.id);
    if (from >= 0 && to >= 0) change(moveRow(rows, from, to));
  };

  const selectedRow = selection?.kind === "row" ? rows.find(row => row.id === selection.id) ?? null : null;
  const selectedBlock = selection?.kind === "block" ? findBlock(rows, selection.id) : null;
  const status = !editable ? "View only" : saving ? "Saving…" : failure ? `Couldn't save: ${failure.message}` : dirty ? "Unsaved changes" : `Saved ${formatRelative(page.updatedAt)}`;
  const offered = registry.types.filter(item => allowed.includes(item.type));
  const total = blockCount(rows as EditorRow[]);
  const removingRow = confirm && typeof confirm === "object" && "removeRow" in confirm ? rows.find(row => row.id === confirm.removeRow) : null;
  const removingBlock = confirm && typeof confirm === "object" && "removeBlock" in confirm ? findBlock(rows, confirm.removeBlock) : null;
  const failedRow = failure?.place ? rows[failure.place.row] : null;
  const focusId = selection?.id ?? null;

  const onPreviewSelect = useCallback((row: string | null, block: string | null) => {
    if (block) setSelection({ kind: "block", id: block });
    else if (row) setSelection({ kind: "row", id: row });
  }, []);

  return (
    <SectionRegistryProvider value={registry}>
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
                <Button variant="secondary" onClick={openTab}>
                  Open preview
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
        {!editable && copy.viewOnly ? <Notice tone="blue">{copy.viewOnly}</Notice> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs variant="pills" label="Screen size" value={breakpoint} onChange={setBreakpoint} items={breakpoints.map(item => ({ value: item.value, label: item.label }))} />
          <div className="flex flex-wrap items-center gap-3">
            <p role="status" className={failure && editable ? "text-sm font-semibold text-red-700" : "text-sm text-muted"}>
              {status}
            </p>
            {editable ? (
              <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding({ rowId: null })} disabled={rows.length >= maxRows || total >= maxBlocks}>
                Add row
              </Button>
            ) : null}
          </div>
        </div>

        {failure && failedRow ? (
          <Notice tone="red" title={`Row ${failure.place!.row + 1}${failure.place!.block !== null ? `, block ${failure.place!.block + 1}` : ""} needs fixing`}>
            <span>{failure.message} </span>
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                const block = failure.place!.block !== null ? failedRow.blocks[failure.place!.block] : null;
                setSelection(block ? { kind: "block", id: block.id } : { kind: "row", id: failedRow.id });
              }}
            >
              Show it
            </button>
          </Notice>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_360px_minmax(0,0.9fr)]">
          <div className="min-w-0 space-y-3 overflow-x-auto rounded-2xl border border-dashed border-line bg-canvas p-3">
            {rows.length ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onRowDragEnd}>
                <SortableContext items={rows.map(row => `row:${row.id}`)} strategy={verticalListSortingStrategy} disabled={!editable}>
                  {rows.map((row, index) => (
                    <RowCard
                      key={row.id}
                      row={row}
                      index={index}
                      rows={rows}
                      breakpoint={breakpoint}
                      selection={selection}
                      invalid={failure?.place ?? null}
                      editable={editable}
                      registry={registry}
                      thumbs={block => (Thumb && block.id in resolved ? <Thumb block={block} resolved={resolved[block.id]} /> : null)}
                      onAddBlock={rowId => setAdding({ rowId })}
                      rowActions={rowActions}
                      blockActions={blockActions}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            ) : (
              <div className="p-8 text-center text-sm text-muted">{copy.empty}</div>
            )}
            <p className="px-1 text-xs text-muted">
              {breakpoint === "sm" ? "On phones every block is full width, row by row." : "Drag a row or block by its handle, or focus the handle and use Space and the arrow keys. Move a block to another row from its row menu."}
            </p>
          </div>
          <div className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
            {selectedRow ? (
              <Card>
                <CardHeader title="Row settings" description={`Row ${rows.indexOf(selectedRow) + 1}${selectedRow.hidden ? " · hidden" : ""}${editable ? "" : " · view only"}`} />
                <fieldset disabled={!editable} className="min-w-0 space-y-4 p-5 sm:px-6">
                  {failure?.place && rows[failure.place.row]?.id === selectedRow.id && failure.place.block === null ? <Notice tone="red" title="This row cannot be saved">{failure.message}</Notice> : null}
                  <RowForm row={selectedRow} onChange={next => change(updateRow(rows, next))} />
                </fieldset>
              </Card>
            ) : (
              <Inspector
                key={selectedBlock?.block.id ?? "none"}
                section={selectedBlock?.block ?? null}
                index={selectedBlock ? selectedBlock.blockIndex : -1}
                error={failure?.place && selectedBlock && failure.place.row === selectedBlock.rowIndex && failure.place.block === selectedBlock.blockIndex ? failure.message : null}
                editable={editable}
                onChange={next => change(updateBlock(rows, next as B))}
              />
            )}
          </div>
          {previewable ? (
            <div className="min-w-0 xl:col-span-2 2xl:col-span-1 2xl:sticky 2xl:top-4 2xl:self-start">
              <LivePreview src={previewSrc} breakpoint={breakpoint} version={saves} focus={focusId} onSelect={onPreviewSelect} onRenew={() => void renewPreview()} />
            </div>
          ) : null}
        </div>

        <Dialog open={Boolean(adding)} onClose={() => setAdding(null)} title={adding?.rowId ? "Add a block to this row" : "Add a row"} description={adding?.rowId ? "Blocks share the row's width evenly; change each one's width on its card." : "The row starts with this block; add more blocks to it, and give it a heading and background in its settings."}>
          <ul className="space-y-2">
            {offered.map(item => (
              <li key={item.type}>
                <button type="button" onClick={() => add(item.type)} className="flex w-full items-start gap-3 rounded-xl border border-line p-3 text-left hover:border-brand-300 hover:bg-brand-50">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                    <SectionIcon registry={registry} type={item.type} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{item.label}</span>
                    <span className="block text-xs text-muted">{item.description}</span>
                  </span>
                </button>
              </li>
            ))}
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
                  {editable ? (
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
          description="Its rows replace your draft. What visitors see does not change until you publish."
          confirmLabel="Restore"
          requireReason={false}
          onConfirm={async () => {
            if (confirm && typeof confirm === "object" && "restore" in confirm) replace(await actions.restore(confirm.restore));
          }}
        />
        <ActionDialog
          open={Boolean(removingRow)}
          onClose={() => setConfirm(null)}
          title={removingRow ? `Delete ${removingRow.title ? `“${removingRow.title}”` : "this row"} and its blocks?` : "Delete row"}
          description="The row and every block in it leave the draft. To keep them without showing them, hide the row instead."
          confirmLabel="Delete row"
          tone="danger"
          requireReason={false}
          onConfirm={async () => {
            if (!removingRow) return;
            change(removeRow(rows, removingRow.id));
            if (selection?.id === removingRow.id || removingRow.blocks.some(block => block.id === selection?.id)) setSelection(null);
          }}
        />
        <ActionDialog
          open={Boolean(removingBlock)}
          onClose={() => setConfirm(null)}
          title={removingBlock ? `Delete “${registry.title(removingBlock.block) || "this block"}”?` : "Delete block"}
          description={removingBlock && removingBlock.row.blocks.length === 1 ? "It is the row's only block, so the row goes too. To keep it without showing it, hide it instead." : "It is removed from the draft. To keep it without showing it, hide it instead."}
          confirmLabel="Delete"
          tone="danger"
          requireReason={false}
          onConfirm={async () => {
            if (!removingBlock) return;
            change(removeBlock(rows, removingBlock.block.id));
            if (selection?.id === removingBlock.block.id) setSelection(null);
          }}
        />
      </EditorSourcesProvider>
    </SectionRegistryProvider>
  );
}
