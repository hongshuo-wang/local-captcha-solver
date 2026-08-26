import { createModelStatusController, createPopupController, type PopupControllerAdapter, type PopupControllerLabels, type PopupView, type PopupViewState } from '../../src/popup/controller';
import type { ModelLog, ModelStatusSnapshot } from '../../src/background/model-status';
import { createTranslator, resolveUiLocale, type Translator, type UiLocale } from '../../src/platform/i18n';
import { createSettingsStore, hostnameForPage, type SiteRecognitionMode } from '../../src/platform/settings-store';
import { originsForPage } from '../../src/platform/permissions';
import { createExtensionBrowserAdapter } from '../../src/background/extension-browser';
import { sendRuntimeMessage } from '../../src/platform/runtime-messaging';
import { SLIDER_RESULT_STATES, type SliderActivity, type SliderResultState, type SliderSiteState } from '../../src/slider/types';
import { supportsPuzzleSliders } from '../../src/platform/extension-capabilities';

type SliderDisplayState = 'loading' | 'off' | 'idle' | 'running' | 'unavailable' | SliderResultState;

export interface PopupViewElements extends PopupView {
  checkbox: HTMLInputElement;
  accessButton: HTMLButtonElement;
  modelRetry: HTMLButtonElement;
  recognizeButton: HTMLButtonElement;
  settingsButton: HTMLButtonElement;
  modeSelect: HTMLSelectElement;
  sliderButton: HTMLButtonElement;
  sliderCheckbox: HTMLInputElement;
  sliderPanel: HTMLElement;
  sliderStateMode: HTMLElement;
  sliderStateTitle: HTMLElement;
  sliderStatus: HTMLElement;
  sliderTab: HTMLButtonElement;
  sliderTabStatus: HTMLElement;
  showTab(tab: 'static' | 'slider'): void;
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
  if (log.kind === 'slider') return log.outcome === 'success' ? 'Slider verification completed' : 'Slider verification did not complete';
  if (log.outcome === 'failure') return 'Recognition failed';
  if (log.outcome === 'skipped') return 'No safe automatic action';
  if (log.kind === 'warmup') return log.outcome === 'success' ? 'Local model is ready' : 'Preparing the local model';
  return log.outcome === 'started' ? 'Recognition started' : 'Recognition completed';
}

export function createPopupView(root: HTMLElement, locale: UiLocale = 'zh_CN', sliderSupported = true): PopupViewElements {
  const t = createTranslator(locale);
  root.innerHTML = `
    <div class="popup-shell">
      <header class="popup-header">
        <img class="brand-mark" src="/icons/icon-48.png" alt="" width="40" height="40" />
        <div class="brand-copy"><h1>Captcha Helper</h1><p>${t('productSubtitle')}</p></div>
        <button type="button" class="settings-command" data-open-settings>${t('navSettings')}</button>
      </header>
      <div class="context-bar"><div><span>${t('currentSite')}</span><strong class="hostname" data-popup-hostname></strong></div><section class="model-strip" aria-label="Model status"><span class="model-indicator" data-model-indicator aria-hidden="true"></span><p data-model-summary>${t('modelLoading')}</p><button type="button" class="text-command" data-model-retry hidden>${t('retryModel')}</button></section></div>

      <nav class="capability-tabs" role="tablist" aria-label="${locale === 'zh_CN' ? '验证码能力' : 'CAPTCHA capabilities'}">
        <button id="popup-static-tab" type="button" role="tab" aria-selected="true" aria-controls="popup-static-panel" data-popup-tab="static"><span class="tab-symbol static-symbol" aria-hidden="true">Aa</span><span><strong>${t('welcomeStaticTitle')}</strong><small data-static-tab-status>${locale === 'zh_CN' ? '读取当前页状态' : 'Reading page status'}</small></span></button>
        <button id="popup-slider-tab" type="button" role="tab" aria-selected="false" aria-controls="popup-slider-panel" tabindex="-1" data-popup-tab="slider"><span class="tab-symbol slider-symbol" aria-hidden="true"><i></i></span><span><strong>${locale === 'zh_CN' ? '拼图滑块' : 'Puzzle slider'}</strong><small data-slider-tab-status>${locale === 'zh_CN' ? '读取接管状态' : 'Reading takeover status'}</small></span></button>
      </nav>
      ${sliderSupported ? '' : `<aside class="slider-availability-note" data-slider-unavailable><strong>${t('firefoxSliderUnavailableTitle')}</strong><span>${t('firefoxSliderUnavailableBody')}</span></aside>`}

      <div class="capability-stage" data-active-tab="static">
        <section id="popup-static-panel" class="capability-view static-panel" role="tabpanel" aria-labelledby="popup-static-tab" data-popup-panel="static">
          <header class="capability-heading"><div><p class="section-kicker">${locale === 'zh_CN' ? '静态图片识别' : 'Static image recognition'}</p><h2>${t('recognizePage')}</h2><span>${locale === 'zh_CN' ? '识别当前页中最明确的一张验证码。' : 'Recognize the clearest CAPTCHA on this page.'}</span></div></header>
          <button type="button" class="recognize-command" data-recognize-page><span>${t('recognizePage')}</span><i aria-hidden="true"></i></button>
          <section class="access-panel" data-access-panel hidden><div><strong data-access-title>${t('accessChoice')}</strong><p data-access-copy></p></div><button type="button" class="primary-command" data-access-button>${t('grantAll')}</button></section>
          <div class="site-controls" data-controls-panel aria-label="${t('currentSite')}">
            <div class="control-row"><div><strong>${t('siteControl')}</strong><p id="site-status" class="status" role="status" aria-live="polite" data-popup-status></p></div><label class="switch" aria-label="${t('siteControl')}"><input id="site-enabled" type="checkbox" aria-describedby="site-status" /><span aria-hidden="true"></span></label></div>
            <label class="mode-row" for="captcha-mode"><span><strong>${t('captchaType')}</strong><small>${locale === 'zh_CN' ? '不确定时保持自动判断' : 'Keep automatic when unsure'}</small></span><select id="captcha-mode" data-captcha-mode><option value="auto">${t('modeAuto')}</option><option value="digits">${t('modeDigits')}</option><option value="letters">${t('modeLetters')}</option><option value="alphanumeric">${t('modeAlphanumeric')}</option><option value="arithmetic">${t('modeArithmetic')}</option></select></label>
          </div>
        </section>

        <section id="popup-slider-panel" class="capability-view slider-panel" role="tabpanel" aria-labelledby="popup-slider-tab" data-popup-panel="slider" data-slider-panel data-state="loading" hidden>
          <header class="capability-heading slider-heading"><div><p class="section-kicker">${locale === 'zh_CN' ? '动态验证码 Beta' : 'Dynamic CAPTCHA Beta'}</p><h2>${locale === 'zh_CN' ? '拼图滑块' : 'Puzzle slider'}</h2><span>${locale === 'zh_CN' ? '只在你允许的网站检测并拖动。' : 'Detect and drag only on sites you allow.'}</span></div><div class="slider-toggle"><span>${locale === 'zh_CN' ? '本站接管' : 'Site takeover'}</span><label class="switch" aria-label="${locale === 'zh_CN' ? '在此网站自动处理滑块' : 'Automatically handle sliders on this site'}"><input type="checkbox" data-slider-enabled aria-describedby="slider-status" /><span aria-hidden="true"></span></label></div></header>
          <div class="slider-state" role="status" aria-live="polite"><span class="slider-state-indicator" aria-hidden="true"></span><div class="slider-state-copy"><div class="slider-state-heading"><strong data-slider-state-title>${locale === 'zh_CN' ? '正在读取接管状态' : 'Reading takeover status'}</strong><span class="slider-state-mode" data-slider-state-mode hidden></span></div><p id="slider-status" data-slider-status>${locale === 'zh_CN' ? '正在确认当前网站设置。' : 'Checking the current site setting.'}</p></div></div>
          <button type="button" class="slider-command" data-run-slider>${locale === 'zh_CN' ? '立即检测当前滑块' : 'Check current slider now'}</button>
          <p class="permission-note">${locale === 'zh_CN' ? '仅在处理时使用浏览器 debugger 权限。运行网站可在设置中调整。' : 'Browser debugger permission is used only while handling a slider. Manage sites in Settings.'}</p>
        </section>
      </div>

      <footer class="popup-footer"><div><span>${t('recentStatus')}</span><time data-latest-time></time></div><p class="latest-activity" data-latest-activity>${t('noActivity')}</p></footer>
    </div>`;

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
  const sliderPanel = required<HTMLElement>(root, '[data-slider-panel]');
  const sliderStateMode = required<HTMLElement>(root, '[data-slider-state-mode]');
  const sliderStateTitle = required<HTMLElement>(root, '[data-slider-state-title]');
  const sliderStatus = required<HTMLElement>(root, '[data-slider-status]');
  const staticTab = required<HTMLButtonElement>(root, '[data-popup-tab="static"]');
  const sliderTab = required<HTMLButtonElement>(root, '[data-popup-tab="slider"]');
  const staticTabStatus = required<HTMLElement>(root, '[data-static-tab-status]');
  const sliderTabStatus = required<HTMLElement>(root, '[data-slider-tab-status]');
  const stage = required<HTMLElement>(root, '.capability-stage');
  const capabilityTabs = required<HTMLElement>(root, '.capability-tabs');
  const panels = root.querySelectorAll<HTMLElement>('[data-popup-panel]');
  const tabs = sliderSupported ? [staticTab, sliderTab] : [staticTab];
  capabilityTabs.dataset.sliderSupported = String(sliderSupported);
  sliderTab.hidden = !sliderSupported;
  sliderPanel.hidden = true;
  const showTab = (tab: 'static' | 'slider'): void => {
    if (tab === 'slider' && !sliderSupported) return;
    const current = stage.dataset.activeTab === 'slider' ? 'slider' : 'static';
    stage.dataset.direction = current === tab ? 'initial' : tab === 'slider' ? 'forward' : 'back';
    stage.dataset.activeTab = tab;
    panels.forEach((panel) => { panel.hidden = panel.dataset.popupPanel !== tab; });
    tabs.forEach((button) => {
      const selected = button.dataset.popupTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  };
  tabs.forEach((button) => button.addEventListener('click', () => showTab(button.dataset.popupTab === 'slider' ? 'slider' : 'static')));
  tabs.forEach((button) => button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextTab = button === staticTab ? sliderTab : staticTab;
    showTab(nextTab === sliderTab ? 'slider' : 'static');
    nextTab.focus();
  }));

  return {
    checkbox,
    accessButton,
    modelRetry,
    recognizeButton,
    settingsButton,
    modeSelect,
    sliderButton,
    sliderCheckbox,
    sliderPanel,
    sliderStateMode,
    sliderStateTitle,
    sliderStatus,
    sliderTab,
    sliderTabStatus,
    showTab,
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
      staticTab.dataset.state = state.recognitionAvailable ? (state.accessGranted ? 'ready' : 'attention') : 'unavailable';
      staticTabStatus.textContent = state.recognitionAvailable
        ? (state.accessGranted ? (state.checked ? (locale === 'zh_CN' ? '已开启' : 'On') : (locale === 'zh_CN' ? '可立即识别' : 'Ready')) : (locale === 'zh_CN' ? '需要授权' : 'Access needed'))
        : (locale === 'zh_CN' ? '当前页不可用' : 'Unavailable');
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
  sliderCapability = true,
): void {
  const view = createPopupView(root, locale, sliderCapability);
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
    off: ['未接管此网站', '开启“本站接管”后，检测到滑块会自动拖动。'],
    idle: ['已接管本站', '正在等待滑块出现，检测到后会自动处理。'],
    automaticRunning: ['正在自动拖动', '已发现滑块，正在发送浏览器级拖动。'],
    manualRunning: ['正在处理当前滑块', '正在定位缺口并发送浏览器级拖动。'],
    automaticSuccess: ['已自动完成拖动', '本次滑块验证已通过。'],
    manualSuccess: ['本次处理已完成', '滑块验证已通过。'],
    notFound: ['未发现可处理的滑块', '已停止操作，可等待滑块出现或再次检测。'],
    lowConfidence: ['已接管，但没有拖动', '定位结果不够确定，为避免误操作已停止。'],
    inactive: ['已接管，暂未拖动', '页面当前不可操作，返回页面后会再次检测。'],
    userActive: ['已暂停自动拖动', '检测到你正在操作页面，本次没有接管。'],
    permission: ['未获得拖动权限', '需要浏览器调试权限才能发送可信拖动。'],
    failed: ['本次未能完成', '操作已停止，可手动再次检测。'],
    unavailable: ['当前页面不可用', '此页面不支持滑块接管。'],
    automatic: '自动接管', manual: '手动处理', command: '立即检测当前滑块', retry: '重新检测当前滑块', working: '正在处理…',
  } : {
    off: ['This site is not taken over', 'Enable site takeover to drag sliders automatically when detected.'],
    idle: ['Site takeover is active', 'Waiting for a slider; it will be handled automatically.'],
    automaticRunning: ['Dragging automatically', 'A slider was found and browser-level drag input is being sent.'],
    manualRunning: ['Handling the current slider', 'Locating the gap and sending browser-level drag input.'],
    automaticSuccess: ['Automatic drag completed', 'This slider verification passed.'],
    manualSuccess: ['Current slider completed', 'Slider verification passed.'],
    notFound: ['No supported slider found', 'No input was sent; wait for a slider or check again.'],
    lowConfidence: ['Taken over, but not dragged', 'The location was uncertain, so the extension stopped to avoid a wrong action.'],
    inactive: ['Taken over, waiting to drag', 'The page is not currently actionable; it will be checked again when you return.'],
    userActive: ['Automatic drag paused', 'You were interacting with the page, so takeover was skipped.'],
    permission: ['Drag permission unavailable', 'Browser debugging permission is required for trusted drag input.'],
    failed: ['This attempt did not complete', 'The operation stopped; check the current slider again.'],
    unavailable: ['Current page unavailable', 'Slider takeover is not supported on this page.'],
    automatic: 'Automatic', manual: 'Manual', command: 'Check current slider now', retry: 'Check current slider again', working: 'Working…',
  };
  let sliderHostname: string | undefined;
  let debuggerGranted = false;
  let sliderSupported = false;
  let sliderEnabled = false;
  let sliderBusy = false;
  let sliderDisplayState: SliderDisplayState = 'loading';
  let sliderReadGeneration = 0;
  const sliderActivity = (value: unknown): SliderActivity | undefined => {
    if (typeof value !== 'object' || value === null) return undefined;
    const candidate = value as { state?: unknown; trigger?: unknown; at?: unknown; confidence?: unknown; reason?: unknown };
    if (candidate.state !== 'running' && !SLIDER_RESULT_STATES.includes(candidate.state as SliderResultState)) return undefined;
    if (candidate.trigger !== 'manual' && candidate.trigger !== 'automatic') return undefined;
    if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) return undefined;
    return {
      state: candidate.state as SliderActivity['state'],
      trigger: candidate.trigger,
      at: candidate.at,
      ...(typeof candidate.confidence === 'number' ? { confidence: candidate.confidence } : {}),
      ...(typeof candidate.reason === 'string' ? { reason: candidate.reason } : {}),
    };
  };
  const displayForActivity = (activity: SliderActivity): SliderDisplayState => {
    if (activity.state === 'unsupported') return 'not-found';
    return activity.state;
  };
  const displayForResult = (state: SliderResultState): SliderDisplayState => state === 'unsupported' ? 'not-found' : state;
  const updateSliderControls = (): void => {
    const running = sliderDisplayState === 'running';
    view.sliderCheckbox.disabled = !sliderSupported || sliderBusy || running || !debuggerGranted;
    view.sliderButton.disabled = !sliderSupported || sliderBusy || running || !debuggerGranted;
  };
  const renderSliderState = (enabled: boolean, state: SliderDisplayState, trigger?: SliderActivity['trigger']): void => {
    const previousState = sliderDisplayState;
    sliderEnabled = enabled;
    sliderDisplayState = state;
    view.sliderCheckbox.checked = enabled;
    view.sliderPanel.dataset.state = state;
    view.sliderTab.dataset.state = state;
    view.sliderTabStatus.textContent = state === 'loading'
      ? (locale === 'zh_CN' ? '读取接管状态' : 'Reading takeover status')
      : state === 'off'
        ? (locale === 'zh_CN' ? '本站未开启' : 'Off')
        : state === 'idle'
          ? (locale === 'zh_CN' ? '已开启' : 'On')
          : state === 'running'
            ? (locale === 'zh_CN' ? '正在处理' : 'Working')
            : state === 'success'
              ? (locale === 'zh_CN' ? '最近已完成' : 'Completed')
              : state === 'unavailable'
                ? (locale === 'zh_CN' ? '当前页不可用' : 'Unavailable')
                : state === 'permission-denied'
                  ? (locale === 'zh_CN' ? '需要权限' : 'Permission needed')
                  : (locale === 'zh_CN' ? '本次未处理' : 'Not handled');
    if (state === 'running' || (state === 'success' && previousState === 'running')) view.showTab('slider');
    const automatic = trigger === 'automatic';
    const content = state === 'off' ? sliderText.off
      : state === 'idle' || state === 'loading' ? sliderText.idle
        : state === 'running' ? (automatic ? sliderText.automaticRunning : sliderText.manualRunning)
          : state === 'success' ? (automatic ? sliderText.automaticSuccess : sliderText.manualSuccess)
            : state === 'not-found' ? sliderText.notFound
              : state === 'low-confidence' ? sliderText.lowConfidence
                : state === 'page-inactive' ? sliderText.inactive
                  : state === 'user-active' ? sliderText.userActive
                    : state === 'permission-denied' ? sliderText.permission
                      : state === 'unavailable' ? sliderText.unavailable
                        : sliderText.failed;
    view.sliderStateTitle.textContent = content[0];
    view.sliderStatus.textContent = content[1];
    view.sliderStateMode.hidden = trigger === undefined;
    view.sliderStateMode.textContent = automatic ? sliderText.automatic : sliderText.manual;
    view.sliderButton.textContent = state === 'running' ? sliderText.working
      : state === 'success' || state === 'not-found' || state === 'low-confidence' || state === 'failed' || state === 'uncertain' ? sliderText.retry
        : sliderText.command;
    updateSliderControls();
  };
  const readSliderState = async (): Promise<void> => {
    const generation = ++sliderReadGeneration;
    const value = await adapter.runtime.sendMessage({ type: 'captcha:get-slider-state' });
    if (generation !== sliderReadGeneration || sliderBusy) return;
    if (typeof value !== 'object' || value === null || (value as { supported?: unknown }).supported !== true) {
      sliderHostname = undefined;
      sliderSupported = false;
      renderSliderState(false, 'unavailable');
      return;
    }
    const state = value as Partial<SliderSiteState>;
    sliderSupported = true;
    sliderHostname = typeof state.hostname === 'string' ? state.hostname : undefined;
    debuggerGranted = state.debuggerGranted === true;
    const enabled = state.enabled === true;
    const activity = sliderActivity(state.activity);
    if (!debuggerGranted) renderSliderState(false, 'permission-denied');
    else if (activity !== undefined) renderSliderState(enabled, displayForActivity(activity), activity.trigger);
    else renderSliderState(enabled, enabled ? 'idle' : 'off');
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
    let ready = false;
    try {
      const response = await adapter.tabs.sendMessage?.(tabId, { type: 'captcha:ping' });
      ready = typeof response === 'object' && response !== null && (response as { ok?: unknown }).ok === true;
    } catch { ready = false; }
    if (!ready) {
      await adapter.scripting.executeScript({ target: { tabId }, files: ['content-scripts/content.js'] }).catch(() => undefined);
      await adapter.tabs.sendMessage?.(tabId, { type: 'captcha:ping' }).catch(() => undefined);
    }
  };
  view.sliderButton.addEventListener('click', () => {
    void (async () => {
      sliderBusy = true;
      sliderReadGeneration += 1;
      renderSliderState(sliderEnabled, 'running', 'manual');
      try {
        if (!debuggerGranted || !await ensureSliderPageAccess()) {
          renderSliderState(sliderEnabled, 'permission-denied', 'manual');
          return;
        }
        await ensureSliderContent();
        const result = await adapter.runtime.sendMessage({ type: 'captcha:run-slider' });
        const state = typeof result === 'object' && result !== null ? (result as { state?: unknown }).state : undefined;
        renderSliderState(sliderEnabled, SLIDER_RESULT_STATES.includes(state as SliderResultState) ? displayForResult(state as SliderResultState) : 'failed', 'manual');
      } catch {
        renderSliderState(sliderEnabled, 'failed', 'manual');
      } finally {
        sliderBusy = false;
        updateSliderControls();
      }
    })();
  });
  view.sliderCheckbox.addEventListener('change', () => {
    void (async () => {
      const requested = view.sliderCheckbox.checked;
      sliderBusy = true;
      sliderReadGeneration += 1;
      updateSliderControls();
      try {
        if (sliderHostname === undefined || (requested && (!debuggerGranted || !await ensureSliderPageAccess()))) {
          renderSliderState(false, 'permission-denied');
          return;
        }
        const value = await adapter.runtime.sendMessage({ type: 'captcha:set-slider-enabled', enabled: requested, hostname: sliderHostname });
        if (requested) await ensureSliderContent();
        const saved = typeof value === 'object' && value !== null && (value as { enabled?: unknown }).enabled === requested;
        renderSliderState(saved ? requested : !requested, saved ? (requested ? 'idle' : 'off') : 'failed');
      } catch {
        renderSliderState(!requested, 'failed');
      } finally {
        sliderBusy = false;
        updateSliderControls();
      }
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
  const scheduleSliderRefresh = (): void => {
    globalThis.setTimeout(() => {
      if (!root.isConnected) return;
      if (sliderBusy) {
        scheduleSliderRefresh();
        return;
      }
      void readSliderState().catch(() => undefined).finally(scheduleSliderRefresh);
    }, 500);
  };
  if (sliderCapability) {
    void readSliderState().then(scheduleSliderRefresh).catch(() => {
      sliderSupported = false;
      renderSliderState(false, 'failed');
      scheduleSliderRefresh();
    });
  }
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
        executeScript: (details) => (browser.scripting as unknown as { executeScript(value: { target: { tabId: number }; files: string[] }): Promise<unknown> }).executeScript({ target: details.target, files: [...details.files] }),
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
    }, supportsPuzzleSliders(browser.runtime.getManifest()));
  });
}
