import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Local CAPTCHA Solver',
    description: 'Recognize simple CAPTCHAs locally and fill the matching field.',
    permissions: ['activeTab', 'contextMenus', 'storage', 'scripting', 'offscreen'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
