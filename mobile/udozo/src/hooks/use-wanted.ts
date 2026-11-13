import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { Channels } from '@/lib/whatsapp';

/**
 * Whether wanted requests are open in a market (`wanted` on `GET /v1/classifieds/channels?country=`, the switch
 * `classifieds_wanted`, as udozo.com reads it); shared with Home's WhatsApp handle, which reads the same answer.
 */
export function useWantedOpen(country: string | null | undefined) {
  const channels = useQuery({
    queryKey: ['channels', country],
    enabled: Boolean(country),
    staleTime: 5 * 60_000,
    queryFn: () => api<Channels>(`/v1/classifieds/channels?country=${country}`),
  });
  return Boolean(channels.data?.wanted);
}
