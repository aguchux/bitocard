// Udozo's own dialog and toasts (`FeedbackProvider`): questions resolve with the chosen action or null, toasts show,
// hide by themselves and wait their turn, and both are found by screen readers.
import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { infoDialog, useDialog, useToast, type DialogOptions } from '@/components/feedback';
import { Button, Sheet } from '@/components/ui';

import { renderScreen } from './helpers';

function Asker({ options }: { options: DialogOptions }) {
  const ask = useDialog();
  const [answer, setAnswer] = useState('waiting');
  return (
    <>
      <Button title="Ask" onPress={() => void ask(options).then(key => setAnswer(String(key)))} />
      <Text>{`Answer: ${answer}`}</Text>
    </>
  );
}

const question: DialogOptions = { title: 'Delete this ad?', body: 'It comes off Udozo for good.', actions: [{ key: 'delete', label: 'Delete', tone: 'danger' }] };

test('the dialog shows its title as a header, the way out first, and resolves with the chosen key', async () => {
  await renderScreen(<Asker options={question} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Ask' }));
  expect(screen.getByRole('header', { name: 'Delete this ad?' })).toBeTruthy();
  expect(screen.getByText('It comes off Udozo for good.')).toBeTruthy();
  expect(screen.getByTestId('dialog').props.accessibilityViewIsModal).toBe(true);
  const labels = screen.getAllByRole('button').map(button => button.props.accessibilityLabel);
  expect(labels.indexOf('Cancel')).toBeLessThan(labels.indexOf('Delete'));
  await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Answer: delete')).toBeTruthy();
  expect(screen.queryByTestId('dialog')).toBeNull();
});

test('Cancel, the backdrop and Back each resolve null', async () => {
  await renderScreen(<Asker options={question} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Ask' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByText('Answer: null')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Ask' }));
  await fireEvent.press(screen.getByTestId('dialog-backdrop', { includeHiddenElements: true }));
  expect(screen.queryByTestId('dialog')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Ask' }));
  // Android's Back is the modal's onRequestClose.
  const modal = screen.getByTestId('dialog-modal', { includeHiddenElements: true });
  await act(async () => modal.props.onRequestClose());
  expect(screen.queryByTestId('dialog')).toBeNull();
  expect(screen.getByText('Answer: null')).toBeTruthy();
});

test('an info dialog offers a single OK', async () => {
  await renderScreen(<Asker options={infoDialog('Call seller', 'The seller is not on Udozo right now.')} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Ask' }));
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'OK' }));
  expect(await screen.findByText('Answer: ok')).toBeTruthy();
});

function Toaster({ inSheet }: { inSheet?: boolean }) {
  const show = useToast();
  const [undone, setUndone] = useState(false);
  const buttons = (
    <>
      <Button title="Save" onPress={() => show({ message: 'Saved', tone: 'success' })} />
      <Button title="Fail" onPress={() => show({ message: 'That did not work', tone: 'error' })} />
      <Button title="Undoable" onPress={() => show({ message: 'Removed', action: { label: 'Undo', onPress: () => setUndone(true) } })} />
      <Text>{undone ? 'Undone' : 'Not undone'}</Text>
    </>
  );
  return inSheet ? (
    <Sheet visible title="A sheet" onClose={() => undefined}>
      {buttons}
    </Sheet>
  ) : (
    buttons
  );
}

describe('toasts', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('show as a polite alert, hide by themselves, and wait their turn', async () => {
    await renderScreen(<Toaster />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Fail' }));
    const toast = screen.getByRole('alert', { name: 'Saved' });
    expect(toast.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.queryByText('That did not work')).toBeNull();
    await act(async () => jest.advanceTimersByTime(3600));
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByRole('alert', { name: 'That did not work' })).toBeTruthy();
    // Tapped, it goes at once.
    await fireEvent.press(screen.getByTestId('toast'));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  test('stay longer with an action, which runs and closes the toast', async () => {
    await renderScreen(<Toaster />);
    await fireEvent.press(screen.getByRole('button', { name: 'Undoable' }));
    await act(async () => jest.advanceTimersByTime(4000));
    expect(screen.getByText('Removed')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Undone')).toBeTruthy();
    expect(screen.queryByText('Removed')).toBeNull();
  });

  test('a toast shown from an open sheet draws inside it, once', async () => {
    await renderScreen(<Toaster inSheet />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getAllByTestId('toast')).toHaveLength(1);
    // The sheet's host is the newest, so the toast is in the sheet's window.
    let node: { props: Record<string, unknown>; parent: unknown } | null = screen.getByTestId('toast') as never;
    while (node && node.props.testID !== 'sheet') node = node.parent as typeof node;
    expect(node).not.toBeNull();
  });
});
