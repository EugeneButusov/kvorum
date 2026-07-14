import { defineConfig, devices } from '@playwright/test';

// M6 acceptance smoke tests (§10.9). These exercise the primary flows that don't depend on live
// data — routing, page rendering, auth-gating, the SIWE/email auth UI, and the error pages — against
// a production build with no backend (server reads degrade gracefully, matching the Lighthouse gate).
// Data-heavy assertions (real tallies, voters, scorecards) live in the Vitest component suites; full
// end-to-end against seeded M4 data would need a backend in CI and is out of scope here.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
