import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DisputeReply, DisputeThread, type DisputeThreadMessage } from '../src';

afterEach(cleanup);

const messages: DisputeThreadMessage[] = [
  { id: '1', author: 'customer', author_name: 'Chi Okafor', visibility: 'all', body: 'The code was already used.', created_at: '2026-10-08T09:00:00.000Z' },
  { id: '2', author: 'reseller', author_name: 'Ada Obi', visibility: 'staff', body: 'Supplier log shows it unused at delivery.', created_at: '2026-10-08T09:30:00.000Z' },
  { id: '3', author: 'system', author_name: null, visibility: 'staff', body: 'Escalated to BitoCard.', created_at: '2026-10-08T10:00:00.000Z' },
  { id: '4', author: 'bitocard', author_name: 'Finance Desk', visibility: 'all', body: 'Refunded in full.', created_at: '2026-10-08T11:00:00.000Z' },
];

describe('DisputeThread', () => {
  test('shows every message with who wrote it, and marks staff notes as never shown to the customer', () => {
    render(<DisputeThread messages={messages} viewer="reseller" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain('Chi Okafor · Customer');
    expect(items[1].textContent).toContain('Ada Obi (you)');
    expect(items[1].textContent).toContain('Staff only: the customer never sees this');
    expect(items[0].textContent).not.toContain('Staff only');
    expect(items[2].textContent).toContain('Update');
    expect(items[3].textContent).toContain('Finance Desk · BitoCard');
  });

  test('admins see their own side as "you"', () => {
    render(<DisputeThread messages={messages} viewer="admin" />);
    expect(screen.getAllByRole('listitem')[3].textContent).toContain('Finance Desk (you)');
  });
});

describe('DisputeReply', () => {
  test('sends a message to everyone, or a staff note when switched; clears after sending', async () => {
    const onSend = vi.fn(async () => true);
    render(<DisputeReply onSend={onSend} />);
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'We are checking.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('We are checking.', 'all'));
    await waitFor(() => expect(box.value).toBe(''));

    fireEvent.click(screen.getByRole('switch'));
    const note = screen.getByLabelText('Staff note') as HTMLTextAreaElement;
    fireEvent.change(note, { target: { value: 'Internal only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenLastCalledWith('Internal only', 'staff'));
  });

  test('without the staff option every message goes to everyone; a failed send keeps the text', async () => {
    const onSend = vi.fn(async () => false);
    render(<DisputeReply onSend={onSend} staffOption={false} />);
    expect(screen.queryByRole('switch')).toBeNull();
    const box = screen.getByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Hello', 'all'));
    expect(box.value).toBe('Hello');
  });
});
