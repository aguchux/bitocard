// Udozo's own dialog and toasts: the dialog's buttons and their order, and how long toasts stay and how they wait.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dialogButtons, dropToast, infoDialog, queueToast, toastDuration, toastQueueLimit, type Toast } from '../src/lib/feedback.ts';

test('the way out comes first, outlined, then the actions in order, primary unless they say', () => {
  const buttons = dialogButtons({ actions: [{ key: 'sold', label: 'Mark sold' }, { key: 'delete', label: 'Delete', tone: 'danger' }] });
  assert.deepEqual(buttons, [
    { key: null, label: 'Cancel', tone: 'secondary' },
    { key: 'sold', label: 'Mark sold', tone: 'primary' },
    { key: 'delete', label: 'Delete', tone: 'danger' },
  ]);
  assert.equal(dialogButtons({ actions: [], dismiss: 'Keep it' })[0].label, 'Keep it');
});

test('an info dialog has a single OK and no way out besides it', () => {
  const options = infoDialog('Call seller', 'The seller is not on Udozo right now.');
  assert.deepEqual(dialogButtons(options), [{ key: 'ok', label: 'OK', tone: 'primary' }]);
  assert.equal(options.body, 'The seller is not on Udozo right now.');
});

const toast = (id: number, message: string, tone: Toast['tone'] = 'success'): Toast => ({ id, message, tone });

test('toasts stay long enough to read, longer with something to press', () => {
  assert.equal(toastDuration({}), 3500);
  assert.equal(toastDuration({ action: { label: 'Undo', onPress: () => undefined } }), 6000);
});

test('toasts wait their turn, the same words never twice, the oldest waiting one giving way past the limit', () => {
  let queue: Toast[] = [];
  queue = queueToast(queue, toast(1, 'Saved'));
  queue = queueToast(queue, toast(2, 'Saved'));
  assert.deepEqual(queue.map(item => item.id), [1]);
  queue = queueToast(queue, toast(3, 'Saved', 'error'));
  for (let id = 4; id < 4 + toastQueueLimit + 1; id++) queue = queueToast(queue, toast(id, `Message ${id}`));
  assert.equal(queue.length, toastQueueLimit + 1);
  assert.equal(queue[0].id, 1, 'the one showing is never dropped');
  assert.deepEqual(queue.slice(1).map(item => item.id), [5, 6, 7]);
  assert.deepEqual(dropToast(queue, 1).map(item => item.id), [5, 6, 7]);
});
