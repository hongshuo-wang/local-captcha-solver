import type { BrowserAdapter } from './browser-adapter';

export const SETTINGS_STORAGE_KEY = 'captcha-settings';

export const RECOGNITION_SHORTCUTS = ['middle', 'ctrl-click', 'alt-click', 'shift-click'] as const;
export type RecognitionShortcut = typeof RECOGNITION_SHORTCUTS[number];

export const ACCESS_MODES = ['all', 'selected'] as const;
export type AccessMode = typeof ACCESS_MODES[number];

export const INTERFACE_LOCALES = ['system', 'zh_CN', 'en'] as const;
export type InterfaceLocale = typeof INTERFACE_LOCALES[number];

export interface SelectedSiteRule {
  hostname: string;
  includeSubdomains: boolean;
}

export function isRecognitionShortcut(value: unknown): value is RecognitionShortcut {
  return typeof value === 'string' && (RECOGNITION_SHORTCUTS as readonly string[]).includes(value);
}

export interface CaptchaSettings {
  version: 3;
  accessMode: AccessMode;
  disabledHosts: string[];
  selectedSites: SelectedSiteRule[];
  copyOnNoField: boolean;
  autoFill: boolean;
  recognitionShortcut: RecognitionShortcut;
  interfaceLocale: InterfaceLocale;
  onboardingComplete: boolean;
}

export interface SettingsStore {
  read(): Promise<CaptchaSettings>;
  isEnabled(pageUrl: string): Promise<boolean>;
  enable(hostname: string): Promise<void>;
  disable(hostname: string): Promise<void>;
  setCopyOnNoField(enabled: boolean): Promise<void>;
  setAutoFill(enabled: boolean): Promise<void>;
  setRecognitionShortcut(shortcut: RecognitionShortcut): Promise<void>;
  setAccessMode(mode: AccessMode): Promise<void>;
  addSelectedSite(rule: SelectedSiteRule): Promise<void>;
  removeSelectedSite(rule: SelectedSiteRule): Promise<void>;
  setInterfaceLocale(locale: InterfaceLocale): Promise<void>;
  setOnboardingComplete(complete: boolean): Promise<void>;
}

export const DEFAULT_SETTINGS: CaptchaSettings = {
  version: 3,
  accessMode: 'all',
  disabledHosts: [],
  selectedSites: [],
  copyOnNoField: false,
  autoFill: true,
  recognitionShortcut: 'middle',
  interfaceLocale: 'system',
  onboardingComplete: false,
};
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const mutationQueues = new WeakMap<BrowserAdapter, Promise<void>>();

function isSupportedHostname(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    try { return new URL(`http://${hostname}/`).hostname === hostname; } catch { return false; }
  }
  if (/^[\d.]+$/.test(hostname)) {
    try { return new URL(`http://${hostname}/`).hostname === hostname && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname); } catch { return false; }
  }
  return HOSTNAME.test(hostname);
}

export function normalizeHostname(hostname: string): string {
  if (typeof hostname !== 'string' || hostname.trim() !== hostname || /[\s\u0000-\u001f\u007f]/.test(hostname)) {
    throw new Error('Hostname must not contain whitespace or control characters');
  }

  const normalized = hostname.toLowerCase();
  if (!isSupportedHostname(normalized)) throw new Error('Hostname must be a supported DNS hostname');
  if (new URL(`https://${normalized}`).hostname !== normalized) throw new Error('Hostname must be canonical');
  return normalized;
}

export function hostnameForPage(pageUrl: string): string {
  if (pageUrl.trim() !== pageUrl || /[\u0000-\u001f\u007f]/.test(pageUrl) || !/^https?:\/\//i.test(pageUrl)) {
    throw new Error('Page URL must begin with an unmodified HTTP or HTTPS authority');
  }

  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    throw new Error('Page URL must be a valid URL');
  }

  const rawAuthority = /^https?:\/\/([^/?#]*)/i.exec(pageUrl)?.[1];
  const hasUserinfo = rawAuthority?.includes('@') ?? false;
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || hasUserinfo || url.username || url.password) {
    throw new Error('Page URL must be a normal HTTP or HTTPS page URL');
  }
  return normalizeHostname(url.hostname);
}

export function isAccessMode(value: unknown): value is AccessMode {
  return typeof value === 'string' && (ACCESS_MODES as readonly string[]).includes(value);
}

export function isInterfaceLocale(value: unknown): value is InterfaceLocale {
  return typeof value === 'string' && (INTERFACE_LOCALES as readonly string[]).includes(value);
}

export function selectedSiteMatches(rule: SelectedSiteRule, hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === rule.hostname || (rule.includeSubdomains && normalized.endsWith(`.${rule.hostname}`));
}

function normalizeSelectedSite(value: unknown): SelectedSiteRule {
  if (typeof value !== 'object' || value === null) throw new Error('Selected site must be an object');
  const candidate = value as { hostname?: unknown; includeSubdomains?: unknown };
  if (typeof candidate.hostname !== 'string' || typeof candidate.includeSubdomains !== 'boolean') throw new Error('Selected site is invalid');
  return { hostname: normalizeHostname(candidate.hostname), includeSubdomains: candidate.includeSubdomains };
}

function normalizeSelectedSites(values: readonly unknown[]): SelectedSiteRule[] {
  const sites = new Map<string, SelectedSiteRule>();
  for (const value of values) {
    const rule = normalizeSelectedSite(value);
    const key = `${rule.hostname}:${rule.includeSubdomains ? 'subdomains' : 'exact'}`;
    sites.set(key, rule);
  }
  return [...sites.values()].sort((left, right) => left.hostname.localeCompare(right.hostname) || Number(left.includeSubdomains) - Number(right.includeSubdomains));
}

function parseSettings(value: unknown): CaptchaSettings {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_SETTINGS, selectedSites: [], disabledHosts: [] };
  const legacy = value as { version?: unknown; allowlistedHosts?: unknown; disabledHosts?: unknown; copyOnNoField?: unknown; autoFill?: unknown; recognitionShortcut?: unknown };
  if (legacy.version === 1 && Array.isArray(legacy.allowlistedHosts)) {
    return {
      ...DEFAULT_SETTINGS,
      onboardingComplete: true,
      copyOnNoField: legacy.copyOnNoField === true,
      recognitionShortcut: isRecognitionShortcut(legacy.recognitionShortcut) ? legacy.recognitionShortcut : 'middle',
    };
  }
  if (legacy.version === 2 && Array.isArray(legacy.disabledHosts)) {
    try {
      return {
        ...DEFAULT_SETTINGS,
        onboardingComplete: true,
        disabledHosts: [...new Set(legacy.disabledHosts.map(normalizeHostname))].sort(),
        copyOnNoField: legacy.copyOnNoField === true,
        autoFill: legacy.autoFill !== false,
        recognitionShortcut: isRecognitionShortcut(legacy.recognitionShortcut) ? legacy.recognitionShortcut : 'middle',
      };
    } catch {
      return { ...DEFAULT_SETTINGS, onboardingComplete: true, selectedSites: [], disabledHosts: [] };
    }
  }
  const candidate = value as Partial<CaptchaSettings>;
  if (candidate.version !== 3 || !Array.isArray(candidate.disabledHosts) || !Array.isArray(candidate.selectedSites)) {
    return { ...DEFAULT_SETTINGS, selectedSites: [], disabledHosts: [] };
  }

  try {
    return {
      version: 3,
      accessMode: isAccessMode(candidate.accessMode) ? candidate.accessMode : 'all',
      disabledHosts: [...new Set(candidate.disabledHosts.map(normalizeHostname))].sort(),
      selectedSites: normalizeSelectedSites(candidate.selectedSites),
      copyOnNoField: candidate.copyOnNoField === true,
      autoFill: candidate.autoFill !== false,
      recognitionShortcut: isRecognitionShortcut(candidate.recognitionShortcut) ? candidate.recognitionShortcut : 'middle',
      interfaceLocale: isInterfaceLocale(candidate.interfaceLocale) ? candidate.interfaceLocale : 'system',
      onboardingComplete: candidate.onboardingComplete === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS, selectedSites: [], disabledHosts: [] };
  }
}

export function createSettingsStore(adapter: BrowserAdapter): SettingsStore {
  const read = async (): Promise<CaptchaSettings> => parseSettings(await adapter.getLocal<unknown>(SETTINGS_STORAGE_KEY));
  const write = async (settings: CaptchaSettings): Promise<void> => {
    await adapter.setLocal<CaptchaSettings>(SETTINGS_STORAGE_KEY, {
      version: 3,
      accessMode: settings.accessMode,
      disabledHosts: [...new Set(settings.disabledHosts)].sort(),
      selectedSites: normalizeSelectedSites(settings.selectedSites),
      copyOnNoField: settings.copyOnNoField,
      autoFill: settings.autoFill,
      recognitionShortcut: settings.recognitionShortcut,
      interfaceLocale: settings.interfaceLocale,
      onboardingComplete: settings.onboardingComplete,
    });
  };
  const mutate = (operation: () => Promise<void>): Promise<void> => {
    const previous = mutationQueues.get(adapter) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    mutationQueues.set(adapter, next.catch(() => undefined));
    return next;
  };

  return {
    read,
    async isEnabled(pageUrl: string): Promise<boolean> {
      const settings = await read();
      const hostname = hostnameForPage(pageUrl);
      if (settings.disabledHosts.includes(hostname)) return false;
      return settings.accessMode === 'all' || settings.selectedSites.some((rule) => selectedSiteMatches(rule, hostname));
    },
    async enable(hostname: string): Promise<void> {
      const normalized = normalizeHostname(hostname);
      await mutate(async () => {
        const settings = await read();
        const selectedSites = settings.accessMode === 'selected' && !settings.selectedSites.some((rule) => selectedSiteMatches(rule, normalized))
          ? [...settings.selectedSites, { hostname: normalized, includeSubdomains: false }]
          : settings.selectedSites;
        await write({ ...settings, selectedSites, disabledHosts: settings.disabledHosts.filter((host) => host !== normalized) });
      });
    },
    async disable(hostname: string): Promise<void> {
      const normalized = normalizeHostname(hostname);
      await mutate(async () => {
        const settings = await read();
        const selectedSites = settings.accessMode === 'selected'
          ? settings.selectedSites.filter((rule) => rule.hostname !== normalized || rule.includeSubdomains)
          : settings.selectedSites;
        if (!settings.disabledHosts.includes(normalized) || selectedSites.length !== settings.selectedSites.length) {
          await write({ ...settings, selectedSites, disabledHosts: [...new Set([...settings.disabledHosts, normalized])] });
        }
      });
    },
    async setCopyOnNoField(enabled: boolean): Promise<void> {
      if (typeof enabled !== 'boolean') throw new Error('copyOnNoField must be a boolean');
      await mutate(async () => {
        const settings = await read();
        if (settings.copyOnNoField !== enabled) await write({ ...settings, copyOnNoField: enabled });
      });
    },
    async setAutoFill(enabled: boolean): Promise<void> {
      if (typeof enabled !== 'boolean') throw new Error('autoFill must be a boolean');
      await mutate(async () => {
        const settings = await read();
        if (settings.autoFill !== enabled) await write({ ...settings, autoFill: enabled });
      });
    },
    async setRecognitionShortcut(shortcut: RecognitionShortcut): Promise<void> {
      if (!isRecognitionShortcut(shortcut)) throw new Error('recognitionShortcut must be supported');
      await mutate(async () => {
        const settings = await read();
        if (settings.recognitionShortcut !== shortcut) await write({ ...settings, recognitionShortcut: shortcut });
      });
    },
    async setAccessMode(mode: AccessMode): Promise<void> {
      if (!isAccessMode(mode)) throw new Error('accessMode must be supported');
      await mutate(async () => {
        const settings = await read();
        if (settings.accessMode !== mode) await write({ ...settings, accessMode: mode });
      });
    },
    async addSelectedSite(value: SelectedSiteRule): Promise<void> {
      const rule = normalizeSelectedSite(value);
      await mutate(async () => {
        const settings = await read();
        const selectedSites = settings.selectedSites.filter((site) => site.hostname !== rule.hostname || site.includeSubdomains !== rule.includeSubdomains);
        await write({ ...settings, selectedSites: [...selectedSites, rule], disabledHosts: settings.disabledHosts.filter((host) => host !== rule.hostname) });
      });
    },
    async removeSelectedSite(value: SelectedSiteRule): Promise<void> {
      const rule = normalizeSelectedSite(value);
      await mutate(async () => {
        const settings = await read();
        const selectedSites = settings.selectedSites.filter((site) => site.hostname !== rule.hostname || site.includeSubdomains !== rule.includeSubdomains);
        if (selectedSites.length !== settings.selectedSites.length) await write({ ...settings, selectedSites });
      });
    },
    async setInterfaceLocale(locale: InterfaceLocale): Promise<void> {
      if (!isInterfaceLocale(locale)) throw new Error('interfaceLocale must be supported');
      await mutate(async () => {
        const settings = await read();
        if (settings.interfaceLocale !== locale) await write({ ...settings, interfaceLocale: locale });
      });
    },
    async setOnboardingComplete(complete: boolean): Promise<void> {
      if (typeof complete !== 'boolean') throw new Error('onboardingComplete must be a boolean');
      await mutate(async () => {
        const settings = await read();
        if (settings.onboardingComplete !== complete) await write({ ...settings, onboardingComplete: complete });
      });
    },
  };
}
