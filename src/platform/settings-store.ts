import type { BrowserAdapter } from './browser-adapter';

export const SETTINGS_STORAGE_KEY = 'captcha-settings';

export interface CaptchaSettings {
  version: 1;
  allowlistedHosts: string[];
}

export interface SettingsStore {
  read(): Promise<CaptchaSettings>;
  isEnabled(pageUrl: string): Promise<boolean>;
  enable(hostname: string): Promise<void>;
  disable(hostname: string): Promise<void>;
}

const EMPTY_SETTINGS: CaptchaSettings = { version: 1, allowlistedHosts: [] };
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

function isSupportedHostname(hostname: string): boolean {
  return hostname !== 'localhost'
    && !hostname.includes(':')
    && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    && HOSTNAME.test(hostname);
}

export function normalizeHostname(hostname: string): string {
  if (typeof hostname !== 'string' || hostname.trim() !== hostname || /[\s\u0000-\u001f\u007f]/.test(hostname)) {
    throw new Error('Hostname must not contain whitespace or control characters');
  }

  const normalized = hostname.toLowerCase();
  if (!isSupportedHostname(normalized)) throw new Error('Hostname must be a supported DNS hostname');
  return normalized;
}

export function hostnameForPage(pageUrl: string): string {
  if (pageUrl.trim() !== pageUrl || /[\u0000-\u001f\u007f]/.test(pageUrl) || !/^https?:\/\//.test(pageUrl)) {
    throw new Error('Page URL must begin with an unmodified HTTP or HTTPS authority');
  }

  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    throw new Error('Page URL must be a valid URL');
  }

  const rawAuthority = /^https?:\/\/([^/?#]*)/.exec(pageUrl)?.[1];
  const hasUserinfo = rawAuthority?.includes('@') ?? false;
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || hasUserinfo || url.username || url.password || url.port) {
    throw new Error('Page URL must be a normal HTTP or HTTPS page URL');
  }
  return normalizeHostname(url.hostname);
}

function parseSettings(value: unknown): CaptchaSettings {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_SETTINGS };
  const candidate = value as Partial<CaptchaSettings>;
  if (candidate.version !== 1 || !Array.isArray(candidate.allowlistedHosts)) return { ...EMPTY_SETTINGS };

  try {
    return {
      version: 1,
      allowlistedHosts: [...new Set(candidate.allowlistedHosts.map(normalizeHostname))].sort(),
    };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

export function createSettingsStore(adapter: BrowserAdapter): SettingsStore {
  const read = async (): Promise<CaptchaSettings> => parseSettings(await adapter.getLocal<unknown>(SETTINGS_STORAGE_KEY));
  const write = async (hosts: Iterable<string>): Promise<void> => {
    await adapter.setLocal<CaptchaSettings>(SETTINGS_STORAGE_KEY, {
      version: 1,
      allowlistedHosts: [...new Set(hosts)].sort(),
    });
  };

  return {
    read,
    async isEnabled(pageUrl: string): Promise<boolean> {
      return (await read()).allowlistedHosts.includes(hostnameForPage(pageUrl));
    },
    async enable(hostname: string): Promise<void> {
      const normalized = normalizeHostname(hostname);
      const settings = await read();
      if (!settings.allowlistedHosts.includes(normalized)) await write([...settings.allowlistedHosts, normalized]);
    },
    async disable(hostname: string): Promise<void> {
      const normalized = normalizeHostname(hostname);
      const settings = await read();
      if (settings.allowlistedHosts.includes(normalized)) {
        await write(settings.allowlistedHosts.filter((host) => host !== normalized));
      }
    },
  };
}
