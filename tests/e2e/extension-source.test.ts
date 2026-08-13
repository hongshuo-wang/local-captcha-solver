import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('does not rely on WXT browser globals inside Playwright callbacks', async () => {
  const source = await readFile(resolve(process.cwd(), 'tests/e2e/extension.spec.ts'), 'utf8');
  expect(source).not.toMatch(/\bbrowser\.(?:runtime|storage|tabs|action)/);
  expect(source).toMatch(/headless:\s*e2eTarget === 'edge' && process\.env\.CAPTCHA_E2E_HEADLESS === '1'/);
});
