import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/extension.spec.ts',
  timeout: 120_000,
  workers: 1,
  projects: [
    {
      name: 'extension-chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
