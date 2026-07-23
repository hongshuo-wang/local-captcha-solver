import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 30_000,
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
