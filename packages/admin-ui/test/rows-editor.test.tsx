// The rows editor (udozo.com's home pages): rows of blocks added, moved between rows, evened out and removed (a row is
// never empty); a row's own settings; saving as you go in rows; each block's thumbnail of what it will show; and the
// live preview, told to read the draft again after each save and followed only from its own origin.
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StickyNote } from 'lucide-react';
import { addBlock, addRow, defineRegistry, duplicateRow, evenSpans, moveBlock, removeBlock, rowPlaceFromParam, RowsEditor, type EditorRow, type EditorSection, type EditorSources } from '../src/storefront';

afterEach(cleanup);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

type Note = EditorSection & { type: 'note'; text: string };
const span = { lg: 12 as const, md: 6 as const, rows: 1 as const };
const note = (id: string, text = id): Note => ({ id, type: 'note', span, hidden: false, text });
const row = (id: string, blocks: Note[], title = ''): EditorRow<Note> => ({ id, hidden: false, title, subtitle: '', background: 'none', blocks });
const blank = () => ({ hidden: false, title: '', subtitle: '', background: 'none' });
const make = (type: string, id: string) => note(id, `New ${type}`);

describe('row helpers', () => {
  test('blocks share a row evenly; moving one to another row leaves no empty row; ids stay unique', () => {
    expect(evenSpans([note('a'), note('b'), note('c')]).map(block => block.span.lg)).toEqual([4, 4, 4]);
    let rows = [row('r1', [note('a')]), row('r2', [note('b')])];
    rows = addBlock(rows, 'r1', 'note', make).rows;
    expect(rows[0]!.blocks.map(block => block.span.lg)).toEqual([6, 6]);
    rows = moveBlock(rows, 'b', 'r1', 0);
    expect(rows.map(item => item.blocks.map(block => block.id))).toEqual([['b', 'a', expect.any(String)]]);
    const added = addRow(rows, 'note', make, 0, blank);
    expect(added.rows[0]!.id).toBe(added.rowId);
    const copy = duplicateRow(added.rows, added.rowId);
    const ids = copy.rows.flatMap(item => [item.id, ...item.blocks.map(block => block.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(removeBlock([row('r', [note('only')])], 'only')).toEqual([]);
    expect(rowPlaceFromParam('rows[2].blocks[1].title')).toEqual({ row: 2, block: 1 });
    expect(rowPlaceFromParam('rows[0].image')).toEqual({ row: 0, block: null });
    expect(rowPlaceFromParam('sections[0].title')).toBeNull();
  });
});

const notes = defineRegistry<Note>({
  types: [
    { type: 'note', label: 'Note', description: 'A short note.' },
    { type: 'other', label: 'Other', description: 'Not offered here.' },
  ] as never,
  newSection: make as never,
  summary: section => `Says: ${section.text}`,
  title: section => section.text,
  icon: () => StickyNote,
  Form: ({ section, onChange }) => <input aria-label="Note text" value={section.text} onChange={event => onChange({ ...section, text: event.target.value })} />,
});
const sources = { useProductSearch: () => ({ data: [], isLoading: false, error: null }), useBrands: () => null, image: { realm: 'admin', purpose: 'home_image' } } as unknown as EditorSources;
const copy = { publish: 'Publish it.', reset: { label: 'Start again', description: 'From the layout.' }, empty: 'Nothing yet.', notLive: 'Not live.' };
const RowForm = ({ row: value, onChange }: { row: EditorRow<Note>; onChange: (next: EditorRow<Note>) => void }) => <input aria-label="Row heading" value={value.title} onChange={event => onChange({ ...value, title: event.target.value })} />;
const Thumb = ({ resolved }: { block: Note; resolved: unknown }) => <span>{`Shows ${String((resolved as { count: number }).count)}`}</span>;

function editor(overrides: Partial<{ editable: boolean }> = {}) {
  const actions = {
    saveDraft: vi.fn(async (rows: EditorRow<Note>[]) => void rows),
    publish: vi.fn(async () => undefined),
    reset: vi.fn(async () => [] as EditorRow<Note>[]),
    restore: vi.fn(async () => [] as EditorRow<Note>[]),
    preview: vi.fn(async () => 'https://udozo.test/home-preview?page=ng&token=1.sig'),
    resolve: vi.fn(async (rows: EditorRow<Note>[]) => Object.fromEntries(rows.flatMap(item => item.blocks.map(block => [block.id, { count: block.text.length }])))),
  };
  render(
    <RowsEditor<Note>
      page={{ rows: [row('r1', [note('a', 'Hello')], 'First row'), row('r2', [note('b', 'World')])], updatedAt: new Date().toISOString(), live: false, version: null, unpublishedChanges: true, versions: [] }}
      allowed={['note']}
      registry={notes}
      RowForm={RowForm}
      blankRow={blank}
      Thumb={Thumb}
      title="Home"
      description="Udozo"
      editable={overrides.editable ?? true}
      previewable
      sources={sources}
      copy={copy}
      actions={actions}
    />,
  );
  return actions;
}

describe('the rows editor', () => {
  test('rows with their blocks and thumbnails; a row added; a block moved to another row; saved as rows', async () => {
    const actions = editor();
    const first = screen.getByRole('region', { name: 'First row' });
    expect(within(first).getByRole('button', { name: 'Hello' })).toBeTruthy();
    expect(await within(first).findByText('Shows 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
    const menu = screen.getByRole('dialog');
    expect(within(menu).queryByRole('button', { name: /Other/ })).toBeNull();
    fireEvent.click(within(menu).getByRole('button', { name: /Note/ }));
    // The second row's block moves into the first.
    fireEvent.change(screen.getByLabelText('Row of World'), { target: { value: 'r1' } });
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalled(), { timeout: 3000 });
    const saved = actions.saveDraft.mock.calls.at(-1)![0];
    expect(saved.map(item => item.blocks.map(block => block.text))).toEqual([['Hello', 'World'], ['New note']]);
    expect(saved[0]!.blocks.map(block => block.span.lg)).toEqual([12, 12]);
  });

  test("a row's settings and a block's form open from the canvas", async () => {
    editor();
    fireEvent.click(screen.getByRole('button', { name: 'Settings of First row' }));
    fireEvent.change(screen.getByLabelText('Row heading'), { target: { value: 'Trending' } });
    expect(screen.getByRole('region', { name: 'Trending' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'World' }));
    expect((screen.getByLabelText('Note text') as HTMLInputElement).value).toBe('World');
  });

  test('the live preview shows the saved draft, is told to refresh after a save, and is followed only from its origin', async () => {
    const actions = editor();
    const frame = (await screen.findByTitle('Live preview of the draft')) as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('https://udozo.test/home-preview?page=ng&token=1.sig');
    const posted = vi.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { postMessage: posted }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Hello' }));
    fireEvent.change(screen.getByLabelText('Note text'), { target: { value: 'Hello there' } });
    await waitFor(() => expect(actions.saveDraft).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() => expect(posted).toHaveBeenCalledWith({ source: 'udozo-editor', type: 'refresh' }, 'https://udozo.test'));
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.test', source: frame.contentWindow as Window, data: { source: 'udozo-preview', type: 'select', row: 'r2', block: 'b' } }));
    });
    expect((screen.getByLabelText('Note text') as HTMLInputElement).value).toBe('Hello there');
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://udozo.test', source: frame.contentWindow as Window, data: { source: 'udozo-preview', type: 'select', row: 'r2', block: 'b' } }));
    });
    expect((screen.getByLabelText('Note text') as HTMLInputElement).value).toBe('World');
    expect(posted).toHaveBeenCalledWith({ source: 'udozo-editor', type: 'focus', id: 'b' }, 'https://udozo.test');
  });

  test('view only: no adding, and controls disabled', () => {
    editor({ editable: false });
    expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Delete First row' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
