import { createInferenceHost } from '../src/background/inference-host';
import type { InferenceBrowser } from '../src/background/inference-host';
import { createImageFetcher } from '../src/background/image-fetch';
import { createSettingsStore } from '../src/platform/settings-store';
import { createExtensionBrowserAdapter } from '../src/background/extension-browser';
import { createContentRegistration } from '../src/background/content-registration';
import { createContextMenu } from '../src/background/context-menu';
import { createBackgroundRuntime } from '../src/background/background-runtime';
import { createModelStatusStore } from '../src/background/model-status';

interface RuntimeWithContexts {
  getContexts?: InferenceBrowser['runtime']['getContexts'];
}

interface BrowserWithOffscreen {
  offscreen: InferenceBrowser['offscreen'];
}

interface BackgroundBrowser {
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> }; onChanged: { addListener(listener: (changes: Record<string, unknown>, areaName: string) => void): void } };
  permissions: {
    contains(details: { origins: readonly string[] }): Promise<boolean>;
    request(details: { origins: string[] }): Promise<boolean>;
    remove(details: { origins: string[] }): Promise<boolean>;
  };
  scripting: {
    getRegisteredContentScripts(): Promise<readonly { id: string; matches: readonly string[]; js: readonly string[]; persistAcrossSessions?: boolean }[]>;
    registerContentScripts(scripts: readonly { id: string; matches: readonly string[]; js: readonly string[]; persistAcrossSessions: boolean }[]): Promise<void>;
    unregisterContentScripts(details: { ids: readonly string[] }): Promise<void>;
    executeScript(details: { target: { tabId: number; frameIds?: readonly number[] }; files: readonly string[] }): Promise<unknown>;
  };
  tabs: {
    query(details: { url?: readonly string[]; active?: boolean; currentWindow?: boolean }): Promise<readonly { id?: number; url?: string }[]>;
    sendMessage(tabId: number, message: unknown, options?: { frameId: number }): Promise<unknown>;
  };
  contextMenus: {
    create(details: { id: string; title: string; contexts: readonly ['image'] }): unknown;
    remove(id: string): Promise<void>;
    onClicked: { addListener(listener: (info: { menuItemId?: string | number; srcUrl?: string; frameId?: number }, tab?: { id?: number; url?: string }) => void): void };
  };
  action: {
    setBadgeText(details: { text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  };
  runtime: {
    onMessage: { addListener(listener: (message: unknown, sender: { tab?: { id?: number; url?: string }; url?: string }) => Promise<unknown | undefined>): void };
    onStartup: { addListener(listener: () => void): void };
    onInstalled: { addListener(listener: () => void): void };
  };
}

export default defineBackground(() => {
  const runtime = browser.runtime as typeof browser.runtime & RuntimeWithContexts;
  const extension = browser as unknown as BackgroundBrowser;
  const extensionBrowser: InferenceBrowser = {
    runtime: {
      getURL: runtime.getURL.bind(runtime),
      sendMessage: runtime.sendMessage.bind(runtime),
      getContexts: runtime.getContexts?.bind(runtime),
    },
    offscreen: (browser as unknown as BrowserWithOffscreen).offscreen,
  };
  const settingsAdapter = createExtensionBrowserAdapter(extension);
  const settings = createSettingsStore(settingsAdapter);
  const registration = createContentRegistration({
    settings,
    permissions: extension.permissions,
    scripting: extension.scripting,
    tabs: { query: async (details) => extension.tabs.query(details), sendMessage: (tabId, message) => extension.tabs.sendMessage(tabId, message) },
  });
  const contextMenu = createContextMenu({ contextMenus: extension.contextMenus, tabs: extension.tabs, scripting: extension.scripting });
  const host = createInferenceHost(extensionBrowser);
  const modelStatus = createModelStatusStore();
  const runtimeApp = createBackgroundRuntime({
    permissions: { contains: extension.permissions.contains.bind(extension.permissions) },
    imageFetcher: createImageFetcher({ permissions: { contains: extension.permissions.contains.bind(extension.permissions) }, fetch: globalThis.fetch.bind(globalThis) }),
    inferenceHost: host,
    modelStatus,
    siteState: { isEnabled: settings.isEnabled, enablePage: registration.enablePage, disablePage: registration.disablePage },
    activeTab: async () => (await extension.tabs.query({ active: true, currentWindow: true }))[0],
    registration,
    contextMenu,
    runtime: extension.runtime,
    storage: { onChanged: extension.storage.onChanged },
    contextMenus: extension.contextMenus,
    action: {
      setBadgeText: extension.action.setBadgeText.bind(extension.action),
      setBadgeBackgroundColor: extension.action.setBadgeBackgroundColor.bind(extension.action),
    },
  });
  void runtimeApp.start();
  console.info('Local CAPTCHA Solver background ready');
});
