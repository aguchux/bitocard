import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

/** Addresses webhooks may never reach: private, loopback, link-local (cloud metadata), shared, reserved and multicast. */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** IPv4 carried inside IPv6 (mapped ::ffff:a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16) is checked as IPv4. */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/.exec(lower);
  const pair = hex ?? sixToFour;
  if (!pair) return null;
  const high = parseInt(pair[1], 16);
  const low = parseInt(pair[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function isBlockedAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true;
  const v4 = embeddedIpv4(address);
  if (v4) return blocked.check(v4, 'ipv4');
  return blocked.check(address, 'ipv6');
}

export class BlockedDestinationError extends Error {
  readonly code = 'blocked_destination';
}

/** Why a URL cannot be an endpoint, or null if it can (before DNS). */
export function urlProblem(raw: string, allowPrivate: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Enter a full URL, such as https://example.com/webhooks/bitocard.';
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) return 'Webhook URLs must use https://.';
  if (url.username || url.password) return 'Webhook URLs cannot contain a username or password.';
  if (url.hash) return 'Webhook URLs cannot contain a #fragment.';
  return null;
}

const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, '');

/** Resolves the URL's host and refuses it if any address is internal. */
export async function checkDestination(raw: string, allowPrivate: boolean, resolve = resolveAll) {
  const problem = urlProblem(raw, allowPrivate);
  if (problem) return problem;
  if (allowPrivate) return null;
  const host = hostOf(new URL(raw));
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    return 'This host name could not be found.';
  }
  if (!addresses.length || addresses.some(isBlockedAddress)) return 'Webhook URLs must point to a public internet address.';
  return null;
}

const resolveAll = (host: string) =>
  new Promise<string[]>((resolve, reject) => dnsLookup(host, { all: true, verbatim: true }, (error, list) => (error ? reject(error) : resolve(list.map(item => item.address)))));

/**
 * A DNS lookup for outgoing webhook connections that refuses internal addresses. The connection uses exactly the
 * addresses checked here, so a host name that changes its answer between saving and sending cannot reach inside.
 */
export function safeLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true, verbatim: true }, (error, list: LookupAddress[]) => {
      if (error) return callback(error, '', 0);
      const usable = allowPrivate ? list : list.filter(item => !isBlockedAddress(item.address));
      if (!usable.length || usable.length !== list.length) {
        return callback(new BlockedDestinationError(`${hostname} resolves to an internal address`), '', 0);
      }
      if (options.all) return (callback as unknown as (e: null, list: LookupAddress[]) => void)(null, usable);
      return callback(null, usable[0].address, usable[0].family);
    });
  };
}
