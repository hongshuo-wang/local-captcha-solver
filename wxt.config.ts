import { defineConfig } from 'wxt';

export default defineConfig({
  targetBrowsers: ['chrome', 'edge', 'firefox'],
  zip: {
    includeSources: [
      'entrypoints/**',
      'public/**',
      'src/**',
      'LICENSE',
      'README.md',
      'README.zh-CN.md',
      'THIRD_PARTY_NOTICES.md',
      'env.d.ts',
      'package-lock.json',
      'package.json',
      'third_party/**',
      'tsconfig.json',
      'wxt.config.ts',
    ],
  },
  vite: () => ({
    resolve: {
      conditions: [
        'module',
        'browser',
        'development|production',
        'onnxruntime-web-use-extern-wasm',
      ],
    },
  }),
  hooks: {
    'build:done': (_wxt, output) => {
      const ortWasmFiles = [
        ...output.publicAssets,
        ...output.steps.flatMap((step) => step.chunks),
      ]
        .map((file) => file.fileName)
        .filter((fileName) =>
          fileName.includes('ort-wasm-simd-threaded') && fileName.endsWith('.wasm'),
        );
      if (
        ortWasmFiles.length !== 1 ||
        ortWasmFiles[0] !== 'ort/ort-wasm-simd-threaded.wasm'
      ) {
        throw new Error(
          `Expected one external ONNX Runtime WASM asset, received: ${ortWasmFiles.join(', ')}`,
        );
      }
    },
    'entrypoints:found': (wxt, entrypoints) => {
      const excludedPaths = wxt.config.browser === 'firefox'
        ? ['/entrypoints/offscreen.html', '/entrypoints/offscreen.ts']
        : ['/entrypoints/offscreen.ts'];
      for (let index = entrypoints.length - 1; index >= 0; index -= 1) {
        if (excludedPaths.some((path) => entrypoints[index].inputPath.endsWith(path))) {
          entrypoints.splice(index, 1);
        }
      }
    },
  },
  manifest: ({ browser }) => {
    const firefox = browser === 'firefox';
    return {
      name: '__MSG_extensionName__',
      description: '__MSG_extensionDescription__',
      default_locale: 'en',
      icons: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
        128: 'icons/icon-128.png',
      },
      action: {
        default_title: '__MSG_actionTitle__',
        default_icon: {
          16: 'icons/icon-16.png',
          32: 'icons/icon-32.png',
        },
      },
      permissions: [
        'activeTab',
        'clipboardWrite',
        'contextMenus',
        'storage',
        'scripting',
        ...(firefox ? [] : ['offscreen', 'debugger']),
      ],
      ...(process.env.CAPTCHA_E2E_PREGRANT === '1'
        ? { host_permissions: ['http://*/*', 'https://*/*'] }
        : { optional_host_permissions: ['http://*/*', 'https://*/*'] }),
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      },
      ...(firefox ? {
        browser_specific_settings: {
          gecko: {
            id: 'captcha-helper@hongshuo-wang.github.io',
            strict_min_version: '142.0',
            data_collection_permissions: { required: ['none'] },
          },
        },
      } : {}),
    };
  },
});
