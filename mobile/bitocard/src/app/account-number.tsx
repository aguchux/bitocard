import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Field, Notice, Page, T } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { Wallet } from '@/lib/types';

/**
 * Your own account number: transfers into it land in the wallet. In Nigeria the bank needs the BVN to open it; it is
 * passed to the bank and never kept by BitoCard.
 */
export default function AccountNumber() {
  const queries = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet', 'primary'], queryFn: () => api<Wallet>('/v1/store/wallet') });
  const [bvn, setBvn] = useState('');
  const needsBvn = wallet.data?.reserved_account_needs_bvn ?? false;
  const open = useMutation({
    mutationFn: () => {
      if (needsBvn && !/^\d{11}$/.test(bvn)) throw new Error('Enter your 11-digit BVN.');
      return api('/v1/store/wallet/reserved-accounts', { body: needsBvn ? { bvn } : {} });
    },
    onSuccess: async () => {
      await queries.invalidateQueries({ queryKey: ['wallet'] });
      router.back();
    },
  });

  return (
    <Page>
      <T kind="title" accessibilityRole="header">
        Your account number
      </T>
      <T muted>A bank account number of your own. Transfer to it from any bank app and the money lands in your wallet, usually within minutes.</T>
      {needsBvn ? (
        <Field label="BVN" value={bvn} onChangeText={value => setBvn(value.replace(/\D/g, '').slice(0, 11))} keyboardType="number-pad" maxLength={11} hint="The bank needs it to open the account. BitoCard passes it on and never keeps it." />
      ) : null}
      {open.isError ? <Notice tone="bad">{open.error instanceof ApiError || open.error instanceof Error ? open.error.message : 'Something went wrong.'}</Notice> : null}
      <Button label="Get my account number" onPress={() => open.mutate()} busy={open.isPending} />
    </Page>
  );
}
