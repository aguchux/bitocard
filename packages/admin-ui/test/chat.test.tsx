import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatPanel, type ChatPanelMessage } from '../src';

afterEach(cleanup);

const at = (minute: number) => `2026-10-19T10:${String(minute).padStart(2, '0')}:00.000Z`;
const message = (changes: Partial<ChatPanelMessage>): ChatPanelMessage => ({ id: Math.random().toString(36), author: 'customer', author_name: 'Chidi Okafor', body: 'Hi', attachments: [], created_at: at(0), ...changes });

describe('ChatPanel', () => {
  test('shows each participant’s avatar and name once per run, the staff member by name', () => {
    render(
      <ChatPanel
        side="reseller"
        requesterLabel="Ngozi Eze"
        messages={[
          message({ id: 'a', author_name: null, body: 'Hello' }),
          message({ id: 'b', author_name: null, body: 'Anyone?', created_at: at(1) }),
          message({ id: 'c', author: 'reseller', author_name: 'Ada Obi', body: 'Yes', created_at: at(2) }),
          message({ id: 'd', author: 'system', author_name: null, body: 'Ada Obi joined the chat.', created_at: at(2) }),
        ]}
      />,
    );
    expect(screen.getAllByText('Ngozi Eze')).toHaveLength(1);
    expect(screen.getByText('NE')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('AO')).toBeTruthy();
    expect(screen.getByText(/Ada Obi joined the chat/)).toBeTruthy();
  });

  test('sends with Enter from a compact composer; a chosen file is sent with its caption', async () => {
    const onSend = vi.fn(async () => true);
    const onAttach = vi.fn(async () => true);
    const { container } = render(<ChatPanel side="bitocard" messages={[]} onSend={onSend} onAttach={onAttach} />);
    const box = screen.getByLabelText('Message');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'Hello there' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Hello there'));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['%PDF-1.7'], 'invoice.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });
    await screen.findByText('invoice.pdf');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Here it is' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith(pdf, 'Here it is'));
  });

  test('refuses files a chat does not take', async () => {
    const { container } = render(<ChatPanel side="bitocard" messages={[]} onSend={async () => true} onAttach={async () => true} />);
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/photo \(JPEG or PNG\) or a PDF/);
  });

  test('a PDF in a message opens through the loader', async () => {
    const loadFile = vi.fn(async () => new Blob(['%PDF']));
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    render(<ChatPanel side="bitocard" loadFile={loadFile} messages={[message({ body: '', attachments: [{ id: 'f1', name: 'statement.pdf', content_type: 'application/pdf', size: 2048, width: null, height: null }] })]} />);
    fireEvent.click(screen.getByText('statement.pdf'));
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(loadFile).toHaveBeenCalledWith('f1');
  });
});
