/**
 * The rules behind Udozo's own dialog and toasts (`src/components/feedback.tsx`), never the phone's alerts: which
 * buttons a dialog shows and in what order, how long a toast stays, and how toasts wait their turn. Kept free of React
 * Native so it runs under `node --test`.
 */

export type DialogTone = 'primary' | 'secondary' | 'danger' | 'money';
export type DialogAction = { key: string; label: string; tone?: DialogTone };
export type DialogOptions = {
  title: string;
  body?: string;
  actions: DialogAction[];
  /** The way out, "Keep it" or "Not now"; "Cancel" by default. `false` leaves it out (an info dialog's single OK). */
  dismiss?: string | false;
};
/** A button the dialog draws: `key` null is the way out, which resolves the question with null. */
export type DialogButton = { key: string | null; label: string; tone: DialogTone };

/**
 * The dialog's buttons, as udozo.com's `useConfirm` has them: the way out first (the safe choice, read first by screen
 * readers), then the actions in the caller's order; the way out is outlined, an action primary unless it says.
 */
export function dialogButtons(options: Pick<DialogOptions, 'actions' | 'dismiss'>): DialogButton[] {
  const actions = options.actions.map(action => ({ key: action.key, label: action.label, tone: action.tone ?? ('primary' as DialogTone) }));
  if (options.dismiss === false) return actions;
  return [{ key: null, label: options.dismiss ?? 'Cancel', tone: 'secondary' }, ...actions];
}

/** An info dialog: what happened, with a single OK (or the caller's word for it). */
export function infoDialog(title: string, body?: string, ok = 'OK'): DialogOptions {
  return { title, body, actions: [{ key: 'ok', label: ok }], dismiss: false };
}

export type ToastTone = 'success' | 'error' | 'info';
export type ToastInput = { message: string; tone?: ToastTone; action?: { label: string; onPress: () => void } };
export type Toast = ToastInput & { id: number; tone: ToastTone };

/** How long a toast stays: long enough to read; longer when it offers something to press. */
export const toastShortMs = 3500;
export const toastActionMs = 6000;
export const toastDuration = (toast: Pick<ToastInput, 'action'>) => (toast.action ? toastActionMs : toastShortMs);

/** At most this many wait behind the one showing: older waiting ones give way to the newest. */
export const toastQueueLimit = 3;

/**
 * Adds a toast to the queue (the first is the one showing). The same words already waiting or showing are not added
 * twice (a button pressed twice), and past the limit the oldest waiting one is dropped, never the one on screen.
 */
export function queueToast(queue: Toast[], toast: Toast): Toast[] {
  if (queue.some(item => item.message === toast.message && item.tone === toast.tone)) return queue;
  const next = [...queue, toast];
  while (next.length > toastQueueLimit + 1) next.splice(1, 1);
  return next;
}

/** The queue once a toast is gone (its time is up, or it was tapped): the next one shows. */
export function dropToast(queue: Toast[], id: number): Toast[] {
  return queue.filter(item => item.id !== id);
}
