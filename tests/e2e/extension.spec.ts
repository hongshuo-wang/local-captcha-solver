import { expect, test, chromium, type BrowserContext, type Page, type Route, type Worker } from '@playwright/test';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { startFixtureServer, type FixtureServer } from './fixtures/server';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../..');
const e2eVariant = process.env.CAPTCHA_E2E_VARIANT ?? 'default';
const usePpOcrV6Small = e2eVariant === 'ppocrv6-small';
const useCaptchaCtc = e2eVariant === 'captcha-ctc';
const e2eTarget = process.env.CAPTCHA_E2E_TARGET === 'edge' ? 'edge' : 'chrome';
const extensionPath = join(
  repositoryRoot,
  usePpOcrV6Small ? '.output/chrome-mv3-ppocrv6-small'
    : useCaptchaCtc ? `.output/${e2eTarget}-mv3-captcha-ctc`
      : `.output/${e2eTarget}-mv3`,
);

interface ExtensionApi {
  scripting: { getRegisteredContentScripts(): Promise<readonly { id: string }[]> };
  tabs: {
    query(query: { url: string[] }): Promise<readonly { id?: number }[]>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
}

let server: FixtureServer;
let context: BrowserContext;
let worker: Worker;
let profileDirectory: string | undefined;
const extensionNetworkRequests: string[] = [];

async function contentMessage(page: Page, request: unknown): Promise<unknown> {
  return worker.evaluate(async ({ payload, pageUrl }) => {
    const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
    if (api === undefined) throw new Error('Extension API unavailable');
    const [tab] = await api.tabs.query({ url: [pageUrl] });
    if (tab?.id === undefined) throw new Error(`No fixture tab for ${pageUrl}`);
    return api.tabs.sendMessage(tab.id, payload);
  }, { payload: request, pageUrl: page.url() });
}

async function waitForContent(page: Page): Promise<void> {
  await page.bringToFront();
  await expect.poll(async () => {
    try { return await contentMessage(page, { type: 'captcha:ping' }); } catch (error) {
      if (error instanceof Error && error.message.includes('Receiving end does not exist')) return undefined;
      throw error;
    }
  }).toEqual({ ok: true });
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
  const response = await fetch(`${server.serverOrigin}${requestUrl.pathname}${requestUrl.search}`);
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  });
}

async function openActionPopup(activePage: Page): Promise<Page> {
  const popup = await context.newPage();
  await activePage.bringToFront();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  return popup;
}

test.beforeAll(async () => {
  const buildScript = usePpOcrV6Small ? 'build:ppocrv6-small'
    : useCaptchaCtc ? `build:captcha-ctc:${e2eTarget}`
      : e2eTarget === 'edge' ? 'build:edge' : 'build';
  await execFileAsync('npm', ['run', buildScript], {
    cwd: repositoryRoot,
    env: { ...process.env, CAPTCHA_E2E_PREGRANT: '1' },
  });
  if (process.platform === 'linux' && process.env.DISPLAY === undefined && process.env.WAYLAND_DISPLAY === undefined) {
    throw new Error('Headed Playwright Chromium is required for MV3 popup E2E tests. Set DISPLAY/WAYLAND_DISPLAY or run: xvfb-run -a npm run test:e2e');
  }
  profileDirectory = await mkdtemp(join(tmpdir(), 'local-captcha-solver-e2e-'));
  let executablePath: string | undefined;
  if (e2eTarget === 'edge') {
    executablePath = process.env.CAPTCHA_EDGE_EXECUTABLE
      ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    await access(executablePath);
  }
  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      headless: false,
      ...(executablePath === undefined ? {} : { executablePath }),
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
  } catch (error) {
    throw new Error(`Playwright Chromium is required for extension E2E tests. Run: npx playwright install chromium. Original error: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (usePpOcrV6Small || useCaptchaCtc) {
    context.on('console', (entry) => console.log(`[experience browser ${entry.type()}] ${entry.text()}`));
    context.on('weberror', (entry) => console.error('[experience browser error]', entry.error()));
  }
  server = await startFixtureServer();
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

test('registers one global content script and automatically fills after access is granted', async () => {
  await expect.poll(() => worker.evaluate(async () => {
    const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
    if (api === undefined) throw new Error('Extension API unavailable');
    return (await api.scripting.getRegisteredContentScripts()).map((script) => script.id);
  })).toContain('captcha-auto-global');
  const page = await open('/automatic.html');
  await expect(page.locator('#captcha-answer')).toHaveValue('14975', { timeout: 30_000 });
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
  await expect(dynamic.locator('#captcha-answer')).toHaveValue('14975');
  const replace = dynamic.locator('[data-local-captcha-status]').locator('button.action', { hasText: '替换' });
  await expect(replace).toBeVisible({ timeout: 30_000 });
  await replace.click();
  await expect(dynamic.locator('#captcha-answer')).toHaveValue('99067', { timeout: 30_000 });
  expect(await submitCount(dynamic)).toBe(0);

  const prefilled = await open('/automatic.html?prefilled=1');
  await expect(prefilled.locator('#captcha-answer')).toHaveValue('already-entered');
  await expect.poll(() => submitCount(prefilled)).toBe(0);

  const ambiguous = await open('/ambiguous.html');
  await waitForContent(ambiguous);
  await ambiguous.locator('#focused-answer').focus();
  await expect(contentMessage(ambiguous, { type: 'captcha:context-image', srcUrl: `${server.origin}/fixtures/digits-002.png` })).resolves.toMatchObject({ state: 'filled' });
  await expect(ambiguous.locator('#first-answer')).toHaveValue('already-entered');
  await expect(ambiguous.locator('#focused-answer')).toHaveValue('14975');
  expect(await submitCount(ambiguous)).toBe(0);

  await automatic.close();
  await dynamic.close();
  await prefilled.close();
  await ambiguous.close();
});

test('recognizes already-loaded CAPTCHA data offline and keeps popup unsupported state disabled', async () => {
  const page = await open('/automatic.html');
  await waitForContent(page);
  await expect(page.locator('#captcha-answer')).toHaveValue('14975', { timeout: 30_000 });
  await page.evaluate(() => { (document.querySelector('#captcha-answer') as HTMLInputElement).value = ''; });
  await context.setOffline(true);
  await expect(contentMessage(page, { type: 'captcha:context-image', srcUrl: `${server.origin}/fixtures/digits-002.png` })).resolves.toMatchObject({ state: 'filled' });
  await expect(page.locator('#captcha-answer')).toHaveValue('14975', { timeout: 30_000 });
  expect(await submitCount(page)).toBe(0);
  await context.setOffline(false);

  const unsupported = await context.newPage();
  await unsupported.goto('chrome://version/');
  await unsupported.bringToFront();
  const popup = await openActionPopup(unsupported);
  await expect(popup.locator('#site-enabled')).toBeDisabled();
  await expect(popup.locator('[data-popup-status]')).toHaveText('当前页面不支持自动识别。');
  await page.close();
  await popup.close();
  await unsupported.close();

  expect(extensionNetworkRequests).toEqual([]);
  expect(server.requests.every((path) => path === '/automatic.html' || path === '/dynamic.html' || path === '/ambiguous.html' || path === '/fixtures/digits-002.png' || path === '/fixtures/digits-017.png')).toBe(true);
});
