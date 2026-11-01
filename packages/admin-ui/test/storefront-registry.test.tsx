// The home page editor's sections come from a registry: the store sections by default (bitocard.com and resellers'
// stores, unchanged), or a page's own (udozo.com's home pages), whose cards, Add section menu and form it uses instead.
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StickyNote } from 'lucide-react';
import { defineRegistry, HomeEditor, SectionsEditor, type EditorSection, type EditorSources } from '../src/storefront';

afterEach(cleanup);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const sources: EditorSources = { useProductSearch: () => ({ products: [], loading: false }), useBrands: () => ({ brands: [], loading: false }), image: { realm: 'admin', purpose: 'storefront_image' } } as unknown as EditorSources;
const page = <S,>(draft: S[]) => ({ draft, updatedAt: new Date().toISOString(), live: false, version: null, unpublishedChanges: true, versions: [] });
const copy = { publish: 'Publish it.', reset: { label: 'Start again', description: 'From the layout.' }, empty: 'Nothing yet.', notLive: 'Not live.' };
const actions = { saveDraft: vi.fn(async () => undefined), publish: vi.fn(async () => undefined), reset: vi.fn(async () => []), restore: vi.fn(async () => []), preview: vi.fn(async () => 'https://example.test') };

type Note = EditorSection & { type: 'note'; text: string };
const notes = defineRegistry<Note>({
  types: [{ type: 'note', label: 'Note', description: 'A short note.' }],
  newSection: (type, id) => ({ id, type, span: { lg: 12, md: 6, rows: 1 }, hidden: false, text: 'New note' }),
  summary: section => `Says: ${section.text}`,
  title: section => section.text,
  icon: () => StickyNote,
  Form: ({ section, onChange }) => <input aria-label="Note text" value={section.text} onChange={event => onChange({ ...section, text: event.target.value })} />,
});

describe('the section registry', () => {
  test('without one, the editor shows the store sections as before', () => {
    render(
      <HomeEditor
        page={page([{ id: 'h1', type: 'hero', span: { lg: 12, md: 6, rows: 1 }, hidden: false, title: 'Welcome', accent: '', subtitle: '', search: true, categoryChips: true }])}
        allowed={['hero', 'trust_bar']}
        title="Home page"
        description="Store"
        editable
        previewable={false}
        sources={sources}
        copy={copy}
        actions={actions}
      />,
    );
    expect(screen.getByText('1. Hero')).toBeTruthy();
    expect(screen.getByText('Search · category chips')).toBeTruthy();
  });

  test("with a page's own, its cards, Add section menu and form are the page's", () => {
    render(<SectionsEditor<Note> page={page([{ id: 'n1', type: 'note', span: { lg: 12, md: 6, rows: 1 }, hidden: false, text: 'Hello' }])} allowed={['note']} registry={notes} title="Home" description="Udozo" editable previewable={false} sources={sources} copy={copy} actions={actions} />);
    expect(screen.getByText('1. Note')).toBeTruthy();
    expect(screen.getByText('Says: Hello')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hello' }));
    expect((screen.getByLabelText('Note text') as HTMLInputElement).value).toBe('Hello');
    fireEvent.click(screen.getByRole('button', { name: /add section/i }));
    const menu = screen.getByRole('dialog');
    fireEvent.click(within(menu).getByRole('button', { name: /note/i }));
    expect(screen.getByText('2. Note')).toBeTruthy();
    expect(screen.getByText('Says: New note')).toBeTruthy();
  });
});
