import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Chip } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import type { Country } from '@/lib/types';

/** The country an account belongs to (`GET /v1/countries`): chosen once, then fixed, with its currency. */
export function CountryPicker({ value, onChange, error }: { value: string | null; onChange: (code: string) => void; error?: string | null }) {
  const countries = useQuery({ queryKey: ['countries'], queryFn: () => api<{ data: Country[] }>('/v1/countries'), staleTime: 60 * 60_000 });
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="smallBold">Your country</ThemedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }} accessibilityRole="radiogroup">
        {(countries.data?.data ?? []).map(country => (
          <Chip key={country.code} label={country.name} selected={value === country.code} onPress={() => onChange(country.code)} />
        ))}
      </View>
      <ThemedText type="caption">{error ?? 'You buy and sell in its market, in its currency. It cannot be changed later.'}</ThemedText>
    </View>
  );
}
