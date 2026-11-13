import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { FeedbackProvider } from '@/components/feedback';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api-core';

export const mockedApi = api as unknown as jest.Mock;

/** What the API answers, by method and path (a function of the body for POSTs); anything else is a 404. */
export function answers(routes: Record<string, unknown | ((body: unknown) => unknown)>) {
  mockedApi.mockImplementation(async (path: string, options: { method?: string; body?: unknown } = {}) => {
    const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
    const reply = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    if (reply === undefined) throw new ApiError(404, { type: 'not_found_error', code: 'resource_missing', message: `No answer for ${method} ${path}` });
    const value = typeof reply === 'function' ? (reply as (body: unknown) => unknown)(options.body) : reply;
    if (value instanceof ApiError) throw value;
    return value;
  });
}

export const refused = (status: number, code: string, message: string, param?: string) => new ApiError(status, { type: 'invalid_request_error', code, message, param });

export async function renderScreen(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <FeedbackProvider>{element}</FeedbackProvider>
    </QueryClientProvider>,
  );
}
