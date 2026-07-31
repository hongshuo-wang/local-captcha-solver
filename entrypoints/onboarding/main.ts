import { createExtensionBrowserAdapter, type ExtensionBrowserStoragePermissions } from '../../src/background/extension-browser';
import { GLOBAL_HTTP_ORIGINS } from '../../src/platform/permissions';
import { createTranslator, resolveUiLocale, type Translator, type UiLocale } from '../../src/platform/i18n';
import {
  createSettingsStore,
  isInterfaceLocale,
  isRecognitionShortcut,
  type CaptchaSettings,
} from '../../src/platform/settings-store';
import { sendRuntimeMessage } from '../../src/platform/runtime-messaging';

export interface OnboardingBrowser extends ExtensionBrowserStoragePermissions {
  permissions: ExtensionBrowserStoragePermissions['permissions'] & {
    contains(details: { origins: string[] }): Promise<boolean>;
  };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    getURL(path: string): string;
  };
  i18n?: { getUILanguage(): string };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Onboarding view is missing ${selector}`);
  return element;
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

function stepNavigation(step: number, t: Translator): string {
  const labels = [t('accessChoice'), t('behaviorTitle'), t('tryTitle')];
  return `<ol class="setup-progress">${labels.map((label, index) => {
    const number = index + 1;
    const state = number === step ? 'current' : number < step ? 'complete' : 'upcoming';
    return `<li data-state="${state}"><span>${number < step ? '✓' : number}</span><div><small>${t('setupProgress', { current: number })}</small><strong>${label}</strong></div></li>`;
  }).join('')}</ol>`;
}

function accessStep(settings: CaptchaSettings, globalGranted: boolean, t: Translator): string {
  return `<section class="wizard-step" data-step="1">
    <header class="step-copy"><p>${t('setupProgress', { current: 1 })}</p><h1>${t('accessChoice')}</h1><span>${t('accessChoiceBody')}</span></header>
    <div class="access-options" role="radiogroup" aria-label="${t('modeLabel')}">
      <button type="button" class="access-option" data-onboarding-mode="all" role="radio" aria-checked="${settings.accessMode === 'all'}">
        <span class="choice-radio" aria-hidden="true"></span><span><strong>${t('allSites')}</strong><small>${t('allSitesBody')}</small></span><b>${settings.accessMode === 'all' && globalGranted ? t('accessGranted') : t('grantAll')}</b>
      </button>
      <button type="button" class="access-option" data-onboarding-mode="selected" role="radio" aria-checked="${settings.accessMode === 'selected'}">
        <span class="choice-radio" aria-hidden="true"></span><span><strong>${t('selectedSites')}</strong><small>${t('selectedSitesBody')}</small></span><b>${t('useSelected')}</b>
      </button>
    </div>
    <p class="inline-status" data-onboarding-status role="status"></p>
  </section>`;
}

function switchControl(id: string, checked: boolean, label: string, body: string): string {
  return `<div class="preference-row"><div><label for="${id}">${label}</label><p>${body}</p></div><label class="switch"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''} /><span aria-hidden="true"></span></label></div>`;
}

function behaviorStep(settings: CaptchaSettings, t: Translator): string {
  return `<section class="wizard-step" data-step="2">
    <header class="step-copy"><p>${t('setupProgress', { current: 2 })}</p><h1>${t('behaviorTitle')}</h1><span>${t('setupLater')}</span></header>
    <div class="preference-list">
      ${switchControl('onboarding-auto-fill', settings.autoFill, t('autoFill'), t('autoFillBody'))}
      ${switchControl('onboarding-copy', settings.copyOnNoField, t('copyOnNoField'), t('copyOnNoFieldBody'))}
      <label class="preference-row select-row" for="onboarding-shortcut"><span><strong>${t('shortcut')}</strong><small>${t('setupLater')}</small></span><select id="onboarding-shortcut">${shortcutOptions(settings.recognitionShortcut, t)}</select></label>
    </div>
  </section>`;
}

function demoStep(t: Translator): string {
  return `<section class="wizard-step" data-step="3">
    <header class="step-copy"><p>${t('setupProgress', { current: 3 })}</p><h1>${t('readyTitle')}</h1><span>${t('readyBody')}</span></header>
    <div class="demo-area">
      <div class="captcha-sample"><canvas width="240" height="80" data-demo-canvas aria-label="7 times 3"></canvas><span>${t('localBadge')}</span></div>
      <div class="demo-action"><button type="button" class="secondary-button" data-run-demo>${t('runDemo')}</button><p data-demo-status role="status">${t('demoIdle')}</p></div>
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

export async function startOnboarding(
  root: HTMLElement,
  extension: OnboardingBrowser,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  const settingsStore = createSettingsStore(createExtensionBrowserAdapter(extension));
  let step = 1;
  let settings = await settingsStore.read();
  let locale: UiLocale = resolveUiLocale(settings.interfaceLocale, extension.i18n?.getUILanguage() ?? navigator.language);
  let t = createTranslator(locale);

  const reconcile = async (): Promise<void> => { await extension.runtime.sendMessage({ type: 'captcha:reconcile-access' }); };

  const render = async (): Promise<void> => {
    settings = await settingsStore.read();
    locale = resolveUiLocale(settings.interfaceLocale, extension.i18n?.getUILanguage() ?? navigator.language);
    t = createTranslator(locale);
    document.documentElement.lang = locale === 'zh_CN' ? 'zh-CN' : 'en';
    const globalGranted = await extension.permissions.contains({ origins: [...GLOBAL_HTTP_ORIGINS] }).catch(() => false);
    const content = step === 1 ? accessStep(settings, globalGranted, t) : step === 2 ? behaviorStep(settings, t) : demoStep(t);
    const continueDisabled = step === 1 && settings.accessMode === 'all' && !globalGranted;
    root.innerHTML = `<div class="setup-page">
      <header class="setup-header">
        <a class="setup-brand" href="#" aria-label="Captcha Helper"><img src="/icons/icon-48.png" width="40" height="40" alt="" /><span><strong>Captcha Helper</strong><small>${t('productSubtitle')}</small></span></a>
        <label class="language-picker"><span>${t('languageLabel')}</span><select data-language>${languageOptions(settings, t)}</select></label>
      </header>
      <div class="setup-layout">
        <aside class="setup-sidebar"><div><p>${t('welcomeEyebrow')}</p><h2>${t('welcomeTitle')}</h2><span>${t('welcomeBody')}</span></div>${stepNavigation(step, t)}<p class="privacy-line"><i aria-hidden="true"></i>${t('footerPrivacy')}</p></aside>
        <section class="wizard-panel" id="setup-content">${content}
          <footer class="wizard-actions">
            <button type="button" class="text-button" data-back ${step === 1 ? 'disabled' : ''}>${t('back')}</button>
            <span>${t('setupProgress', { current: step })}</span>
            <button type="button" class="primary-button" ${step === 3 ? 'data-finish-guide' : 'data-next'} ${continueDisabled ? 'disabled' : ''}>${step === 3 ? t('openConfiguration') : t('continueSetup')}</button>
          </footer>
        </section>
      </div>
    </div>`;

    const canvas = root.querySelector<HTMLCanvasElement>('[data-demo-canvas]');
    if (canvas !== null) drawDemo(canvas);

    root.querySelector<HTMLSelectElement>('[data-language]')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (isInterfaceLocale(value)) void settingsStore.setInterfaceLocale(value).then(render);
    });
    root.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { if (step > 1) { step -= 1; void render(); } });
    root.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', () => { if (step < 3) { step += 1; void render(); } });
    root.querySelectorAll<HTMLButtonElement>('[data-onboarding-mode]').forEach((button) => button.addEventListener('click', () => {
      void (async () => {
        const mode = button.dataset.onboardingMode as 'all' | 'selected';
        if (mode === 'all') {
          const granted = await extension.permissions.request({ origins: [...GLOBAL_HTTP_ORIGINS] });
          if (!granted) {
            const status = root.querySelector<HTMLElement>('[data-onboarding-status]');
            if (status !== null) { status.textContent = t('permissionDenied'); status.classList.add('error'); }
            return;
          }
        } else {
          await extension.permissions.remove({ origins: [...GLOBAL_HTTP_ORIGINS] });
        }
        await settingsStore.setAccessMode(mode);
        await reconcile();
        await render();
      })();
    }));
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
        button.disabled = true;
        status.dataset.state = 'loading';
        status.textContent = t('demoRunning');
        try {
          const response = await extension.runtime.sendMessage({ type: 'captcha:recognize', imageDataUrl: demoCanvas.toDataURL('image/png'), revision: `tutorial-${Date.now()}`, modes: ['arithmetic'] }) as { text?: string; confidence?: number }[];
          const best = Array.isArray(response) ? [...response].sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))[0] : undefined;
          status.textContent = best?.text ? t('demoResult', { value: best.text }) : t('demoFailed');
          status.dataset.state = best?.text ? 'success' : 'error';
        } catch {
          status.textContent = t('demoFailed');
          status.dataset.state = 'error';
        } finally {
          button.disabled = false;
        }
      })();
    });
    root.querySelector<HTMLButtonElement>('[data-finish-guide]')?.addEventListener('click', () => {
      void settingsStore.setOnboardingComplete(true).then(() => navigate(extension.runtime.getURL('options.html')));
    });
  };

  await render();
}

const root = document.querySelector<HTMLElement>('#app');
if (root !== null && typeof browser !== 'undefined') {
  void startOnboarding(root, {
    storage: browser.storage,
    permissions: browser.permissions,
    runtime: {
      sendMessage: (message) => sendRuntimeMessage(browser.runtime, message),
      getURL: (path) => (browser.runtime.getURL as (value: string) => string)(path),
    },
    i18n: browser.i18n,
  });
}
