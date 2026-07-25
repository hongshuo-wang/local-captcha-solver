import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('does not rely on WXT browser globals inside Playwright callbacks', async () => {
  const source = await readFile(resolve(process.cwd(), 'tests/e2e/extension.spec.ts'), 'utf8');
  expect(source).not.toMatch(/\bbrowser\.(?:runtime|storage|tabs|action)/);
  expect(source).not.toMatch(/headless:\s*true/);
  expect(source).toMatch(/headless:\s*false/);
});
