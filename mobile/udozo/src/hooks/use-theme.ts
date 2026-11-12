import { useQuery } from '@tanstack/react-query';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { api } from '@/lib/api';
import { themed, type ThemeColors } from '@/lib/palette';

type PublishedTheme = { object: 'theme'; preset: string | null; colors: ThemeColors; version: number };

/** The theme Udozo's admins published (`GET /v1/theme`), read once an hour; Udozo's own colours until it answers. */
export function usePublishedTheme() {
  return useQuery({ queryKey: ['theme'], queryFn: () => api<PublishedTheme>('/v1/theme'), staleTime: 60 * 60_000, retry: 1 }).data?.colors ?? null;
}

/** The colours to draw with now: light or dark as the phone is set, the published theme on light. */
export function useTheme() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return themed(scheme, usePublishedTheme());
}
