import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ManualTopUp } from '@bitocard/api-client/admin';
import { confirmCodeProblem, defaultConfirmMethod, ManualTopUpsList, resendWait, topUpProblems, WalletTopUpDialog } from '../src';

afterEach(cleanup);

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const topUp = (changes: Partial<ManualTopUp> = {}): ManualTopUp => ({
  object: 'manual_top_up',
  id: 'mt_1',
  number: 'MT-000001',
  mode: 'live',
  target: { type: 'reseller', id: 'rs_1', name: 'Ada Digital', email: null, store: null },
  currency: 'NGN',
  amount: 2_500_000,
  source: 'received',
  external_reference: 'GTB-1',
  reason: 'Bank transfer',
  status: 'awaiting_code',
  requested_by: { id: 'ad_1', name: 'Fola Finance' },
  cancelled_by: null,
  code_expires_at: '2026-10-17T12:10:00Z',
  code_sent_at: new Date().toISOString(),
  created_at: '2026-10-17T12:00:00Z',
  completed_at: null,
  ...changes,
});

const currencies = [
  { code: 'NGN', currency: 'NGN', label: 'NGN (country)' },
  { code: 'USD', currency: 'USD', label: 'US dollars' },
];

function setup(overrides: Partial<Parameters<typeof WalletTopUpDialog>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    targetName: 'Ada Digital',
    currencies,
    chooseMode: true,
    onRequest: vi.fn(async () => topUp()),
    onConfirm: vi.fn(async () => topUp({ status: 'completed' })),
    onResend: vi.fn(async () => topUp()),
    onCancel: vi.fn(async () => topUp({ status: 'cancelled' })),
    onDone: vi.fn(),
    ...overrides,
  };
  render(<WalletTopUpDialog {...props} />);
  return props;
}

describe('manual top-up form', () => {
  test('problems: amount, reference for received money, reason', () => {
    expect(topUpProblems({ amount: '0', source: 'goodwill', reference: '', reason: 'Sorry' })).toHaveProperty('amount');
    expect(topUpProblems({ amount: '10.505', source: 'goodwill', reference: '', reason: 'Sorry' })).toHaveProperty('amount');
    expect(topUpProblems({ amount: '10', source: 'received', reference: ' ', reason: 'Bank in' })).toHaveProperty('reference');
    expect(topUpProblems({ amount: '10', source: 'goodwill', reference: '', reason: 'Hi' })).toHaveProperty('reason');
    expect(topUpProblems({ amount: '25000.50', source: 'received', reference: 'GTB-1', reason: 'Bank in' })).toEqual({});
  });

  test('the resend countdown runs a minute from the last code', () => {
    const now = Date.parse('2026-10-17T12:00:30Z');
    expect(resendWait('2026-10-17T12:00:00Z', now)).toBe(30);
    expect(resendWait('2026-10-17T11:58:00Z', now)).toBe(0);
    expect(resendWait(null, now)).toBe(0);
  });

  test('asks for a code with minor units, then confirms with the emailed code', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(props.onRequest).not.toHaveBeenCalled();
    expect(screen.getByText('Enter an amount above zero, with at most two decimals.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Wallet'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'test' } });
    fireEvent.change(screen.getByLabelText('Amount (USD)'), { target: { value: '25000.5' } });
    fireEvent.change(screen.getByLabelText('Bank or payment reference'), { target: { value: ' GTB-1 ' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Bank transfer in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await waitFor(() =>
      expect(props.onRequest).toHaveBeenCalledWith({ mode: 'test', currency: 'USD', amount: 2_500_050, source: 'received', external_reference: 'GTB-1', reason: 'Bank transfer in' }),
    );

    expect(await screen.findByText('Confirm MT-000001')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Resend in \d+s/ }) as HTMLButtonElement).disabled).toBe(true);
    const boxes = screen.getAllByRole('textbox') as HTMLInputElement[];
    for (const [index, digit] of [...'48213'].entries()) fireEvent.change(boxes[index], { target: { value: digit } });
    fireEvent.change(boxes[5], { target: { value: '7' } });
    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith('mt_1', '482137', 'email'));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(props.onClose).toHaveBeenCalled();
  });

  test('a wrong code keeps the dialog open with the API message; the top-up can be cancelled', async () => {
    const props = setup({
      chooseMode: false,
      onConfirm: vi.fn(async () => {
        throw { message: 'That code is not valid. Check it or ask for a new one.' };
      }),
    });
    expect(screen.queryByLabelText('Mode')).toBeNull();
    fireEvent.change(screen.getByLabelText('Where the money comes from'), { target: { value: 'goodwill' } });
    expect(screen.queryByLabelText('Bank or payment reference')).toBeNull();
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Sorry for the delay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    await waitFor(() => expect(props.onRequest).toHaveBeenCalledWith({ currency: 'NGN', amount: 10_000, source: 'goodwill', reason: 'Sorry for the delay' }));

    const boxes = await screen.findAllByRole('textbox');
    fireEvent.paste(boxes[0], { clipboardData: { getData: () => '111111' } });
    expect(await screen.findByText('That code is not valid. Check it or ask for a new one.')).toBeTruthy();
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel top-up' }));
    await waitFor(() => expect(props.onCancel).toHaveBeenCalledWith('mt_1'));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('confirming with the authenticator app', () => {
  test('the authenticator is the default only when offered', () => {
    expect(defaultConfirmMethod(['authenticator', 'email'])).toBe('authenticator');
    expect(defaultConfirmMethod(['email'])).toBe('email');
    expect(defaultConfirmMethod(undefined)).toBe('email');
    expect(confirmCodeProblem('authenticator')).toMatch(/authenticator app/);
    expect(confirmCodeProblem('email')).toMatch(/email/);
  });

  test('offered: chosen by default, no resend; the emailed code can still be picked and resent', async () => {
    const props = setup({ chooseMode: false, onRequest: vi.fn(async () => ({ ...topUp(), confirm_with: ['authenticator', 'email'] as Array<'authenticator' | 'email'> })) });
    fireEvent.change(screen.getByLabelText('Where the money comes from'), { target: { value: 'goodwill' } });
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Sorry for the delay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));

    const app = (await screen.findByLabelText('Authenticator app')) as HTMLInputElement;
    expect(app.checked).toBe(true);
    expect(screen.getByText('Code from your authenticator app')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Resend/ })).toBeNull();
    fireEvent.paste(screen.getAllByRole('textbox')[0], { clipboardData: { getData: () => '246810' } });
    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith('mt_1', '246810', 'authenticator'));
  });

  test('switching to the emailed code clears what was typed and shows resend', async () => {
    const props = setup({ chooseMode: false, onConfirm: vi.fn(async () => topUp({ status: 'completed' })), onRequest: vi.fn(async () => ({ ...topUp({ code_sent_at: '2026-01-01T00:00:00Z' }), confirm_with: ['authenticator', 'email'] as Array<'authenticator' | 'email'> })) });
    fireEvent.change(screen.getByLabelText('Where the money comes from'), { target: { value: 'goodwill' } });
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Sorry for the delay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));

    fireEvent.change((await screen.findAllByRole('textbox'))[0], { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('Emailed code'));
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(props.onResend).toHaveBeenCalledWith('mt_1'));
    // The resend's answer carries no confirm_with: the choice stays.
    expect(screen.getByLabelText('Authenticator app')).toBeTruthy();
    fireEvent.paste(screen.getAllByRole('textbox')[0], { clipboardData: { getData: () => '135790' } });
    await waitFor(() => expect(props.onConfirm).toHaveBeenCalledWith('mt_1', '135790', 'email'));
  });

  test('not offered: only the emailed code, with no choice shown', async () => {
    setup({ chooseMode: false, onRequest: vi.fn(async () => ({ ...topUp(), confirm_with: ['email'] as Array<'authenticator' | 'email'> })) });
    fireEvent.change(screen.getByLabelText('Where the money comes from'), { target: { value: 'goodwill' } });
    fireEvent.change(screen.getByLabelText('Amount (NGN)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Sorry for the delay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    expect(await screen.findByText('Code from the email')).toBeTruthy();
    expect(screen.queryByLabelText('Authenticator app')).toBeNull();
  });
});

describe('manual top-ups list', () => {
  test('shows amount, number, source and status', () => {
    render(<ManualTopUpsList topUps={[topUp({ status: 'completed', completed_at: '2026-10-17T12:05:00Z' }), topUp({ id: 'mt_2', number: 'MT-000002', status: 'expired', source: 'goodwill', mode: 'test' })]} />);
    expect(screen.getByText('Added')).toBeTruthy();
    expect(screen.getByText('Code expired')).toBeTruthy();
    expect(screen.getByText(/MT-000001 · Received \(GTB-1\)/)).toBeTruthy();
    expect(screen.getByText(/MT-000002 · Goodwill/)).toBeTruthy();
  });

  test('says so when there are none', () => {
    render(<ManualTopUpsList topUps={[]} />);
    expect(screen.getByText('No manual top-ups yet.')).toBeTruthy();
  });
});
