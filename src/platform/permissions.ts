import type { BrowserAdapter } from './browser-adapter';
import { createSettingsStore, hostnameForPage, type SettingsStore } from './settings-store';

export interface PermissionManager {
  enablePage(pageUrl: string): Promise<EnablePageResult>;
  disablePage(pageUrl: string): Promise<DisablePageResult>;
}

export type EnablePageResult =
  | { enabled: true }
  | { enabled: false; reason: 'permission-denied' };

export type DisablePageResult = {
  disabled: true;
  permissionRemoved: boolean;
};

export function originsForPage(pageUrl: string): readonly [string, string] {
  const hostname = hostnameForPage(pageUrl);
  return [`http://${hostname}/*`, `https://${hostname}/*`];
}

export function createPermissionManager(adapter: BrowserAdapter, settings: SettingsStore = createSettingsStore(adapter)): PermissionManager {
  return {
    async enablePage(pageUrl: string): Promise<EnablePageResult> {
      const hostname = hostnameForPage(pageUrl);
      const origins = originsForPage(pageUrl);
      if (!await adapter.requestOrigins(origins)) return { enabled: false, reason: 'permission-denied' };
      await settings.enable(hostname);
      return { enabled: true };
    },
    async disablePage(pageUrl: string): Promise<DisablePageResult> {
      const hostname = hostnameForPage(pageUrl);
      const origins = originsForPage(pageUrl);
      await settings.disable(hostname);
      try {
        return { disabled: true, permissionRemoved: await adapter.removeOrigins(origins) };
      } catch {
        return { disabled: true, permissionRemoved: false };
      }
    },
  };
}
