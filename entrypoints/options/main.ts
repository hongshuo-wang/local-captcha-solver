import { createExtensionBrowserAdapter, type ExtensionBrowserStoragePermissions } from '../../src/background/extension-browser';
import type { ModelLog, ModelStatusSnapshot } from '../../src/background/model-status';
import { GLOBAL_HTTP_ORIGINS, originsForPage, originsForSelectedSite } from '../../src/platform/permissions';
import {
  createSettingsStore,
  isInterfaceLocale,
  isRecognitionShortcut,
  normalizeHostname,
  type CaptchaSettings,
  type SiteRecognitionMode,
  type SelectedSiteRule,
  SETTINGS_STORAGE_KEY,
} from '../../src/platform/settings-store';
import { createTranslator, resolveUiLocale, type Translator, type UiLocale } from '../../src/platform/i18n';
import { sendRuntimeMessage } from '../../src/platform/runtime-messaging';
import { supportsPuzzleSliders } from '../../src/platform/extension-capabilities';

type ViewName = 'static' | 'slider' | 'diagnostics' | 'about';
const MODEL_STATUS_POLL_INTERVAL_MS = 250;
const MODEL_STATUS_POLL_LIMIT = 64;
const MODEL_STATUS_REFRESH_MS = 500;

interface SelectedSiteAccess {
  readonly rule: SelectedSiteRule;
  readonly granted: boolean;
}

export interface OptionsBrowser extends ExtensionBrowserStoragePermissions {
  storage: ExtensionBrowserStoragePermissions['storage'] & {
    onChanged?: {
      addListener(listener: (changes: Record<string, unknown>, areaName: string) => void): void;
    };
  };
  permissions: ExtensionBrowserStoragePermissions['permissions'] & {
    contains(details: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    remove(details: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    onAdded?: { addListener(listener: () => void): void };
    onRemoved?: { addListener(listener: () => void): void };
  };
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    getManifest(): { version: string; permissions?: readonly string[] };
    getURL(path: string): string;
  };
  tabs?: { create(details: { url: string }): Promise<unknown> };
  i18n?: { getUILanguage(): string };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Options view is missing ${selector}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

function diagnosticNumber(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(Math.round(value * 100) / 100);
}

function diagnosticDetails(log: ModelLog): string {
  const common = [
    log.site,
    log.recognizedText,
    log.fillValue,
    log.durationMs === undefined ? undefined : `${Math.round(log.durationMs)} ms`,
  ];
  if (log.kind !== 'slider') return common.filter((value): value is string => value !== undefined && value !== '').map(escapeHtml).join(' · ');
  const fields: Array<[string, string | undefined]> = [
    ['provider', log.provider],
    ['trigger', log.trigger],
    ['attempt', log.attemptId],
    ['challenge', log.challengeId],
    ['phase', log.phase],
    ['result', log.sliderState],
    ['imageSource', log.imageSource],
    ['method', log.localizationMethod],
    ['confidence', diagnosticNumber(log.confidence)],
    ['threshold', diagnosticNumber(log.confidenceThreshold)],
    ['score', diagnosticNumber(log.localizationScore)],
    ['alternativeSource', log.alternativeImageSource],
    ['alternativeConfidence', diagnosticNumber(log.alternativeConfidence)],
    ['gapX', diagnosticNumber(log.gapX)],
    ['gapY', diagnosticNumber(log.gapY)],
    ['pieceOffsetX', diagnosticNumber(log.pieceOffsetX)],
    ['pieceOffsetY', diagnosticNumber(log.pieceOffsetY)],
    ['desiredPieceOffsetX', diagnosticNumber(log.desiredPieceOffsetX)],
    ['actualPieceOffsetX', diagnosticNumber(log.actualPieceOffsetX)],
    ['pieceErrorX', diagnosticNumber(log.pieceErrorX)],
    ['correctionX', diagnosticNumber(log.correctionX)],
    ['imageWidth', diagnosticNumber(log.imageWidth)],
    ['imageHeight', diagnosticNumber(log.imageHeight)],
    ['trackWidth', diagnosticNumber(log.trackWidth)],
    ['handleWidth', diagnosticNumber(log.handleWidth)],
    ['scaleX', diagnosticNumber(log.scaleX)],
    ['scaleY', diagnosticNumber(log.scaleY)],
    ['startX', diagnosticNumber(log.startX)],
    ['requestedEndX', diagnosticNumber(log.requestedEndX)],
    ['endX', diagnosticNumber(log.endX)],
    ['releaseX', diagnosticNumber(log.releaseX)],
    ['plannedDragX', diagnosticNumber(log.plannedDragX)],
    ['finalDragX', diagnosticNumber(log.finalDragX)],
    ['observations', log.outcomeSequence],
    ['reason', log.reason],
  ];
  return [...common, ...fields.map(([name, value]) => value === undefined ? undefined : `${name}=${value}`)]
    .filter((value): value is string => value !== undefined && value !== '')
    .map(escapeHtml)
    .join(' · ');
}

function parseHostname(value: string): string {
  const input = value.trim();
  if (input === '') throw new Error('empty hostname');
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withScheme);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported scheme');
  return normalizeHostname(url.hostname);
}

function canIncludeSubdomains(hostname: string): boolean {
  return hostname.includes('.') && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) && !hostname.startsWith('[');
}

function uniqueOrigins(rules: readonly SelectedSiteRule[]): string[] {
  return [...new Set(rules.flatMap((rule) => originsForSelectedSite(rule)))];
}

function languageOptions(settings: CaptchaSettings, t: Translator): string {
  return `<option value="system" ${settings.interfaceLocale === 'system' ? 'selected' : ''}>${t('languageSystem')}</option><option value="zh_CN" ${settings.interfaceLocale === 'zh_CN' ? 'selected' : ''}>${t('languageChinese')}</option><option value="en" ${settings.interfaceLocale === 'en' ? 'selected' : ''}>${t('languageEnglish')}</option>`;
}

function shell(settings: CaptchaSettings, sliderSupported: boolean, t: Translator): string {
  return `<div class="settings-shell">
    <aside class="settings-sidebar">
      <a class="brand" href="#static" data-nav="static" aria-label="Captcha Helper">
        <img src="/icons/icon-48.png" width="40" height="40" alt="" />
        <span><strong>Captcha Helper</strong><small>${t('productSubtitle')}</small></span>
      </a>
      <nav class="settings-nav" aria-label="Primary">
        <button type="button" data-nav="static"><span class="nav-mark static-mark" aria-hidden="true">Aa</span><span><strong>${t('navAccess')}</strong><small>${t('accessHeading')}</small></span></button>
        ${sliderSupported ? `<button type="button" data-nav="slider"><span class="nav-mark slider-mark" aria-hidden="true"><i></i></span><span><strong>${t('navBehavior')}</strong><small>${t('sliderScopeTitle')}</small></span></button>` : ''}
        <button type="button" data-nav="diagnostics"><span class="nav-mark diagnostic-mark" aria-hidden="true"><i></i></span><span><strong>${t('navDiagnostics')}</strong><small>${t('recentStatus')}</small></span></button>
        <button type="button" data-nav="about"><span class="nav-mark about-mark" aria-hidden="true">i</span><span><strong>${t('navAbout')}</strong><small>Captcha Helper</small></span></button>
      </nav>
      <div class="sidebar-footer"><label for="interface-locale"><span>${t('languageLabel')}</span><select id="interface-locale">${languageOptions(settings, t)}</select></label><button type="button" data-open-guide>${t('reopenGuide')}</button><p><i aria-hidden="true"></i>${t('footerPrivacy')}</p></div>
    </aside>
    <main class="settings-content" id="content">
      <section class="view" data-view="static"></section>
      <section class="view" data-view="slider" hidden></section>
      <section class="view" data-view="diagnostics" hidden></section>
      <section class="view" data-view="about" hidden></section>
    </main>
  </div>`;
}

function pageHeading(eyebrow: string, title: string, body: string): string {
  return `<header class="page-heading" aria-label="${eyebrow}"><h1>${title}</h1><span>${body}</span></header>`;
}

function siteList(sites: readonly SelectedSiteAccess[], t: Translator): string {
  if (sites.length === 0) return `<p class="empty-state">${t('noAuthorizedSites')}</p>`;
  return `<ul class="site-list">${sites.map(({ rule, granted }) => `<li><div><strong>${rule.includeSubdomains ? `*.${rule.hostname}` : rule.hostname}</strong><small data-permission="${granted ? 'granted' : 'missing'}">${granted ? t('sitePermissionGranted') : t('sitePermissionMissing')} · ${rule.includeSubdomains ? t('includesSubdomains') : t('exactHostname')}</small></div><button type="button" class="icon-command" data-remove-site="${rule.hostname}" data-subdomains="${rule.includeSubdomains}" title="${t('remove')}" aria-label="${t('remove')} ${rule.hostname}">×</button></li>`).join('')}</ul>`;
}

function disabledList(hosts: readonly string[], t: Translator): string {
  if (hosts.length === 0) return `<p class="empty-state">${t('noDisabledSites')}</p>`;
  return `<ul class="site-list">${hosts.map((host) => `<li><strong>${host}</strong><button type="button" class="text-button" data-restore-site="${host}">${t('restore')}</button></li>`).join('')}</ul>`;
}

function staticMarkup(settings: CaptchaSettings, globalGranted: boolean, selectedAccess: readonly SelectedSiteAccess[], t: Translator): string {
  const selectedGranted = selectedAccess.filter((site) => site.granted).length;
  const permissionGranted = settings.accessMode === 'all' ? globalGranted : selectedGranted > 0;
  const permissionLabel = settings.accessMode === 'all'
    ? (globalGranted ? t('accessGranted') : t('accessNotGranted'))
    : t('selectedAccessStatus', { granted: selectedGranted, total: selectedAccess.length });
  return `${pageHeading(t('navSettings'), t('welcomeStaticTitle'), `${t('accessDescription')} ${t('behaviorDescription')}`)}
    <section class="capability-summary static-summary"><div class="summary-identity"><span aria-hidden="true">Aa</span><div><strong>${t('welcomeStaticTitle')}</strong><small>${t('localOnly')}</small></div></div><dl><div><dt>${t('modeLabel')}</dt><dd>${settings.accessMode === 'all' ? t('allSites') : t('selectedSites')}</dd></div><div><dt>${t('autoFill')}</dt><dd>${settings.autoFill ? t('settingOn') : t('settingOff')}</dd></div><div><dt>${t('authorizedSites')}</dt><dd>${selectedGranted}/${selectedAccess.length}</dd></div></dl></section>
    <div class="content-section access-section">
      <div class="section-heading"><div><h2>${t('modeLabel')}</h2><p><i class="status-dot" data-granted="${permissionGranted}"></i>${permissionLabel}</p></div><span class="mode-summary">${settings.accessMode === 'all' ? t('accessSummaryAll') : t('accessSummarySelected')}</span></div>
      <div class="segmented-control" data-access-mode>
        <button type="button" data-mode="all" aria-pressed="${settings.accessMode === 'all'}">${t('allSites')}</button>
        <button type="button" data-mode="selected" aria-pressed="${settings.accessMode === 'selected'}">${t('selectedSites')}</button>
      </div>
      <p class="inline-status" data-static-status role="status"></p>
      ${settings.accessMode === 'all' && globalGranted ? `<button type="button" class="text-button danger" data-revoke-global>${t('revokeGlobal')}</button>` : ''}
      ${settings.accessMode === 'selected' ? `<form class="site-form" data-site-form><label><span>${t('addSite')}</span><input name="hostname" type="text" inputmode="url" autocomplete="off" placeholder="${t('hostnamePlaceholder')}" /></label><label class="check-row"><input name="subdomains" type="checkbox" /><span>${t('includeSubdomains')}</span></label><button type="submit" class="primary-button">${t('add')}</button></form>` : ''}
    </div>
    <div class="site-columns">
      <section class="content-section list-section" aria-labelledby="authorized-title"><div class="section-heading compact"><h2 id="authorized-title">${t('authorizedSites')}</h2><span class="count">${selectedGranted}/${selectedAccess.length}</span></div>${siteList(selectedAccess, t)}</section>
      <section class="content-section list-section" aria-labelledby="disabled-title"><div class="section-heading compact"><h2 id="disabled-title">${t('disabledSites')}</h2><span class="count">${settings.disabledHosts.length}</span></div>${disabledList(settings.disabledHosts, t)}</section>
    </div>
    <div class="static-preference-grid">
      <section class="content-section behavior-section"><div class="section-heading compact"><h2>${t('recognitionHeading')}</h2></div><div class="setting-list">${switchControl('settings-auto-fill', settings.autoFill, t('autoFill'), t('autoFillBody'))}${switchControl('settings-copy', settings.copyOnNoField, t('copyOnNoField'), t('copyOnNoFieldBody'))}<label class="setting-row select-row" for="settings-shortcut"><span><strong>${t('shortcut')}</strong><small>${t('setupLater')}</small></span><select id="settings-shortcut">${shortcutOptions(settings.recognitionShortcut, t)}</select></label></div></section>
      <section class="content-section site-mode-section"><div class="section-heading compact"><h2>${t('siteModeOverrides')}</h2><span class="count">${settings.siteRecognitionModes.length}</span></div>${siteModeOverrides(settings.siteRecognitionModes, t)}</section>
    </div>`;
}

function switchControl(id: string, checked: boolean, label: string, body: string): string {
  return `<div class="setting-row"><div><label for="${id}">${label}</label><p>${body}</p></div><label class="switch"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''} /><span aria-hidden="true"></span></label></div>`;
}

function shortcutOptions(value: string, t: Translator): string {
  const options = [['middle', t('shortcutMiddle')], ['ctrl-click', t('shortcutCtrl')], ['alt-click', t('shortcutAlt')], ['shift-click', t('shortcutShift')]];
  return options.map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('');
}

function recognitionModeLabel(mode: SiteRecognitionMode, t: Translator): string {
  return mode === 'auto' ? t('modeAuto')
    : mode === 'digits' ? t('modeDigits')
      : mode === 'letters' ? t('modeLetters')
        : mode === 'alphanumeric' ? t('modeAlphanumeric')
          : t('modeArithmetic');
}

function siteModeOverrides(overrides: CaptchaSettings['siteRecognitionModes'], t: Translator): string {
  if (overrides.length === 0) return `<p class="empty-state">${t('noSiteModeOverrides')}</p>`;
  return `<ul class="site-list">${overrides.map((entry) => `<li><div><strong>${entry.hostname}</strong><small>${recognitionModeLabel(entry.mode, t)}</small></div><button type="button" class="text-button" data-restore-mode="${entry.hostname}">${t('restoreAutomatic')}</button></li>`).join('')}</ul>`;
}

function sliderMarkup(settings: CaptchaSettings, globalGranted: boolean, debuggerGranted: boolean, t: Translator): string {
  const sliderSites = settings.sliderEnabledHosts.length === 0
    ? `<p class="empty-state">${t('noSliderSites')}</p>`
    : `<ul class="site-list">${settings.sliderEnabledHosts.map((host) => `<li><div><strong>${host}</strong><small>${t('sliderSiteEnabled')}</small></div><button type="button" class="text-button danger" data-remove-slider="${host}">${t('remove')}</button></li>`).join('')}</ul>`;
  const sliderScope = settings.sliderAccessMode === 'all' ? t('allSites') : t('selectedSites');
  return `${pageHeading(t('navSettings'), t('welcomeSliderTitle'), t('sliderSitesDescription'))}
    <section class="capability-summary slider-summary"><div class="summary-identity"><span aria-hidden="true"><i></i></span><div><strong>${t('welcomeSliderTitle')}</strong><small>Beta · GeeTest</small></div></div><dl><div><dt>${t('modeLabel')}</dt><dd>${sliderScope}</dd></div><div><dt>debugger</dt><dd>${debuggerGranted ? t('accessGranted') : t('accessNotGranted')}</dd></div><div><dt>${t('authorizedSites')}</dt><dd>${settings.sliderAccessMode === 'all' ? 'HTTP / HTTPS' : settings.sliderEnabledHosts.length}</dd></div></dl></section>
    <section class="content-section slider-settings-section">
      <div class="section-heading compact"><div><h2>${t('sliderSitesHeading')}</h2><p class="section-description">${t('sliderSitesDescription')}</p></div><span class="count">${settings.sliderAccessMode === 'all' ? t('allSites') : settings.sliderEnabledHosts.length}</span></div>
      <div class="segmented-control" data-slider-access-mode>
        <button type="button" data-slider-mode="all" aria-pressed="${settings.sliderAccessMode === 'all'}">${t('allSites')}</button>
        <button type="button" data-slider-mode="selected" aria-pressed="${settings.sliderAccessMode === 'selected'}">${t('selectedSites')}</button>
      </div>
      <p class="inline-status" data-slider-settings-status role="status"></p>
      <p class="permission-note"><i class="status-dot" data-granted="${settings.sliderAccessMode === 'all' && globalGranted}"></i>${settings.sliderAccessMode === 'all' ? (globalGranted ? t('sliderGlobalGranted') : t('sliderGlobalPermissionMissing')) : t('sliderSelectedDescription')}</p>
      ${settings.sliderAccessMode === 'selected' ? `<form class="site-form" data-slider-site-form><label><span>${t('addSliderSite')}</span><input name="hostname" type="text" inputmode="url" autocomplete="off" placeholder="${t('hostnamePlaceholder')}" /></label><button type="submit" class="primary-button">${t('add')}</button></form>` : ''}
      ${sliderSites}
    </section>
    <section class="content-section demo-launch"><div><span class="demo-brand">G</span><div><h2>GeeTest</h2><p>2captcha.com/demo/geetest</p></div></div><div><button type="button" class="secondary-button" data-open-geetest>${t('openGeeTestDemo')}</button><button type="button" class="text-button" data-open-guide>${t('reopenGuide')}</button></div></section>`;
}

function diagnosticsMarkup(snapshot: ModelStatusSnapshot | undefined, t: Translator): string {
  const logs = snapshot?.logs.slice().reverse() ?? [];
  return `${pageHeading(t('navDiagnostics'), t('diagnosticsHeading'), t('diagnosticsBody'))}
    <section class="content-section diagnostics-summary"><div><span class="model-state" data-state="${snapshot?.status ?? 'loading'}"></span><div><strong>${snapshot?.message ?? t('modelLoading')}</strong><progress value="${snapshot?.progress ?? 0}" max="100"></progress></div></div><div class="toolbar"><button type="button" class="secondary-button" data-retry-model>${t('retryModel')}</button><button type="button" class="secondary-button" data-copy-diagnostics>${t('copyDiagnostics')}</button><button type="button" class="text-button danger" data-clear-diagnostics>${t('clearDiagnostics')}</button></div></section>
    <section class="content-section diagnostic-stream">${logs.length === 0 ? `<p class="empty-state">${t('noDiagnostics')}</p>` : `<ol>${logs.map((log) => `<li><time>${new Date(log.at).toLocaleString()}</time><div><strong>${escapeHtml(log.message)}</strong><p>${diagnosticDetails(log)}</p></div></li>`).join('')}</ol>`}</section>`;
}

function aboutMarkup(version: string, t: Translator): string {
  return `${pageHeading(t('navAbout'), t('aboutHeading'), t('aboutBody'))}
    <section class="content-section about-section"><div class="about-brand"><img src="/brand/captcha-helper.svg" alt="Captcha Helper" /><div><strong>Captcha Helper</strong><span>${t('localBadge')}</span></div></div><dl><div><dt>${t('version')}</dt><dd>${version}</dd></div><div><dt>${t('developer')}</dt><dd>Hongshuo Wang</dd></div></dl><nav class="about-links"><a href="https://github.com/hongshuo-wang/local-captcha-solver" target="_blank" rel="noreferrer">${t('sourceCode')}</a><a href="https://github.com/hongshuo-wang/local-captcha-solver/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">${t('privacy')}</a><a href="https://github.com/hongshuo-wang/local-captcha-solver/blob/main/LICENSE" target="_blank" rel="noreferrer">${t('license')}</a></nav></section>`;
}

export async function startOptions(
  root: HTMLElement,
  extension: OptionsBrowser,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  const settingsStore = createSettingsStore(createExtensionBrowserAdapter(extension));
  const sliderSupported = supportsPuzzleSliders(extension.runtime.getManifest());
  let settings = await settingsStore.read();
  let locale: UiLocale = resolveUiLocale(settings.interfaceLocale, extension.i18n?.getUILanguage() ?? navigator.language);
  let t = createTranslator(locale);
  let snapshot: ModelStatusSnapshot | undefined;
  let renderGeneration = 0;
  let modelRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const readModelStatus = async (): Promise<ModelStatusSnapshot | undefined> => {
    try { return await extension.runtime.sendMessage({ type: 'captcha:get-model-status' }) as ModelStatusSnapshot; }
    catch { return undefined; }
  };
  snapshot = await readModelStatus();

  const reconcile = async (): Promise<void> => { await extension.runtime.sendMessage({ type: 'captcha:reconcile-access' }); };
  const readGlobal = async (): Promise<boolean> => extension.permissions.contains({ origins: [...GLOBAL_HTTP_ORIGINS] });
  const currentView = (): ViewName => {
    const hash = location.hash.replace('#', '');
    if (sliderSupported && (hash === 'behavior' || hash === 'slider')) return 'slider';
    if (hash === 'diagnostics' || hash === 'about') return hash;
    return 'static';
  };
  const setInlineStatus = (selector: string, message: string, error = false): void => {
    const element = root.querySelector<HTMLElement>(selector);
    if (element === null) return;
    element.textContent = message;
    element.classList.toggle('error', error);
  };

  const show = async (view: ViewName): Promise<void> => {
    const generation = ++renderGeneration;
    if (modelRefreshTimer !== undefined) clearTimeout(modelRefreshTimer);
    settings = await settingsStore.read();
    locale = resolveUiLocale(settings.interfaceLocale, extension.i18n?.getUILanguage() ?? navigator.language);
    t = createTranslator(locale);
    document.documentElement.lang = locale === 'zh_CN' ? 'zh-CN' : 'en';
    if (view === 'diagnostics') snapshot = await readModelStatus() ?? snapshot;
    const globalGranted = await readGlobal().catch(() => false);
    const debuggerGranted = sliderSupported && await extension.permissions.contains({ permissions: ['debugger'] }).catch(() => false);
    const selectedAccess = await Promise.all(settings.selectedSites.map(async (rule): Promise<SelectedSiteAccess> => ({
      rule,
      granted: await extension.permissions.contains({ origins: [...originsForSelectedSite(rule)] }).catch(() => false),
    })));
    if (generation !== renderGeneration) return;
    root.innerHTML = shell(settings, sliderSupported, t);
    required<HTMLElement>(root, '[data-view="static"]').innerHTML = staticMarkup(settings, globalGranted, selectedAccess, t);
    required<HTMLElement>(root, '[data-view="slider"]').innerHTML = sliderSupported ? sliderMarkup(settings, globalGranted, debuggerGranted, t) : '';
    required<HTMLElement>(root, '[data-view="diagnostics"]').innerHTML = diagnosticsMarkup(snapshot, t);
    required<HTMLElement>(root, '[data-view="about"]').innerHTML = aboutMarkup(extension.runtime.getManifest().version, t);
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((element) => { element.hidden = element.dataset.view !== view; });
    root.querySelectorAll<HTMLElement>('[data-nav]').forEach((control) => control.setAttribute('aria-current', control.dataset.nav === view ? 'page' : 'false'));
    wire(view);
    if (view === 'diagnostics' && snapshot?.status === 'loading') {
      modelRefreshTimer = setTimeout(() => { if (currentView() === 'diagnostics') void show('diagnostics'); }, MODEL_STATUS_REFRESH_MS);
    }
  };

  const selectMode = async (mode: 'all' | 'selected'): Promise<void> => {
    if (mode === 'all') {
      const granted = await extension.permissions.request({ origins: [...GLOBAL_HTTP_ORIGINS] });
      if (!granted) { setInlineStatus('[data-static-status]', t('permissionDenied'), true); return; }
      await settingsStore.setAccessMode('all');
    } else {
      await settingsStore.setAccessMode('selected');
      await extension.permissions.remove({ origins: [...GLOBAL_HTTP_ORIGINS] }).catch(() => false);
      const origins = uniqueOrigins((await settingsStore.read()).selectedSites);
      if (origins.length > 0) await extension.permissions.request({ origins });
    }
    await reconcile();
    await show('static');
  };

  const wire = (view: ViewName): void => {
    root.querySelectorAll<HTMLElement>('[data-nav]').forEach((control) => control.addEventListener('click', (event) => {
      event.preventDefault();
      const next = control.dataset.nav as ViewName;
      location.hash = next;
      void show(next);
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-open-guide]').forEach((button) => button.addEventListener('click', () => {
      const url = extension.runtime.getURL(sliderSupported
        ? `onboarding.html?flow=upgrade&version=${encodeURIComponent(extension.runtime.getManifest().version)}&manual=1`
        : 'onboarding.html');
      if (extension.tabs) void extension.tabs.create({ url });
      else navigate(url);
    }));
    root.querySelector<HTMLButtonElement>('[data-open-geetest]')?.addEventListener('click', () => {
      const url = 'https://2captcha.com/demo/geetest';
      if (extension.tabs) void extension.tabs.create({ url });
      else navigate(url);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => { void selectMode(button.dataset.mode as 'all' | 'selected'); }));
    root.querySelector<HTMLInputElement>('#settings-auto-fill')?.addEventListener('change', (event) => { void settingsStore.setAutoFill((event.currentTarget as HTMLInputElement).checked); });
    root.querySelector<HTMLInputElement>('#settings-copy')?.addEventListener('change', (event) => { void settingsStore.setCopyOnNoField((event.currentTarget as HTMLInputElement).checked); });
    root.querySelector<HTMLSelectElement>('#settings-shortcut')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (isRecognitionShortcut(value)) void settingsStore.setRecognitionShortcut(value);
    });
    root.querySelectorAll<HTMLButtonElement>('[data-restore-mode]').forEach((button) => button.addEventListener('click', () => {
      void settingsStore.setSiteRecognitionMode(button.dataset.restoreMode!, 'auto').then(() => show(view));
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-remove-slider]').forEach((button) => button.addEventListener('click', () => {
      void settingsStore.setSliderEnabled(button.dataset.removeSlider!, false).then(() => show(view));
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-slider-mode]').forEach((button) => button.addEventListener('click', () => {
      void (async () => {
        const mode = button.dataset.sliderMode as 'all' | 'selected';
        if (mode === 'all') {
          const granted = await extension.permissions.request({ origins: [...GLOBAL_HTTP_ORIGINS] });
          if (!granted) { setInlineStatus('[data-slider-settings-status]', t('permissionDenied'), true); return; }
        } else {
          const current = await settingsStore.read();
          if (current.accessMode !== 'all') await extension.permissions.remove({ origins: [...GLOBAL_HTTP_ORIGINS] }).catch(() => false);
        }
        await settingsStore.setSliderAccessMode(mode);
        await reconcile();
        await show('slider');
      })();
    }));
    root.querySelector<HTMLFormElement>('[data-slider-site-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const input = required<HTMLInputElement>(form, 'input[name="hostname"]');
      void (async () => {
        let hostname: string;
        try { hostname = parseHostname(input.value); } catch { setInlineStatus('[data-slider-settings-status]', t('invalidHostname'), true); return; }
        const granted = await extension.permissions.request({ origins: [`http://${hostname}/*`, `https://${hostname}/*`] });
        if (!granted) { setInlineStatus('[data-slider-settings-status]', t('permissionRequestFailed'), true); return; }
        await settingsStore.setSliderEnabled(hostname, true);
        await reconcile();
        await show('slider');
      })();
    });
    root.querySelector<HTMLSelectElement>('#interface-locale')?.addEventListener('change', (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      if (isInterfaceLocale(value)) void settingsStore.setInterfaceLocale(value).then(() => show(view));
    });
    root.querySelector<HTMLButtonElement>('[data-revoke-global]')?.addEventListener('click', () => { void extension.permissions.remove({ origins: [...GLOBAL_HTTP_ORIGINS] }).then(reconcile).then(() => show('static')); });
    root.querySelector<HTMLFormElement>('[data-site-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const input = required<HTMLInputElement>(form, 'input[name="hostname"]');
      const include = required<HTMLInputElement>(form, 'input[name="subdomains"]');
      void (async () => {
        let hostname: string;
        try { hostname = parseHostname(input.value); } catch { setInlineStatus('[data-static-status]', t('invalidHostname'), true); return; }
        const rule = { hostname, includeSubdomains: include.checked && canIncludeSubdomains(hostname) };
        const granted = await extension.permissions.request({ origins: [...originsForSelectedSite(rule)] });
        if (!granted) { setInlineStatus('[data-static-status]', t('permissionRequestFailed'), true); return; }
        await settingsStore.addSelectedSite(rule);
        await reconcile();
        await show('static');
      })();
    });
    root.querySelectorAll<HTMLButtonElement>('[data-remove-site]').forEach((button) => button.addEventListener('click', () => {
      const rule = { hostname: button.dataset.removeSite!, includeSubdomains: button.dataset.subdomains === 'true' };
      void settingsStore.removeSelectedSite(rule).then(() => extension.permissions.remove({ origins: [...originsForSelectedSite(rule)] })).then(reconcile).then(() => show('static'));
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-restore-site]').forEach((button) => button.addEventListener('click', () => {
      void (async () => {
        const pageUrl = `https://${button.dataset.restoreSite}/`;
        const current = await settingsStore.read();
        if (current.accessMode === 'selected' && !await extension.permissions.request({ origins: [...originsForPage(pageUrl)] })) return;
        await settingsStore.enable(button.dataset.restoreSite!);
        await reconcile();
        await show('static');
      })();
    }));
    root.querySelector<HTMLButtonElement>('[data-retry-model]')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      void (async () => {
        button.disabled = true;
        button.textContent = t('retryingModel');
        const state = root.querySelector<HTMLElement>('.model-state');
        const message = root.querySelector<HTMLElement>('.diagnostics-summary strong');
        if (state !== null) state.dataset.state = 'loading';
        if (message !== null) message.textContent = t('modelLoading');
        try {
          snapshot = await extension.runtime.sendMessage({ type: 'captcha:retry-model-warmup' }) as ModelStatusSnapshot;
          for (let attempt = 0; snapshot?.status === 'loading' && attempt < MODEL_STATUS_POLL_LIMIT; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, MODEL_STATUS_POLL_INTERVAL_MS));
            snapshot = await readModelStatus();
          }
          if (snapshot === undefined) {
            snapshot = { status: 'error', progress: 0, message: t('modelStatusUnavailable'), logs: [] };
          }
        } catch {
          snapshot = { status: 'error', progress: 0, message: t('modelStatusUnavailable'), logs: snapshot?.logs ?? [] };
        }
        await show('diagnostics');
      })();
    });
    root.querySelector<HTMLButtonElement>('[data-clear-diagnostics]')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      void (async () => {
        button.disabled = true;
        try {
          const response = await extension.runtime.sendMessage({ type: 'captcha:clear-diagnostics' }) as { cleared?: boolean; snapshot?: ModelStatusSnapshot };
          if (response.cleared !== true || response.snapshot === undefined) throw new Error('clear rejected');
          snapshot = response.snapshot;
          await show('diagnostics');
        } catch {
          button.disabled = false;
          button.textContent = t('clearDiagnosticsFailed');
        }
      })();
    });
    root.querySelector<HTMLButtonElement>('[data-copy-diagnostics]')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      void navigator.clipboard.writeText(JSON.stringify(snapshot ?? {}, null, 2)).then(() => { button.textContent = t('copied'); }, () => { button.textContent = t('copyFailed'); });
    });
  };

  window.addEventListener('hashchange', () => { void show(currentView()); });
  window.addEventListener('focus', () => { void show(currentView()); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void show(currentView()); });
  extension.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && Object.hasOwn(changes, SETTINGS_STORAGE_KEY)) void show(currentView());
  });
  extension.permissions.onAdded?.addListener(() => { void show(currentView()); });
  extension.permissions.onRemoved?.addListener(() => { void show(currentView()); });
  await show(currentView());
}

const root = document.querySelector<HTMLElement>('#app');
if (root !== null && typeof browser !== 'undefined') {
  void startOptions(root, {
    storage: browser.storage,
    permissions: browser.permissions,
    runtime: {
      sendMessage: (message) => sendRuntimeMessage(browser.runtime, message),
      getManifest: () => browser.runtime.getManifest(),
      getURL: (path) => (browser.runtime.getURL as (value: string) => string)(path),
    },
    i18n: browser.i18n,
  });
}
