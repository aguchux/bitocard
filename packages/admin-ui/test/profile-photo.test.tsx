// Udozo's profile photos in Seller HQ and the admin: the card asks the API for a signed link, sends the prepared photo
// straight to storage (no cookies), then sets it; taking it off works the same way; and the account menu shows the
// photo in place of the initial (BitoCard's menu, with no photo, is unchanged).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { makeStore } from '@bitocard/api-client';

vi.mock('@bitocard/ui/image', () => ({ squareImage: vi.fn(async () => new Blob(['photo'], { type: 'image/jpeg' })) }));

const { ProfilePhotoCard } = await import('../src/ui/profile-photo');
const { AccountMenu } = await import('../src/shell/console-shell');

let sent: Array<{ method: string; url: string; credentials?: string; body?: unknown }>;

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = 'http://api.test/';
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => undefined }));
  vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
    const request = typeof input === 'string' ? { method: init?.method ?? 'GET', url: input, credentials: init?.credentials } : input;
    const body = typeof input === 'string' ? init?.body : await input.clone().text();
    sent.push({ method: request.method, url: request.url, credentials: (request as { credentials?: string }).credentials, body });
    if (request.url.endsWith('/v1/auth/avatar/uploads')) return Response.json({ object: 'media_upload', id: '11111111-1111-4111-8111-111111111111', url: 'https://media.test/me.jpg', upload: { method: 'PUT', url: 'https://storage.test/put', headers: { 'content-type': 'image/jpeg' } }, expires_at: '' }, { status: 201 });
    if (request.url === 'https://storage.test/put') return new Response(null, { status: 200 });
    if (request.url.endsWith('/v1/auth/avatar') && request.method === 'POST') return Response.json({ object: 'avatar', avatar_url: 'https://media.test/me.jpg' });
    if (request.url.endsWith('/v1/auth/avatar') && request.method === 'DELETE') return Response.json({ object: 'avatar', avatar_url: null });
    return Response.json({});
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('profile photo card', () => {
  test('a chosen photo is sent to storage with the signed link, then set', async () => {
    render(
      <Provider store={makeStore()}>
        <ProfilePhotoCard realm="reseller" name="Ada Obi" url={null} />
      </Provider>,
    );
    expect(screen.getByText('AO')).toBeTruthy();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] } });
    expect(screen.getByAltText('Your new photo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
    await waitFor(() => expect(screen.getByText('Your photo is saved.')).toBeTruthy());
    expect(sent.map(call => `${call.method} ${new URL(call.url).pathname}`)).toEqual(['POST /v1/auth/avatar/uploads', 'PUT /put', 'POST /v1/auth/avatar']);
    expect(sent[1].credentials).toBe('omit');
    expect(JSON.parse(String(sent[2].body))).toEqual({ media_id: '11111111-1111-4111-8111-111111111111' });
  });

  test('refuses other kinds of file, and takes a photo off', async () => {
    render(
      <Provider store={makeStore()}>
        <ProfilePhotoCard realm="reseller" name="Ada Obi" url="https://media.test/old.jpg" />
      </Provider>,
    );
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [new File(['x'], 'me.gif', { type: 'image/gif' })] } });
    expect(screen.getByRole('alert').textContent).toBe('Choose a JPEG, PNG or WebP picture.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('taken off'));
    expect(sent.some(call => call.method === 'DELETE' && call.url.endsWith('/v1/auth/avatar'))).toBe(true);
  });
});

describe('account menu', () => {
  test('shows the photo when there is one, else the initial', () => {
    const { container, rerender } = render(<AccountMenu name="Ada Obi" email="ada@udozo.com" avatarUrl="https://media.test/me.jpg" onSignOut={() => undefined} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://media.test/me.jpg');
    rerender(<AccountMenu name="Ada Obi" email="ada@udozo.com" onSignOut={() => undefined} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('A');
  });
});
