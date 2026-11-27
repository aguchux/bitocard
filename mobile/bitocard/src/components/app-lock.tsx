import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Field, Notice, T, useTheme } from '@/components/ui';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import { authenticateDevice, rememberTransactionPin, savedTransactionPin, setActiveTransactionPin } from '@/lib/transaction-pin';

/** Locks a signed-in app on launch and whenever it leaves the foreground. Device authentication or the server PIN opens it. */
export function AppLock({ children }: { children: ReactNode }) {
  const { customer, refresh } = useAccount();
  const configured = Boolean(customer?.transaction_pin_set);
  return (
    <AppLockSession key={`${customer?.id ?? 'signed-out'}:${configured ? 'pin' : 'no-pin'}`} configured={configured} enrolling={Boolean(customer) && !configured} refresh={refresh}>
      {children}
    </AppLockSession>
  );
}

function AppLockSession({ children, configured, enrolling, refresh }: { children: ReactNode; configured: boolean; enrolling: boolean; refresh: () => Promise<unknown> }) {
  const theme = useTheme();
  const [locked, setLocked] = useState(true);
  const [pin, setPin] = useState('');
  const [pinAgain, setPinAgain] = useState('');
  const [code, setCode] = useState('');
  const trying = useRef(false);

  const unlockDevice = useCallback(async () => {
    if (trying.current) return;
    trying.current = true;
    try {
      if (!(await authenticateDevice('Unlock BitoCard'))) return;
      const saved = await savedTransactionPin();
      // A device challenge authenticates the device owner, but the server still
      // requires the customer's PIN for every transaction. On a new device the
      // customer must enter that PIN once before biometric unlock can be used.
      if (!saved) return;
      setActiveTransactionPin(saved);
      setLocked(false);
    } finally {
      trying.current = false;
    }
  }, []);

  useEffect(() => {
    if (configured) void unlockDevice();
  }, [configured, unlockDevice]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && configured) {
        setActiveTransactionPin(null);
        setLocked(true);
      }
    });
    return () => subscription.remove();
  }, [configured]);

  const verify = useMutation({
    mutationFn: () => api('/v1/store/account/transaction-pin/verify', { body: {}, transactionPin: pin }),
    onSuccess: async () => {
      await rememberTransactionPin(pin);
      setPin('');
      setLocked(false);
    },
  });

  const enroll = useMutation({
    mutationFn: () => api('/v1/store/account/transaction-pin', { body: { code, pin } }),
    onSuccess: async () => {
      await rememberTransactionPin(pin);
      await refresh();
    },
  });
  const sendCode = useMutation({ mutationFn: () => api<{ sent_to: string }>('/v1/store/account/transaction-pin/code', { body: {} }) });

  if (enrolling) {
    return (
      <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
        <Image source={require('@/assets/images/mark.png')} style={styles.mark} accessibilityIgnoresInvertColors />
        <T kind="title" style={styles.centre} accessibilityRole="header">Secure your BitoCard app</T>
        <T muted style={styles.centre}>Set a six-digit transaction PIN before using BitoCard. We will email a one-time code to confirm it is you.</T>
        <Card style={styles.card}>
          <Button kind="secondary" label={sendCode.isSuccess ? 'Send a new email code' : 'Email me a code'} busy={sendCode.isPending} onPress={() => sendCode.mutate()} />
          {sendCode.isSuccess ? <Notice tone="good">Code sent to {sendCode.data.sent_to}. It expires in 30 minutes.</Notice> : null}
          {sendCode.isError ? <Notice tone="bad">{sendCode.error instanceof ApiError ? sendCode.error.message : 'Could not send the code. Try again.'}</Notice> : null}
          <Field label="Email code" value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} />
          <Field label="New transaction PIN" value={pin} onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} />
          <Field label="New transaction PIN again" value={pinAgain} onChangeText={value => setPinAgain(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} error={pinAgain.length > 0 && pinAgain !== pin ? 'The two PINs are not the same.' : null} />
          {enroll.isError ? <Notice tone="bad">{enroll.error instanceof ApiError ? enroll.error.message : 'Could not secure BitoCard. Try again.'}</Notice> : null}
          <Button label="Set PIN and continue" busy={enroll.isPending} disabled={code.length !== 6 || pin.length !== 6 || pin !== pinAgain} onPress={() => enroll.mutate()} />
        </Card>
      </SafeAreaView>
    );
  }

  if (!configured || !locked) return children;
  return (
    <SafeAreaView style={[styles.page, { backgroundColor: theme.background }]}>
      <Image source={require('@/assets/images/mark.png')} style={styles.mark} accessibilityIgnoresInvertColors />
      <T kind="title" style={styles.centre} accessibilityRole="header">
        Unlock BitoCard
      </T>
      <T muted style={styles.centre}>
        Use Face ID, fingerprint, your device passcode, or your BitoCard transaction PIN.
      </T>
      <Card style={styles.card}>
        <Field label="Transaction PIN" value={pin} onChangeText={value => setPin(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry maxLength={6} />
        {verify.isError ? <Notice tone="bad">{verify.error instanceof ApiError ? verify.error.message : 'Could not unlock BitoCard.'}</Notice> : null}
        <Button label="Unlock with PIN" busy={verify.isPending} disabled={pin.length !== 6} onPress={() => verify.mutate()} />
        <Button kind="secondary" label="Use device security" onPress={() => void unlockDevice()} />
      </Card>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  mark: { width: 72, height: 72, resizeMode: 'contain' },
  centre: { textAlign: 'center' },
  card: { width: '100%', maxWidth: 440 },
});
