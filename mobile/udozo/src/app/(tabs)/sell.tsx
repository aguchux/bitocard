import * as WebBrowser from 'expo-web-browser';
import { Camera } from 'lucide-react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Page } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

/** Sell: posting from the camera comes in the next phase; until then, Post an ad on udozo.com. */
export default function SellScreen() {
  const theme = useTheme();
  return (
    <Page>
      <ThemedText type="subtitle" accessibilityRole="header">
        Sell on Udozo
      </ThemedText>
      <Card style={{ backgroundColor: theme.backgroundElement }}>
        <Camera size={28} color={theme.primary} />
        <ThemedText>Posting an ad straight from your camera, with Anjio filling in the details from your photos, is coming to the app.</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Until then, post on udozo.com with the same account. Listing is free.
        </ThemedText>
        <Button title="Post an ad on udozo.com" onPress={() => WebBrowser.openBrowserAsync('https://udozo.com/sell')} />
      </Card>
    </Page>
  );
}
