import type { BrowserAdapter } from './browser-adapter';
import { createSettingsStore, hostnameForPage, type CaptchaSettings, type SelectedSiteRule, type SettingsStore } from './settings-store';

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
  return originsForHostname(hostname);
}

export function originsForHostname(hostname: string): readonly [string, string] {
  return [`http://${hostname}/*`, `https://${hostname}/*`];
}

export function originsForSelectedSite(rule: SelectedSiteRule): readonly [string, string] {
  const hostname = rule.includeSubdomains ? `*.${rule.hostname}` : rule.hostname;
  return [`http://${hostname}/*`, `https://${hostname}/*`];
}

export function permissionOriginsForPage(settings: Pick<CaptchaSettings, 'accessMode'>, pageUrl: string): readonly string[] {
  return settings.accessMode === 'all' ? GLOBAL_HTTP_ORIGINS : originsForPage(pageUrl);
}

export const GLOBAL_HTTP_ORIGINS = ['http://*/*', 'https://*/*'] as const;

export function createPermissionManager(adapter: BrowserAdapter, settings: SettingsStore = createSettingsStore(adapter)): PermissionManager {
  return {
    async enablePage(pageUrl: string): Promise<EnablePageResult> {
      const hostname = hostnameForPage(pageUrl);
      const current = await settings.read();
      if (!await adapter.requestOrigins(permissionOriginsForPage(current, pageUrl))) return { enabled: false, reason: 'permission-denied' };
      await settings.enable(hostname);
      return { enabled: true };
    },
    async disablePage(pageUrl: string): Promise<DisablePageResult> {
      const hostname = hostnameForPage(pageUrl);
      const current = await settings.read();
      await settings.disable(hostname);
      const permissionRemoved = current.accessMode === 'selected'
        ? await adapter.removeOrigins(originsForPage(pageUrl))
        : false;
      return { disabled: true, permissionRemoved };
    },
  };
}
