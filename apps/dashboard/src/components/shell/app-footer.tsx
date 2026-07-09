import { Fresh } from '@/components/ui/fresh';
import { FreshFooter, FreshFooterItem } from '@/components/ui/fresh-footer';
import { LiveDot } from '@/components/ui/live-dot';

export type AppFooterProps = {
  syncedAt?: number;
  build?: string;
  deployment?: string;
};

/** Persistent footer strip: data-sync freshness + build + deployment. */
export function AppFooter({ syncedAt, build = 'dev', deployment = 'local' }: AppFooterProps) {
  return (
    <FreshFooter>
      <FreshFooterItem>
        <LiveDot live />
        <Fresh timestamp={syncedAt ?? Date.now()} prefix="Synced" />
      </FreshFooterItem>
      <FreshFooterItem>build · {build}</FreshFooterItem>
      <FreshFooterItem>deployment · {deployment}</FreshFooterItem>
    </FreshFooter>
  );
}
