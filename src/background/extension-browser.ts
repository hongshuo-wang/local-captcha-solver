import type { BrowserAdapter } from '../platform/browser-adapter';

export interface ExtensionBrowserStoragePermissions {
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> } };
  permissions: {
    request(details: { origins: string[] }): Promise<boolean>;
    remove(details: { origins: string[] }): Promise<boolean>;
  };
}

export function createExtensionBrowserAdapter(browser: ExtensionBrowserStoragePermissions): BrowserAdapter {
  return {
    async getLocal<T>(key: string): Promise<T | undefined> { return (await browser.storage.local.get(key))[key] as T | undefined; },
    async setLocal<T>(key: string, value: T): Promise<void> { await browser.storage.local.set({ [key]: value }); },
    requestOrigins(origins: readonly string[]): Promise<boolean> { return browser.permissions.request({ origins: [...origins] }); },
    removeOrigins(origins: readonly string[]): Promise<boolean> { return browser.permissions.remove({ origins: [...origins] }); },
  };
}
