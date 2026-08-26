import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.output', 'firefox-mv3');
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

requireValue(manifest.manifest_version === 3, 'Firefox build must use Manifest V3');
requireValue(manifest.background?.scripts?.includes('background.js'), 'Firefox build must use a background script');
requireValue(manifest.browser_specific_settings?.gecko?.id === 'captcha-helper@hongshuo-wang.github.io', 'Firefox extension ID is missing');
requireValue(manifest.browser_specific_settings?.gecko?.strict_min_version === '142.0', 'Firefox minimum version is incorrect');
requireValue(manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required?.includes('none'), 'Firefox data collection declaration is missing');
requireValue(Array.isArray(manifest.permissions), 'Firefox permissions are missing');
for (const permission of ['offscreen', 'debugger']) {
  requireValue(!manifest.permissions.includes(permission), `Firefox build contains unsupported ${permission} permission`);
}
for (const permission of ['activeTab', 'clipboardWrite', 'contextMenus', 'storage', 'scripting']) {
  requireValue(manifest.permissions.includes(permission), `Firefox build is missing ${permission} permission`);
}
requireValue(
  JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(['http://*/*', 'https://*/*']),
  'Firefox optional website permissions are incomplete',
);

for (const file of [
  'background.js',
  'content-scripts/content.js',
  'models/captcha-ctc.json',
  'models/captcha-ctc.onnx',
  'onboarding.html',
  'options.html',
  'ort/ort-wasm-simd-threaded.mjs',
  'ort/ort-wasm-simd-threaded.wasm',
  'popup.html',
]) {
  await access(path.join(output, file));
}

console.log('Verified Firefox Manifest V3 build');
