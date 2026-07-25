import { defineConfig } from 'wxt';

export default defineConfig({
  hooks: {
    'entrypoints:found': (_wxt, entrypoints) => {
      const companionScript = entrypoints.findIndex((entrypoint) =>
        entrypoint.inputPath.endsWith('/entrypoints/offscreen.ts'),
      );
      if (companionScript !== -1) {
        entrypoints.splice(companionScript, 1);
      }
    },
  },
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
