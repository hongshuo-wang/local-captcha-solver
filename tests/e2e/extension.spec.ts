import { expect, test, chromium, type BrowserContext, type Page, type Route, type Worker } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fixtureHostname, fixtureServerOrigin, startFixtureServer, type FixtureServer } from './fixtures/server';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../..');
const extensionPath = join(repositoryRoot, '.output/chrome-mv3');

let server: FixtureServer;
let context: BrowserContext;
let worker: Worker;
let profileDirectory: string | undefined;
const extensionNetworkRequests: string[] = [];

async function message(request: unknown): Promise<unknown> {
  return worker.evaluate((payload) => browser.runtime.sendMessage(payload), request);
}

async function contentMessage(request: unknown): Promise<unknown> {
  return worker.evaluate(async (payload) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('No active fixture tab');
    return browser.tabs.sendMessage(tab.id, payload);
  }, request);
}

async function waitForContent(page: Page): Promise<void> {
  await page.bringToFront();
  await expect.poll(() => contentMessage({ type: 'captcha:ping' })).toEqual({ ok: true });
}

async function open(path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${server.origin}${path}`);
  return page;
}

async function submitCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as typeof window & { __submitCount: number }).__submitCount);
}

async function fulfillFixtureRequest(route: Route): Promise<void> {
  const requestUrl = new URL(route.request().url());
  const response = await fetch(`${fixtureServerOrigin}${requestUrl.pathname}${requestUrl.search}`);
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  });
}

async function openActionPopup(): Promise<Page> {
  const extensionId = new URL(worker.url()).host;
  const pages = new Set(context.pages());
  const popupPromise = context.waitForEvent('page', (page) => !pages.has(page));
  await worker.evaluate(() => browser.action.openPopup());
  const popup = await popupPromise;
  await popup.waitForURL(`chrome-extension://${extensionId}/popup.html`);
  return popup;
}

test.beforeAll(async () => {
  await execFileAsync('npm', ['run', 'build'], { cwd: repositoryRoot });
  server = await startFixtureServer();
  profileDirectory = await mkdtemp(join(tmpdir(), 'local-captcha-solver-e2e-'));
  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
  } catch (error) {
    throw new Error(`Playwright Chromium is required for extension E2E tests. Run: npx playwright install chromium. Original error: ${error instanceof Error ? error.message : String(error)}`);
  }
  await context.route(`${server.origin}/**`, fulfillFixtureRequest);
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  context.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith(server.origin)) extensionNetworkRequests.push(url);
  });
});

test.afterAll(async () => {
  await context?.close();
  await server?.close();
  if (profileDirectory !== undefined) await rm(profileDirectory, { recursive: true, force: true });
});

test('enables the current local site and persists only versioned settings', async () => {
  const page = await open('/automatic.html');
  await expect.poll(() => message({ type: 'captcha:get-site-state' })).toEqual({ enabled: false });
  await page.bringToFront();
  const popup = await openActionPopup();
  await expect(popup.locator('[data-popup-hostname]')).toHaveText(fixtureHostname);
  await expect(popup.locator('#site-enabled')).not.toBeChecked();
  await popup.locator('#site-enabled').check();
  await expect(popup.locator('[data-popup-status]')).toHaveText('Automatic recognition is on.');
  await expect.poll(() => message({ type: 'captcha:get-site-state' })).toEqual({ enabled: true });
  await expect.poll(async () => worker.evaluate(() => browser.storage.local.get())).toEqual({
    'captcha-settings': { version: 1, allowlistedHosts: [fixtureHostname] },
  });
  await popup.close();
  await page.close();
});

test('fills known local digit CAPTCHAs without submitting or overwriting user input', async () => {
  const automatic = await open('/automatic.html');
  await expect(automatic.locator('#captcha-answer')).toHaveValue('14975', { timeout: 30_000 });
  await expect(automatic.locator('#captcha-answer')).toHaveAttribute('data-controlled-value', '14975');
  expect(await submitCount(automatic)).toBe(0);

  const dynamic = await open('/dynamic.html');
  await expect(dynamic.locator('#captcha-answer')).toHaveValue('14975', { timeout: 30_000 });
  await dynamic.locator('#refresh').click();
  await expect(dynamic.locator('#captcha-answer')).toHaveValue('99067', { timeout: 30_000 });
  expect(await submitCount(dynamic)).toBe(0);

  const prefilled = await open('/automatic.html?prefilled=1');
  await expect(prefilled.locator('#captcha-answer')).toHaveValue('already-entered');
  await expect.poll(() => submitCount(prefilled)).toBe(0);

  const ambiguous = await open('/ambiguous.html');
  await waitForContent(ambiguous);
  await ambiguous.locator('#focused-answer').focus();
  await expect(contentMessage({ type: 'captcha:context-image', srcUrl: `${server.origin}/fixtures/digits-002.png` })).resolves.toMatchObject({ state: 'filled' });
  await expect(ambiguous.locator('#first-answer')).toHaveValue('already-entered');
  await expect(ambiguous.locator('#focused-answer')).toHaveValue('14975');
  expect(await submitCount(ambiguous)).toBe(0);

  await automatic.close();
  await dynamic.close();
  await prefilled.close();
  await ambiguous.close();
});

test('recognizes already-loaded CAPTCHA data offline and keeps popup unsupported state disabled', async () => {
  const page = await open('/automatic.html?prefilled=1');
  await waitForContent(page);
  await page.evaluate(() => { (document.querySelector('#captcha-answer') as HTMLInputElement).value = ''; });
  await context.setOffline(true);
  await expect(contentMessage({ type: 'captcha:scan' })).resolves.toEqual({ queued: true });
  await expect(page.locator('#captcha-answer')).toHaveValue('14975', { timeout: 30_000 });
  expect(await submitCount(page)).toBe(0);
  await context.setOffline(false);

  const unsupported = await context.newPage();
  await unsupported.goto('chrome://version/');
  await unsupported.bringToFront();
  const popup = await openActionPopup();
  await expect(popup.locator('#site-enabled')).toBeDisabled();
  await expect(popup.locator('[data-popup-status]')).toHaveText('Automatic recognition is unavailable on this page.');
  await page.close();
  await popup.close();
  await unsupported.close();

  expect(extensionNetworkRequests).toEqual([]);
  expect(server.requests.every((path) => path === '/automatic.html' || path === '/dynamic.html' || path === '/ambiguous.html' || path === '/fixtures/digits-002.png' || path === '/fixtures/digits-017.png')).toBe(true);
});
