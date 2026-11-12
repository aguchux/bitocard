import { router } from 'expo-router';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';

/** What a tab shows signed out: why to sign in, Sign in and Create an account. */
export function SignedOut({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ padding: Spacing.four, gap: Spacing.three }}>
      <ThemedText type="subtitle" accessibilityRole="header">
        {title}
      </ThemedText>
      <ThemedText themeColor="textSecondary">{body}</ThemedText>
      <Button title="Sign in" onPress={() => router.push('/signin')} />
      <Button tone="secondary" title="Create an account" onPress={() => router.push('/signup')} />
    </View>
  );
}
