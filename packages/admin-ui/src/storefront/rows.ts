/**
 * Pure helpers for the rows editor (udozo.com's home pages, later Resale shops'): a page is rows, each with up to six
 * blocks on the 12/6/1-column grid. They mirror Udozo's API (`apps/udozo-api/src/classifieds/home/layout.ts`): at most
 * 20 rows and 40 blocks, every row and block id its own, a row never empty.
 */
import type { SectionSpan } from '@bitocard/api-client/storefront';
import { type GridSection, uniqueId } from './grid';

export type EditorRow<B extends GridSection = GridSection> = {
  id: string;
  hidden: boolean;
  title: string;
  subtitle: string;
  background: string;
  blocks: B[];
} & Record<string, unknown>;

export const maxRows = 20;
export const maxBlocks = 40;
export const maxBlocksPerRow = 6;

/** Where something is: a row, or a block in a row. */
export type RowSelection = { kind: 'row'; id: string } | { kind: 'block'; id: string } | null;

const ids = (rows: EditorRow[]) => rows.flatMap(row => [row.id, ...row.blocks.map(block => block.id)]);
export const blockCount = (rows: EditorRow[]) => rows.reduce((sum, row) => sum + row.blocks.length, 0);

/** Even widths for a row's blocks: one full, two halves, three thirds, four quarters; more keep their own. */
export function evenSpans<B extends GridSection>(blocks: B[]): B[] {
  const lg = ({ 1: 12, 2: 6, 3: 4, 4: 3 } as Record<number, SectionSpan['lg']>)[blocks.length];
  if (!lg) return blocks;
  const md: SectionSpan['md'] = blocks.length === 1 ? 6 : 3;
  return blocks.map(block => ({ ...block, span: { ...block.span, lg, md } }));
}

/** The row and block a block id is in, or null. */
export function findBlock<B extends GridSection>(rows: EditorRow<B>[], id: string) {
  for (const [rowIndex, row] of rows.entries()) {
    const blockIndex = row.blocks.findIndex(block => block.id === id);
    if (blockIndex >= 0) return { row, rowIndex, block: row.blocks[blockIndex]!, blockIndex };
  }
  return null;
}

/** A new row at `at` (the end by default) holding one new block of `type`, full width. */
export function addRow<B extends GridSection>(rows: EditorRow<B>[], type: string, newBlock: (type: string, id: string) => B, at = rows.length, blank: () => Omit<EditorRow<B>, 'id' | 'blocks'>) {
  const rowId = uniqueId(ids(rows as EditorRow[]));
  const blockId = uniqueId([...ids(rows as EditorRow[]), rowId]);
  const row = { ...blank(), id: rowId, blocks: evenSpans([newBlock(type, blockId)]) } as EditorRow<B>;
  const next = rows.slice();
  next.splice(Math.max(0, Math.min(rows.length, at)), 0, row);
  return { rows: next, rowId, blockId };
}

/** A new block of `type` at the end of a row, the row's blocks evened out (up to four). */
export function addBlock<B extends GridSection>(rows: EditorRow<B>[], rowId: string, type: string, newBlock: (type: string, id: string) => B) {
  const id = uniqueId(ids(rows as EditorRow[]));
  return { rows: rows.map(row => (row.id === rowId && row.blocks.length < maxBlocksPerRow ? { ...row, blocks: evenSpans([...row.blocks, newBlock(type, id)]) } : row)), id };
}

export function updateRow<B extends GridSection>(rows: EditorRow<B>[], next: EditorRow<B>) {
  return rows.map(row => (row.id === next.id ? next : row));
}

export function updateBlock<B extends GridSection>(rows: EditorRow<B>[], next: B) {
  return rows.map(row => (row.blocks.some(block => block.id === next.id) ? { ...row, blocks: row.blocks.map(block => (block.id === next.id ? next : block)) } : row));
}

/** Moves a row from one place to another (clamped). */
export function moveRow<B extends GridSection>(rows: EditorRow<B>[], from: number, to: number) {
  if (from < 0 || from >= rows.length) return rows;
  const target = Math.max(0, Math.min(rows.length - 1, to));
  if (target === from) return rows;
  const next = rows.slice();
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item!);
  return next;
}

/**
 * Moves a block to `index` in the row `toRowId` (its own row or another, which then holds at most six); a row left
 * without blocks goes with it, since a row is never empty.
 */
export function moveBlock<B extends GridSection>(rows: EditorRow<B>[], blockId: string, toRowId: string, index: number) {
  const found = findBlock(rows, blockId);
  const target = rows.find(row => row.id === toRowId);
  if (!found || !target) return rows;
  if (target.id !== found.row.id && target.blocks.length >= maxBlocksPerRow) return rows;
  const without = rows.map(row => (row.id === found.row.id ? { ...row, blocks: row.blocks.filter(block => block.id !== blockId) } : row));
  return without
    .map(row => {
      if (row.id !== toRowId) return row;
      const blocks = row.blocks.slice();
      blocks.splice(Math.max(0, Math.min(blocks.length, index)), 0, found.block);
      return { ...row, blocks };
    })
    .filter(row => row.blocks.length > 0);
}

export function duplicateRow<B extends GridSection>(rows: EditorRow<B>[], rowId: string) {
  const index = rows.findIndex(row => row.id === rowId);
  if (index < 0) return { rows, id: null };
  const taken = new Set(ids(rows as EditorRow[]));
  const fresh = () => {
    const id = uniqueId(taken);
    taken.add(id);
    return id;
  };
  const copy = { ...structuredClone(rows[index]!), id: fresh() } as EditorRow<B>;
  copy.blocks = copy.blocks.map(block => ({ ...block, id: fresh() }));
  const next = rows.slice();
  next.splice(index + 1, 0, copy);
  return { rows: next, id: copy.id };
}

export function duplicateBlock<B extends GridSection>(rows: EditorRow<B>[], blockId: string) {
  const found = findBlock(rows, blockId);
  if (!found || found.row.blocks.length >= maxBlocksPerRow) return { rows, id: null };
  const id = uniqueId(ids(rows as EditorRow[]));
  const copy = { ...structuredClone(found.block), id };
  return { rows: rows.map(row => (row.id === found.row.id ? { ...row, blocks: [...row.blocks.slice(0, found.blockIndex + 1), copy, ...row.blocks.slice(found.blockIndex + 1)] } : row)), id };
}

export const removeRow = <B extends GridSection>(rows: EditorRow<B>[], rowId: string) => rows.filter(row => row.id !== rowId);

/** Removes a block; its row goes too when it was the only one. */
export function removeBlock<B extends GridSection>(rows: EditorRow<B>[], blockId: string) {
  return rows.map(row => ({ ...row, blocks: row.blocks.filter(block => block.id !== blockId) })).filter(row => row.blocks.length > 0);
}

export const toggleRowHidden = <B extends GridSection>(rows: EditorRow<B>[], rowId: string) => rows.map(row => (row.id === rowId ? { ...row, hidden: !row.hidden } : row));
export const toggleBlockHidden = <B extends GridSection>(rows: EditorRow<B>[], blockId: string) =>
  rows.map(row => (row.blocks.some(block => block.id === blockId) ? { ...row, blocks: row.blocks.map(block => (block.id === blockId ? { ...block, hidden: !block.hidden } : block)) } : row));

export function setBlockSpan<B extends GridSection>(rows: EditorRow<B>[], blockId: string, breakpoint: 'lg' | 'md', value: number) {
  return rows.map(row => ({ ...row, blocks: row.blocks.map(block => (block.id === blockId ? { ...block, span: { ...block.span, [breakpoint]: value } } : block)) }));
}

/** The row and block a validation error's `param` names (`rows[2].blocks[1].title`), or null. */
export function rowPlaceFromParam(param: string | null | undefined): { row: number; block: number | null } | null {
  const match = /^rows\[(\d+)\](?:\.blocks\[(\d+)\])?/.exec(param ?? '');
  return match ? { row: Number(match[1]), block: match[2] === undefined ? null : Number(match[2]) } : null;
}
