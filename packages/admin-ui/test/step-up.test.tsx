import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { makeStore } from '@bitocard/api-client';
import { adminApi } from '@bitocard/api-client/admin';
import { StepUpPrompt } from '../src/shell/step-up';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

let sent: string[];
let goodCode: string;
// BitoCard's API never says; Udozo's says whether the admin has turned 2-step verification on.
let authenticator: boolean | undefined;

beforeEach(() => {
  sent = [];
  goodCode = '246810';
  authenticator = undefined;
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  let open = false;
  vi.stubGlobal('fetch', async (input: Request) => {
    sent.push(`${input.method} ${new URL(input.url).pathname}`);
    if (input.url.endsWith('/v1/admin/auth/session')) {
      return Response.json({ object: 'admin_session', admin: { object: 'admin', id: 'a1', name: 'Ada', email: 'ada@udozo.com', roles: ['finance'], authenticator }, step_up_until: null });
    }
    if (input.url.endsWith('/v1/admin/auth/step-up')) {
      const { code } = (await input.json()) as { code: string };
      if (code !== goodCode) return Response.json({ error: { type: 'invalid_request_error', code: 'mfa_code_invalid', message: 'That code is not valid. Check your authenticator app.' } }, { status: 400 });
      open = true;
      return Response.json({ object: 'admin_step_up', step_up_until: '2026-10-18T10:05:00.000Z' });
    }
    if (!open) return Response.json({ error: { type: 'permission_error', code: 'step_up_required', message: 'Enter the code.' } }, { status: 403 });
    return Response.json({ object: 'feature_switch' });
  });
});

// Under CI load (builds and other suites at once) the prompt can take more than Testing Library's default second.
const slow = { timeout: 5000 };

const typeCode = async (code: string) => {
  const boxes = (await screen.findAllByRole('textbox', {}, slow)) as HTMLInputElement[];
  for (const [index, digit] of [...code].entries()) fireEvent.change(boxes[index], { target: { value: digit } });
};

describe('step-up prompt', () => {
  test('asks for the code when an action needs the window, waits for Confirm, then the action goes through', async () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <StepUpPrompt />
      </Provider>,
    );
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = store.dispatch(adminApi.endpoints.setSwitch.initiate({ key: 'custom_domains', enabled: true }));
    });
    expect(await screen.findByText("Confirm it's you", {}, slow)).toBeTruthy();
    await typeCode('111111');
    expect(sent.filter(item => item.endsWith('/step-up'))).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    expect(await screen.findByText('That code is not valid. Check your authenticator app.', {}, slow)).toBeTruthy();
    await typeCode(goodCode);
    expect(sent.filter(item => item.endsWith('/step-up'))).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    const result = (await done) as { error?: unknown };
    expect(result.error).toBeUndefined();
    expect(sent.filter(item => item === 'PUT /v1/admin/switches/custom_domains')).toHaveLength(2);
    await waitFor(() => expect((document.querySelector('dialog') as HTMLDialogElement).open).toBe(false), slow);
  });

  test('an admin without an authenticator is sent to turn 2-step verification on, and the action stays refused', async () => {
    authenticator = false;
    const store = makeStore();
    render(
      <Provider store={store}>
        <StepUpPrompt setupHref="/account" />
      </Provider>,
    );
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = store.dispatch(adminApi.endpoints.setSwitch.initiate({ key: 'custom_domains', enabled: true }));
    });
    const link = await screen.findByRole('link', { name: /Turn on 2-step verification/ }, slow);
    expect(link.getAttribute('href')).toBe('/account');
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(link);
    const result = (await done) as { error?: { code: string } };
    expect(result.error?.code).toBe('step_up_required');
    expect(sent.filter(item => item.endsWith('/step-up'))).toHaveLength(0);
  });

  test('cancelling leaves the action refused', async () => {
    const store = makeStore();
    render(
      <Provider store={store}>
        <StepUpPrompt />
      </Provider>,
    );
    let done: Promise<unknown> = Promise.resolve();
    act(() => {
      done = store.dispatch(adminApi.endpoints.setSwitch.initiate({ key: 'custom_domains', enabled: true }));
    });
    await screen.findByText("Confirm it's you", {}, slow);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const result = (await done) as { error?: { code: string } };
    expect(result.error?.code).toBe('step_up_required');
  });
});
