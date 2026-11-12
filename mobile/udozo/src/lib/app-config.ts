import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { appVersion } from '@/lib/config';
import type { UpdateState } from '@/lib/version';

/** `GET /v1/app/config` (apps/udozo-api/src/app-config): whether this version must or may be updated, and where. */
export type AppConfig = {
  object: 'app_config';
  platform: 'ios' | 'android';
  version: string;
  update: UpdateState;
  min_version: string | null;
  latest_version: string | null;
  store_url: string | null;
  site_url: string;
  legal: { terms: string; privacy: string };
};

export const appPlatform = Platform.OS === 'ios' ? 'ios' : 'android';

export const fetchAppConfig = () =>
  api<AppConfig>(`/v1/app/config?platform=${appPlatform}&version=${encodeURIComponent(appVersion)}`);
