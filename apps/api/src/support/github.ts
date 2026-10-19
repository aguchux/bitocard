import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError } from '../payments/provider-error.js';
import { redact } from './redact.js';

/**
 * GitHub's REST API for engineering escalations: one repository, a fine-grained token with Issues read and write. Issues
 * carry no personal data: everything is redacted, and emails and phone numbers are removed, before it leaves BitoCard.
 */
export class GithubIssues {
  constructor(private readonly options: { token?: string; repo?: string; baseUrl: string }) {}

  configured() {
    return Boolean(this.options.token?.trim() && /^[\w.-]+\/[\w.-]+$/.test(this.options.repo?.trim() ?? ''));
  }

  get repo() {
    return this.options.repo?.trim() ?? '';
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.options.baseUrl.replace(/\/+$/, '')}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.options.token?.trim() ?? ''}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'BitoCard-Support',
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new ProviderError('github', `request failed: ${(error as Error).message}`, false);
    }
    const text = await res.text();
    const body: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ProviderError('github', (body as { message?: string } | null)?.message ?? `HTTP ${res.status}`, res.status >= 400 && res.status < 500 && res.status !== 429, res.status);
    return body as T;
  }

  /** Test connection: the repository, readable with the token. */
  async check() {
    const repo = await this.call<{ full_name: string; has_issues: boolean }>(`/repos/${this.repo}`);
    if (!repo.has_issues) throw new ProviderError('github', 'issues are switched off on this repository', true);
    return repo.full_name;
  }

  async createIssue(input: { title: string; body: string; labels: string[] }) {
    return this.call<{ number: number; html_url: string; state: string }>(`/repos/${this.repo}/issues`, { method: 'POST', body: input });
  }
}

/** Removes personal data from text bound for GitHub: secrets (as for AI), emails and phone numbers. */
export function withoutPersonalData(text: string) {
  return redact(text)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email removed]')
    .replace(/\+?\d[\d\s()-]{7,}\d/g, '[number removed]');
}

/** GitHub's `X-Hub-Signature-256`: `sha256=<hex HMAC-SHA256 of the raw body keyed with the webhook secret>`. */
export function githubSignatureValid(secret: string | undefined, raw: Buffer | undefined, header: string | undefined) {
  if (!secret || !raw || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
