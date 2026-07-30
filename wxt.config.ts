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
  manifest: (env) => ({
    name: env.mode === 'ppocrv6-small' ? '本地验证码识别器 (PP-OCRv6 small 体验版)'
      : env.mode === 'captcha-ctc' ? '本地验证码识别器 (候选模型)'
        : '本地验证码识别器',
    description: '在本地识别简单验证码并填入匹配的输入框。',
    permissions: ['activeTab', 'clipboardWrite', 'contextMenus', 'storage', 'scripting', 'offscreen'],
    ...(process.env.CAPTCHA_E2E_PREGRANT === '1'
      ? { host_permissions: ['http://*/*', 'https://*/*'] }
      : { optional_host_permissions: ['http://*/*', 'https://*/*'] }),
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  }),
});
