// Support tickets in rich text: messages drawn with their formatting (never set as HTML), long conversations folded
// to the newest messages with earlier ones a click away, and the rich reply box sending the words with the HTML.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DisputeReply, DisputeThread, type DisputeThreadMessage } from '../src';

afterEach(cleanup);

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute)).toISOString();
const thread: DisputeThreadMessage[] = Array.from({ length: 7 }, (_, index) => ({
  id: String(index + 1),
  author: index % 2 ? 'reseller' : 'customer',
  author_name: index % 2 ? 'Ada Obi' : 'Chi Okafor',
  visibility: 'all',
  body: `Message number ${index + 1}`,
  body_html: index === 6 ? '<p>Open <strong>the order</strong>:</p><ul><li>Reveal</li></ul><p><a href="https://bitocard.com/help">help</a></p>' : null,
  created_at: at(index),
}));

describe('a folded ticket conversation', () => {
  test('shows the newest two in full, the first as a preview, and the rest behind one button', () => {
    render(<DisputeThread fold messages={thread} viewer="reseller" />);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Open the message from Chi Okafor · Customer' })).toBeTruthy();
    const more = screen.getByRole('button', { name: 'Show 4 earlier messages' });
    expect(screen.queryByText('Message number 3')).toBeNull();

    fireEvent.click(more);
    expect(screen.getAllByRole('button', { name: /^Open the message from/ })).toHaveLength(5);
    expect(screen.getByText('Message number 3')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: /^Open the message from/ })[2]);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Fold' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByRole('article')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse earlier messages' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  test('rich messages keep their formatting and safe links, opening in a new tab', () => {
    render(<DisputeThread fold messages={thread} viewer="admin" />);
    const newest = screen.getAllByRole('article').at(-1)!;
    expect(within(newest).getByText('the order').tagName).toBe('STRONG');
    expect(within(newest).getByRole('listitem').textContent).toBe('Reveal');
    const link = within(newest).getByRole('link', { name: 'help' });
    expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual(['https://bitocard.com/help', '_blank', 'noopener noreferrer nofollow ugc']);
  });

  test('a short conversation is shown in full, with no folding controls', () => {
    render(<DisputeThread fold messages={thread.slice(0, 2)} viewer="reseller" />);
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull();
  });
});

describe('the rich reply box', () => {
  test('has a formatting toolbar, and sends the words with the cleaned HTML', async () => {
    const onSend = vi.fn(async () => true);
    render(<DisputeReply rich staffOption={false} onSend={onSend} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Message: formatting' });
    for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Bulleted list', 'Numbered list', 'Quote', 'Code', 'Link', 'Clear formatting']) {
      expect(within(toolbar).getByRole('button', { name })).toBeTruthy();
    }
    const box = screen.getByRole('textbox', { name: 'Message' });
    box.innerHTML = '<div><b>Hello</b> there</div><script>x()</script>';
    fireEvent.input(box);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledWith('Hello there', 'all', '<p><strong>Hello</strong> there</p>'));
    await vi.waitFor(() => expect(box.innerHTML).toBe(''));
  });

  test('a link is added from its own box, and only to a safe address', () => {
    render(<DisputeReply rich staffOption={false} onSend={async () => true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const field = screen.getByLabelText('Link to');
    fireEvent.change(field, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByRole('alert').textContent).toMatch(/web address/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Link to')).toBeNull();
  });
});
