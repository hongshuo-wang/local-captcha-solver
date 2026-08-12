import { createModelStatusController, createPopupController, type PopupControllerAdapter, type PopupControllerLabels, type PopupView, type PopupViewState } from '../../src/popup/controller';
import type { ModelLog, ModelStatusSnapshot } from '../../src/background/model-status';
import { createTranslator, resolveUiLocale, type Translator, type UiLocale } from '../../src/platform/i18n';
import { createSettingsStore, hostnameForPage, type SiteRecognitionMode } from '../../src/platform/settings-store';
import { originsForPage } from '../../src/platform/permissions';
import { createExtensionBrowserAdapter } from '../../src/background/extension-browser';
import { sendRuntimeMessage } from '../../src/platform/runtime-messaging';

export interface PopupViewElements extends PopupView {
  checkbox: HTMLInputElement;
  accessButton: HTMLButtonElement;
  modelRetry: HTMLButtonElement;
  recognizeButton: HTMLButtonElement;
  settingsButton: HTMLButtonElement;
  modeSelect: HTMLSelectElement;
  sliderButton: HTMLButtonElement;
  sliderCheckbox: HTMLInputElement;
  sliderStatus: HTMLElement;
  renderModelStatus(snapshot: ModelStatusSnapshot): void;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Popup view is missing ${selector}`);
  return element;
}

function activityText(log: ModelLog | undefined, locale: UiLocale, t: Translator): string {
  if (log === undefined) return t('noActivity');
  if (locale === 'zh_CN') return log.message;
  if (log.outcome === 'failure') return 'Recognition failed';
  if (log.outcome === 'skipped') return 'No safe automatic action';
  if (log.kind === 'warmup') return log.outcome === 'success' ? 'Local model is ready' : 'Preparing the local model';
  return log.outcome === 'started' ? 'Recognition started' : 'Recognition completed';
}

export function createPopupView(root: HTMLElement, locale: UiLocale = 'zh_CN'): PopupViewElements {
  const t = createTranslator(locale);
  root.innerHTML = `
    <header class="popup-header">
      <img class="brand-mark" src="/icons/icon-48.png" alt="" width="40" height="40" />
      <div class="brand-copy"><h1>Captcha Helper</h1><p>${t('productSubtitle')}</p></div>
      <button type="button" class="settings-command" data-open-settings>${t('navSettings')}</button>
    </header>
    <section class="model-strip" aria-label="Model status">
      <span class="model-indicator" data-model-indicator aria-hidden="true"></span>
      <p data-model-summary>${t('modelLoading')}</p>
      <button type="button" class="text-command" data-model-retry hidden>${t('retryModel')}</button>
    </section>
    <section class="recognition-panel">
      <button type="button" class="recognize-command" data-recognize-page>${t('recognizePage')}</button>
      <p>${t('recognizePageBody')}</p>
    </section>
    <section class="access-panel" data-access-panel hidden>
      <div><p class="section-kicker">${t('currentSite')}</p><h2 data-access-title>${t('accessChoice')}</h2><p data-access-copy></p></div>
      <button type="button" class="primary-command" data-access-button>${t('grantAll')}</button>
    </section>
    <section class="site-panel" data-controls-panel aria-label="${t('currentSite')}">
      <div class="site-heading">
        <div><p class="section-kicker">${t('siteControl')}</p><h2 class="hostname" data-popup-hostname></h2></div>
        <label class="switch" aria-label="${t('autoFill')}"><input id="site-enabled" type="checkbox" aria-describedby="site-status" /><span aria-hidden="true"></span></label>
      </div>
      <p id="site-status" class="status" role="status" aria-live="polite" data-popup-status></p>
      <label class="mode-row" for="captcha-mode"><span>${t('captchaType')}</span><select id="captcha-mode" data-captcha-mode><option value="auto">${t('modeAuto')}</option><option value="digits">${t('modeDigits')}</option><option value="letters">${t('modeLetters')}</option><option value="alphanumeric">${t('modeAlphanumeric')}</option><option value="arithmetic">${t('modeArithmetic')}</option></select></label>
    </section>
    <section class="slider-panel">
      <div class="site-heading">
        <div><p class="section-kicker">${locale === 'zh_CN' ? '动态验证码 Beta' : 'Dynamic CAPTCHA Beta'}</p><h2>${locale === 'zh_CN' ? '拼图滑块' : 'Puzzle slider'}</h2></div>
        <label class="switch" aria-label="${locale === 'zh_CN' ? '在此网站自动处理滑块' : 'Automatically handle sliders on this site'}"><input type="checkbox" data-slider-enabled aria-describedby="slider-status" /><span aria-hidden="true"></span></label>
      </div>
      <button type="button" class="slider-command" data-run-slider>${locale === 'zh_CN' ? '处理当前滑块' : 'Handle current slider'}</button>
      <p id="slider-status" class="status" role="status" aria-live="polite" data-slider-status></p>
      <p class="permission-note">${locale === 'zh_CN' ? '滑块会发送浏览器级拖动。为避免误操作页面控件，不支持全局自动开启，必须逐站授权。' : 'Slider handling sends browser-level drag input. Global automatic mode is unavailable to prevent accidental page actions; enable each site explicitly.'}</p>
    </section>
    <section class="activity-panel">
      <div class="section-heading"><p class="section-kicker">${t('recentStatus')}</p><time data-latest-time></time></div>
      <p class="latest-activity" data-latest-activity>${t('noActivity')}</p>
    </section>
    <footer class="popup-footer"><p>${t('footerPrivacy')}</p></footer>`;

  const hostname = required<HTMLElement>(root, '[data-popup-hostname]');
  const checkbox = required<HTMLInputElement>(root, '#site-enabled');
  const status = required<HTMLElement>(root, '[data-popup-status]');
  const accessPanel = required<HTMLElement>(root, '[data-access-panel]');
  const accessTitle = required<HTMLElement>(root, '[data-access-title]');
  const accessCopy = required<HTMLElement>(root, '[data-access-copy]');
  const accessButton = required<HTMLButtonElement>(root, '[data-access-button]');
  const controls = root.querySelectorAll<HTMLElement>('[data-controls-panel]');
  const modelSummary = required<HTMLElement>(root, '[data-model-summary]');
  const modelIndicator = required<HTMLElement>(root, '[data-model-indicator]');
  const modelRetry = required<HTMLButtonElement>(root, '[data-model-retry]');
  const latestActivity = required<HTMLElement>(root, '[data-latest-activity]');
  const latestTime = required<HTMLTimeElement>(root, '[data-latest-time]');
  const settingsButton = required<HTMLButtonElement>(root, '[data-open-settings]');
  const recognizeButton = required<HTMLButtonElement>(root, '[data-recognize-page]');
  const modeSelect = required<HTMLSelectElement>(root, '[data-captcha-mode]');
  const sliderButton = required<HTMLButtonElement>(root, '[data-run-slider]');
  const sliderCheckbox = required<HTMLInputElement>(root, '[data-slider-enabled]');
  const sliderStatus = required<HTMLElement>(root, '[data-slider-status]');

  return {
    checkbox,
    accessButton,
    modelRetry,
    recognizeButton,
    settingsButton,
    modeSelect,
    sliderButton,
    sliderCheckbox,
    sliderStatus,
    render(state: PopupViewState): void {
      hostname.textContent = state.hostname;
      checkbox.checked = state.checked;
      checkbox.disabled = state.disabled;
      recognizeButton.disabled = !state.recognitionAvailable;
      recognizeButton.title = state.recognitionAvailable ? '' : t('recognizeUnavailable');
      accessPanel.hidden = state.accessGranted;
      controls.forEach((element) => { element.hidden = !state.accessGranted; });
      accessTitle.textContent = state.accessMode === 'all' ? t('allSites') : state.hostname;
      accessCopy.textContent = state.status;
      accessButton.textContent = state.accessMode === 'all' ? t('grantAll') : t('addSite');
      status.textContent = state.error ?? state.status;
      status.classList.toggle('error', state.error !== undefined);
      accessButton.disabled = state.disabled && state.status.includes(locale === 'zh_CN' ? '请求' : 'Request');
    },
    renderModelStatus(snapshot: ModelStatusSnapshot): void {
      modelSummary.textContent = snapshot.status === 'ready' ? t('modelReady') : snapshot.status === 'error' ? (locale === 'zh_CN' ? '模型暂不可用' : 'Model unavailable') : t('modelLoading');
      modelIndicator.dataset.state = snapshot.status;
      modelRetry.hidden = snapshot.status !== 'error';
      modelRetry.disabled = snapshot.status === 'loading';
      const latest = [...snapshot.logs].reverse().find((log) => log.kind === 'workflow')
        ?? [...snapshot.logs].reverse().find((log) => log.kind === 'recognition' && log.outcome !== 'started');
      latestActivity.textContent = activityText(latest, locale, t);
      latestTime.textContent = latest === undefined ? '' : new Date(latest.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    },
  };
}

function labels(locale: UiLocale): PopupControllerLabels {
  if (locale === 'zh_CN') {
    return {
      loadingHostname: '正在读取网站…', loadingSite: '正在读取网站设置…', off: '此网站未开启自动识别。', on: '此网站已开启自动识别。',
      unsupported: '当前页面不支持自动识别。', unsupportedHostname: '不支持的页面', allSitesHostname: '所有网站',
      accessNeeded: (mode) => mode === 'all' ? '启用全站访问后开始自动识别。' : '允许访问此网站后开始自动识别。',
      requestingAccess: (mode) => mode === 'all' ? '正在请求全站访问权限…' : '正在请求此网站访问权限…',
      accessDenied: '需要授权后才能自动识别。', accessFailed: '无法完成网站授权。', updating: '正在更新网站设置…', readFailed: '无法读取网站设置。', updateFailed: '无法更新网站设置。',
      pageRecognitionFailed: '无法在当前页面启动识别。',
    };
  }
  return {
    loadingHostname: 'Reading site...', loadingSite: 'Reading site settings...', off: 'Automatic recognition is disabled on this site.', on: 'Automatic recognition is enabled on this site.',
    unsupported: 'This page is not supported.', unsupportedHostname: 'Unsupported page', allSitesHostname: 'All sites',
    accessNeeded: (mode) => mode === 'all' ? 'Allow all sites to start automatic recognition.' : 'Allow this site to start automatic recognition.',
    requestingAccess: (mode) => mode === 'all' ? 'Requesting access to all sites...' : 'Requesting access to this site...',
    accessDenied: 'Site access is required for automatic recognition.', accessFailed: 'Could not complete site authorization.', updating: 'Updating site settings...', readFailed: 'Could not read site settings.', updateFailed: 'Could not update site settings.',
    pageRecognitionFailed: 'Could not start recognition on this page.',
  };
}

export function formatDiagnosticSnapshot(snapshot: ModelStatusSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function startPopup(
  root: HTMLElement,
  adapter: PopupControllerAdapter,
  locale: UiLocale = 'zh_CN',
  openSettings: () => Promise<void> = async () => undefined,
  closePopup: () => void = () => window.close(),
  siteModes?: {
    read(): Promise<SiteRecognitionMode>;
    write(mode: SiteRecognitionMode): Promise<void>;
  },
  sliderPermissions?: { requestDebugger(): Promise<boolean> },
): void {
  const view = createPopupView(root, locale);
  const t = createTranslator(locale);
  const controller = createPopupController(adapter, view, labels(locale));
  const modelController = createModelStatusController(adapter, view);
  view.accessButton.addEventListener('click', () => { void controller.grantAccess(); });
  view.checkbox.addEventListener('change', () => { void controller.setEnabled(view.checkbox.checked); });
  view.modelRetry.addEventListener('click', () => { void modelController.retry(); });
  view.recognizeButton.addEventListener('click', () => {
    void (async () => {
      const original = view.recognizeButton.textContent;
      view.recognizeButton.disabled = true;
      view.recognizeButton.textContent = t('recognizingPage');
      const started = await controller.recognizeCurrentPage();
      if (started) closePopup();
      else {
        view.recognizeButton.disabled = false;
        view.recognizeButton.textContent = original;
      }
    })();
  });
  view.settingsButton.addEventListener('click', () => { void openSettings(); });
  const sliderText = locale === 'zh_CN' ? {
    disabled: '此网站未开启自动处理。', enabled: '已为此网站开启自动处理。', running: '正在定位并拖动…', success: '滑块验证已通过。',
    notFound: '当前页面未找到唯一、受支持的滑块。', lowConfidence: '定位置信度不足，已停止操作。', permission: '需要浏览器调试权限才能发送可信拖动。', failed: '未能完成滑块验证，请手动处理。', unsupported: '当前页面不支持滑块处理。',
  } : {
    disabled: 'Automatic slider handling is disabled for this site.', enabled: 'Automatic slider handling is enabled for this site.', running: 'Locating and dragging...', success: 'Slider verification passed.',
    notFound: 'No unique supported slider was found.', lowConfidence: 'Gap confidence was too low; no drag was sent.', permission: 'Browser debugging permission is required for trusted drag input.', failed: 'Slider verification did not complete; handle it manually.', unsupported: 'Slider handling is unavailable on this page.',
  };
  let sliderHostname: string | undefined;
  let debuggerGranted = false;
  const renderSliderState = (enabled: boolean): void => {
    view.sliderCheckbox.checked = enabled;
    view.sliderStatus.textContent = enabled ? sliderText.enabled : sliderText.disabled;
  };
  const readSliderState = async (): Promise<void> => {
    const value = await adapter.runtime.sendMessage({ type: 'captcha:get-slider-state' });
    if (typeof value !== 'object' || value === null || (value as { supported?: unknown }).supported !== true) {
      sliderHostname = undefined;
      view.sliderButton.disabled = true;
      view.sliderCheckbox.disabled = true;
      view.sliderStatus.textContent = sliderText.unsupported;
      return;
    }
    sliderHostname = typeof (value as { hostname?: unknown }).hostname === 'string' ? (value as { hostname: string }).hostname : undefined;
    debuggerGranted = (value as { debuggerGranted?: unknown }).debuggerGranted === true;
    view.sliderButton.disabled = false;
    view.sliderCheckbox.disabled = false;
    renderSliderState((value as { enabled?: unknown }).enabled === true);
  };
  const ensureDebugger = async (): Promise<boolean> => {
    if (debuggerGranted) return true;
    debuggerGranted = await sliderPermissions?.requestDebugger() ?? false;
    return debuggerGranted;
  };
  const ensureSliderPageAccess = async (): Promise<boolean> => {
    const tabs = await adapter.tabs.query({ active: true, currentWindow: true });
    const pageUrl = typeof tabs[0]?.url === 'string' ? tabs[0].url : undefined;
    if (pageUrl === undefined) return false;
    const origins = [...originsForPage(pageUrl)];
    if (await adapter.permissions.contains({ origins })) return true;
    return adapter.permissions.request({ origins });
  };
  const ensureSliderContent = async (): Promise<void> => {
    await adapter.runtime.sendMessage({ type: 'captcha:reconcile-access' }).catch(() => undefined);
    const tabs = await adapter.tabs.query({ active: true, currentWindow: true });
    const tabId = typeof tabs[0]?.id === 'number' ? tabs[0].id : undefined;
    if (tabId === undefined || adapter.scripting === undefined) return;
    try { await adapter.tabs.sendMessage?.(tabId, { type: 'captcha:ping' }); }
    catch {
      await adapter.scripting.executeScript({ target: { tabId }, files: ['content-scripts/content.js'] }).catch(() => undefined);
    }
  };
  view.sliderButton.addEventListener('click', () => {
    void (async () => {
      view.sliderButton.disabled = true;
      view.sliderStatus.textContent = sliderText.running;
      if (!await ensureSliderPageAccess() || !await ensureDebugger()) {
        view.sliderStatus.textContent = sliderText.permission;
        view.sliderButton.disabled = false;
        return;
      }
      await ensureSliderContent();
      const result = await adapter.runtime.sendMessage({ type: 'captcha:run-slider' }).catch(() => ({ state: 'failed' }));
      const state = typeof result === 'object' && result !== null ? (result as { state?: unknown }).state : undefined;
      view.sliderStatus.textContent = state === 'success' ? sliderText.success
        : state === 'not-found' || state === 'unsupported' ? sliderText.notFound
          : state === 'low-confidence' ? sliderText.lowConfidence
            : state === 'permission-denied' ? sliderText.permission
              : sliderText.failed;
      view.sliderButton.disabled = false;
    })();
  });
  view.sliderCheckbox.addEventListener('change', () => {
    void (async () => {
      const requested = view.sliderCheckbox.checked;
      view.sliderCheckbox.disabled = true;
      if (sliderHostname === undefined || (requested && (!await ensureSliderPageAccess() || !await ensureDebugger()))) {
        view.sliderCheckbox.checked = false;
        view.sliderStatus.textContent = sliderText.permission;
        view.sliderCheckbox.disabled = false;
        return;
      }
      const value = await adapter.runtime.sendMessage({ type: 'captcha:set-slider-enabled', enabled: requested, hostname: sliderHostname }).catch(() => undefined);
      if (requested) await ensureSliderContent();
      const saved = typeof value === 'object' && value !== null && (value as { enabled?: unknown }).enabled === requested;
      renderSliderState(saved ? requested : !requested);
      view.sliderCheckbox.disabled = false;
    })();
  });
  if (siteModes !== undefined) {
    view.modeSelect.disabled = true;
    void siteModes.read().then((mode) => {
      view.modeSelect.value = mode;
      view.modeSelect.disabled = false;
    }).catch(() => { view.modeSelect.value = 'auto'; view.modeSelect.disabled = false; });
    view.modeSelect.addEventListener('change', () => {
      const mode = view.modeSelect.value as SiteRecognitionMode;
      view.modeSelect.disabled = true;
      void siteModes.write(mode).then(() => {
        view.modeSelect.value = mode;
      }).catch(() => {
        void siteModes.read().then((current) => { view.modeSelect.value = current; }).catch(() => { view.modeSelect.value = 'auto'; });
      }).finally(() => { view.modeSelect.disabled = false; });
    });
  }
  void controller.start();
  void modelController.start();
  void readSliderState().catch(() => {
    view.sliderButton.disabled = true;
    view.sliderCheckbox.disabled = true;
    view.sliderStatus.textContent = sliderText.failed;
  });
}

const root = document.querySelector<HTMLElement>('#app');
if (root !== null && typeof browser !== 'undefined') {
  const settingsStore = createSettingsStore(createExtensionBrowserAdapter(browser));
  void settingsStore.read().then((settings) => {
    const locale = resolveUiLocale(settings.interfaceLocale, browser.i18n.getUILanguage());
    startPopup(root, {
      tabs: {
        query: (queryInfo) => browser.tabs.query(queryInfo),
        sendMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
      },
      scripting: {
        executeScript: (details) => browser.scripting.executeScript({ target: details.target, files: ['/content-scripts/content.js'] }),
      },
      runtime: { sendMessage: (message) => sendRuntimeMessage(browser.runtime, message) },
      permissions: browser.permissions,
      settings: { readAccessMode: async () => (await settingsStore.read()).accessMode },
    }, locale, () => browser.runtime.openOptionsPage(), () => window.close(), {
      async read() {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const url = tabs[0]?.url;
        if (typeof url !== 'string') throw new Error('unsupported page');
        return settingsStore.recognitionModeForPage(url);
      },
      async write(mode) {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const url = tabs[0]?.url;
        if (typeof url !== 'string') throw new Error('unsupported page');
        await settingsStore.setSiteRecognitionMode(hostnameForPage(url), mode);
      },
    }, { requestDebugger: () => browser.permissions.request({ permissions: ['debugger'] }) });
  });
}
