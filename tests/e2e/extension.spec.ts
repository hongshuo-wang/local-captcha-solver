import { expect, test, chromium, type BrowserContext, type Page, type Route, type Worker } from '@playwright/test';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { startFixtureServer, type FixtureServer } from './fixtures/server';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../..');
const e2eTarget = process.env.CAPTCHA_E2E_TARGET === 'edge' ? 'edge' : 'chrome';
const extensionPath = join(
  repositoryRoot,
  `.output/${e2eTarget}-mv3`,
);

interface ExtensionApi {
  runtime: {
    getManifest(): { options_ui?: { open_in_tab?: boolean } };
    sendMessage(message: unknown): Promise<unknown>;
  };
  storage: {
    local: { set(values: Record<string, unknown>): Promise<void> };
  };
  scripting: { getRegisteredContentScripts(): Promise<readonly { id: string }[]> };
  permissions: { contains(details: { permissions: string[] }): Promise<boolean> };
  tabs: {
    query(query: { url?: string[]; active?: boolean; currentWindow?: boolean }): Promise<readonly { id?: number; url?: string }[]>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    update(tabId: number, properties: { active: boolean }): Promise<unknown>;
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
    const tab = (await api.tabs.query({})).find((candidate) => candidate.url === pageUrl);
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
  await activePage.bringToFront();
  const activeTabId = await worker.evaluate(async () => {
    const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
    if (api === undefined) throw new Error('Extension API unavailable');
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) throw new Error('No active browser tab');
    return tab.id;
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
  await worker.evaluate(async ({ tabId }) => {
    const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
    if (api === undefined) throw new Error('Extension API unavailable');
    await api.tabs.update(tabId, { active: true });
  }, { tabId: activeTabId });
  await popup.reload();
  return popup;
}

async function openOptionsPage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
  return page;
}

async function openOnboardingPage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/onboarding.html`);
  return page;
}

test.beforeAll(async () => {
  const buildScript = e2eTarget === 'edge' ? 'build:edge' : 'build';
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

test('registers globally and automatically fills after all-site access is explicitly selected', async () => {
  await worker.evaluate(async () => {
    const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
    if (api === undefined) throw new Error('Extension API unavailable');
    await api.storage.local.set({
      'captcha-settings': {
        version: 4,
        accessMode: 'all',
        disabledHosts: [],
        selectedSites: [],
        siteRecognitionModes: [],
        copyOnNoField: false,
        autoFill: true,
        recognitionShortcut: 'middle',
        interfaceLocale: 'system',
        onboardingComplete: false,
      },
    });
  });
  await expect.poll(() => worker.evaluate(async () => {
    const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
    if (api === undefined) throw new Error('Extension API unavailable');
    try {
      await api.runtime.sendMessage({ type: 'captcha:reconcile-access' });
      return true;
    } catch {
      return false;
    }
  })).toBe(true);
  await expect.poll(() => worker.evaluate(async () => {
    const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
    if (api === undefined) throw new Error('Extension API unavailable');
    return (await api.scripting.getRegisteredContentScripts()).map((script) => script.id);
  }), { timeout: 15_000 }).toContain('captcha-auto-global');
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
  const replace = dynamic.locator('[data-local-captcha-status]').locator('button.action', { hasText: /替换|Replace/ });
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

test('recognizes already-loaded CAPTCHA data offline and keeps popup unsupported state disabled', async ({}, testInfo) => {
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
  await expect(popup.locator('[data-popup-status]')).toHaveText(/当前页面不支持自动识别。|This page is not supported\./);
  await expect(popup.locator('.brand-mark')).toHaveJSProperty('complete', true);
  await expect(popup.locator('h1')).toHaveText('Captcha Helper');
  expect(await popup.locator('#app').evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }))).toEqual({ clientWidth: 360, scrollWidth: 360 });
  await popup.locator('#app').screenshot({ path: testInfo.outputPath('captcha-helper-popup.png') });
  await page.close();
  await popup.close();
  await unsupported.close();

  expect(extensionNetworkRequests).toEqual([]);
  expect(server.requests.every((path) => path === '/automatic.html' || path === '/dynamic.html' || path === '/ambiguous.html' || path === '/fixtures/digits-002.png' || path === '/fixtures/digits-017.png')).toBe(true);
});

test('renders standalone onboarding and settings without horizontal overflow', async ({}, testInfo) => {
  await expect.poll(() => context.pages().some((page) => page.url().endsWith('/onboarding.html'))).toBe(true);
  expect(await worker.evaluate(() => {
    const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
    return api?.runtime.getManifest().options_ui?.open_in_tab;
  })).toBe(true);
  const onboarding = await openOnboardingPage();
  await expect(onboarding).toHaveURL(/onboarding\.html/);
  await expect(onboarding.locator('[data-step="1"] h1')).toHaveText(/选择网站访问范围|Choose site access/);
  await expect(onboarding.locator('[data-next]')).toBeDisabled();
  expect(await onboarding.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await onboarding.screenshot({ path: testInfo.outputPath('captcha-helper-onboarding-access.png'), fullPage: true });

  await onboarding.setViewportSize({ width: 390, height: 844 });
  expect(await onboarding.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await onboarding.screenshot({ path: testInfo.outputPath('captcha-helper-onboarding-access-mobile.png'), fullPage: true });
  await onboarding.setViewportSize({ width: 1280, height: 720 });

  await onboarding.locator('[data-language]').selectOption('zh_CN');
  await expect(onboarding.locator('[data-step="1"] h1')).toHaveText('选择网站访问范围');

  await onboarding.locator('[data-onboarding-mode="selected"]').click();
  await expect(onboarding.locator('[data-next]')).toBeEnabled();
  await onboarding.locator('[data-next]').click();
  await expect(onboarding.locator('[data-step="2"]')).toBeVisible();
  await onboarding.locator('[data-next]').click();
  await expect(onboarding.locator('[data-demo-canvas]')).toBeVisible();
  expect(await onboarding.locator('[data-demo-canvas]').evaluate((canvas) => {
    const context2d = (canvas as HTMLCanvasElement).getContext('2d');
    if (context2d === null) return 0;
    const pixels = context2d.getImageData(0, 0, 240, 80).data;
    let nonBackgroundPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] < 230 || pixels[index + 1] < 230 || pixels[index + 2] < 210) nonBackgroundPixels += 1;
    }
    return nonBackgroundPixels;
  })).toBeGreaterThan(100);
  await onboarding.locator('[data-run-demo]').click();
  await expect(onboarding.locator('[data-demo-status]')).toHaveAttribute('data-state', 'success', { timeout: 30_000 });
  await expect(onboarding.locator('[data-demo-status]')).toContainText('识别结果：');
  await onboarding.screenshot({ path: testInfo.outputPath('captcha-helper-onboarding-complete-zh.png'), fullPage: true });
  await onboarding.locator('[data-language]').selectOption('en');
  await expect(onboarding.locator('[data-finish-guide]')).toHaveText('Finish setup and close');
  const onboardingClosed = onboarding.waitForEvent('close');
  await onboarding.locator('[data-finish-guide]').click();
  await onboardingClosed;

  const options = await openOptionsPage();
  await expect(options.locator('[data-view="access"]')).toBeVisible();
  await expect(options.locator('[data-access-mode]')).toBeVisible();
  expect(await options.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await options.screenshot({ path: testInfo.outputPath('captcha-helper-options-access.png'), fullPage: true });

  await options.locator('[data-nav="behavior"]').click();
  await expect(options.locator('[data-view="behavior"]')).toBeVisible();
  await expect(options.locator('#interface-locale')).toBeVisible();

  await options.locator('[data-nav="diagnostics"]').click();
  await expect(options.locator('[data-view="diagnostics"]')).toBeVisible();
  await options.locator('[data-retry-model]').click();
  await expect(options.locator('.model-state')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(options.locator('[data-retry-model]')).toBeEnabled();
  await options.screenshot({ path: testInfo.outputPath('captcha-helper-options-diagnostics.png'), fullPage: true });

  await options.locator('[data-clear-diagnostics]').click();
  await expect(options.locator('.diagnostic-stream')).toContainText(/暂无诊断记录。|No diagnostic records./);
  const statusPopup = await openActionPopup(options);
  await expect(statusPopup.locator('[data-model-indicator]')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
  await expect(statusPopup.locator('[data-latest-activity]')).toHaveText(/暂无执行记录|No activity yet/);
  await statusPopup.close();

  const manualPage = await open('/automatic.html');
  const manualPopup = await openActionPopup(manualPage);
  await expect.poll(() => manualPopup.evaluate(() => ({
    hostname: document.querySelector<HTMLElement>('[data-popup-hostname]')?.textContent,
    accessHidden: (document.querySelector<HTMLElement>('[data-access-panel]'))?.hidden,
    recognizeDisabled: document.querySelector<HTMLButtonElement>('[data-recognize-page]')?.disabled,
  }))).toEqual({
    hostname: 'captcha.e2e.test',
    accessHidden: true,
    recognizeDisabled: false,
  });
  await manualPopup.screenshot({ path: testInfo.outputPath('captcha-helper-popup-manual.png'), fullPage: true });
  await manualPopup.locator('[data-recognize-page]').click();
  await expect(manualPage.locator('#captcha-answer')).toHaveValue('14975', { timeout: 30_000 });
  expect(await submitCount(manualPage)).toBe(0);
  if (!manualPopup.isClosed()) await manualPopup.close();
  await manualPage.close();

  await options.bringToFront();
  await options.locator('.settings-nav [data-nav="access"]').click();
  await expect(options.locator('.status-dot')).toHaveAttribute('data-granted', 'false');

  await options.locator('[data-nav="behavior"]').click();
  await expect(options.locator('[data-view="behavior"]')).toBeVisible();

  await options.setViewportSize({ width: 390, height: 844 });
  expect(await options.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await options.screenshot({ path: testInfo.outputPath('captcha-helper-options-behavior-mobile.png'), fullPage: true });
  await options.close();
});

test('enables slider automation and handles a supported fixture in Edge', async () => {
  const page = await open('/slider.html');
  const popup = await openActionPopup(page);
  await expect(popup.locator('[data-slider-enabled]')).toBeEnabled();
  await expect(popup.locator('[data-run-slider]')).toBeEnabled();
  await expect(popup.locator('[data-slider-status]')).toHaveText(/此网站未开启自动处理。|Automatic slider handling is disabled for this site\./);
  await popup.locator('[data-slider-enabled]').click();
  await expect(popup.locator('[data-slider-enabled]')).toBeChecked();
  await expect.poll(() => worker.evaluate(async () => {
    const api = (globalThis as { browser?: ExtensionApi; chrome?: ExtensionApi }).browser ?? (globalThis as { chrome?: ExtensionApi }).chrome;
    return api?.permissions.contains({ permissions: ['debugger'] });
  })).toBe(true);
  await popup.locator('[data-run-slider]').click();
  await expect(popup.locator('[data-slider-status]')).toHaveText(/滑块验证已通过。|Slider verification passed\./, { timeout: 15_000 });
  await expect(page.locator('#status')).toHaveText('验证成功');
  await popup.close();
  await page.close();
});
