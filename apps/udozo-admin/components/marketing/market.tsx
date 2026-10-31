"use client";

import { Select } from "@bitocard/admin-ui";
import { flagEmoji } from "@bitocard/ui/phone";
import { useMarketOptions } from "@/components/classifieds";

/**
 * Marketing's market: every seller is one country's (Nigeria by default), so their numbers carry its dialling code
 * on WhatsApp and calls. The choice is among Udozo's markets.
 */
export function MarketSelect({ id, value, onChange, disabled }: { id: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const markets = useMarketOptions();
  const options = markets.length ? markets : [{ value, label: value }];
  return (
    <Select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {options.map(item => (
        <option key={item.value} value={item.value}>
          {flagEmoji(item.value)} {item.label}
        </option>
      ))}
    </Select>
  );
}

/** The market's name (its code until the markets load). */
export function useMarketName(code: string) {
  return useMarketOptions().find(item => item.value === code)?.label ?? code;
}
