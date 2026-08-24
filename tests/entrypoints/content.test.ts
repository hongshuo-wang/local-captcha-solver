import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/platform/settings-store';

const listener = vi.fn();
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.resetModules(); vi.unstubAllGlobals(); listener.mockReset(); document.body.innerHTML = ''; });
const statusHost = () => document.querySelector<HTMLElement>('[data-local-captcha-status]');
const statusText = () => statusHost()?.shadowRoot?.textContent ?? '';
describe('content runtime messages', () => {
  it('does not initialize duplicate injected content runtimes in one frame', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    const onMessage = { addListener: vi.fn() };
    vi.stubGlobal('browser', {
      runtime: { onMessage, sendMessage: vi.fn() },
      i18n: { getUILanguage: () => 'zh-CN' },
      storage: { local: { get: vi.fn(async () => ({})) }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    });
    const { default: contentScript } = await import('../../entrypoints/content');
    const context = {} as NonNullable<Parameters<typeof contentScript.main>[0]>;
    contentScript.main(context);
    contentScript.main(context);
    expect(onMessage.addListener).toHaveBeenCalledOnce();
    const documentWithCleanup = document as Document & { __localCaptchaShortcutCleanup?: () => void };
    documentWithCleanup.__localCaptchaShortcutCleanup?.();
    delete documentWithCleanup.__localCaptchaShortcutCleanup;
  });

  it('guards unknown messages and distinguishes zero from ambiguous visible image matches', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({ sendMessage: vi.fn(), onMessage: { addListener: listener } });
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => unknown;
    expect(handle({ type: 'unknown' })).toBeUndefined(); await expect(handle({ type: 'captcha:context-image', srcUrl: 'missing' })).resolves.toEqual({ state: 'no_candidate' });
    document.body.innerHTML = '<img src="https://example.test/captcha"><img hidden src="https://example.test/captcha"><img src="https://example.test/captcha">';
    await expect(handle({ type: 'captcha:context-image', srcUrl: 'https://example.test/captcha' })).resolves.toMatchObject({ state: 'ambiguous_image', candidateIds: expect.any(Array) });
  });
  it('resolves one visible context image even when a hidden duplicate exists', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<img src="data:image/png;base64,AQ=="><img hidden src="data:image/png;base64,AQ==">';
    const { createRuntimeContent } = await import('../../entrypoints/content'); createRuntimeContent({ sendMessage: vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize' ? [{ mode: 'digits', text: '1', confidence: .9 }] : undefined), onMessage: { addListener: listener } });
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => Promise<unknown>;
    await expect(handle({ type: 'captcha:context-image', srcUrl: 'data:image/png;base64,AQ==' })).resolves.toMatchObject({ state: 'no_field' });
  });
  it('recognizes the best page candidate from the popup command without enabling automation', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<form><img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ=="><input id="answer" aria-label="captcha"></form>';
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize'
      ? [{ mode: 'digits', text: '2468', confidence: .9 }]
      : message.type === 'captcha:get-model-status' ? { status: 'ready' } : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => Promise<unknown>;

    await expect(handle({ type: 'captcha:recognize-page' })).resolves.toMatchObject({ state: 'filled', fillValue: '2468' });
    expect((document.querySelector('#answer') as HTMLInputElement).value).toBe('2468');
  });
  it('starts automatic observation only after an explicit enable message and stops it on disable', async () => {
    vi.useFakeTimers(); vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<img alt="captcha" width="120" height="40">';
    const { createRuntimeContent } = await import('../../entrypoints/content'); createRuntimeContent({ sendMessage: vi.fn(), onMessage: { addListener: listener } }); const handle = listener.mock.calls[0]?.[0] as (message: unknown) => unknown;
    await expect(handle({ type: 'captcha:get-status' })).resolves.toEqual({ enabled: false }); await expect(handle({ type: 'captcha:auto-enable' })).resolves.toEqual({ enabled: true }); await expect(handle({ type: 'captcha:auto-disable' })).resolves.toEqual({ enabled: false }); vi.useRealTimers();
  });
  it('treats trusted wheel input as active user control for slider automation', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({ sendMessage: vi.fn(), onMessage: { addListener: listener } });
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => Promise<unknown>;
    const wheel = new WheelEvent('wheel', { bubbles: true, deltaY: 120 });
    Object.defineProperty(wheel, 'isTrusted', { configurable: true, value: true });
    window.dispatchEvent(wheel);
    await expect(handle({ type: 'captcha:slider-user-active' })).resolves.toEqual({ active: true });
  });
  it('does not show takeover feedback when a visible slider is idle', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<div data-slider-captcha><img data-slider-image><div data-slider-track></div><button data-slider-handle>drag</button></div>';
    const imageElement = document.querySelector<HTMLElement>('[data-slider-image]')!;
    const trackElement = document.querySelector<HTMLElement>('[data-slider-track]')!;
    const handleElement = document.querySelector<HTMLElement>('[data-slider-handle]')!;
    imageElement.getBoundingClientRect = () => ({ left: 40, top: 20, right: 300, bottom: 120, width: 260, height: 100, x: 40, y: 20, toJSON: () => ({}) });
    trackElement.getBoundingClientRect = () => ({ left: 40, top: 130, right: 300, bottom: 170, width: 260, height: 40, x: 40, y: 130, toJSON: () => ({}) });
    handleElement.getBoundingClientRect = () => ({ left: 40, top: 124, right: 92, bottom: 176, width: 52, height: 52, x: 40, y: 124, toJSON: () => ({}) });
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({
      sendMessage: vi.fn(),
      onMessage: { addListener: listener },
      settings: { read: async () => ({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] }), subscribe: () => vi.fn() },
    });
    await Promise.resolve();
    const event = new WheelEvent('wheel', { bubbles: true, deltaY: 100 });
    Object.defineProperty(event, 'isTrusted', { configurable: true, value: true });
    window.dispatchEvent(event);
    expect(statusText()).not.toContain('已暂停自动拖动');
    expect(document.querySelector('[data-local-captcha-slider-highlight]')).toBeNull();
  });
  it('does not treat an armed automation activation click as user input', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<button class="geetest_btn_click">verify</button>';
    const activator = document.querySelector<HTMLElement>('.geetest_btn_click')!;
    activator.getBoundingClientRect = () => ({ left: 40, top: 30, right: 300, bottom: 80, width: 260, height: 50, x: 40, y: 30, toJSON: () => ({}) });
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({
      sendMessage: vi.fn(),
      onMessage: { addListener: listener },
      settings: { read: async () => ({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] }), subscribe: () => vi.fn() },
    });
    await Promise.resolve();
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => Promise<unknown>;
    await expect(handle({ type: 'captcha:slider-automation-press' })).resolves.toEqual({ armed: true });
    const activation = new PointerEvent('pointerdown', { bubbles: true });
    Object.defineProperty(activation, 'isTrusted', { configurable: true, value: true });
    activator.dispatchEvent(activation);
    expect(statusText()).not.toContain('已暂停自动拖动');
  });
  it('does not treat an armed automation press as applying to an ancestor page target', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<button class="geetest_btn_click">verify</button>';
    const activator = document.querySelector<HTMLElement>('.geetest_btn_click')!;
    activator.getBoundingClientRect = () => ({ left: 40, top: 30, right: 300, bottom: 80, width: 260, height: 50, x: 40, y: 30, toJSON: () => ({}) });
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({ sendMessage: vi.fn(), onMessage: { addListener: listener } });
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => Promise<unknown>;
    await expect(handle({ type: 'captcha:slider-automation-press' })).resolves.toEqual({ armed: true });
    const userClick = new PointerEvent('pointerdown', { bubbles: true });
    Object.defineProperty(userClick, 'isTrusted', { configurable: true, value: true });
    document.body.dispatchEvent(userClick);
    await expect(handle({ type: 'captcha:slider-user-active' })).resolves.toEqual({ active: true });
  });
  it('ignores an injected manual slider press even when automatic slider mode is disabled', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<button class="geetest_btn_click">verify</button>';
    const activator = document.querySelector<HTMLElement>('.geetest_btn_click')!;
    activator.getBoundingClientRect = () => ({ left: 40, top: 30, right: 300, bottom: 80, width: 260, height: 50, x: 40, y: 30, toJSON: () => ({}) });
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({ sendMessage: vi.fn(), onMessage: { addListener: listener } });
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => Promise<unknown>;
    await expect(handle({ type: 'captcha:slider-automation-press' })).resolves.toEqual({ armed: true });
    const injectedPress = new PointerEvent('pointerdown', { bubbles: true });
    Object.defineProperty(injectedPress, 'isTrusted', { configurable: true, value: true });
    activator.dispatchEvent(injectedPress);
    await expect(handle({ type: 'captcha:slider-user-active' })).resolves.toEqual({ active: false });
  });
  it('automatically requests one run for a collapsed slider on an explicitly enabled site', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    let pageFocused = false;
    vi.spyOn(document, 'hasFocus').mockImplementation(() => pageFocused);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.body.innerHTML = '<button class="geetest_btn_click" style="display:block;visibility:visible;opacity:1">Click to verify</button>';
    const activator = document.querySelector<HTMLElement>('.geetest_btn_click')!;
    activator.getBoundingClientRect = () => ({ x: 40, y: 30, left: 40, top: 30, right: 300, bottom: 80, width: 260, height: 50, toJSON: () => ({}) });
    let finishRun!: () => void;
    const pendingRun = new Promise<{ state: 'success' }>((resolve) => { finishRun = () => resolve({ state: 'success' }); });
    const sendMessage = vi.fn((message: { type: string }) => message.type === 'captcha:slider-auto-run' ? pendingRun : Promise.resolve(undefined));
    let updateSettings!: (settings: unknown) => void;
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({
      sendMessage,
      onMessage: { addListener: listener },
      settings: {
        read: async () => ({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] }),
        subscribe: (subscriber) => { updateSettings = subscriber; return () => undefined; },
      },
    });

    updateSettings({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(250);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:slider-auto-run')).toHaveLength(0);
    pageFocused = true;
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:slider-auto-run', revision: 'activatable|geetest-v4|40:30:260:50' });
    expect(statusText()).toContain('Captcha Helper 正在接管滑块');
    const interruption = new WheelEvent('wheel', { bubbles: true, deltaY: 100 });
    Object.defineProperty(interruption, 'isTrusted', { configurable: true, value: true });
    window.dispatchEvent(interruption);
    expect(statusText()).toContain('已暂停自动拖动');
    expect(document.querySelector('[data-local-captcha-slider-highlight]')).not.toBeNull();
    expect(statusHost()?.style.pointerEvents).toBe('none');
    await vi.advanceTimersByTimeAsync(1200);
    expect(document.querySelector('[data-local-captcha-slider-highlight]')).toBeNull();
    activator.classList.add('changed-once');
    await vi.advanceTimersByTimeAsync(250);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:slider-auto-run')).toHaveLength(1);

    finishRun();
    await pendingRun;
    await Promise.resolve();
    expect(statusText()).toContain('滑块已自动完成');
    const unrelatedClick = new PointerEvent('pointerdown', { bubbles: true });
    Object.defineProperty(unrelatedClick, 'isTrusted', { configurable: true, value: true });
    document.body.dispatchEvent(unrelatedClick);
    expect(statusText()).not.toContain('已暂停自动拖动');
    activator.classList.add('changed-twice');
    await vi.advanceTimersByTimeAsync(250);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:slider-auto-run')).toHaveLength(1);

    activator.getBoundingClientRect = () => ({ x: 70, y: 30, left: 70, top: 30, right: 330, bottom: 80, width: 260, height: 50, toJSON: () => ({}) });
    activator.classList.add('new-challenge-without-user');
    await vi.advanceTimersByTimeAsync(250);
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:slider-auto-run')).toHaveLength(1);

    const activation = new PointerEvent('pointerdown', { bubbles: true });
    Object.defineProperty(activation, 'isTrusted', { configurable: true, value: true });
    activator.dispatchEvent(activation);
    expect(statusText()).not.toContain('已暂停自动拖动');
    activator.classList.add('user-opened-new-challenge');
    await vi.advanceTimersByTimeAsync(1_200);
    await Promise.resolve();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:slider-auto-run')).toHaveLength(2);
    updateSettings({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [] });
  });

  it('retries the same challenge after a user interruption finishes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    let pageFocused = true;
    vi.spyOn(document, 'hasFocus').mockImplementation(() => pageFocused);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.body.innerHTML = '<button class="geetest_btn_click">Click to verify</button>';
    const activator = document.querySelector<HTMLElement>('.geetest_btn_click')!;
    activator.getBoundingClientRect = () => ({ x: 40, y: 30, left: 40, top: 30, right: 300, bottom: 80, width: 260, height: 50, toJSON: () => ({}) });
    let releaseFirst!: (result: { state: 'uncertain' }) => void;
    const firstRun = new Promise<{ state: 'uncertain' }>((resolve) => { releaseFirst = resolve; });
    let runs = 0;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type !== 'captcha:slider-auto-run') return Promise.resolve(undefined);
      runs += 1;
      return runs === 1 ? firstRun : Promise.resolve({ state: 'success' });
    });
    let updateSettings!: (settings: unknown) => void;
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({
      sendMessage,
      onMessage: { addListener: listener },
      settings: {
        read: async () => ({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] }),
        subscribe: (subscriber) => { updateSettings = subscriber; return () => undefined; },
      },
    });
    updateSettings({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] });
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    expect(runs).toBe(1);

    const interruption = new WheelEvent('wheel', { bubbles: true, deltaY: 120 });
    Object.defineProperty(interruption, 'isTrusted', { configurable: true, value: true });
    window.dispatchEvent(interruption);
    releaseFirst({ state: 'uncertain' });
    await firstRun;
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1200);
    await Promise.resolve();
    await Promise.resolve();

    expect(runs).toBe(2);
    expect(statusText()).toContain('滑块已自动完成');
    pageFocused = false;
  });
  it('does not let a disabled slider run restore stale status after it finishes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    vi.spyOn(document, 'hasFocus').mockImplementation(() => true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.body.innerHTML = '<button class="geetest_btn_click">Click to verify</button>';
    const activator = document.querySelector<HTMLElement>('.geetest_btn_click')!;
    activator.getBoundingClientRect = () => ({ x: 40, y: 30, left: 40, top: 30, right: 300, bottom: 80, width: 260, height: 50, toJSON: () => ({}) });
    let release!: (result: { state: 'success' }) => void;
    const pending = new Promise<{ state: 'success' }>((resolve) => { release = resolve; });
    const sendMessage = vi.fn((message: { type: string }) => message.type === 'captcha:slider-auto-run' ? pending : Promise.resolve(undefined));
    let updateSettings!: (settings: unknown) => void;
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({
      sendMessage,
      onMessage: { addListener: listener },
      settings: {
        read: async () => ({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] }),
        subscribe: (subscriber) => { updateSettings = subscriber; return () => undefined; },
      },
    });
    updateSettings({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] });
    await vi.advanceTimersByTimeAsync(250);
    await Promise.resolve();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:slider-auto-run')).toHaveLength(1);
    updateSettings({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [] });
    release({ state: 'success' });
    await pending;
    await Promise.resolve();
    expect(statusText()).not.toContain('滑块已自动完成');
  });
  it('does not mark a challenge refreshed during an older run as already attempted', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    vi.spyOn(document, 'hasFocus').mockImplementation(() => true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.body.innerHTML = '<button class="geetest_btn_click">Click to verify</button>';
    const activator = document.querySelector<HTMLElement>('.geetest_btn_click')!;
    let left = 40;
    activator.getBoundingClientRect = () => ({ x: left, y: 30, left, top: 30, right: left + 260, bottom: 80, width: 260, height: 50, toJSON: () => ({}) });
    let finishFirst!: (result: { state: 'uncertain' }) => void;
    const first = new Promise<{ state: 'uncertain' }>((resolve) => { finishFirst = resolve; });
    let runs = 0;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type !== 'captcha:slider-auto-run') return Promise.resolve(undefined);
      runs += 1;
      return runs === 1 ? first : Promise.resolve({ state: 'success' });
    });
    let updateSettings!: (settings: unknown) => void;
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({
      sendMessage,
      onMessage: { addListener: listener },
      settings: {
        read: async () => ({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] }),
        subscribe: (subscriber) => { updateSettings = subscriber; return () => undefined; },
      },
    });
    updateSettings({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] });
    await vi.advanceTimersByTimeAsync(250);
    expect(runs).toBe(1);
    left = 70;
    activator.classList.add('refreshed');
    finishFirst({ state: 'uncertain' });
    await first;
    for (let flush = 0; flush < 5; flush += 1) await Promise.resolve();
    for (let attempt = 0; attempt < 4 && runs === 1; attempt += 1) await vi.advanceTimersByTimeAsync(250);
    expect(runs).toBe(2);
  });
  it('can restart after disable and re-enable without an older run clearing the new one', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    vi.spyOn(document, 'hasFocus').mockImplementation(() => true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.body.innerHTML = '<button class="geetest_btn_click">Click to verify</button>';
    const activator = document.querySelector<HTMLElement>('.geetest_btn_click')!;
    activator.getBoundingClientRect = () => ({ x: 40, y: 30, left: 40, top: 30, right: 300, bottom: 80, width: 260, height: 50, toJSON: () => ({}) });
    let finishFirst!: (result: { state: 'success' }) => void;
    let finishSecond!: (result: { state: 'success' }) => void;
    const first = new Promise<{ state: 'success' }>((resolve) => { finishFirst = resolve; });
    const second = new Promise<{ state: 'success' }>((resolve) => { finishSecond = resolve; });
    let runs = 0;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type !== 'captcha:slider-auto-run') return Promise.resolve(undefined);
      runs += 1;
      return runs === 1 ? first : second;
    });
    let updateSettings!: (settings: unknown) => void;
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({
      sendMessage,
      onMessage: { addListener: listener },
      settings: {
        read: async () => ({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] }),
        subscribe: (subscriber) => { updateSettings = subscriber; return () => undefined; },
      },
    });
    updateSettings({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] });
    await vi.advanceTimersByTimeAsync(250);
    expect(runs).toBe(1);
    updateSettings({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [] });
    updateSettings({ ...DEFAULT_SETTINGS, sliderEnabledHosts: [location.hostname] });
    await vi.advanceTimersByTimeAsync(250);
    expect(runs).toBe(2);
    finishFirst({ state: 'success' });
    await first;
    for (let flush = 0; flush < 4; flush += 1) await Promise.resolve();
    expect(statusText()).toContain('正在接管滑块');
    finishSecond({ state: 'success' });
    await second;
    for (let flush = 0; flush < 4; flush += 1) await Promise.resolve();
    expect(statusText()).toContain('滑块已自动完成');
  });
  it('reconciles automatic state when a dynamically registered new document starts', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:get-site-state' ? { enabled: true } : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content'); const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });
    await Promise.resolve();
    const handle = listener.mock.calls[0]?.[0] as (message: unknown) => unknown;
    expect(sendMessage).toHaveBeenCalledWith({ type: 'captcha:get-site-state' });
    await expect(handle({ type: 'captcha:get-status' })).resolves.toEqual({ enabled: true });
    content.disable();
  });
  it('keeps the explicit status when an older automatic request finishes later', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<form><img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ=="><input aria-label="captcha"></form>';
    let release!: (value: unknown) => void; let signal!: () => void; const started = new Promise<void>((resolve) => { signal = resolve; }); let calls = 0;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'captcha:get-model-status') return Promise.resolve({ status: 'ready' });
      if (message.type !== 'captcha:recognize') return Promise.resolve(undefined);
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { release = resolve; signal(); });
      return Promise.resolve([{ mode: 'digits', text: '2', confidence: .9 }]);
    });
    const { createRuntimeContent } = await import('../../entrypoints/content'); const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } }); const image = document.querySelector('#image') as HTMLImageElement;
    content.enable(); const automatic = content.workflow.run(image, 'automatic'); await started; expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:recognize')).toHaveLength(1);
    await content.workflow.run(image, 'explicit'); release([{ mode: 'digits', text: '1', confidence: .9 }]); await automatic;
    expect(statusText()).toContain('已自动填入验证码');
    expect(statusText()).toContain('2');
  });
  it('does not restore status when a pending explicit request resolves after disable', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<img id="image" src="data:image/png;base64,AQ==">'; let release!: (value: unknown) => void; let signal!: () => void; const started = new Promise<void>((resolve) => { signal = resolve; });
    const sendMessage = vi.fn((message: { type: string }) => message.type === 'captcha:recognize' ? new Promise((resolve) => { release = resolve; signal(); }) : Promise.resolve(message.type === 'captcha:get-model-status' ? { status: 'ready' } : undefined)); const { createRuntimeContent } = await import('../../entrypoints/content'); const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } }); const image = document.querySelector('#image') as HTMLImageElement;
    const pending = content.workflow.run(image, 'explicit'); await started; content.disable(); release([{ mode: 'digits', text: '5', confidence: .9 }]); await pending;
    expect(document.querySelector('[data-local-captcha-status]')).toBeNull();
  });
  it('maps guarded background OCR failures back into workflow status', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ=="><input aria-label="captcha">';
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize' ? { type: 'captcha:recognition-error', code: 'model_unavailable' } : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content'); const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });
    await expect(content.workflow.run(document.querySelector('#image') as HTMLImageElement, 'context')).resolves.toMatchObject({ state: 'model_unavailable' });
  });
  it('shows a low-confidence candidate beside the field and fills only after confirmation', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value); document.body.innerHTML = '<form><img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ=="><input id="answer" aria-label="captcha"></form>';
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize' ? [{ mode: 'letters', text: 'ABC', confidence: .94 }] : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content'); const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });
    const result = await content.workflow.run(document.querySelector('#image') as HTMLImageElement, 'context');
    expect(result).toMatchObject({ state: 'needs_confirmation', fillValue: 'ABC' });
    expect((document.querySelector('#answer') as HTMLInputElement).value).toBe('');
    const button = statusHost()?.shadowRoot?.querySelector('button.action') as HTMLButtonElement;
    expect(button.textContent).toContain('填入'); button.click();
    await vi.waitFor(() => expect((document.querySelector('#answer') as HTMLInputElement).value).toBe('ABC'));
    expect(statusText()).toContain('已填入验证码');
  });

  it('offers explicit replacement without overwriting a non-empty field', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<form><img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ=="><input id="answer" aria-label="captcha" value="old"></form>';
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize' ? [{ mode: 'digits', text: '2468', confidence: .9 }] : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });
    const result = await content.workflow.run(document.querySelector('#image') as HTMLImageElement, 'explicit');
    expect(result).toMatchObject({ state: 'needs_confirmation', fillValue: '2468' });
    expect((document.querySelector('#answer') as HTMLInputElement).value).toBe('old');
    const button = statusHost()?.shadowRoot?.querySelector('button.action') as HTMLButtonElement;
    expect(button.textContent).toBe('替换');
    button.click();
    await vi.waitFor(() => expect((document.querySelector('#answer') as HTMLInputElement).value).toBe('2468'));
  });

  it('recognizes a middle click by default and ignores ordinary or modified left clicks', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ=="><button id="button">click</button>';
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize' ? [{ mode: 'digits', text: '9', confidence: .9 }] : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });
    const image = document.querySelector('#image') as HTMLImageElement;
    const ordinary = image.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(ordinary).toBe(true);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'captcha:recognize' }));

    const controlClick = new MouseEvent('mousedown', { bubbles: true, cancelable: true, ctrlKey: true });
    expect(image.dispatchEvent(controlClick)).toBe(true);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'captcha:recognize' }));

    const middleClick = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 });
    expect(image.dispatchEvent(middleClick)).toBe(false);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'captcha:recognize' })));

    document.querySelector('#button')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 }));
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:recognize')).toHaveLength(1);
    content.disable();
  });

  it('captures a middle click before a page listener stops it at the window boundary', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<img id="image" alt="验证码" width="120" height="40" src="data:image/png;base64,AQ==">';
    const blockDocument = (event: MouseEvent) => event.stopPropagation();
    window.addEventListener('mousedown', blockDocument, true);
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize'
      ? [{ mode: 'digits', text: '9', confidence: .9 }]
      : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });
    const image = document.querySelector('#image') as HTMLImageElement;

    expect(image.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1, composed: true }))).toBe(false);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'captcha:recognize' })));

    window.removeEventListener('mousedown', blockDocument, true);
    content.disable();
  });

  it('applies a custom shortcut and updates it from storage without reloading', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ==">';
    let settingsListener: ((settings: unknown) => void) | undefined;
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize' ? [{ mode: 'digits', text: '9', confidence: .9 }] : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    createRuntimeContent({
      sendMessage,
      onMessage: { addListener: listener },
      settings: {
        read: async () => ({ recognitionShortcut: 'alt-click' }),
        subscribe: (next) => { settingsListener = next; return vi.fn(); },
      },
    });
    await Promise.resolve();
    const image = document.querySelector('#image') as HTMLImageElement;

    expect(image.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, altKey: true }))).toBe(false);
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:recognize')).toHaveLength(1));
    settingsListener?.({ recognitionShortcut: 'shift-click' });
    image.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, altKey: true }));
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:recognize')).toHaveLength(1);
    image.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true }));
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === 'captcha:recognize')).toHaveLength(2));
  });

  it('applies an exact-host recognition mode to every workflow request', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ==">';
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize'
      ? [{ mode: 'letters', text: 'CODE', confidence: .99 }]
      : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    const content = createRuntimeContent({
      sendMessage,
      onMessage: { addListener: listener },
      settings: {
        read: async () => ({ ...DEFAULT_SETTINGS, siteRecognitionModes: [{ hostname: location.hostname, mode: 'letters' }] }),
        subscribe: () => vi.fn(),
      },
    });
    await Promise.resolve();
    await content.workflow.run(document.querySelector('#image') as HTMLImageElement, 'explicit');
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'captcha:recognize', modes: ['letters'] }));
  });

  it('shows and copies a recognized value when no input field is found', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    document.body.innerHTML = '<img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ==">';
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'captcha:recognize') return [{ mode: 'digits', text: '2468', confidence: .9 }];
      if (message.type === 'captcha:get-preferences') return { copyOnNoField: true };
      return undefined;
    });
    const { createRuntimeContent } = await import('../../entrypoints/content');
    const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });

    await expect(content.workflow.run(document.querySelector('#image') as HTMLImageElement, 'explicit')).resolves.toMatchObject({ state: 'no_field', fillValue: '2468' });
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('2468'));
    expect(statusText()).toContain('2468');
    expect(statusText()).toContain('已复制到剪贴板');
  });

  it('respects a disabled no-field copy preference while still showing the result', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    document.body.innerHTML = '<img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ==">';
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize'
      ? [{ mode: 'digits', text: '1357', confidence: .9 }]
      : message.type === 'captcha:get-preferences' ? { copyOnNoField: false } : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });

    await content.workflow.run(document.querySelector('#image') as HTMLImageElement, 'explicit');

    expect(writeText).not.toHaveBeenCalled();
    expect(statusText()).toContain('1357');
    expect(statusText()).toContain('未找到对应输入框');
  });

  it('keeps the recognized value visible when clipboard writing fails', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    document.body.innerHTML = '<img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ==">';
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize'
      ? [{ mode: 'digits', text: '8642', confidence: .9 }]
      : message.type === 'captcha:get-preferences' ? { copyOnNoField: true } : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });

    await content.workflow.run(document.querySelector('#image') as HTMLImageElement, 'explicit');

    expect(statusText()).toContain('8642');
    expect(statusText()).toContain('自动复制失败');
  });

  it('lets the user select an otherwise unmatched safe field after recognition', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    document.body.innerHTML = '<img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ=="><input id="target" aria-label="Account note">';
    const sendMessage = vi.fn(async (message: { type: string }) => message.type === 'captcha:recognize'
      ? [{ mode: 'digits', text: '8642', confidence: .9 }]
      : message.type === 'captcha:get-preferences' ? { copyOnNoField: false } : undefined);
    const { createRuntimeContent } = await import('../../entrypoints/content');
    const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });
    const image = document.querySelector('#image') as HTMLImageElement;
    const target = document.querySelector('#target') as HTMLInputElement;

    await expect(content.workflow.run(image, 'explicit')).resolves.toMatchObject({ state: 'no_field', fillValue: '8642' });
    const choose = [...statusHost()!.shadowRoot!.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '选择输入框');
    expect(choose).toBeDefined();
    choose?.click();
    target.click();
    await vi.waitFor(() => expect(target.value).toBe('8642'));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'captcha:record-activity', outcome: 'filled' }));
  });

  it('does not copy an older no-field result after a newer request supersedes it', async () => {
    vi.stubGlobal('defineContentScript', (value: unknown) => value);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    document.body.innerHTML = '<img id="image" alt="captcha" width="120" height="40" src="data:image/png;base64,AQ==">';
    let releasePreference!: (value: unknown) => void;
    let preferenceStarted!: () => void;
    const preferencePending = new Promise<void>((resolve) => { preferenceStarted = resolve; });
    let recognitionCalls = 0;
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'captcha:recognize') return Promise.resolve([{ mode: 'digits', text: recognitionCalls++ === 0 ? '1111' : '2222', confidence: .9 }]);
      if (message.type === 'captcha:get-preferences') return new Promise((resolve) => { releasePreference = resolve; preferenceStarted(); });
      return Promise.resolve(undefined);
    });
    const { createRuntimeContent } = await import('../../entrypoints/content');
    const content = createRuntimeContent({ sendMessage, onMessage: { addListener: listener } });
    const image = document.querySelector('#image') as HTMLImageElement;

    const older = content.workflow.run(image, 'explicit');
    await preferencePending;
    const input = document.createElement('input');
    input.setAttribute('aria-label', '验证码');
    document.body.append(input);
    await expect(content.workflow.run(image, 'explicit')).resolves.toMatchObject({ state: 'filled', fillValue: '2222' });
    releasePreference({ copyOnNoField: true });
    await older;

    expect(writeText).not.toHaveBeenCalled();
  });
});
