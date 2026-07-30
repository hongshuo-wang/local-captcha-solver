import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  PPOCRV6_ASSETS,
  installPpOcrV6Archive,
} from './ppocrv6-assets';
import type { PpOcrV6Variant } from './ppocrv6-assets';

export async function downloadPpOcrV6Variant(
  root: string,
  variant: PpOcrV6Variant,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const asset = PPOCRV6_ASSETS[variant];
  const response = await fetchImpl(asset.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${asset.modelName}: HTTP ${response.status}`);
  }
  await installPpOcrV6Archive(
    root,
    variant,
    asset,
    new Uint8Array(await response.arrayBuffer()),
  );
}

export async function main(root = process.cwd()): Promise<void> {
  for (const variant of ['tiny', 'small'] as const) {
    console.log(`Downloading official ${PPOCRV6_ASSETS[variant].modelName}...`);
    await downloadPpOcrV6Variant(root, variant);
    console.log(`Verified ${PPOCRV6_ASSETS[variant].modelName}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
