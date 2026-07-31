import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'output');
const assets = [
  ['promo-small', 'promo-small-440x280.png'],
  ['promo-marquee', 'promo-marquee-1400x560.png'],
  ['screenshot-global', 'screenshot-global-1280x800.png'],
  ['screenshot-zh', 'screenshot-zh-CN-1280x800.png'],
];

await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1500, height: 900 },
  deviceScaleFactor: 1,
});

await page.goto(pathToFileURL(path.join(root, 'source', 'index.html')).href);
await page.evaluate(() => document.fonts.ready);

for (const [id, filename] of assets) {
  const asset = page.locator(`#${id}`);
  await asset.screenshot({
    path: path.join(output, filename),
    animations: 'disabled',
    omitBackground: false,
  });
}

await browser.close();

console.log(`Rendered ${assets.length} Chrome Web Store assets to ${output}`);
