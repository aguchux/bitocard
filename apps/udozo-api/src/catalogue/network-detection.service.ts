import { Injectable } from '@nestjs/common';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { SupplierAdapters } from '../suppliers/supplier-adapters.js';
import { detectNetworkByPrefix } from './network-prefixes.js';

export type DetectedNetwork = { brand: string; name: string | null; method: 'supplier' | 'prefix' };

/**
 * Which mobile network a phone number belongs to, for the quick top-up form: the routed supplier's own lookup first
 * (Reloadly’s auto-detect endpoint), the prefix table if that cannot tell, else null (the customer chooses).
 */
@Injectable()
export class NetworkDetectionService {
  constructor(private readonly adapters: SupplierAdapters) {}

  /** E.164, or null for a number that is not a valid mobile number of the country (never thrown: this is best effort). */
  normalise(phone: string, country: string): string | null {
    const parsed = parsePhoneNumberFromString(phone, country.toUpperCase() as CountryCode);
    const type = parsed?.getType();
    if (!parsed?.isValid() || parsed.country !== country.toUpperCase() || (type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE')) return null;
    return parsed.number;
  }

  async detect(phone: string, country: string): Promise<DetectedNetwork | null> {
    const e164 = this.normalise(phone, country);
    if (!e164) return null;
    // Reloadly is BitoCard's live airtime and data supplier in most markets; others' adapters have no detect lookup
    // yet, so this falls straight to the prefix table for them.
    const reloadly = this.adapters.get('reloadly');
    const supplierGuess = await reloadly.detectOperator?.(e164, country.toUpperCase()).catch(() => null);
    if (supplierGuess) return { brand: supplierGuess.brand, name: supplierGuess.name, method: 'supplier' };
    const prefixGuess = detectNetworkByPrefix(e164, country);
    if (prefixGuess) return { brand: prefixGuess, name: null, method: 'prefix' };
    return null;
  }
}
