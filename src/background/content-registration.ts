import { hostnameForPage, normalizeHostname, type SettingsStore } from '../platform/settings-store';
import { originsForPage } from '../platform/permissions';

export const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';
const REGISTRATION_PREFIX = 'captcha-auto-';

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
  return originsForPage(`https://${hostname}/`);
}

export async function contentScriptRegistrationId(hostname: string): Promise<string> {
  const normalized = normalizeHostname(hostname);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${REGISTRATION_PREFIX}${hex.slice(0, 16)}`;
}

function scriptFor(hostname: string, id: string): Required<RegisteredContentScript> {
  return { id, matches: [...exactOrigins(hostname)], js: [CONTENT_SCRIPT_FILE], persistAcrossSessions: true };
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
      const expected = await Promise.all(settings.allowlistedHosts.map(async (hostname) => {
        const origins = exactOrigins(hostname);
        return await adapter.permissions.contains({ origins }) ? scriptFor(hostname, await contentScriptRegistrationId(hostname)) : undefined;
      }));
      const desired = expected.filter((script): script is Required<RegisteredContentScript> => script !== undefined);
      const current = await adapter.scripting.getRegisteredContentScripts();
      const kept = new Set<string>();
      const invalid = current.filter((script) => {
        if (!script.id.startsWith(REGISTRATION_PREFIX)) return false;
        if (!desired.some((candidate) => isSameScript(script, candidate)) || kept.has(script.id)) return true;
        kept.add(script.id);
        return false;
      });
      const invalidIds = [...new Set(invalid.map((script) => script.id))];
      await unregister(invalidIds);
      const present = current.filter((script) => !invalid.includes(script) && !invalidIds.includes(script.id));
      const missing = desired.filter((script) => !present.some((candidate) => isSameScript(candidate, script)));
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
      const origins = exactOrigins(hostname);
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
      const origins = exactOrigins(hostname);
      await adapter.settings.disable(hostname);
      const id = await contentScriptRegistrationId(hostname);
      try { await unregister([id]); } catch { /* Registration may already have been removed. */ }
      try { await notifyTabs(adapter, hostname, 'captcha:auto-disable'); } finally {
        try { return { disabled: true, permissionRemoved: await adapter.permissions.remove({ origins }) }; } catch { return { disabled: true, permissionRemoved: false }; }
      }
  };

  return { reconcile, enablePage: (pageUrl, options) => serialize(() => enablePage(pageUrl, options)), disablePage: (pageUrl) => serialize(() => disablePage(pageUrl)) };
}
