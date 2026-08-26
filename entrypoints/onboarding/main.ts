import { createExtensionBrowserAdapter, type ExtensionBrowserStoragePermissions } from '../../src/background/extension-browser';
import { GLOBAL_HTTP_ORIGINS } from '../../src/platform/permissions';
import { createTranslator, resolveUiLocale, type Translator, type UiLocale } from '../../src/platform/i18n';
import {
  createSettingsStore,
  isAccessMode,
  isInterfaceLocale,
  isRecognitionShortcut,
  type AccessMode,
  type CaptchaSettings,
} from '../../src/platform/settings-store';
import { sendRuntimeMessage } from '../../src/platform/runtime-messaging';
import { supportsPuzzleSliders } from '../../src/platform/extension-capabilities';

const GEE_TEST_ORIGINS = ['http://2captcha.com/*', 'https://2captcha.com/*'] as const;
const UPGRADE_GUIDE_VERSION = '1.2.0';

type OnboardingFlow = 'welcome' | 'upgrade';

export interface OnboardingBrowser extends ExtensionBrowserStoragePermissions {
  permissions: ExtensionBrowserStoragePermissions['permissions'] & {
    contains(details: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
  };
  tabs?: { create(details: { url: string }): Promise<unknown> };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    getURL(path: string): string;
    getManifest(): { permissions?: readonly string[] };
  };
  i18n?: { getUILanguage(): string };
}

interface GuideState {
  step: number;
  accessChoice?: AccessMode;
  sliderChoice?: AccessMode;
  sliderSkipped: boolean;
  sliderConfirmed: boolean;
  geeTestOpened: boolean;
  geeTestDone: boolean;
  sliderError?: string;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Onboarding view is missing ${selector}`);
  return element;
}

function flowFromLocation(): OnboardingFlow {
  return new URLSearchParams(window.location.search).get('flow') === 'upgrade' ? 'upgrade' : 'welcome';
}

function upgradeVersionFromLocation(): string {
  const value = new URLSearchParams(window.location.search).get('version');
  return value && /^\d+\.\d+\.\d+$/.test(value) ? value : UPGRADE_GUIDE_VERSION;
}

function shortcutOptions(value: string, t: Translator): string {
  const options = [
    ['middle', t('shortcutMiddle')],
    ['ctrl-click', t('shortcutCtrl')],
    ['alt-click', t('shortcutAlt')],
    ['shift-click', t('shortcutShift')],
  ];
  return options.map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('');
}

function languageOptions(settings: CaptchaSettings, t: Translator): string {
  return `<option value="system" ${settings.interfaceLocale === 'system' ? 'selected' : ''}>${t('languageSystem')}</option>
    <option value="zh_CN" ${settings.interfaceLocale === 'zh_CN' ? 'selected' : ''}>${t('languageChinese')}</option>
    <option value="en" ${settings.interfaceLocale === 'en' ? 'selected' : ''}>${t('languageEnglish')}</option>`;
}

function progress(step: number, total: number, t: Translator): string {
  return t('setupProgress', { current: step, total });
}

function stepNavigation(step: number, flow: OnboardingFlow, sliderSupported: boolean, t: Translator): string {
  const labels = flow === 'upgrade'
    ? [t('stepUpgrade'), t('stepSliderScope'), t('stepSliderDemo')]
    : sliderSupported
      ? [t('stepOverview'), t('stepStaticSettings'), t('stepStaticDemo'), t('stepSliderScope'), t('stepSliderDemo')]
      : [t('stepOverview'), t('stepStaticSettings'), t('stepStaticDemo')];
  const total = labels.length;
  return `<nav class="journey-nav" aria-label="${t('setupProgress', { current: step, total })}"><ol class="setup-progress">${labels.map((label, index) => {
    const number = index + 1;
    const state = number === step ? 'current' : number < step ? 'complete' : 'upcoming';
    return `<li data-state="${state}" ${number === step ? 'aria-current="step"' : ''}><span class="progress-dot">${number < step ? '<i aria-hidden="true"></i>' : number}</span><strong>${label}</strong></li>`;
  }).join('')}</ol></nav>`;
}

function accessOptions(choice: AccessMode | undefined, globalGranted: boolean, t: Translator): string {
  return `<div class="access-options" role="radiogroup" aria-label="${t('modeLabel')}">
    <button type="button" class="access-option" data-onboarding-mode="selected" role="radio" aria-checked="${choice === 'selected'}">
      <span class="choice-radio" aria-hidden="true"></span><span><strong>${t('selectedSites')}</strong><small>${t('selectedSitesBody')}</small></span><b>${choice === 'selected' ? t('accessGranted') : t('useSelected')}</b>
    </button>
    <button type="button" class="access-option" data-onboarding-mode="all" role="radio" aria-checked="${choice === 'all'}">
      <span class="choice-radio" aria-hidden="true"></span><span><strong>${t('allSites')}</strong><small>${t('allSitesBody')}</small></span><b>${choice === 'all' && globalGranted ? t('accessGranted') : t('grantAll')}</b>
    </button>
  </div>
  <p class="inline-status" data-onboarding-status role="status"></p>`;
}

function switchControl(id: string, checked: boolean, label: string, body: string): string {
  return `<div class="preference-row"><div><label for="${id}">${label}</label><p>${body}</p></div><label class="switch"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''} /><span aria-hidden="true"></span></label></div>`;
}

function overviewStep(sliderSupported: boolean, t: Translator): string {
  return `<section class="wizard-step stage-overview" data-step="1" data-page="overview">
    <header class="step-copy centered"><p>${t('welcomeEyebrow')}</p><h1>${t('welcomeTitle')}</h1><span>${t('welcomeBody')}</span></header>
    <div class="capability-workbench ${sliderSupported ? '' : 'single'}" aria-label="${t('welcomeFlowNote')}">
      <article class="capability-card static">
        <div class="workbench-heading"><span class="capability-index">01</span><div><h2>${t('welcomeStaticTitle')}</h2><p>${t('welcomeStaticBody')}</p></div></div>
        <div class="static-visual" aria-hidden="true"><div class="visual-captcha"><span>6K4P</span><i></i></div><div class="visual-arrow"></div><div class="visual-field"><span>6K4P</span><i></i></div></div>
      </article>
      ${sliderSupported ? `<article class="capability-card slider">
        <div class="workbench-heading"><span class="capability-index">02</span><div><h2>${t('welcomeSliderTitle')}</h2><p>${t('welcomeSliderBody')}</p></div></div>
        <div class="slider-visual compact" aria-hidden="true"><div class="puzzle-scene"><span class="puzzle-gap"></span><span class="puzzle-piece"></span><i class="locator-line"></i></div><div class="slider-track"><span></span><i></i></div></div>
      </article>` : ''}
    </div>
    <p class="setup-note"${sliderSupported ? '' : ' data-slider-unavailable'}><i aria-hidden="true"></i><strong>${sliderSupported ? t('localOnly') : t('firefoxSliderUnavailableTitle')}</strong><span>${sliderSupported ? t('welcomeFlowNote') : t('firefoxSliderUnavailableBody')}</span></p>
  </section>`;
}

function staticSettingsStep(settings: CaptchaSettings, choice: AccessMode | undefined, globalGranted: boolean, total: number, t: Translator): string {
  return `<section class="wizard-step" data-step="2" data-page="static-settings">
    <header class="step-copy"><p>${t('setupProgress', { current: 2, total })}</p><h1>${t('behaviorTitle')}</h1><span>${t('behaviorBody')}</span></header>
    <div class="settings-stage-grid">
      <div class="stage-column"><div class="stage-label"><span>01</span>${t('accessChoice')}</div>${accessOptions(choice, globalGranted, t)}</div>
      <div class="stage-column"><div class="stage-label"><span>02</span>${t('recognitionHeading')}</div><div class="preference-list compact-preferences">
        ${switchControl('onboarding-auto-fill', settings.autoFill, t('autoFill'), t('autoFillBody'))}
        ${switchControl('onboarding-copy', settings.copyOnNoField, t('copyOnNoField'), t('copyOnNoFieldBody'))}
        <label class="preference-row select-row" for="onboarding-shortcut"><span><strong>${t('shortcut')}</strong><small>${t('setupLater')}</small></span><select id="onboarding-shortcut">${shortcutOptions(settings.recognitionShortcut, t)}</select></label>
      </div></div>
    </div>
  </section>`;
}

function drawDemo(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.fillStyle = '#f7f7f4';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#9ca39f';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(12, 18);
  context.lineTo(228, 31);
  context.moveTo(18, 63);
  context.lineTo(220, 55);
  context.stroke();
  context.save();
  context.translate(45, 58);
  context.rotate(-0.025);
  context.fillStyle = '#39423e';
  context.font = '40px Georgia, serif';
  context.fillText('20+22', 0, 0);
  context.restore();
}

function staticDemoStep(total: number, t: Translator): string {
  return `<section class="wizard-step" data-step="3" data-page="static-demo">
    <header class="step-copy"><p>${t('setupProgress', { current: 3, total })}</p><h1>${t('tryTitle')}</h1><span>${t('tryBody')}</span></header>
    <div class="demo-area">
      <div class="demo-window"><div class="window-bar" aria-hidden="true"><i></i><i></i><i></i><span>captcha.local</span></div><div class="captcha-sample"><canvas width="240" height="80" data-demo-canvas aria-label="7 times 3"></canvas><span>${t('localBadge')}</span></div></div>
      <div class="demo-action"><span class="demo-step-number">03</span><strong>${t('localOnly')}</strong><p data-demo-status role="status">${t('demoIdle')}</p><button type="button" class="secondary-button" data-run-demo>${t('runDemo')}</button></div>
    </div>
  </section>`;
}

function sliderChoiceCard(choice: AccessMode | undefined, mode: AccessMode, title: string, body: string): string {
  return `<button type="button" class="scope-option" data-slider-choice="${mode}" aria-pressed="${choice === mode}"><span class="scope-radio" aria-hidden="true"></span><span><strong>${title}</strong><small>${body}</small></span></button>`;
}

function sliderSettingsStep(settings: CaptchaSettings, state: GuideState, debuggerGranted: boolean, total: number, t: Translator): string {
  const selected = state.sliderChoice !== undefined;
  const existing = settings.sliderEnabledHosts.length > 0 || settings.sliderAccessMode === 'all';
  const existingValue = settings.sliderAccessMode === 'all' ? t('currentSliderAll') : settings.sliderEnabledHosts.length > 0 ? t('currentSliderSelected') : t('currentSliderOff');
  return `<section class="wizard-step" data-step="${state.step}" data-page="slider-settings">
    <header class="step-copy"><p>${t('setupProgress', { current: state.step, total })}</p><h1>${t('sliderScopeTitle')}</h1><span>${t('sliderScopeBody')}</span></header>
    <div class="slider-settings-grid">
      <div class="scope-column">
        ${existing ? `<div class="existing-config"><strong>${t('existingSliderConfig')}</strong><span>${t('currentSliderConfig', { value: existingValue })}. ${t('existingSliderConfigBody')}</span></div>` : ''}
        <div class="scope-options">
          ${sliderChoiceCard(state.sliderChoice, 'selected', t('selectedSites'), t('sliderSelectedBody'))}
          ${sliderChoiceCard(state.sliderChoice, 'all', t('allSites'), t('sliderAllBody'))}
        </div>
        <p class="choice-hint">${t('sliderChoiceHint')}</p>
      </div>
      <aside class="permission-summary ${selected ? '' : 'empty'}" data-permission-summary>${selected ? `<div><span class="summary-mark" aria-hidden="true"></span><strong>${t('sliderPermissionTitle')}</strong><p>${t('sliderPermissionBody')}</p></div><ul><li>${state.sliderChoice === 'all' ? t('sliderPermissionAll') : t('sliderPermissionSelected')}</li><li>${debuggerGranted ? t('accessGranted') : t('sliderPermissionRequired')}</li></ul>` : `<div><span class="summary-mark" aria-hidden="true"></span><strong>${t('sliderPermissionTitle')}</strong><p>${t('sliderChoiceHint')}</p></div>`}</aside>
    </div>
    <p class="inline-status ${state.sliderError ? 'error' : ''}" data-slider-status role="status">${state.sliderError ?? ''}</p>
    <button type="button" class="quiet-link" data-skip-slider>${t('skipSlider')}</button>
  </section>`;
}

function sliderDemoStep(state: GuideState, total: number, t: Translator): string {
  if (state.sliderSkipped) {
    return `<section class="wizard-step" data-step="${state.step}" data-page="slider-demo">
      <header class="step-copy"><p>${t('setupProgress', { current: state.step, total })}</p><h1>${t('sliderSkippedTitle')}</h1><span>${t('sliderSkippedBody')}</span></header>
      <div class="completion-card skipped"><span class="completion-icon" aria-hidden="true"><i></i></span><div><strong>${t('sliderSkippedTitle')}</strong><p>${t('sliderSkippedBody')}</p></div></div>
    </section>`;
  }
  return `<section class="wizard-step" data-step="${state.step}" data-page="slider-demo">
    <header class="step-copy"><p>${t('setupProgress', { current: state.step, total })}</p><h1>${state.geeTestDone ? t('sliderDoneTitle') : t('sliderOnboardingTitle')}</h1><span>${state.geeTestDone ? t('sliderDoneBody') : t('upgradeTestBody')}</span></header>
    <div class="slider-demo-layout">
      <div class="slider-visual large" aria-hidden="true"><div class="puzzle-scene"><span class="puzzle-gap"></span><span class="puzzle-piece"></span><i class="locator-line"></i></div><div class="slider-track"><span></span><i></i></div></div>
      <div class="slider-demo-card ${state.geeTestDone ? 'done' : ''}">
        <div class="demo-site-mark"><span>G</span><div><strong>GeeTest</strong><small>2captcha.com/demo/geetest</small></div></div>
        <p data-gee-status>${state.geeTestOpened ? t('geeTestOpened') : t('upgradeTestBody')}</p>
        <div class="demo-actions"><button type="button" class="primary-button" data-open-geetest>${t('openGeeTestDemo')}</button><button type="button" class="quiet-link" data-mark-geetest>${t('markGeeTestDone')}</button></div>
      </div>
    </div>
    <button type="button" class="quiet-link skip-test" data-skip-test>${t('skipTest')}</button>
  </section>`;
}

function upgradeStep(t: Translator): string {
  return `<section class="wizard-step" data-step="1" data-page="upgrade">
    <div class="upgrade-layout">
      <div><header class="step-copy"><p>${t('upgradeEyebrow')}</p><h1>${t('upgradeTitle')}</h1><span>${t('upgradeBody')}</span></header>
        <div class="release-points"><div><span>01</span><strong>${t('upgradePointSlider')}</strong></div><div><span>02</span><strong>${t('upgradePointScope')}</strong></div><div><span>03</span><strong>${t('upgradePointLocal')}</strong></div></div>
        <p class="permission-note">${t('upgradePermissionNote')}</p>
      </div>
      <div class="upgrade-visual"><span class="visual-label">Captcha Helper 1.2</span><div class="slider-visual large" aria-hidden="true"><div class="puzzle-scene"><span class="puzzle-gap"></span><span class="puzzle-piece"></span><i class="locator-line"></i></div><div class="slider-track"><span></span><i></i></div></div></div>
    </div>
  </section>`;
}

export async function startOnboarding(
  root: HTMLElement,
  extension: OnboardingBrowser,
  closeGuide: () => void | Promise<void> = () => window.close(),
): Promise<void> {
  const settingsStore = createSettingsStore(createExtensionBrowserAdapter(extension));
  const flow = flowFromLocation();
  const sliderSupported = supportsPuzzleSliders(extension.runtime.getManifest());
  const total = flow === 'welcome' ? (sliderSupported ? 5 : 3) : 3;
  const upgradeVersion = upgradeVersionFromLocation();
  const manualUpgrade = new URLSearchParams(window.location.search).get('manual') === '1';
  let settings = await settingsStore.read();
  let locale: UiLocale = resolveUiLocale(settings.interfaceLocale, extension.i18n?.getUILanguage() ?? navigator.language);
  let t = createTranslator(locale);
  const state: GuideState = {
    step: 1,
    accessChoice: flow === 'welcome' && !settings.onboardingComplete ? undefined : settings.accessMode,
    sliderChoice: undefined,
    sliderSkipped: false,
    sliderConfirmed: false,
    geeTestOpened: false,
    geeTestDone: false,
  };

  if (flow === 'upgrade' && !sliderSupported) {
    await closeGuide();
    return;
  }

  if (flow === 'upgrade') {
    if (!manualUpgrade && settings.lastSeenUpgradeGuide === upgradeVersion) {
      await closeGuide();
      return;
    }
    await settingsStore.setLastSeenUpgradeGuide(upgradeVersion);
  }

  const reconcile = async (): Promise<void> => { await extension.runtime.sendMessage({ type: 'captcha:reconcile-access' }); };
  const openTab = async (url: string): Promise<void> => {
    if (extension.tabs) await extension.tabs.create({ url });
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  let render: (direction?: 'next' | 'back' | 'initial') => Promise<void>;
  const primaryAction = async (): Promise<void> => {
    if (state.step === total) {
      if (flow === 'welcome') await settingsStore.setOnboardingComplete(true);
      await closeGuide();
      return;
    }
    const sliderStep = sliderSupported && (flow === 'upgrade' ? state.step === 2 : state.step === 4);
    if (sliderStep && !state.sliderSkipped && !state.sliderConfirmed) {
      if (state.sliderChoice === undefined) return;
      const debuggerGranted = await extension.permissions.contains({ permissions: ['debugger'] }).catch(() => false);
      if (!debuggerGranted) { state.sliderError = t('sliderPermissionRequired'); await render('initial'); return; }
      const origins = state.sliderChoice === 'all' ? [...GLOBAL_HTTP_ORIGINS] : [...GEE_TEST_ORIGINS];
      const granted = await extension.permissions.request({ origins });
      if (!granted) { state.sliderError = t('permissionDenied'); await render('initial'); return; }
      await settingsStore.setSliderAccessMode(state.sliderChoice);
      await settingsStore.setSliderOnboardingChoice(state.sliderChoice);
      if (state.sliderChoice === 'selected') await settingsStore.setSliderEnabled('2captcha.com', true);
      await reconcile();
      state.sliderConfirmed = true;
      state.step += 1;
      await render('next');
      return;
    }
    state.step += 1;
    await render('next');
  };

  render = async (direction: 'next' | 'back' | 'initial' = 'initial'): Promise<void> => {
    settings = await settingsStore.read();
    locale = resolveUiLocale(settings.interfaceLocale, extension.i18n?.getUILanguage() ?? navigator.language);
    t = createTranslator(locale);
    document.documentElement.lang = locale === 'zh_CN' ? 'zh-CN' : 'en';
    const globalGranted = await extension.permissions.contains({ origins: [...GLOBAL_HTTP_ORIGINS] }).catch(() => false);
    const debuggerGranted = sliderSupported && await extension.permissions.contains({ permissions: ['debugger'] }).catch(() => false);
    const content = flow === 'upgrade'
      ? state.step === 1 ? upgradeStep(t) : state.step === 2 ? sliderSettingsStep(settings, state, debuggerGranted, total, t) : sliderDemoStep(state, total, t)
      : state.step === 1 ? overviewStep(sliderSupported, t)
        : state.step === 2 ? staticSettingsStep(settings, state.accessChoice, globalGranted, total, t)
          : state.step === 3 ? staticDemoStep(total, t)
            : state.step === 4 ? sliderSettingsStep(settings, state, debuggerGranted, total, t)
              : sliderDemoStep(state, total, t);
    const primaryDisabled = flow === 'welcome' && state.step === 2 && state.accessChoice === undefined;
    const sliderNeedsConfirmation = (flow === 'upgrade' && state.step === 2 || flow === 'welcome' && state.step === 4) && !state.sliderSkipped && !state.sliderConfirmed;
    const sliderChoiceMissing = sliderNeedsConfirmation && state.sliderChoice === undefined;
    const primaryLabel = state.step === total ? t('finishSetup') : sliderNeedsConfirmation ? t('confirmSlider') : t('continueSetup');
    root.innerHTML = `<div class="setup-page" data-flow="${flow}" data-direction="${direction}">
      <header class="setup-header"><a class="setup-brand" href="#" aria-label="Captcha Helper"><img src="/icons/icon-48.png" width="40" height="40" alt="" /><span><strong>Captcha Helper</strong><small>${t('productSubtitle')}</small></span></a><div class="header-actions"><span class="local-status"><i aria-hidden="true"></i>${t('localOnly')}</span><label class="language-picker"><span>${t('languageLabel')}</span><select data-language>${languageOptions(settings, t)}</select></label></div></header>
      <div class="setup-layout">${stepNavigation(state.step, flow, sliderSupported, t)}<section class="wizard-panel" id="setup-content">${content}<footer class="wizard-actions"><button type="button" class="text-button" data-back ${state.step === 1 ? 'disabled' : ''}>${t('back')}</button><span>${progress(state.step, total, t)}</span><button type="button" class="primary-button" data-primary ${primaryDisabled || sliderChoiceMissing ? 'disabled' : ''}>${primaryLabel}</button></footer></section></div>
    </div>`;
    root.dataset.direction = direction;

    const canvas = root.querySelector<HTMLCanvasElement>('[data-demo-canvas]');
    if (canvas !== null) drawDemo(canvas);
    root.querySelector<HTMLSelectElement>('[data-language]')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (isInterfaceLocale(value)) void settingsStore.setInterfaceLocale(value).then(() => render('initial'));
    });
    root.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { if (state.step > 1) { state.step -= 1; void render('back'); } });
    root.querySelector<HTMLButtonElement>('[data-primary]')?.addEventListener('click', () => { void primaryAction(); });
    root.querySelectorAll<HTMLButtonElement>('[data-onboarding-mode]').forEach((button) => button.addEventListener('click', () => {
      void (async () => {
        const mode = button.dataset.onboardingMode;
        if (!isAccessMode(mode)) return;
        if (mode === 'all') {
          const granted = await extension.permissions.request({ origins: [...GLOBAL_HTTP_ORIGINS] });
          if (!granted) { const status = root.querySelector<HTMLElement>('[data-onboarding-status]'); if (status) { status.textContent = t('permissionDenied'); status.classList.add('error'); } return; }
        } else {
          await extension.permissions.remove({ origins: [...GLOBAL_HTTP_ORIGINS] }).catch(() => false);
        }
        state.accessChoice = mode;
        await settingsStore.setAccessMode(mode);
        await reconcile();
        await render('initial');
      })();
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-slider-choice]').forEach((button) => button.addEventListener('click', () => {
      const mode = button.dataset.sliderChoice;
      if (isAccessMode(mode)) { state.sliderChoice = mode; state.sliderError = undefined; void render('initial'); }
    }));
    root.querySelector<HTMLButtonElement>('[data-skip-slider]')?.addEventListener('click', () => { state.sliderSkipped = true; state.sliderChoice = undefined; state.sliderError = undefined; state.step += 1; void render('next'); });
    root.querySelector<HTMLButtonElement>('[data-skip-test]')?.addEventListener('click', () => { state.sliderSkipped = true; void render('initial'); });
    root.querySelector<HTMLButtonElement>('[data-open-geetest]')?.addEventListener('click', () => {
      void openTab('https://2captcha.com/demo/geetest').then(() => { state.geeTestOpened = true; void render('initial'); });
    });
    root.querySelector<HTMLButtonElement>('[data-mark-geetest]')?.addEventListener('click', () => { state.geeTestDone = true; void render('initial'); });
    root.querySelector<HTMLInputElement>('#onboarding-auto-fill')?.addEventListener('change', (event) => { void settingsStore.setAutoFill((event.currentTarget as HTMLInputElement).checked); });
    root.querySelector<HTMLInputElement>('#onboarding-copy')?.addEventListener('change', (event) => { void settingsStore.setCopyOnNoField((event.currentTarget as HTMLInputElement).checked); });
    root.querySelector<HTMLSelectElement>('#onboarding-shortcut')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (isRecognitionShortcut(value)) void settingsStore.setRecognitionShortcut(value);
    });
    root.querySelector<HTMLButtonElement>('[data-run-demo]')?.addEventListener('click', () => {
      void (async () => {
        const demoCanvas = required<HTMLCanvasElement>(root, '[data-demo-canvas]');
        const status = required<HTMLElement>(root, '[data-demo-status]');
        const button = required<HTMLButtonElement>(root, '[data-run-demo]');
        button.disabled = true; status.dataset.state = 'loading'; status.textContent = t('demoRunning');
        try {
          const response = await extension.runtime.sendMessage({ type: 'captcha:recognize', imageDataUrl: demoCanvas.toDataURL('image/png'), revision: `tutorial-${Date.now()}`, modes: ['arithmetic'] }) as { text?: string; confidence?: number }[];
          const best = Array.isArray(response) ? [...response].sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0] : undefined;
          status.textContent = best?.text ? t('demoResult', { value: best.text }) : t('demoFailed'); status.dataset.state = best?.text ? 'success' : 'error';
        } catch { status.textContent = t('demoFailed'); status.dataset.state = 'error'; } finally { button.disabled = false; }
      })();
    });
  };

  await render();
}

const root = document.querySelector<HTMLElement>('#app');
if (root !== null && typeof browser !== 'undefined') {
  void startOnboarding(root, {
    storage: browser.storage,
    permissions: browser.permissions,
    tabs: { create: (details) => browser.tabs.create(details) },
    runtime: {
      sendMessage: (message) => sendRuntimeMessage(browser.runtime, message),
      getURL: (path) => (browser.runtime.getURL as (value: string) => string)(path),
      getManifest: () => browser.runtime.getManifest(),
    },
    i18n: browser.i18n,
  });
}
