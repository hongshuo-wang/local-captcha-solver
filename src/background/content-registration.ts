import { hostnameForPage, normalizeHostname, selectedSiteMatches, type SelectedSiteRule, type SettingsStore } from '../platform/settings-store';
import { GLOBAL_HTTP_ORIGINS, originsForPage, originsForSelectedSite, permissionOriginsForPage } from '../platform/permissions';

export const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';
const REGISTRATION_PREFIX = 'captcha-auto-';
export const GLOBAL_REGISTRATION_ID = `${REGISTRATION_PREFIX}global`;
export const GLOBAL_SLIDER_REGISTRATION_ID = `${REGISTRATION_PREFIX}slider-global`;

export interface RegisteredContentScript {
  id: string;
  matches: readonly string[];
  js: readonly string[];
  persistAcrossSessions?: boolean;
}

export interface ContentRegistrationAdapter {
  settings: SettingsStore;
  permissions: {
    contains(details: { origins: readonly string[] }): Promise<boolean>;
    request(details: { origins: readonly string[] }): Promise<boolean>;
    remove(details: { origins: readonly string[] }): Promise<boolean>;
  };
  scripting: {
    getRegisteredContentScripts(): Promise<readonly RegisteredContentScript[]>;
    registerContentScripts(scripts: readonly Required<RegisteredContentScript>[]): Promise<void>;
    unregisterContentScripts(details: { ids: readonly string[] }): Promise<void>;
    executeScript(details: { target: { tabId: number; frameIds?: readonly number[] }; files: readonly string[] }): Promise<unknown>;
  };
  tabs: {
    query(details: { url: readonly string[] }): Promise<readonly { id?: number; url?: string }[]>;
    sendMessage(tabId: number, message: { type: 'captcha:auto-enable' | 'captcha:auto-disable' }): Promise<unknown>;
  };
}

export type EnableRegistrationResult = { enabled: true } | { enabled: false; reason: 'permission-denied' | 'permission-unavailable' | 'settings-failed' | 'registration-failed' };
export type DisableRegistrationResult = { disabled: true; permissionRemoved: boolean };
export interface EnableRegistrationOptions { permissionAlreadyGranted?: boolean; }

export interface ContentRegistration {
  reconcile(): Promise<void>;
  enablePage(pageUrl: string, options?: EnableRegistrationOptions): Promise<EnableRegistrationResult>;
  disablePage(pageUrl: string): Promise<DisableRegistrationResult>;
}

function exactOrigins(hostname: string): readonly [string, string] {
  return [`http://${hostname}/*`, `https://${hostname}/*`];
}

export async function contentScriptRegistrationId(hostname: string, includeSubdomains = false): Promise<string> {
  const normalized = normalizeHostname(hostname);
  const input = includeSubdomains ? `${normalized}:subdomains` : normalized;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${REGISTRATION_PREFIX}${hex.slice(0, 16)}`;
}

function globalScript(): Required<RegisteredContentScript> {
  return { id: GLOBAL_REGISTRATION_ID, matches: [...GLOBAL_HTTP_ORIGINS], js: [CONTENT_SCRIPT_FILE], persistAcrossSessions: true };
}

function globalSliderScript(): Required<RegisteredContentScript> {
  return { id: GLOBAL_SLIDER_REGISTRATION_ID, matches: [...GLOBAL_HTTP_ORIGINS], js: [CONTENT_SCRIPT_FILE], persistAcrossSessions: true };
}

async function selectedScript(rule: SelectedSiteRule): Promise<Required<RegisteredContentScript>> {
  return {
    id: await contentScriptRegistrationId(rule.hostname, rule.includeSubdomains),
    matches: [...originsForSelectedSite(rule)],
    js: [CONTENT_SCRIPT_FILE],
    persistAcrossSessions: true,
  };
}

async function exactSliderScript(hostname: string): Promise<Required<RegisteredContentScript>> {
  return {
    id: await contentScriptRegistrationId(hostname),
    matches: [...exactOrigins(hostname)],
    js: [CONTENT_SCRIPT_FILE],
    persistAcrossSessions: true,
  };
}

function isSameScript(actual: RegisteredContentScript, expected: Required<RegisteredContentScript>): boolean {
  return actual.id === expected.id
    && actual.persistAcrossSessions === true
    && actual.matches.length === expected.matches.length
    && actual.matches.every((match, index) => match === expected.matches[index])
    && actual.js.length === expected.js.length
    && actual.js.every((file, index) => file === expected.js[index]);
}

async function notifyTabs(adapter: ContentRegistrationAdapter, hostname: string, type: 'captcha:auto-enable' | 'captcha:auto-disable'): Promise<void> {
  const tabs = await adapter.tabs.query({ url: exactOrigins(hostname) });
  await Promise.all(tabs.filter((tab): tab is { id: number; url?: string } => typeof tab.id === 'number').map(async (tab) => {
    try {
      await adapter.tabs.sendMessage(tab.id, { type });
      return;
    } catch {
      if (type !== 'captcha:auto-enable') return;
    }
    try { await adapter.scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_FILE] }); } catch { return; }
    try { await adapter.tabs.sendMessage(tab.id, { type }); } catch { /* The injected client may still be initializing. */ }
  }));
}

export function createContentRegistration(adapter: ContentRegistrationAdapter): ContentRegistration {
  const unregister = async (ids: readonly string[]) => { if (ids.length > 0) await adapter.scripting.unregisterContentScripts({ ids }); };
  let queue: Promise<void> = Promise.resolve();
  let activeReconcile: Promise<void> | undefined;
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => undefined).then(operation);
    queue = next.then(() => undefined, () => undefined);
    return next;
  };

  const reconcileInternal = async (): Promise<void> => {
      const settings = await adapter.settings.read();
      const desired: Required<RegisteredContentScript>[] = [];
      let globalAccess = false;
      if (settings.accessMode === 'all') {
        globalAccess = await adapter.permissions.contains({ origins: GLOBAL_HTTP_ORIGINS });
        if (globalAccess) desired.push(globalScript());
      } else {
        for (const rule of settings.selectedSites) {
          const origins = originsForSelectedSite(rule);
          if (await adapter.permissions.contains({ origins })) desired.push(await selectedScript(rule));
        }
      }
      const sliderGlobalAccess = settings.sliderAccessMode === 'all' && await adapter.permissions.contains({ origins: GLOBAL_HTTP_ORIGINS });
      if (sliderGlobalAccess && !globalAccess) desired.push(globalSliderScript());
      for (const hostname of settings.sliderEnabledHosts) {
        if (globalAccess || sliderGlobalAccess) continue;
        let coveredBySelectedSite = false;
        if (settings.accessMode === 'selected') {
          for (const rule of settings.selectedSites) {
            if (!selectedSiteMatches(rule, hostname)) continue;
            try {
              if (await adapter.permissions.contains({ origins: originsForSelectedSite(rule) })) {
                coveredBySelectedSite = true;
                break;
              }
            } catch { /* An unavailable rule does not cover the slider host. */ }
          }
        }
        if (coveredBySelectedSite) continue;
        const origins = exactOrigins(hostname);
        if (await adapter.permissions.contains({ origins })) desired.push(await exactSliderScript(hostname));
      }
      const uniqueDesired = [...new Map(desired.map((script) => [script.id, script])).values()];
      const current = await adapter.scripting.getRegisteredContentScripts();
      const kept = new Set<string>();
      const invalid = current.filter((script) => {
        if (!script.id.startsWith(REGISTRATION_PREFIX)) return false;
        if (!uniqueDesired.some((candidate) => isSameScript(script, candidate)) || kept.has(script.id)) return true;
        kept.add(script.id);
        return false;
      });
      const invalidIds = [...new Set(invalid.map((script) => script.id))];
      await unregister(invalidIds);
      const present = current.filter((script) => !invalid.includes(script) && !invalidIds.includes(script.id));
      const missing = uniqueDesired.filter((script) => !present.some((candidate) => isSameScript(candidate, script)));
      if (missing.length > 0) {
        try { await adapter.scripting.registerContentScripts(missing); } catch (error) {
          try { await unregister(missing.map((script) => script.id)); } catch { /* Best-effort partial registration cleanup. */ }
          throw error;
        }
      }
  };
  const reconcile = (): Promise<void> => {
    if (activeReconcile !== undefined) return activeReconcile;
    const scheduled = serialize(reconcileInternal);
    activeReconcile = scheduled;
    void scheduled.then(() => { if (activeReconcile === scheduled) activeReconcile = undefined; }, () => { if (activeReconcile === scheduled) activeReconcile = undefined; });
    return scheduled;
  };

  const enablePage = async (pageUrl: string, options?: EnableRegistrationOptions): Promise<EnableRegistrationResult> => {
      const hostname = hostnameForPage(pageUrl);
      const before = await adapter.settings.read();
      const origins = permissionOriginsForPage(before, pageUrl);
      let previouslyGranted: boolean;
      try { previouslyGranted = await adapter.permissions.contains({ origins }); } catch { return { enabled: false, reason: 'permission-unavailable' }; }
      let newlyGranted = !previouslyGranted;
      if (options?.permissionAlreadyGranted !== undefined) {
        if (!previouslyGranted) return { enabled: false, reason: 'permission-denied' };
        newlyGranted = options.permissionAlreadyGranted === false;
      } else if (!previouslyGranted && !await adapter.permissions.request({ origins })) {
        return { enabled: false, reason: 'permission-denied' };
      }
      try { await adapter.settings.enable(hostname); } catch {
        try { await adapter.settings.disable(hostname); } catch { /* Best-effort storage rollback. */ }
        if (newlyGranted) try { await adapter.permissions.remove({ origins }); } catch { /* Best-effort permission rollback. */ }
        return { enabled: false, reason: 'settings-failed' };
      }
      try {
        await reconcileInternal();
      } catch {
        try { await adapter.settings.disable(hostname); } catch { /* Best-effort storage rollback. */ }
        if (newlyGranted) try { await adapter.permissions.remove({ origins }); } catch { /* Best-effort permission rollback. */ }
        return { enabled: false, reason: 'registration-failed' };
      }
      try { await notifyTabs(adapter, hostname, 'captcha:auto-enable'); } catch { /* Runtime registration still covers future tabs. */ }
      return { enabled: true };
  };

  const disablePage = async (pageUrl: string): Promise<DisableRegistrationResult> => {
      const hostname = hostnameForPage(pageUrl);
      const before = await adapter.settings.read();
      await adapter.settings.disable(hostname);
      let permissionRemoved = false;
      if (before.accessMode === 'selected') {
        const coveredByWildcard = before.selectedSites.some((rule) => rule.includeSubdomains && selectedSiteMatches(rule, hostname));
        if (!coveredByWildcard) {
          try { permissionRemoved = await adapter.permissions.remove({ origins: originsForPage(pageUrl) }); } catch { permissionRemoved = false; }
        }
        try { await reconcileInternal(); } catch { /* Settings still prevent future automatic runs. */ }
      }
      try { await notifyTabs(adapter, hostname, 'captcha:auto-disable'); } catch { /* Future automatic runs remain blocked by settings. */ }
      return { disabled: true, permissionRemoved };
  };

  return { reconcile, enablePage: (pageUrl, options) => serialize(() => enablePage(pageUrl, options)), disablePage: (pageUrl) => serialize(() => disablePage(pageUrl)) };
}
