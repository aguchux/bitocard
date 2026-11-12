import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';

import { Loading } from '@/components/ui';

/** A udozo.com page the app does not have yet: opened in the in-app browser, then back to where the person was. */
export default function WebPage() {
  const { url } = useLocalSearchParams<{ url?: string }>();
  useEffect(() => {
    const safe = typeof url === 'string' && /^https:\/\/(www\.)?udozo\.com\//.test(url) ? url : 'https://udozo.com/';
    WebBrowser.openBrowserAsync(safe)
      .catch(() => undefined)
      .finally(() => (router.canGoBack() ? router.back() : router.replace('/')));
  }, [url]);
  return <Loading label="Opening udozo.com" />;
}
