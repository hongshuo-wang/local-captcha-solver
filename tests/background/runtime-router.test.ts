import { describe, expect, it, vi } from 'vitest';

import { createRuntimeRouter } from '../../src/background/runtime-router';
import { createModelStatusStore } from '../../src/background/model-status';
import { DEFAULT_SETTINGS } from '../../src/platform/settings-store';

function harness(options: { pagePermission?: boolean; stateEnabled?: boolean } = {}) {
  const fetch = vi.fn(async () => ({ state: 'ready' as const, bytes: new Uint8Array([1]), mimeType: 'image/png' }));
  const recognize = vi.fn(async () => [{ mode: 'digits' as const, text: '42', confidence: .9 }]);
  const warmup = vi.fn(async () => undefined);
  const contains = vi.fn(async () => options.pagePermission ?? true);
  const activeTab = vi.fn(async () => ({ id: 4, url: 'https://portal.example.test/login' }));
  const enablePage = vi.fn(async () => ({ enabled: true }));
  const disablePage = vi.fn(async () => ({ disabled: true, permissionRemoved: false }));
  let copyOnNoField = false;
  let autoFill = true;
  let recognitionShortcut: 'middle' | 'alt-click' = 'middle';
  const readSettings = vi.fn(async () => ({ ...DEFAULT_SETTINGS, copyOnNoField, autoFill, recognitionShortcut }));
  const setCopyOnNoField = vi.fn(async (enabled: boolean) => { copyOnNoField = enabled; });
  const setAutoFill = vi.fn(async (enabled: boolean) => { autoFill = enabled; });
  const setRecognitionShortcut = vi.fn(async (shortcut: 'middle' | 'alt-click') => { recognitionShortcut = shortcut; });
  const modelStatus = createModelStatusStore(() => 1000);
  return { fetch, recognize, warmup, contains, activeTab, enablePage, disablePage, router: createRuntimeRouter({
    permissions: { contains }, imageFetcher: { fetch }, inferenceHost: { recognize, warmup }, modelStatus,
    siteState: { isEnabled: vi.fn(async () => options.stateEnabled ?? false), enablePage, disablePage },
    settings: { read: readSettings, setCopyOnNoField, setAutoFill, setRecognitionShortcut },
    activeTab,
  }), readSettings, setCopyOnNoField, setAutoFill, setRecognitionShortcut };
}

const sender = { tab: { id: 4, url: 'https://portal.example.test/login' }, url: 'https://portal.example.test/login' };

describe('background runtime router', () => {
  it('rejects image acquisition from a sender page without origin permission and never requests it', async () => {
    const app = harness({ pagePermission: false });
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://cdn.example.test/captcha.png' }, sender)).resolves.toEqual({ state: 'image_unavailable', reason: 'permission' });
    expect(app.fetch).not.toHaveBeenCalled();
    expect(app.contains).toHaveBeenCalledWith({ origins: ['https://portal.example.test/*'] });
  });

  it('maps a rejected page-permission check to the typed acquisition denial', async () => {
    const app = harness();
    app.contains.mockRejectedValueOnce(new Error('permission API unavailable'));
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://cdn.example.test/captcha.png' }, sender)).resolves.toEqual({ state: 'image_unavailable', reason: 'permission' });
    expect(app.fetch).not.toHaveBeenCalled();
  });

  it('routes validated acquisition and OCR requests without result cross-talk', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://portal.example.test/captcha.png' }, sender)).resolves.toMatchObject({ state: 'ready' });
    await expect(app.router.handle({ type: 'captcha:recognize', imageDataUrl: 'data:image/png;base64,AQ==', revision: 'r1', modes: ['digits'] }, sender)).resolves.toEqual([{ mode: 'digits', text: '42', confidence: .9 }]);
    expect(app.recognize).toHaveBeenCalledWith('data:image/png;base64,AQ==', 'r1', ['digits']);
  });

  it('publishes recognition success and exposes the model status snapshot', async () => {
    const app = harness();
    await app.router.handle({ type: 'captcha:recognize', imageDataUrl: 'data:image/png;base64,AQ==', revision: 'r1', modes: ['digits'] }, sender);
    const snapshot = await app.router.handle({ type: 'captcha:get-model-status' }, {});
    expect(snapshot).toMatchObject({ status: 'loading', logs: [{ kind: 'recognition', outcome: 'started' }, { kind: 'recognition', outcome: 'success' }] });
    expect((snapshot as { logs: readonly { durationMs?: number }[] }).logs.at(-1)?.durationMs).toEqual(expect.any(Number));
  });

  it('records guarded workflow activity without accepting popup or malformed events', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:record-activity', outcome: 'filled' }, sender)).resolves.toEqual({ recorded: true });
    await expect(app.router.handle({ type: 'captcha:record-activity', outcome: 'filled' }, {})).resolves.toEqual({ recorded: false });
    await expect(app.router.handle({ type: 'captcha:record-activity', outcome: 'SECRET123' }, sender)).resolves.toEqual({ recorded: false });
    const snapshot = await app.router.handle({ type: 'captcha:get-model-status' }, {});
    expect(snapshot).toMatchObject({ logs: [expect.objectContaining({ kind: 'workflow', message: '已填入验证码' })] });
  });

  it('records structured activity and only lets the extension popup clear diagnostics', async () => {
    const app = harness();
    await expect(app.router.handle({
      type: 'captcha:record-activity',
      outcome: 'confirmation',
      diagnostic: { trigger: 'automatic', candidateId: 'image-2', width: 120, height: 40, source: 'captcha.png?token=ignored', recognizedText: '12+7=?', fillValue: '19', confidence: .97, match: 'ambiguous', reason: 'ambiguous_field' },
    }, sender)).resolves.toEqual({ recorded: true });
    const before = await app.router.handle({ type: 'captcha:get-model-status' }, {});
    expect(before).toMatchObject({ logs: [expect.objectContaining({ site: 'portal.example.test', candidateId: 'image-2', source: 'captcha.png', recognizedText: '12+7=?', fillValue: '19', confidence: .97 })] });

    await expect(app.router.handle({ type: 'captcha:clear-diagnostics' }, sender)).resolves.toEqual({ cleared: false });
    await expect(app.router.handle({ type: 'captcha:clear-diagnostics' }, {
      tab: { id: 8, url: 'chrome-extension://captcha-helper/options.html' },
      url: 'chrome-extension://captcha-helper/options.html',
    })).resolves.toMatchObject({ cleared: true, snapshot: { logs: [] } });
    await expect(app.router.handle({ type: 'captcha:clear-diagnostics' }, {})).resolves.toMatchObject({ cleared: true, snapshot: { logs: [] } });
  });

  it('retries model warmup without requiring a page sender', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:retry-model-warmup' }, {})).resolves.toMatchObject({ status: 'loading' });
    expect(app.warmup).toHaveBeenCalledOnce();
  });

  it('accepts same-origin iframe/path senders but rejects cross-origin sender URLs', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://portal.example.test/captcha.png' }, { tab: { id: 4, url: 'https://portal.example.test/login' }, url: 'https://portal.example.test/frame/captcha' })).resolves.toMatchObject({ state: 'ready' });
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://cdn.example.test/captcha.png' }, { tab: { id: 4, url: 'https://portal.example.test/login' }, url: 'https://other.example.test/frame/captcha' })).resolves.toEqual({ state: 'image_unavailable', reason: 'permission' });
  });

  it('acquires same-origin images on an IP address with a port', async () => {
    const app = harness();
    const intranetSender = { tab: { id: 4, url: 'http://172.26.54.105:9000/login' }, url: 'http://172.26.54.105:9000/login' };
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'http://172.26.54.105:9000/captcha.png' }, intranetSender)).resolves.toMatchObject({ state: 'ready' });
    expect(app.contains).toHaveBeenCalledWith({ origins: ['http://172.26.54.105/*'] });
  });

  it('rejects a cross-origin image URL even when the sender page is permitted', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:acquire-image', url: 'https://cdn.example.test/captcha.png' }, sender)).resolves.toEqual({ state: 'image_unavailable', reason: 'permission' });
    expect(app.fetch).not.toHaveBeenCalled();
  });

  it('does not report a site as enabled after global access is removed', async () => {
    const app = harness({ pagePermission: false, stateEnabled: true });
    await expect(app.router.handle({ type: 'captcha:get-site-state' }, sender)).resolves.toEqual({ enabled: false });
  });

  it('uses the active website for state reads sent by a trusted extension tab', async () => {
    const app = harness({ pagePermission: true, stateEnabled: true });
    await expect(app.router.handle({ type: 'captcha:get-site-state' }, {
      tab: { id: 8, url: 'chrome-extension://captcha-helper/popup.html' },
      url: 'chrome-extension://captcha-helper/popup.html',
    })).resolves.toEqual({ enabled: true });
    expect(app.activeTab).toHaveBeenCalledOnce();
  });

  it('starts non-blocking model warmup when an enabled site is restored or newly enabled', async () => {
    const app = harness({ pagePermission: true, stateEnabled: true });
    app.warmup.mockImplementation(() => new Promise(() => undefined));

    await expect(app.router.handle({ type: 'captcha:get-site-state' }, sender)).resolves.toEqual({ enabled: true });
    await expect(app.router.handle({ type: 'captcha:set-site-enabled', enabled: true, hostname: 'portal.example.test' }, sender)).resolves.toEqual({ enabled: true });
    expect(app.warmup).toHaveBeenCalledOnce();
  });

  it('does not repeat normal warmup after the model is ready', async () => {
    const app = harness({ pagePermission: true, stateEnabled: true });
    await app.router.handle({ type: 'captcha:get-site-state' }, sender);
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(await app.router.handle({ type: 'captcha:get-model-status' }, {})).toMatchObject({ status: 'ready' });

    await app.router.handle({ type: 'captcha:get-site-state' }, sender);
    expect(app.warmup).toHaveBeenCalledOnce();
  });

  it('allows a forced retry and ignores a stale earlier warmup completion', async () => {
    const app = harness();
    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    app.warmup
      .mockImplementationOnce(() => new Promise<undefined>((resolve) => { resolveFirst = () => resolve(undefined); }))
      .mockImplementationOnce(() => new Promise<undefined>((resolve) => { resolveSecond = () => resolve(undefined); }));

    await expect(app.router.handle({ type: 'captcha:retry-model-warmup' }, {})).resolves.toMatchObject({ status: 'loading' });
    await expect(app.router.handle({ type: 'captcha:retry-model-warmup' }, {})).resolves.toMatchObject({ status: 'loading' });
    expect(app.warmup).toHaveBeenCalledTimes(2);

    resolveFirst?.();
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    expect(await app.router.handle({ type: 'captcha:get-model-status' }, {})).toMatchObject({ status: 'loading' });
    resolveSecond?.();
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    expect(await app.router.handle({ type: 'captcha:get-model-status' }, {})).toMatchObject({ status: 'ready' });
  });

  it('records a synchronous warmup throw as a failed forced retry', async () => {
    const app = harness();
    app.warmup.mockImplementationOnce(() => { throw new Error('model load failed'); });
    await app.router.handle({ type: 'captcha:retry-model-warmup' }, {});
    for (let index = 0; index < 3; index += 1) await Promise.resolve();
    expect(await app.router.handle({ type: 'captcha:get-model-status' }, {})).toMatchObject({ status: 'error', logs: [{ kind: 'warmup', outcome: 'started' }, { kind: 'warmup', outcome: 'failure' }] });
  });

  it('never falls back to activeTab for malformed or cross-origin tab senders', async () => {
    const app = harness({ stateEnabled: true });
    await expect(app.router.handle({ type: 'captcha:get-site-state' }, { tab: { id: 99, url: 'not a page' }, url: 'not a page' })).resolves.toEqual({ enabled: false });
    await expect(app.router.handle({ type: 'captcha:set-site-enabled', enabled: true }, { tab: { id: 99, url: 'https://portal.example.test/' }, url: 'https://other.example.test/' })).resolves.toEqual({ enabled: false, reason: 'invalid-request' });
    expect(app.activeTab).not.toHaveBeenCalled();
  });

  it('rejects a popup toggle after the active tab changes without mutating either site', async () => {
    const app = harness();
    app.activeTab.mockResolvedValueOnce({ id: 8, url: 'https://other.example.test/login' });

    await expect(app.router.handle({ type: 'captcha:set-site-enabled', enabled: true, hostname: 'portal.example.test' }, {})).resolves.toEqual({ enabled: false, reason: 'site-changed' });

    expect(app.enablePage).not.toHaveBeenCalled();
    expect(app.disablePage).not.toHaveBeenCalled();
  });

  it('forwards the popup grant guard only from an extension sender', async () => {
    const app = harness();

    await expect(app.router.handle({ type: 'captcha:set-site-enabled', enabled: true, hostname: 'portal.example.test', permissionAlreadyGranted: false }, {})).resolves.toEqual({ enabled: true });
    await expect(app.router.handle({ type: 'captcha:set-site-enabled', enabled: true, hostname: 'portal.example.test', permissionAlreadyGranted: false }, sender)).resolves.toEqual({ enabled: true });

    expect(app.enablePage).toHaveBeenNthCalledWith(1, 'https://portal.example.test/login', { permissionAlreadyGranted: false });
    expect(app.enablePage).toHaveBeenNthCalledWith(2, 'https://portal.example.test/login');
  });

  it.each([undefined, '', 42, 'Portal.Example.test'])('rejects an invalid expected hostname (%j) before mutation', async (hostname) => {
    const app = harness();

    await expect(app.router.handle({ type: 'captcha:set-site-enabled', enabled: true, hostname }, {})).resolves.toEqual({ enabled: false, reason: 'invalid-request' });

    expect(app.enablePage).not.toHaveBeenCalled();
    expect(app.disablePage).not.toHaveBeenCalled();
  });

  it('maps malformed and inference errors to guarded OCR failures', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:recognize', imageDataUrl: 'not a data URL', revision: '', modes: ['invalid'] }, sender)).resolves.toEqual({ type: 'captcha:recognition-error', code: 'recognition_failed' });
    app.recognize.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'model_unavailable' }));
    await expect(app.router.handle({ type: 'captcha:recognize', imageDataUrl: 'data:image/png;base64,AQ==', revision: 'r1', modes: ['digits'] }, sender)).resolves.toEqual({ type: 'captcha:recognition-error', code: 'model_unavailable' });
    const status = await app.router.handle({ type: 'captcha:get-model-status' }, {});
    expect(status).toMatchObject({ status: 'error', logs: [
      { kind: 'recognition', outcome: 'started' },
      { kind: 'recognition', outcome: 'failure' },
      { kind: 'recognition', outcome: 'started' },
      { kind: 'recognition', outcome: 'failure' },
    ] });
    expect((status as { logs: readonly { outcome: string; durationMs?: number }[] }).logs.filter((log) => log.outcome !== 'started').every((log) => typeof log.durationMs === 'number')).toBe(true);
    expect(await app.router.handle({ type: 'other' }, sender)).toBeUndefined();
  });

  it('reads and updates the no-field copy preference', async () => {
    const app = harness();

    await expect(app.router.handle({ type: 'captcha:get-preferences' }, sender)).resolves.toEqual({ copyOnNoField: false, autoFill: true, recognitionShortcut: 'middle', accessMode: 'selected', interfaceLocale: 'system' });
    await expect(app.router.handle({ type: 'captcha:set-preferences', copyOnNoField: true }, sender)).resolves.toEqual({ copyOnNoField: true, autoFill: true, recognitionShortcut: 'middle' });
    expect(app.setCopyOnNoField).toHaveBeenCalledWith(true);
    await expect(app.router.handle({ type: 'captcha:set-preferences', autoFill: false }, sender)).resolves.toEqual({ copyOnNoField: true, autoFill: false, recognitionShortcut: 'middle' });
    expect(app.setAutoFill).toHaveBeenCalledWith(false);

    await expect(app.router.handle({ type: 'captcha:set-preferences', recognitionShortcut: 'alt-click' }, sender)).resolves.toEqual({ copyOnNoField: true, autoFill: false, recognitionShortcut: 'alt-click' });
    expect(app.setRecognitionShortcut).toHaveBeenCalledWith('alt-click');
  });

  it('rejects malformed preference updates without mutating storage', async () => {
    const app = harness();

    await expect(app.router.handle({ type: 'captcha:set-preferences', copyOnNoField: 'no' }, sender)).resolves.toEqual({ copyOnNoField: false, autoFill: true, recognitionShortcut: 'middle', reason: 'invalid-request' });
    await expect(app.router.handle({ type: 'captcha:set-preferences', recognitionShortcut: 'double-click' }, sender)).resolves.toMatchObject({ reason: 'invalid-request' });
    expect(app.setCopyOnNoField).not.toHaveBeenCalled();
    expect(app.setAutoFill).not.toHaveBeenCalled();
    expect(app.setRecognitionShortcut).not.toHaveBeenCalled();
  });

  it('does not let a page sender read or change slider authorization', async () => {
    const app = harness();
    await expect(app.router.handle({ type: 'captcha:get-slider-state' }, sender)).resolves.toEqual({ supported: false, enabled: false, debuggerGranted: false });
    await expect(app.router.handle({ type: 'captcha:set-slider-enabled', enabled: true, hostname: 'portal.example.test' }, sender)).resolves.toMatchObject({ reason: 'invalid-request' });
  });

  it('rejects manual slider execution until the active site has host permission', async () => {
    const app = harness({ pagePermission: false });
    const solve = vi.fn(async () => ({ state: 'success' as const }));
    const router = createRuntimeRouter({
      permissions: { contains: app.contains },
      imageFetcher: { fetch: app.fetch },
      inferenceHost: { recognize: app.recognize, warmup: app.warmup },
      modelStatus: createModelStatusStore(() => 1000),
      siteState: { isEnabled: vi.fn(async () => false), enablePage: app.enablePage, disablePage: app.disablePage },
      settings: { read: app.readSettings, setCopyOnNoField: app.setCopyOnNoField, setAutoFill: app.setAutoFill, setRecognitionShortcut: app.setRecognitionShortcut },
      sliderSolver: { solve },
      activeTab: app.activeTab,
    });
    await expect(router.handle({ type: 'captcha:run-slider' }, { tab: { id: 8, url: 'chrome-extension://test/popup.html' }, url: 'chrome-extension://test/popup.html' })).resolves.toEqual({ state: 'permission-denied', reason: 'site-access-not-granted' });
    expect(solve).not.toHaveBeenCalled();
  });

  it('does not start a manual drag after the active tab navigates', async () => {
    const app = harness({ pagePermission: true });
    app.activeTab
      .mockResolvedValueOnce({ id: 4, url: 'https://portal.example.test/login' })
      .mockResolvedValueOnce({ id: 4, url: 'https://portal.example.test/other' });
    const solve = vi.fn(async () => ({ state: 'success' as const }));
    const router = createRuntimeRouter({
      permissions: { contains: app.contains },
      imageFetcher: { fetch: app.fetch },
      inferenceHost: { recognize: app.recognize, warmup: app.warmup },
      modelStatus: createModelStatusStore(() => 1000),
      siteState: { isEnabled: vi.fn(async () => false), enablePage: app.enablePage, disablePage: app.disablePage },
      settings: { read: app.readSettings, setCopyOnNoField: app.setCopyOnNoField, setAutoFill: app.setAutoFill, setRecognitionShortcut: app.setRecognitionShortcut },
      sliderSolver: { solve },
      activeTab: app.activeTab,
    });

    await expect(router.handle({ type: 'captcha:run-slider' }, {})).resolves.toEqual({ state: 'page-inactive', reason: 'page-changed' });
    expect(solve).not.toHaveBeenCalled();
  });

  it('trusts Edge extension pages for slider popup commands', async () => {
    const app = harness({ pagePermission: true });
    const solve = vi.fn(async () => ({ state: 'success' as const }));
    const router = createRuntimeRouter({
      permissions: { contains: app.contains },
      imageFetcher: { fetch: app.fetch },
      inferenceHost: { recognize: app.recognize, warmup: app.warmup },
      modelStatus: createModelStatusStore(() => 1000),
      siteState: { isEnabled: vi.fn(async () => false), enablePage: app.enablePage, disablePage: app.disablePage },
      settings: {
        read: app.readSettings,
        setCopyOnNoField: app.setCopyOnNoField,
        setAutoFill: app.setAutoFill,
        setRecognitionShortcut: app.setRecognitionShortcut,
        isSliderEnabled: vi.fn(async () => false),
        setSliderEnabled: vi.fn(async () => undefined),
      },
      sliderSolver: { solve },
      activeTab: app.activeTab,
    });
    await expect(router.handle({ type: 'captcha:get-slider-state' }, { url: 'edge-extension://test/popup.html' })).resolves.toMatchObject({ supported: true });
  });

  it('cancels the active tab run when slider automation is disabled', async () => {
    const app = harness({ pagePermission: true });
    const cancel = vi.fn();
    const setSliderEnabled = vi.fn(async () => undefined);
    const router = createRuntimeRouter({
      permissions: { contains: app.contains },
      imageFetcher: { fetch: app.fetch },
      inferenceHost: { recognize: app.recognize, warmup: app.warmup },
      modelStatus: createModelStatusStore(() => 1000),
      siteState: { isEnabled: vi.fn(async () => false), enablePage: app.enablePage, disablePage: app.disablePage },
      settings: {
        read: app.readSettings,
        setCopyOnNoField: app.setCopyOnNoField,
        setAutoFill: app.setAutoFill,
        setRecognitionShortcut: app.setRecognitionShortcut,
        isSliderEnabled: vi.fn(async () => true),
        setSliderEnabled,
      },
      sliderSolver: { solve: vi.fn(async () => ({ state: 'success' as const })), cancel },
      activeTab: app.activeTab,
    });

    await expect(router.handle({ type: 'captcha:set-slider-enabled', enabled: false, hostname: 'portal.example.test' }, {})).resolves.toMatchObject({ enabled: false });
    expect(setSliderEnabled).toHaveBeenCalledWith('portal.example.test', false);
    expect(cancel).toHaveBeenCalledWith(4);
  });

  it('exposes automatic slider progress and its terminal result to the popup', async () => {
    const app = harness({ pagePermission: true });
    let finishSolve: ((value: { state: 'success'; confidence: number }) => void) | undefined;
    const solve = vi.fn(() => new Promise<{ state: 'success'; confidence: number }>((resolve) => { finishSolve = resolve; }));
    const router = createRuntimeRouter({
      permissions: { contains: app.contains },
      imageFetcher: { fetch: app.fetch },
      inferenceHost: { recognize: app.recognize, warmup: app.warmup },
      modelStatus: createModelStatusStore(() => 1000),
      siteState: { isEnabled: vi.fn(async () => false), enablePage: app.enablePage, disablePage: app.disablePage },
      settings: {
        read: app.readSettings,
        setCopyOnNoField: app.setCopyOnNoField,
        setAutoFill: app.setAutoFill,
        setRecognitionShortcut: app.setRecognitionShortcut,
        isSliderEnabled: vi.fn(async () => true),
        setSliderEnabled: vi.fn(async () => undefined),
      },
      sliderSolver: { solve },
      activeTab: app.activeTab,
    });
    const pending = router.handle({ type: 'captcha:slider-auto-run', revision: 'challenge-1' }, sender);
    await vi.waitFor(() => expect(solve).toHaveBeenCalledOnce());

    await expect(router.handle({ type: 'captcha:get-slider-state' }, { url: 'edge-extension://test/popup.html' })).resolves.toMatchObject({
      supported: true,
      enabled: true,
      activity: { state: 'running', trigger: 'automatic', at: expect.any(Number) },
    });

    finishSolve?.({ state: 'success', confidence: .82 });
    await expect(pending).resolves.toEqual({ state: 'success', confidence: .82 });
    await expect(router.handle({ type: 'captcha:get-slider-state' }, { url: 'edge-extension://test/popup.html' })).resolves.toMatchObject({
      activity: { state: 'success', trigger: 'automatic', confidence: .82, at: expect.any(Number) },
    });
  });

  it('serializes manual and automatic slider runs in the same tab', async () => {
    const app = harness({ pagePermission: true });
    let finish!: (value: { state: 'success' }) => void;
    const solve = vi.fn()
      .mockImplementationOnce(() => new Promise<{ state: 'success' }>((resolve) => { finish = resolve; }))
      .mockResolvedValue({ state: 'success' });
    const router = createRuntimeRouter({
      permissions: { contains: app.contains },
      imageFetcher: { fetch: app.fetch },
      inferenceHost: { recognize: app.recognize, warmup: app.warmup },
      modelStatus: createModelStatusStore(() => 1000),
      siteState: { isEnabled: vi.fn(async () => false), enablePage: app.enablePage, disablePage: app.disablePage },
      settings: {
        read: app.readSettings,
        setCopyOnNoField: app.setCopyOnNoField,
        setAutoFill: app.setAutoFill,
        setRecognitionShortcut: app.setRecognitionShortcut,
        isSliderEnabled: vi.fn(async () => true),
        setSliderEnabled: vi.fn(async () => undefined),
      },
      sliderSolver: { solve },
      activeTab: app.activeTab,
    });

    const first = router.handle({ type: 'captcha:slider-auto-run', revision: 'challenge-1' }, sender);
    await vi.waitFor(() => expect(solve).toHaveBeenCalledOnce());
    const joined = router.handle({ type: 'captcha:run-slider' }, {});
    expect(solve).toHaveBeenCalledOnce();
    finish({ state: 'success' });
    await expect(first).resolves.toEqual({ state: 'success' });
    await expect(joined).resolves.toEqual({ state: 'success' });
    expect(solve.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('records manual and automatic slider results with site, duration, and geometry', async () => {
    const app = harness({ pagePermission: true });
    const modelStatus = createModelStatusStore(() => 1000);
    const solve = vi.fn(async (_tab: { id: number; url: string }, trigger: 'manual' | 'automatic') => ({
      state: trigger === 'manual' ? 'failed' as const : 'success' as const,
      confidence: .81,
      ...(trigger === 'manual' ? { reason: 'challenge-rejected' } : {}),
      diagnostic: {
        provider: 'geetest-v4' as const,
        gapX: 184,
        gapY: 27,
        pieceOffsetX: 8,
        imageWidth: 300,
        imageHeight: 180,
        trackWidth: 300,
        handleWidth: 40,
        scaleX: 2,
        scaleY: 2,
        startX: 20,
        requestedEndX: 196,
        endX: 196,
        releaseX: 196,
      },
    }));
    const router = createRuntimeRouter({
      permissions: { contains: app.contains },
      imageFetcher: { fetch: app.fetch },
      inferenceHost: { recognize: app.recognize, warmup: app.warmup },
      modelStatus,
      siteState: { isEnabled: vi.fn(async () => false), enablePage: app.enablePage, disablePage: app.disablePage },
      settings: {
        read: app.readSettings,
        setCopyOnNoField: app.setCopyOnNoField,
        setAutoFill: app.setAutoFill,
        setRecognitionShortcut: app.setRecognitionShortcut,
        isSliderEnabled: vi.fn(async () => true),
        setSliderEnabled: vi.fn(async () => undefined),
      },
      sliderSolver: { solve },
      activeTab: app.activeTab,
    });

    await router.handle({ type: 'captcha:run-slider' }, {});
    await router.handle({ type: 'captcha:slider-auto-run', revision: 'challenge-1' }, sender);

    expect(modelStatus.snapshot().logs).toEqual([
      expect.objectContaining({ kind: 'slider', sliderState: 'failed', outcome: 'failure', site: 'portal.example.test', trigger: 'manual', reason: 'challenge-rejected', durationMs: expect.any(Number), gapX: 184, requestedEndX: 196, releaseX: 196 }),
      expect.objectContaining({ kind: 'slider', sliderState: 'success', outcome: 'success', site: 'portal.example.test', trigger: 'automatic', durationMs: expect.any(Number), provider: 'geetest-v4' }),
    ]);
  });

  it('does not expose slider activity after the active tab navigates', async () => {
    const app = harness({ pagePermission: true });
    const router = createRuntimeRouter({
      permissions: { contains: app.contains },
      imageFetcher: { fetch: app.fetch },
      inferenceHost: { recognize: app.recognize, warmup: app.warmup },
      modelStatus: createModelStatusStore(() => 1000),
      siteState: { isEnabled: vi.fn(async () => false), enablePage: app.enablePage, disablePage: app.disablePage },
      settings: {
        read: app.readSettings,
        setCopyOnNoField: app.setCopyOnNoField,
        setAutoFill: app.setAutoFill,
        setRecognitionShortcut: app.setRecognitionShortcut,
        isSliderEnabled: vi.fn(async () => true),
        setSliderEnabled: vi.fn(async () => undefined),
      },
      sliderSolver: { solve: vi.fn(async () => ({ state: 'success' as const })) },
      activeTab: app.activeTab,
    });
    await router.handle({ type: 'captcha:slider-auto-run', revision: 'challenge-1' }, sender);
    app.activeTab.mockResolvedValue({ id: 4, url: 'https://portal.example.test/other-page' });

    await expect(router.handle({ type: 'captcha:get-slider-state' }, { url: 'edge-extension://test/popup.html' })).resolves.toMatchObject({
      supported: true,
      activity: undefined,
    });
  });
});
