import { Fresh } from '@/components/ui/fresh';
import { FreshFooter, FreshFooterItem } from '@/components/ui/fresh-footer';
import { LiveDot } from '@/components/ui/live-dot';

export type AppFooterProps = {
  syncedAt?: number;
  build?: string;
  deployment?: string;
};

/**
 * Persistent footer strip: data-sync freshness + build + deployment.
 *
 * `build` / `deployment` read from the runtime env on the server (this is a server component):
 * BUILD_SHA is baked into the image at `docker build` time from the git SHA (see Dockerfile +
 * deploy.yml); DEPLOYMENT_ENV comes from the kvorum-config ConfigMap. Both fall back to the
 * dev-machine values (`dev` / `local`) when unset, so local runs read honestly too.
 */
export function AppFooter({
  syncedAt,
  build = process.env.BUILD_SHA?.slice(0, 7) || 'dev',
  deployment = process.env.DEPLOYMENT_ENV || 'local',
}: AppFooterProps) {
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
