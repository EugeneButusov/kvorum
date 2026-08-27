import { sessionGet } from '@/lib/api/session';

export type WindowState = {
  used: number;
  limit: number;
  reset_seconds: number;
};

export type KeyUsage = {
  id: string;
  label: string | null;
  prefix: string;
  last_four: string;
  daily: number[];
  rate_limit: {
    minute: WindowState;
    day: WindowState;
  };
};

export type UsageResponse = {
  buckets: string[];
  keys: KeyUsage[];
};

export async function fetchUsage(): Promise<UsageResponse> {
  return sessionGet<UsageResponse>('/v1/keys/usage');
}
