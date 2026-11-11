"use client";

import type { LocalSale, LocalShift, OfflineCopy, OfflineMeta, OutboxEntry } from "./offline-rules";

/**
 * The offline till's copy on this device (docs/UDOZO_POS_PLAN.md, How the offline data is stored): IndexedDB for
 * pos.udozo.com only, the copy, the device's bookkeeping, staff PIN checks and the sales not yet uploaded. Staff
 * checks and sales are **sealed** with AES-GCM under a key the browser makes and keeps (WebCrypto, not extractable), so
 * the files are useless copied elsewhere. Only the PIN check is kept, never a PIN.
 */

const dbName = "udozo-pos-offline";
const version = 2;
type Store = "kv" | "checks" | "sales" | "outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ["kv", "checks", "sales", "outbox"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(store: Store, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const get = <T>(store: Store, key: string) => run<T>(store, "readonly", s => s.get(key) as IDBRequest<T>);
const put = (store: Store, key: string, value: unknown) => run(store, "readwrite", s => void s.put(value, key));
const all = <T>(store: Store) => run<T[]>(store, "readonly", s => s.getAll() as IDBRequest<T[]>);

// ---- Sealing ----

type Sealed = { iv: Uint8Array; data: ArrayBuffer };

async function deviceKey(): Promise<CryptoKey> {
  const kept = await get<CryptoKey>("kv", "key");
  if (kept) return kept;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await put("kv", "key", key);
  return key;
}

async function seal(value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deviceKey(), new TextEncoder().encode(JSON.stringify(value)));
  return { iv, data };
}

async function unseal<T>(sealed: Sealed | undefined): Promise<T | null> {
  if (!sealed) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv as BufferSource }, await deviceKey(), sealed.data);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

// ---- The copy and the device's bookkeeping ----

export const readCopy = () => get<OfflineCopy>("kv", "copy").then(copy => copy ?? null);
export const writeCopy = (copy: OfflineCopy) => put("kv", "copy", copy);
export async function readMeta(): Promise<OfflineMeta> {
  return (await get<OfflineMeta>("kv", "meta")) ?? { synced_at: null, next_number: 1, offline_sales: 0 };
}
export const writeMeta = (meta: OfflineMeta) => put("kv", "meta", meta);

// ---- Sales ----

export async function saveSale(sale: LocalSale) {
  await put("sales", sale.client_sale_id, await seal(sale));
}

/** Every sale kept on this device, oldest first (the order they are uploaded in). */
export async function readSales(): Promise<LocalSale[]> {
  const rows = (await all<Sealed>("sales")) ?? [];
  const sales = (await Promise.all(rows.map(row => unseal<LocalSale>(row)))).filter((sale): sale is LocalSale => sale !== null);
  return sales.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export const dropSale = (id: string) => run("sales", "readwrite", s => void s.delete(id));

// ---- Shifts, refunds and stock changes waiting to upload ----

export async function saveEntry(entry: OutboxEntry) {
  await put("outbox", entry.client_id, await seal(entry));
}

export async function readEntries(): Promise<OutboxEntry[]> {
  const rows = (await all<Sealed>("outbox")) ?? [];
  const entries = (await Promise.all(rows.map(row => unseal<OutboxEntry>(row)))).filter((entry): entry is OutboxEntry => entry !== null);
  return entries.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export const dropEntry = (id: string) => run("outbox", "readwrite", s => void s.delete(id));

/** The till's shift as the device knows it (null: none open). */
export const readShift = () => get<LocalShift | null>("kv", "shift").then(shift => shift ?? null);
export const writeShift = (shift: LocalShift | null) => put("kv", "shift", shift);

/** Sales refunded on this till offline (their client ids), so they are not refunded twice. */
export const readRefunded = () => get<string[]>("kv", "refunded").then(ids => new Set(ids ?? []));
export async function markRefunded(id: string) {
  const ids = await readRefunded();
  ids.add(id);
  await put("kv", "refunded", [...ids].slice(-500));
}

// ---- The device's signing key (a file of unsent sales) ----

async function signingKey(): Promise<CryptoKeyPair> {
  const kept = await get<CryptoKeyPair>("kv", "signing");
  if (kept) return kept;
  // The private key never leaves the browser (not extractable); Udozo keeps the public one.
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  await put("kv", "signing", pair);
  return pair;
}

export const publicKey = async () => crypto.subtle.exportKey("jwk", (await signingKey()).publicKey);

/** Signs a file's payload: ECDSA P-256 with SHA-256, the signature in base64 (r and s, 64 bytes). */
export async function signPayload(payload: string) {
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, (await signingKey()).privateKey, new TextEncoder().encode(payload)));
  let text = "";
  for (const byte of signature) text += String.fromCharCode(byte);
  return btoa(text);
}

export const keySentFor = () => get<string>("kv", "key_sent").then(id => id ?? null);
export const markKeySent = (deviceId: string) => put("kv", "key_sent", deviceId);

// ---- Staff PIN checks ----

type PinCheck = { salt: number[]; hash: number[]; tries: number; locked_until: number | null };
export const pinTries = 5;
export const pinLockMs = 15 * 60_000;
const iterations = 150_000;

async function derive(pin: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, material, 256));
}

/** Keeps a PIN check for a member of staff who just signed in online on this till (never the PIN). */
export async function rememberPin(staffId: string, pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const check: PinCheck = { salt: [...salt], hash: [...(await derive(pin, salt))], tries: 0, locked_until: null };
  await put("checks", staffId, await seal(check));
}

/** Whether this till can sign the member of staff in offline (they signed in on it online before). */
export const hasPinCheck = async (staffId: string) => Boolean(await get("checks", staffId));

/** Checks a PIN offline: five wrong tries lock that person on this till for 15 minutes. */
export async function checkPin(staffId: string, pin: string, now = Date.now()): Promise<"ok" | "wrong" | "locked" | "unknown"> {
  const check = await unseal<PinCheck>(await get<Sealed>("checks", staffId));
  if (!check) return "unknown";
  if (check.locked_until && check.locked_until > now) return "locked";
  const hash = await derive(pin, new Uint8Array(check.salt));
  let same = hash.length === check.hash.length ? 0 : 1;
  for (let i = 0; i < hash.length; i += 1) same |= hash[i]! ^ (check.hash[i] ?? 0);
  if (same === 0) {
    await put("checks", staffId, await seal({ ...check, tries: 0, locked_until: null }));
    return "ok";
  }
  const tries = check.tries + 1;
  await put("checks", staffId, await seal({ ...check, tries: tries >= pinTries ? 0 : tries, locked_until: tries >= pinTries ? now + pinLockMs : null }));
  return tries >= pinTries ? "locked" : "wrong";
}

/** Asks the browser to keep this site's data (persistent storage): false where it refuses, as private windows do. */
export async function keepData() {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
