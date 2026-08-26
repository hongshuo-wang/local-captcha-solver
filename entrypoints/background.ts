import { createInferenceHost } from '../src/background/inference-host';
import type { InferenceBrowser, InferenceHost } from '../src/background/inference-host';
import { createImageFetcher } from '../src/background/image-fetch';
import { createSettingsStore } from '../src/platform/settings-store';
import { createExtensionBrowserAdapter } from '../src/background/extension-browser';
import { createContentRegistration } from '../src/background/content-registration';
import { createContextMenu } from '../src/background/context-menu';
import { createBackgroundRuntime } from '../src/background/background-runtime';
import { createModelStatusStore, MODEL_LOGS_STORAGE_KEY } from '../src/background/model-status';
import { sendRuntimeMessage } from '../src/platform/runtime-messaging';
import { registerInstallExperience } from '../src/background/install-experience';
import { createSliderSolver, decodeScreenshot } from '../src/slider/slider-solver';

interface RuntimeWithContexts {
  getContexts?: InferenceBrowser['runtime']['getContexts'];
}

interface BrowserWithOffscreen {
  offscreen: InferenceBrowser['offscreen'];
}

interface BackgroundBrowser {
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> }; onChanged: { addListener(listener: (changes: Record<string, unknown>, areaName: string) => void): void } };
  permissions: {
    contains(details: { origins?: readonly string[]; permissions?: readonly string[] }): Promise<boolean>;
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
    query(details: { url?: readonly string[]; active?: boolean; currentWindow?: boolean }): Promise<readonly { id?: number; url?: string; windowId?: number }[]>;
    sendMessage(tabId: number, message: unknown, options?: { frameId: number }): Promise<unknown>;
    create(details: { url: string }): Promise<unknown>;
  };
  debugger: {
    attach(target: { tabId: number }, version: string): Promise<void>;
    detach(target: { tabId: number }): Promise<void>;
    sendCommand(target: { tabId: number }, method: string, params?: Record<string, unknown>): Promise<unknown>;
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
    onMessage: {
      addListener(listener: (message: unknown, sender: { tab?: { id?: number; url?: string; windowId?: number }; url?: string }, sendResponse?: (response: unknown) => void) => Promise<unknown | undefined> | boolean | void): void;
    };
    onStartup: { addListener(listener: () => void): void };
    onInstalled: { addListener(listener: (details: { reason: string; previousVersion?: string }) => void): void };
    getURL(path: string): string;
    getManifest(): { version: string };
  };
}

function createFirefoxInferenceHost(getExtensionUrl: (path: string) => string): InferenceHost {
  const service = import('../src/ocr/inference-service')
    .then(({ createOcrInferenceService }) => createOcrInferenceService(getExtensionUrl));
  return {
    async recognize(imageDataUrl, imageRevision, modes) {
      return (await service).recognize(imageDataUrl, imageRevision, modes);
    },
    async warmup() {
      await (await service).warmup?.();
    },
  };
}

export default defineBackground(() => {
  const runtime = browser.runtime as typeof browser.runtime & RuntimeWithContexts;
  const extension = browser as unknown as BackgroundBrowser;
  const getExtensionUrl = runtime.getURL as (path: string) => string;
  const host = import.meta.env.BROWSER === 'firefox'
    ? createFirefoxInferenceHost(getExtensionUrl)
    : createInferenceHost({
        runtime: {
          getURL: getExtensionUrl,
          sendMessage: (message) => sendRuntimeMessage(runtime, message),
          getContexts: runtime.getContexts?.bind(runtime),
        },
        offscreen: (browser as unknown as BrowserWithOffscreen).offscreen,
      });
  const settingsAdapter = createExtensionBrowserAdapter(extension);
  const settings = createSettingsStore(settingsAdapter);
  const registration = createContentRegistration({
    settings,
    permissions: extension.permissions,
    scripting: extension.scripting,
    tabs: { query: async (details) => extension.tabs.query(details), sendMessage: (tabId, message) => extension.tabs.sendMessage(tabId, message) },
  });
  const contextMenu = createContextMenu({ contextMenus: extension.contextMenus, tabs: extension.tabs, scripting: extension.scripting });
  const modelStatus = createModelStatusStore(Date.now, {
    async read() { return (await extension.storage.local.get(MODEL_LOGS_STORAGE_KEY))[MODEL_LOGS_STORAGE_KEY]; },
    async write(value) { await extension.storage.local.set({ [MODEL_LOGS_STORAGE_KEY]: value }); },
  });
  const sliderSolver = import.meta.env.BROWSER === 'firefox' ? undefined : createSliderSolver({
    settings,
    permissions: { contains: extension.permissions.contains.bind(extension.permissions) },
    tabs: {
      sendMessage: (tabId, message) => extension.tabs.sendMessage(tabId, message),
    },
    debugger: extension.debugger,
    decodeImage: decodeScreenshot,
  });
  const runtimeApp = createBackgroundRuntime({
    permissions: { contains: extension.permissions.contains.bind(extension.permissions) },
    imageFetcher: createImageFetcher({ permissions: { contains: extension.permissions.contains.bind(extension.permissions) }, fetch: globalThis.fetch.bind(globalThis) }),
    inferenceHost: host,
    modelStatus,
    siteState: { isEnabled: settings.isEnabled, enablePage: registration.enablePage, disablePage: registration.disablePage, reconcile: registration.reconcile },
    settings,
    ...(sliderSolver === undefined ? {} : { sliderSolver }),
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
  registerInstallExperience(extension.runtime, extension.tabs, runtime.getManifest().version);
  void modelStatus.hydrate();
  void runtimeApp.start();
  console.info('Captcha Helper background ready');
});
