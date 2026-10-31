import type { IntegrationField } from '../../integrations/definitions.js';
import type { IntegrationLink } from '../../integrations/links.js';

/**
 * Sanctions screening of the addresses customers withdraw to, behind one interface: Chainalysis's free sanctions API
 * and TRM's public sanctions screening. The first one set up answers; if it cannot be reached the next is asked. An
 * address no screener could check is `unscreened`, and live withdrawals to it wait for an admin; a flagged address is
 * never used. Endpoints follow each provider's documentation: confirm them against the account before going live.
 */
export type Screening = { status: 'clear' | 'flagged'; provider: string; detail: string | null };

export type Screener = {
  id: string;
  name: string;
  description: string;
  fields: IntegrationField[];
  links: IntegrationLink[];
  /** Null while not set up. */
  configured: (values: Record<string, string | undefined>) => boolean;
  screen: (values: Record<string, string | undefined>, address: string) => Promise<Screening>;
};

const timeoutMs = 10_000;

async function call(url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch (error) {
    throw new Error(`unreachable (${error instanceof Error ? error.name : 'error'})`);
  }
  if (res.status === 401 || res.status === 403) throw new Error(`refused the API key (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

export const screeners: Screener[] = [
  {
    id: 'chainalysis',
    name: 'Chainalysis sanctions screening',
    description: 'Checks every address customers withdraw crypto to against sanctions lists (Chainalysis’s free sanctions API).',
    fields: [
      { key: 'CHAINALYSIS_API_KEY', label: 'API key', secret: true, kind: 'text', required: true, help: 'From the Chainalysis sanctions screening sign-up page: the key is emailed to you.' },
      { key: 'CHAINALYSIS_API_URL', label: 'API address', secret: false, kind: 'url', required: false, help: 'Leave empty for https://public.chainalysis.com.' },
    ],
    links: [
      { label: 'Get a key', url: 'https://go.chainalysis.com/chainalysis-oracle-sanctions-api-signup.html' },
      { label: 'API docs', url: 'https://public.chainalysis.com/docs/index.html' },
    ],
    configured: values => Boolean(values.CHAINALYSIS_API_KEY),
    screen: async (values, address) => {
      const base = (values.CHAINALYSIS_API_URL || 'https://public.chainalysis.com').replace(/\/+$/, '');
      const reply = (await call(`${base}/api/v1/address/${encodeURIComponent(address)}`, { headers: { accept: 'application/json', 'x-api-key': values.CHAINALYSIS_API_KEY! } })) as {
        identifications?: Array<{ category?: string; name?: string }>;
      };
      if (!reply || !Array.isArray(reply.identifications)) throw new Error('an answer BitoCard cannot read');
      const found = reply.identifications;
      return { status: found.length ? 'flagged' : 'clear', provider: 'chainalysis', detail: found.length ? found.map(item => item.name ?? item.category ?? 'sanctions').join(', ').slice(0, 300) : null };
    },
  },
  {
    id: 'trm',
    name: 'TRM sanctions screening',
    description: 'Checks every address customers withdraw crypto to against sanctions lists (TRM Labs’ public sanctions screening).',
    fields: [
      { key: 'TRM_API_KEY', label: 'API key', secret: true, kind: 'text', required: true, help: 'TRM Labs > the free sanctions screening API key (sent as the user name and password).' },
      { key: 'TRM_API_URL', label: 'API address', secret: false, kind: 'url', required: false, help: 'Leave empty for https://api.trmlabs.com.' },
    ],
    links: [
      { label: 'Get a key', url: 'https://www.trmlabs.com/products/sanctions' },
      { label: 'API docs', url: 'https://docs.sanctions.trmlabs.com/' },
    ],
    configured: values => Boolean(values.TRM_API_KEY),
    screen: async (values, address) => {
      const base = (values.TRM_API_URL || 'https://api.trmlabs.com').replace(/\/+$/, '');
      const auth = Buffer.from(`${values.TRM_API_KEY}:${values.TRM_API_KEY}`).toString('base64');
      const reply = (await call(`${base}/public/v1/sanctions/screening`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Basic ${auth}` },
        body: JSON.stringify([{ address }]),
      })) as Array<{ address?: string; isSanctioned?: boolean }>;
      const row = Array.isArray(reply) ? reply.find(item => item.address?.toLowerCase() === address.toLowerCase()) : null;
      if (!row || typeof row.isSanctioned !== 'boolean') throw new Error('an answer BitoCard cannot read');
      return { status: row.isSanctioned ? 'flagged' : 'clear', provider: 'trm', detail: row.isSanctioned ? 'sanctioned' : null };
    },
  },
];

export const screener = (id: string) => screeners.find(item => item.id === id);
export const screenerKeys = screeners.flatMap(item => item.fields.map(field => field.key));
