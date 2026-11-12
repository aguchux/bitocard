import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, FormError } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api } from '@/lib/api';
import { useMarket } from '@/lib/market';
import { appleAvailable, facebookAvailable, googleAvailable, signInWithApple, signInWithFacebook, signInWithGoogle } from '@/lib/social';
import { confirmationPending, type SessionReply } from '@/lib/types';

/** After any sign-in: an account still to finish goes to Finish your account, else back to where the person was. */
export function useFinishSignIn() {
  const { signedIn } = useAccount();
  return async (reply: SessionReply) => {
    const customer = await signedIn(reply);
    if (confirmationPending(customer)) router.replace('/verify');
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };
}

/**
 * Continue with Apple (first on iPhones, as Apple asks), Google, Facebook (in builds that have their IDs) and WhatsApp.
 * Each signs in, or makes the account when none uses that identity (never taking over an account with its email).
 */
export function SignInMethods({ intent, refCode }: { intent: 'signin' | 'signup'; refCode?: string }) {
  const theme = useTheme();
  const finish = useFinishSignIn();
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [whatsapp, setWhatsapp] = useState(false);

  useEffect(() => {
    appleAvailable().then(setApple, () => setApple(false));
  }, []);

  const run = async (name: string, attempt: () => Promise<SessionReply | null>) => {
    setBusy(name);
    setError(null);
    try {
      const reply = await attempt();
      if (reply) await finish(reply);
    } catch (problem) {
      setError(problem);
    } finally {
      setBusy(null);
    }
  };

  if (whatsapp) return <WhatsappSignIn intent={intent} refCode={refCode} onBack={() => setWhatsapp(false)} />;
  return (
    <View style={{ gap: Spacing.two }}>
      <FormError error={error} />
      {apple ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={intent === 'signup' ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={Radius.medium}
          style={{ height: 48 }}
          onPress={() => run('apple', () => signInWithApple(refCode))}
        />
      ) : null}
      {googleAvailable ? <Button tone="secondary" title="Continue with Google" loading={busy === 'google'} onPress={() => run('google', () => signInWithGoogle(refCode))} /> : null}
      {facebookAvailable ? <Button tone="secondary" title="Continue with Facebook" loading={busy === 'facebook'} onPress={() => run('facebook', () => signInWithFacebook(refCode))} /> : null}
      <Button tone="secondary" title="Continue with WhatsApp" icon={<MessageCircle size={18} color={theme.success} />} onPress={() => setWhatsapp(true)} />
    </View>
  );
}

type Started = { code: string; text: string; link: string; token: string; expires_at: string };
type Status = { status: 'waiting' | 'declined' | 'expired' } | ({ status: 'approved' } & SessionReply);

/**
 * WhatsApp: the app asks for a one-time code, the person sends it from their WhatsApp (Open WhatsApp fills it in),
 * approves on WhatsApp, and the app, asking every 3 seconds, is signed in. A number with no account makes one there.
 */
function WhatsappSignIn({ intent, refCode, onBack }: { intent: 'signin' | 'signup'; refCode?: string; onBack: () => void }) {
  const { country } = useMarket();
  const finish = useFinishSignIn();
  const [started, setStarted] = useState<Started | null>(null);
  const [state, setState] = useState<'waiting' | 'declined' | 'expired'>('waiting');
  const [error, setError] = useState<unknown>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!country) return;
    api<Started>('/v1/store/account/whatsapp-sign-in/start', { body: { intent, country, ref: refCode } }).then(setStarted, setError);
  }, [country, intent, refCode]);

  useEffect(() => {
    if (!started || state !== 'waiting') return;
    const timer = setInterval(async () => {
      if (done.current) return;
      try {
        const reply = await api<Status>('/v1/store/account/whatsapp-sign-in/finish', { body: { token: started.token } });
        if (reply.status === 'approved') {
          done.current = true;
          clearInterval(timer);
          await finish(reply);
        } else if (reply.status !== 'waiting') setState(reply.status);
      } catch (problem) {
        setError(problem);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [started, state, finish]);

  return (
    <View style={{ gap: Spacing.three }}>
      <FormError error={error} />
      {started ? (
        <>
          <ThemedText>Send this message to Udozo on WhatsApp, then approve the sign-in there:</ThemedText>
          <ThemedText type="subtitle" selectable accessibilityLabel={`Message: ${started.text}`}>
            {started.text}
          </ThemedText>
          <Button title="Open WhatsApp" onPress={() => Linking.openURL(started.link)} />
          <ThemedText type="small" themeColor="textSecondary">
            {state === 'waiting' ? 'Waiting for you to approve on WhatsApp…' : state === 'declined' ? 'You said no on WhatsApp.' : 'This code has expired. Go back and start again.'}
          </ThemedText>
        </>
      ) : !error ? (
        <ThemedText themeColor="textSecondary">Getting your code…</ThemedText>
      ) : null}
      <Button tone="ghost" title="Back" onPress={onBack} />
    </View>
  );
}
