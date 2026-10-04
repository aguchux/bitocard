"use client";

import type { CSSProperties } from "react";
import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Award, Copy, Eye, EyeOff, GripVertical, LayoutPanelTop, Megaphone, Rows2, ShieldCheck, ShoppingBag, Trash2, Grid2x2, type LucideIcon } from "lucide-react";
import { Badge, cn } from "@bitocard/admin-ui";
import { type Breakpoint, gridPlacement, lgSpans, mdSpans, sectionSummary, sectionTitle, sectionTypeLabel } from "@bitocard/admin-ui/storefront";
import type { Section, SectionType } from "@bitocard/api-client/storefront";

export const sectionIcons: Record<SectionType, LucideIcon> = {
  hero: LayoutPanelTop,
  product_rail: ShoppingBag,
  category_grid: Grid2x2,
  brand_grid: Award,
  promo: Megaphone,
  trust_bar: ShieldCheck,
};

export type CanvasActions = {
  select: (id: string) => void;
  move: (from: number, to: number) => void;
  setSpan: (id: string, breakpoint: "lg" | "md", value: number) => void;
  setRows: (id: string, rows: number) => void;
  toggleHidden: (id: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
};

const gridClass: Record<Breakpoint, string> = {
  // Desktop and tablet keep their real proportions on narrow screens by scrolling inside the canvas, never the page.
  lg: "grid-cols-12 min-w-[36rem]",
  md: "grid-cols-6 min-w-[26rem]",
  sm: "grid-cols-1 max-w-sm mx-auto",
};

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

function SectionCard({
  section,
  index,
  count,
  colSpan,
  rowSpan,
  breakpoint,
  selected,
  invalid,
  editable,
  actions,
}: {
  section: Section;
  index: number;
  count: number;
  colSpan: number;
  rowSpan: number;
  breakpoint: Breakpoint;
  selected: boolean;
  invalid: boolean;
  editable: boolean;
  actions: CanvasActions;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled: !editable });
  const Icon = sectionIcons[section.type];
  const title = sectionTitle(section) || "Untitled";
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    gridColumn: `span ${colSpan} / span ${colSpan}`,
    gridRow: rowSpan === 2 ? "span 2 / span 2" : undefined,
  };
  const spanBreakpoint = breakpoint === "sm" ? null : breakpoint;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => actions.select(section.id)}
      className={cn(
        "relative flex min-w-0 flex-col gap-2 rounded-xl border bg-white p-3 shadow-card transition-shadow",
        rowSpan === 2 && "min-h-56",
        selected ? "border-brand-500 ring-2 ring-brand-100" : "border-line hover:border-brand-200",
        invalid && "border-red-500 ring-2 ring-red-100",
        section.hidden && "bg-canvas opacity-60",
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
            aria-label={`Drag to reorder ${title}`}
            onClick={event => event.stopPropagation()}
            className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-subtle hover:bg-canvas hover:text-ink active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        ) : null}
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-600">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-subtle">{`${index + 1}. ${sectionTypeLabel(section.type)}`}</p>
          <button type="button" onClick={() => actions.select(section.id)} aria-pressed={selected} className="block max-w-full truncate text-left text-sm font-bold text-ink hover:text-brand-600">
            {title}
          </button>
        </div>
      </div>
      <p className="line-clamp-2 text-xs text-muted">{sectionSummary(section)}</p>
      <div className="flex flex-wrap gap-1">
        {section.hidden ? <Badge tone="grey">Hidden</Badge> : null}
        {invalid ? <Badge tone="red">Needs fixing</Badge> : null}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-line pt-2" onClick={event => event.stopPropagation()}>
        {spanBreakpoint ? (
          <>
            <label className="sr-only" htmlFor={`width-${section.id}`}>{`Width of ${title} on ${spanBreakpoint === "lg" ? "desktop" : "tablet"}`}</label>
            <select
              id={`width-${section.id}`}
              value={section.span[spanBreakpoint]}
              disabled={!editable}
              onChange={event => actions.setSpan(section.id, spanBreakpoint, Number(event.target.value))}
              className="h-8 cursor-pointer rounded-md border border-line bg-white px-1.5 text-xs font-semibold text-ink focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none disabled:cursor-not-allowed disabled:bg-canvas"
            >
              {(spanBreakpoint === "lg" ? lgSpans : mdSpans).map(value => (
                <option key={value} value={value}>
                  {`${value}/${spanBreakpoint === "lg" ? 12 : 6}`}
                </option>
              ))}
            </select>
            <IconButton
              label={section.span.rows === 2 ? `${title}: two rows tall (make one row)` : `${title}: one row tall (make two rows)`}
              icon={Rows2}
              pressed={section.span.rows === 2}
              disabled={!editable}
              onClick={() => actions.setRows(section.id, section.span.rows === 2 ? 1 : 2)}
            />
          </>
        ) : null}
        <IconButton label={section.hidden ? `Show ${title}` : `Hide ${title}`} icon={section.hidden ? Eye : EyeOff} disabled={!editable} onClick={() => actions.toggleHidden(section.id)} />
        <IconButton label={`Move ${title} up`} icon={ArrowUp} disabled={!editable || index === 0} onClick={() => actions.move(index, index - 1)} />
        <IconButton label={`Move ${title} down`} icon={ArrowDown} disabled={!editable || index === count - 1} onClick={() => actions.move(index, index + 1)} />
        <IconButton label={`Duplicate ${title}`} icon={Copy} disabled={!editable} onClick={() => actions.duplicate(section.id)} />
        <IconButton label={`Delete ${title}`} icon={Trash2} disabled={!editable} onClick={() => actions.remove(section.id)} />
      </div>
    </div>
  );
}

/** The editor's grid: every section as a card, sized for the chosen breakpoint, reordered by drag or keyboard. */
export function Canvas({
  sections,
  breakpoint,
  selectedId,
  invalidIndex,
  editable,
  actions,
}: {
  sections: Section[];
  breakpoint: Breakpoint;
  selectedId: string | null;
  invalidIndex: number | null;
  editable: boolean;
  actions: CanvasActions;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const placements = gridPlacement(sections, breakpoint, { includeHidden: true });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = sections.findIndex(section => section.id === active.id);
    const to = sections.findIndex(section => section.id === over.id);
    if (from >= 0 && to >= 0) actions.move(from, to);
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-dashed border-line bg-canvas p-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sections.map(section => section.id)} strategy={rectSortingStrategy} disabled={!editable}>
          <div className={cn("grid grid-flow-row-dense gap-3", gridClass[breakpoint])}>
            {placements.map(placement => (
              <SectionCard
                key={placement.id}
                section={sections[placement.index]}
                index={placement.index}
                count={sections.length}
                colSpan={placement.colSpan}
                rowSpan={placement.rowSpan}
                breakpoint={breakpoint}
                selected={selectedId === placement.id}
                invalid={invalidIndex === placement.index}
                editable={editable}
                actions={actions}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
