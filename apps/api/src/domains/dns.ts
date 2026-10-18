import { isIP } from 'node:net';

/**
 * DNS for reseller domains on Vercel's nameservers: what a reseller may add, the records BitoCard keeps for the store and
 * email (never edited from SHQ), the mailbox providers' records, and reading a domain's public records before its
 * nameservers move, so its email keeps working.
 */

/** Records BitoCard writes are marked in their comment; resellers cannot edit or delete them in SHQ. */
export const managedPrefix = 'bitocard:';
export const managedComment = (purpose: 'mail' | 'email' | 'imported') => `${managedPrefix}${purpose}`;
export const isManaged = (comment: string | undefined | null) => Boolean(comment?.startsWith(managedPrefix) && comment !== managedComment('imported'));

export const recordTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'CAA'] as const;
export type RecordType = (typeof recordTypes)[number];
export type RecordInput = { name: string; type: RecordType; value: string; ttl?: number; priority?: number };

/** A domain name we accept: letters, digits and hyphens per label, at least two labels, at most 253 characters. */
const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
export function domainName(raw: string) {
  const name = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '').replace(/^www\./, '');
  const labels = name.split('.');
  if (name.length > 253 || labels.length < 2 || !labels.every(part => label.test(part)) || /^\d+$/.test(labels.at(-1)!)) return null;
  return name;
}

/** Domains that can never be a reseller's: BitoCard's own and Vercel's preview hosts. */
export function reservedDomain(name: string) {
  return ['bitocard.com', 'vercel.app', 'vercel.com', 'localhost'].some(base => name === base || name.endsWith(`.${base}`));
}

/** The registrable top-level domain of a name (`com` for `shop.example.com`). */
export const tldOf = (name: string) => name.split('.').at(-1)!;

const hostname = (value: string) => /^(?=.{1,253}$)(?:(?!-)[a-z0-9_-]{1,63}(?<!-)\.)+[a-z]{2,63}\.?$/i.test(value);

/**
 * Why a record cannot be added, or null. The store's own address (the apex and `www`) is BitoCard's: no A, AAAA or
 * CNAME there, which would take the store offline.
 */
export function recordProblem(record: RecordInput) {
  const name = record.name.trim().toLowerCase().replace(/\.$/, '');
  if (name !== '' && name !== '@' && !/^(?:(?!-)[a-z0-9_*-]{1,63}(?<!-)\.)*(?!-)[a-z0-9_*-]{1,63}(?<!-)$/.test(name)) return 'Use letters, numbers, hyphens and dots for the name, or leave it empty for the domain itself.';
  const apex = name === '' || name === '@';
  if (['A', 'AAAA', 'CNAME'].includes(record.type) && (apex || name === 'www')) return 'The domain itself and www point to your store. Use another name, for example shop or blog.';
  const value = record.value.trim();
  if (!value || value.length > 2048 || /[\r\n]/.test(value)) return 'Enter a value on one line (at most 2,048 characters).';
  if (record.type === 'A' && isIP(value) !== 4) return 'An A record needs an IPv4 address, for example 203.0.113.10.';
  if (record.type === 'AAAA' && isIP(value) !== 6) return 'An AAAA record needs an IPv6 address.';
  if ((record.type === 'CNAME' || record.type === 'MX') && !hostname(value)) return 'Enter a host name, for example mail.example.com.';
  if (record.type === 'MX' && (record.priority === undefined || record.priority < 0 || record.priority > 65535)) return 'Give the MX record a priority from 0 to 65535.';
  if (record.type === 'CAA' && !/^\d{1,3} (issue|issuewild|iodef) "[^"]+"$/.test(value)) return 'A CAA record looks like: 0 issue "letsencrypt.org".';
  if (record.ttl !== undefined && (record.ttl < 60 || record.ttl > 86400)) return 'TTL must be from 60 to 86,400 seconds.';
  return null;
}

/** The mailbox providers a reseller can point their domain's email to, with the records each needs. */
export const mailProviders = {
  google: { name: 'Google Workspace', verification: 'google-site-verification=…' },
  microsoft: { name: 'Microsoft 365', verification: 'MS=ms12345678' },
  zoho: { name: 'Zoho Mail', verification: 'zoho-verification=zb12345678.zmverify.zoho.com' },
} as const;
export type MailProvider = keyof typeof mailProviders;

/** The records a mailbox provider needs on `domain` (MX, SPF, their verification TXT, and Microsoft's autodiscover). */
export function mailRecords(provider: MailProvider, domain: string, verification?: string): RecordInput[] {
  const verify: RecordInput[] = verification?.trim() ? [{ name: '', type: 'TXT', value: verification.trim() }] : [];
  if (provider === 'google') return [{ name: '', type: 'MX', value: 'smtp.google.com', priority: 1 }, { name: '', type: 'TXT', value: 'v=spf1 include:_spf.google.com ~all' }, ...verify];
  if (provider === 'microsoft') {
    return [
      { name: '', type: 'MX', value: `${domain.replace(/\./g, '-')}.mail.protection.outlook.com`, priority: 0 },
      { name: '', type: 'TXT', value: 'v=spf1 include:spf.protection.outlook.com -all' },
      { name: 'autodiscover', type: 'CNAME', value: 'autodiscover.outlook.com' },
      ...verify,
    ];
  }
  return [
    { name: '', type: 'MX', value: 'mx.zoho.com', priority: 10 },
    { name: '', type: 'MX', value: 'mx2.zoho.com', priority: 20 },
    { name: '', type: 'MX', value: 'mx3.zoho.com', priority: 50 },
    { name: '', type: 'TXT', value: 'v=spf1 include:zohomail.com ~all' },
    ...verify,
  ];
}

/** Names worth reading before nameservers move: email (MX, SPF, DMARC, common DKIM selectors) and common mail hosts. */
const probes: Array<{ name: string; types: RecordType[] }> = [
  { name: '', types: ['MX', 'TXT', 'CAA'] },
  { name: '_dmarc', types: ['TXT'] },
  ...['google', 'selector1', 'selector2', 'k1', 'k2', 'zmail', 'default', 's1', 's2', 'mail', 'dkim'].map(selector => ({ name: `${selector}._domainkey`, types: ['TXT', 'CNAME'] as RecordType[] })),
  ...['mail', 'webmail', 'smtp', 'imap', 'pop', 'autodiscover', 'autoconfig', 'shop', 'blog', 'app', 'api'].map(host => ({ name: host, types: ['CNAME', 'A', 'AAAA'] as RecordType[] })),
  { name: 'send', types: ['MX', 'TXT'] },
];
const typeCodes: Record<RecordType, number> = { A: 1, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };

/** TXT data as DNS-over-HTTPS returns it ("part one" "part two") to the text itself. */
export function txtValue(data: string) {
  const parts = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(match => match[1].replace(/\\(.)/g, '$1'));
  return parts.length ? parts.join('') : data;
}

/**
 * The domain's public records at the names above, read with DNS over HTTPS (JSON), so they can be copied to Vercel before
 * the nameservers move. A name with a CNAME has only that. Best effort: what was found is shown for the reseller to confirm.
 */
export async function lookupPublicRecords(domain: string, lookupUrl: string): Promise<RecordInput[]> {
  const found: RecordInput[] = [];
  const seen = new Set<string>();
  await Promise.all(
    probes.map(async probe => {
      const fqdn = probe.name ? `${probe.name}.${domain}` : domain;
      for (const type of probe.types) {
        let answers: Array<{ type: number; data: string; TTL?: number }> = [];
        try {
          const res = await fetch(`${lookupUrl}?${new URLSearchParams({ name: fqdn, type })}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
          if (!res.ok) continue;
          answers = ((await res.json()) as { Answer?: typeof answers }).Answer ?? [];
        } catch {
          continue;
        }
        // Only answers of the type asked (a CNAME chain answers an A query with the CNAME and its target's address).
        const own = answers.filter(answer => answer.type === typeCodes[type]);
        for (const answer of own) {
          let record: RecordInput;
          if (type === 'MX') {
            const [priority, host] = answer.data.split(/\s+/);
            record = { name: probe.name, type, value: (host ?? '').replace(/\.$/, ''), priority: Number(priority) };
          } else if (type === 'TXT') {
            record = { name: probe.name, type, value: txtValue(answer.data) };
          } else {
            record = { name: probe.name, type, value: answer.data.replace(/\.$/, '') };
          }
          const key = `${record.name}|${record.type}|${record.value}`;
          if (!seen.has(key) && !recordProblem(record)) {
            seen.add(key);
            found.push({ ...record, ttl: answer.TTL && answer.TTL >= 60 ? Math.min(answer.TTL, 86400) : 3600 });
          }
        }
        if (type === 'CNAME' && own.length) break;
      }
    }),
  );
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}
