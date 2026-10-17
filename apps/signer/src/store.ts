/**
 * The signer's own database: every transfer it was asked for, recorded before anything is signed, the signed bytes
 * kept before they are broadcast, and the customer deposit addresses the API has told it about (to sweep and to count in balances). It is the signer's memory across restarts; the
 * API's database knows nothing of it.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export const schema = `
CREATE TABLE IF NOT EXISTS transfers (
  reference TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'withdrawal',
  chain TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  contract TEXT,
  to_address TEXT NOT NULL,
  amount NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
  from_index INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'broadcast', 'confirmed', 'failed')),
  tx_hash TEXT,
  raw TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lease_until TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transfers_open ON transfers (next_attempt_at) WHERE status IN ('pending', 'signed', 'broadcast');
CREATE INDEX IF NOT EXISTS transfers_daily ON transfers (chain, asset, created_at);
CREATE TABLE IF NOT EXISTS deposit_addresses (
  chain TEXT NOT NULL,
  network TEXT NOT NULL,
  address_index INTEGER NOT NULL,
  address TEXT NOT NULL,
  swept_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, network, address_index)
);
`;

export type TransferRow = {
  reference: string;
  kind: string;
  chain: string;
  network: string;
  asset: string;
  contract: string | null;
  to_address: string;
  amount: string;
  from_index: number | null;
  status: 'pending' | 'signed' | 'broadcast' | 'confirmed' | 'failed';
  tx_hash: string | null;
  raw: string | null;
  meta: Record<string, unknown>;
  reason: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
};

export async function migrate(db: Db) {
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
}
