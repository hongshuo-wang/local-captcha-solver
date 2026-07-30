import type { BrowserAdapter } from './browser-adapter';

export const SETTINGS_STORAGE_KEY = 'captcha-settings';

export const RECOGNITION_SHORTCUTS = ['middle', 'ctrl-click', 'alt-click', 'shift-click'] as const;
export type RecognitionShortcut = typeof RECOGNITION_SHORTCUTS[number];

export function isRecognitionShortcut(value: unknown): value is RecognitionShortcut {
  return typeof value === 'string' && (RECOGNITION_SHORTCUTS as readonly string[]).includes(value);
}

export interface CaptchaSettings {
  version: 2;
  disabledHosts: string[];
  copyOnNoField: boolean;
  autoFill: boolean;
  recognitionShortcut: RecognitionShortcut;
}

export interface SettingsStore {
  read(): Promise<CaptchaSettings>;
  isEnabled(pageUrl: string): Promise<boolean>;
  enable(hostname: string): Promise<void>;
  disable(hostname: string): Promise<void>;
  setCopyOnNoField(enabled: boolean): Promise<void>;
  setAutoFill(enabled: boolean): Promise<void>;
  setRecognitionShortcut(shortcut: RecognitionShortcut): Promise<void>;
}

const EMPTY_SETTINGS: CaptchaSettings = { version: 2, disabledHosts: [], copyOnNoField: false, autoFill: true, recognitionShortcut: 'middle' };
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

function parseSettings(value: unknown): CaptchaSettings {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_SETTINGS };
  const legacy = value as { version?: unknown; allowlistedHosts?: unknown; copyOnNoField?: unknown; recognitionShortcut?: unknown };
  if (legacy.version === 1 && Array.isArray(legacy.allowlistedHosts)) {
    return {
      ...EMPTY_SETTINGS,
      copyOnNoField: legacy.copyOnNoField === true,
      recognitionShortcut: isRecognitionShortcut(legacy.recognitionShortcut) ? legacy.recognitionShortcut : 'middle',
    };
  }
  const candidate = value as Partial<CaptchaSettings>;
  if (candidate.version !== 2 || !Array.isArray(candidate.disabledHosts)) return { ...EMPTY_SETTINGS };

  try {
    return {
      version: 2,
      disabledHosts: [...new Set(candidate.disabledHosts.map(normalizeHostname))].sort(),
      copyOnNoField: candidate.copyOnNoField === true,
      autoFill: candidate.autoFill !== false,
      recognitionShortcut: isRecognitionShortcut(candidate.recognitionShortcut) ? candidate.recognitionShortcut : 'middle',
    };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

export function createSettingsStore(adapter: BrowserAdapter): SettingsStore {
  const read = async (): Promise<CaptchaSettings> => parseSettings(await adapter.getLocal<unknown>(SETTINGS_STORAGE_KEY));
  const write = async (settings: CaptchaSettings): Promise<void> => {
    await adapter.setLocal<CaptchaSettings>(SETTINGS_STORAGE_KEY, {
      version: 2,
      disabledHosts: [...new Set(settings.disabledHosts)].sort(),
      copyOnNoField: settings.copyOnNoField,
      autoFill: settings.autoFill,
      recognitionShortcut: settings.recognitionShortcut,
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
      return !(await read()).disabledHosts.includes(hostnameForPage(pageUrl));
    },
    async enable(hostname: string): Promise<void> {
      const normalized = normalizeHostname(hostname);
      await mutate(async () => {
        const settings = await read();
        await write({ ...settings, disabledHosts: settings.disabledHosts.filter((host) => host !== normalized) });
      });
    },
    async disable(hostname: string): Promise<void> {
      const normalized = normalizeHostname(hostname);
      await mutate(async () => {
        const settings = await read();
        if (!settings.disabledHosts.includes(normalized)) await write({ ...settings, disabledHosts: [...settings.disabledHosts, normalized] });
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
  };
}
