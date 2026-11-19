import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { fetchAppConfig } from '@/components/update-gate';
import { Button, Card, Notice, Page, Segmented, T, useTheme } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { appVersion } from '@/lib/config';
import { chooseTheme, savedTheme, type ThemeChoice } from '@/lib/preferences';
import { pushAllowed, registerPush } from '@/lib/push';
import type { NoticePreference } from '@/lib/types';

type List = { object: 'list'; data: NoticePreference[] };

/**
 * Settings: notifications on this phone and which notices are pushed (security ones always are), the theme, how
 * payments are confirmed, and the legal documents. Deleting the account is at the bottom.
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const queries = useQueryClient();
  const allowed = useQuery({ queryKey: ['push-allowed'], queryFn: pushAllowed });
  const preferences = useQuery({ queryKey: ['notice-preferences'], queryFn: () => api<List>('/v1/store/account/notification-preferences') });
  const config = useQuery({ queryKey: ['app-config'], queryFn: fetchAppConfig, staleTime: 60 * 60_000 });
  const [look, setLook] = useState<ThemeChoice>('system');
  const [pushProblem, setPushProblem] = useState<string | null>(null);
  useEffect(() => {
    void savedTheme().then(setLook);
  }, []);

  const turnOn = useMutation({
    mutationFn: () => registerPush({ ask: true }),
    onSuccess: result => {
      void allowed.refetch();
      setPushProblem(result.registered ? null : result.reason === 'denied' ? 'Notifications are off for BitoCard. Allow them in your phone’s settings.' : 'Notifications cannot be switched on in this build of the app yet.');
    },
  });
  const choose = useMutation({
    mutationFn: ({ type, push }: { type: string; push: boolean }) => api<NoticePreference>(`/v1/store/account/notification-preferences/${encodeURIComponent(type)}`, { method: 'PUT', body: { push } }),
    onMutate: ({ type, push }) => {
      // Drawn at once; the API's answer replaces it, and a refusal puts it back.
      const before = queries.getQueryData<List>(['notice-preferences']);
      if (before) queries.setQueryData<List>(['notice-preferences'], { ...before, data: before.data.map(item => (item.type === type ? { ...item, push } : item)) });
      return { before };
    },
    onError: (_error, _vars, context) => context?.before && queries.setQueryData(['notice-preferences'], context.before),
    onSettled: () => void queries.invalidateQueries({ queryKey: ['notice-preferences'] }),
  });

  const pickLook = (next: ThemeChoice) => {
    setLook(next);
    void chooseTheme(next);
  };
  const legal = config.data?.legal;

  return (
    <Page>
      <T kind="heading" accessibilityRole="header">
        Notifications
      </T>
      {allowed.data ? (
        <T muted>Notifications are on for this phone.</T>
      ) : (
        <Card>
          <T muted>Get told on this phone when an order is delivered, money arrives or someone answers you.</T>
          <Button label="Turn on notifications" onPress={() => turnOn.mutate()} busy={turnOn.isPending} />
          {pushProblem ? <T kind="small" color={theme.bad}>{pushProblem}</T> : null}
        </Card>
      )}
      {preferences.isError ? <Notice tone="bad">{preferences.error instanceof ApiError ? preferences.error.message : 'Your choices could not be read.'}</Notice> : null}
      {preferences.data ? (
        <Card>
          <T kind="small" muted>
            Which notices come to your phone. Every one stays in your inbox.
          </T>
          {preferences.data.data.map(item => (
            <View key={item.type} style={styles.row}>
              <T style={{ flex: 1 }}>
                {item.label}
                {item.locked ? <T kind="small" muted>{'\n'}Always sent: it keeps your account safe.</T> : null}
              </T>
              <Switch accessibilityLabel={item.label} value={item.push} disabled={item.locked} onValueChange={push => choose.mutate({ type: item.type, push })} trackColor={{ true: theme.pink }} />
            </View>
          ))}
        </Card>
      ) : null}
      {choose.isError ? <Notice tone="bad">{choose.error instanceof ApiError ? choose.error.message : 'That change was not saved.'}</Notice> : null}

      <T kind="heading" accessibilityRole="header">
        Appearance
      </T>
      <Segmented
        label="Theme"
        value={look}
        onChange={pickLook}
        options={[
          { key: 'system', label: 'Phone' },
          { key: 'light', label: 'Light' },
          { key: 'dark', label: 'Dark' },
        ]}
      />

      <T kind="heading" accessibilityRole="header">
        Payments
      </T>
      <T muted>Before money leaves your wallet, BitoCard names the amount and asks for Face ID, your fingerprint or your phone’s PIN.</T>
      <Button kind="secondary" label="Mobile numbers" onPress={() => router.push('/phones')} />

      <T kind="heading" accessibilityRole="header">
        About
      </T>
      {legal ? (
        <>
          <Button kind="secondary" label="Terms of use" onPress={() => void WebBrowser.openBrowserAsync(legal.terms)} />
          <Button kind="secondary" label="Privacy notice" onPress={() => void WebBrowser.openBrowserAsync(legal.privacy)} />
        </>
      ) : null}
      <T kind="small" muted>
        BitoCard {appVersion} · A Golojan Ltd venture
      </T>
      <Button kind="secondary" label="Delete your account" onPress={() => router.push('/delete-account')} />
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
});
