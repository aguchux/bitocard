import type { ShopReportReason } from '@shared/classifieds';
import { useMutation } from '@tanstack/react-query';
import { Flag } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Field, FormError, Sheet } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { reportReasons } from '@/lib/words';

/** Report this listing to Udozo's moderators: a reason and, if they like, what is wrong. */
export function ReportListing({ listingId }: { listingId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ShopReportReason | null>(null);
  const [details, setDetails] = useState('');
  const report = useMutation({
    mutationFn: () => api('/v1/classifieds/reports', { body: { listing_id: listingId, reason, details: details.trim() || undefined } }),
  });
  const theme = useTheme();
  return (
    <>
      <Button tone="ghost" title="Report this listing" icon={<Flag size={16} color={theme.link} />} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Report this listing">
        {report.isSuccess ? (
          <>
            <ThemedText>Thank you. Udozo&apos;s team will look at it.</ThemedText>
            <Button title="Done" onPress={() => setOpen(false)} />
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two }}>
              {(Object.keys(reportReasons) as ShopReportReason[]).map(item => (
                <Chip key={item} label={reportReasons[item]} selected={reason === item} onPress={() => setReason(item)} />
              ))}
            </View>
            <Field label="What is wrong (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} />
            <FormError error={report.error} />
            <Button title="Send report" disabled={!reason} loading={report.isPending} onPress={() => report.mutate()} />
          </>
        )}
      </Sheet>
    </>
  );
}
