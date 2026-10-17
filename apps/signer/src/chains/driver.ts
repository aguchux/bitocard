import type { Chain, KeyOwner, Network } from '../keys.js';

/**
 * A clear refusal before anything was signed: a bad address, not enough in the hot wallet, a limit. The transfer is
 * reported `failed` (nothing was, or ever will be, sent). Anything unclear is a `ChainUnavailable` and retried.
 */
export class Refusal extends Error {
  override name = 'Refusal';
}

export type Intent = {
  chain: Chain;
  network: Network;
  /** Token contract, or null for the chain's own coin. */
  contract: string | null;
  to: string;
  amount: bigint;
  /** Which key pays: the hot wallet for withdrawals, a customer's address for sweeps. */
  from: KeyOwner;
  /** Sweeps of a chain's own coin: send everything the address holds less the network fee (`amount` is ignored). */
  sweepAll?: boolean;
};

/** A signed transaction, kept before it is broadcast so a retry sends exactly the same bytes. */
export type Signed = { txHash: string; raw: string; meta: Record<string, unknown> };

export type TxState =
  | { state: 'unknown' }
  | { state: 'pending' }
  | { state: 'mined'; confirmations: number }
  /** Mined but did nothing (an EVM revert, a TRON contract failure): the transfer was not made and never will be. */
  | { state: 'reverted'; reason: string };

export interface ChainDriver {
  /** The standard form of a destination address on this chain's network, or null when it is not one. */
  address(to: string): string | null;
  /** Builds and signs the transfer. Refuses (Refusal) when it can never be made, e.g. the payer holds too little. */
  sign(intent: Intent, context: SignContext): Promise<Signed>;
  /** Sends signed bytes. Sending the same transaction again is harmless; an unclear answer throws ChainUnavailable. */
  broadcast(signed: Signed): Promise<void>;
  /** What the chain shows for a transaction. */
  status(signed: Signed): Promise<TxState>;
  /** What an address holds of a coin or token, in on-chain units. */
  balance(address: string, contract: string | null): Promise<bigint>;
  /** The chain's coin a deposit address needs to send this token (gas), in on-chain units. */
  tokenGas(from: string, contract: string, to: string, amount: bigint): Promise<bigint>;
  /** Confirmations after which a transfer is reported `confirmed`. */
  readonly confirmations: number;
}

export type SignContext = {
  /** The next EVM nonce this signer may use for an address (kept in the database across restarts). */
  nonce?: (address: string, chainNonce: bigint) => Promise<bigint>;
  /** UTXOs already spent by this signer's own unconfirmed transactions, so two transfers never spend one. */
  reserved?: Set<string>;
};
