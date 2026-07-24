import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const forbiddenBrowserDependency = /\b(?:chrome|browser)\s*\.|from\s+['\"]wxt\/browser['\"]|import\s*\(\s*['\"]wxt\/browser['\"]\s*\)/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

describe('browser-independent import boundary', () => {
  it('keeps core and OCR modules free of browser runtime dependencies', async () => {
    const files = (await Promise.all(['src/core', 'src/ocr'].map(sourceFiles))).flat();
    const violations = await Promise.all(files.map(async (file) => ({ file, contents: await readFile(file, 'utf8') })));

    expect(violations.filter(({ contents }) => forbiddenBrowserDependency.test(contents)).map(({ file }) => file)).toEqual([]);
  });
});
